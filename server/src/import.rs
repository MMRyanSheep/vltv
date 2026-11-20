use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use axum::{
    Json,
    body::Body,
    extract::State,
    http::{HeaderMap, StatusCode, header},
};
use chrono::{DateTime, Datelike, Utc};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;
use tokio::{
    fs::File, io::AsyncWriteExt, process::Command, sync::OwnedSemaphorePermit, time::timeout,
};
use uuid::Uuid;

use crate::{ApiError, AppState, admin::Session};

const REPLAY_LIMIT: usize = 128 * 1024 * 1024;

pub struct Calculator {
    pub python: OsString,
    pub script: PathBuf,
    pub model: PathBuf,
}

#[derive(Serialize, Deserialize)]
pub struct Report {
    summary: Value,
    timeline: Value,
}

#[derive(Deserialize)]
struct CalculatedMatch {
    match_id: Uuid,
    map_id: String,
    patch_version: String,
    ssversion: String,
    rating_version: Option<String>,
    players: Vec<CalculatedPlayer>,
    rounds: Vec<CalculatedRound>,
}

#[derive(Deserialize)]
struct CalculatedPlayer {
    player_id: Uuid,
    agent_id: Uuid,
    team_id: String,
    kills: i32,
    deaths: i32,
    assists: Option<i32>,
    has_scoreboard_kd: bool,
    first_kills: i32,
    uploaded_first_kills: Option<i32>,
    kill_diff: String,
    acs: Option<f64>,
    hs_percent: Option<f64>,
    first_deaths: Option<i32>,
    kast: Option<f64>,
    adr: Option<f64>,
    swingscore: f64,
    rating: Option<f64>,
}

#[derive(Deserialize)]
struct CalculatedRound {
    result: Value,
    timeline: Value,
}

impl Calculator {
    async fn run(&self, report: Report) -> Result<CalculatedMatch, ApiError> {
        let input = serde_json::to_vec(&report).map_err(ApiError::internal)?;
        let mut child = Command::new(&self.python)
            .arg("-X")
            .arg("utf8")
            .arg(&self.script)
            .arg(&self.model)
            .env("OMP_NUM_THREADS", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(ApiError::internal)?;

        let mut stdin = child.stdin.take().expect("piped calculator stdin");
        let (output, write_result) = timeout(Duration::from_secs(45), async move {
            tokio::join!(child.wait_with_output(), async move {
                stdin.write_all(&input).await
            })
        })
        .await
        .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "计算超时，请重试".into()))?;

        let output = output.map_err(ApiError::internal)?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            if output.status.code() == Some(2) {
                return Err(ApiError(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    format!("报告校验失败：{error}"),
                ));
            }
            return Err(ApiError::internal(error));
        }
        write_result.map_err(ApiError::internal)?;
        serde_json::from_slice(&output.stdout).map_err(ApiError::internal)
    }
}

pub async fn handle(
    State(state): State<AppState>,
    _: Session,
    Json(report): Json<Report>,
) -> Result<Json<Value>, ApiError> {
    let _permit = acquire_slot(&state)?;
    import_report(&state, report).await
}

pub async fn handle_replay(
    State(state): State<AppState>,
    _: Session,
    headers: HeaderMap,
    body: Body,
) -> Result<Json<Value>, ApiError> {
    if headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/octet-stream")
    {
        return Err(ApiError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "请上传原始 .vrf 回放。".into(),
        ));
    }
    if headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > REPLAY_LIMIT as u64)
    {
        return Err(replay_too_large());
    }

    let permit = acquire_slot(&state)?;
    let workspace = tempfile::tempdir().map_err(ApiError::internal)?;
    let replay = workspace.path().join("replay.vrf");
    timeout(Duration::from_secs(300), receive_replay(body, &replay))
        .await
        .map_err(|_| ApiError(StatusCode::REQUEST_TIMEOUT, "回放上传超时，请重试。".into()))??;

    let tables = workspace.path().join("tables");
    decode_replay(&state.vrfkit, &replay, &tables).await?;
    let (report, _permit) = tokio::task::spawn_blocking(move || {
        let export = vltv::read_vrfkit_export(&tables, None);
        drop(workspace);
        export.and_then(|export| {
            anyhow::ensure!(export.summary.played_at.is_some(), "回放缺少有效的比赛时间");
            let rounds: Vec<_> = export
                .timelines
                .into_iter()
                .map(|round| {
                    let mut document = json!(round);
                    document["match_id"] = json!(export.summary.match_id);
                    document
                })
                .collect();
            let timeline = json!({
                "match_id": export.summary.match_id,
                "rounds": rounds,
            });
            Ok((
                Report {
                    summary: json!(export.summary),
                    timeline,
                },
                permit,
            ))
        })
    })
    .await
    .map_err(ApiError::internal)?
    .map_err(invalid_replay)?;
    import_report(&state, report).await
}

fn acquire_slot(state: &AppState) -> Result<OwnedSemaphorePermit, ApiError> {
    state.import_slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "正在导入另一场比赛，请稍后重试".into(),
        )
    })
}

fn replay_too_large() -> ApiError {
    ApiError(
        StatusCode::PAYLOAD_TOO_LARGE,
        "单个回放超过 128 MiB。".into(),
    )
}

fn invalid_replay(error: impl std::fmt::Display) -> ApiError {
    eprintln!("VLTV replay import: {error}");
    ApiError(
        StatusCode::UNPROCESSABLE_ENTITY,
        "无法解析此回放，请检查文件是否完整及版本是否受支持。".into(),
    )
}

async fn receive_replay(mut body: Body, path: &Path) -> Result<(), ApiError> {
    let mut file = File::create(path).await.map_err(ApiError::internal)?;
    let mut size = 0;
    while let Some(frame) = body.frame().await {
        let frame = frame
            .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "回放上传中断，请重试。".into()))?;
        if let Ok(chunk) = frame.into_data() {
            size += chunk.len();
            if size > REPLAY_LIMIT {
                return Err(replay_too_large());
            }
            file.write_all(&chunk).await.map_err(ApiError::internal)?;
        }
    }
    file.flush().await.map_err(ApiError::internal)?;
    Ok(())
}

async fn decode_replay(vrfkit: &Path, replay: &Path, tables: &Path) -> Result<(), ApiError> {
    let child = Command::new(vrfkit)
        .arg("export")
        .arg(replay)
        .arg("--out")
        .arg(tables)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                return ApiError(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "服务端找不到回放解析器 vrfkit，请配置 VRFKIT。".into(),
                );
            }
            ApiError::internal(error)
        })?;
    let output = timeout(Duration::from_secs(90), child.wait_with_output())
        .await
        .map_err(|_| ApiError(StatusCode::GATEWAY_TIMEOUT, "回放解析超时，请重试。".into()))?
        .map_err(ApiError::internal)?;
    if !output.status.success() {
        return Err(invalid_replay(String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}

async fn import_report(state: &AppState, report: Report) -> Result<Json<Value>, ApiError> {
    let played_at = match report.summary.get("played_at") {
        None | Some(Value::Null) => None,
        Some(value) => Some(
            value
                .as_str()
                .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
                .map(|time| time.with_timezone(&Utc))
                .filter(|time| (1970..=9999).contains(&time.year()))
                .ok_or_else(|| {
                    ApiError(
                        StatusCode::UNPROCESSABLE_ENTITY,
                        "报告中的比赛时间 played_at 须为带时区的 RFC 3339 时间。".into(),
                    )
                })?,
        ),
    };
    let result = state.calculator.run(report).await?;
    let played_at = save(&state.db, &result, played_at).await?;
    Ok(Json(json!({
        "match_id": result.match_id,
        "round_count": result.rounds.len(),
        "ssversion": result.ssversion,
        "rating_version": result.rating_version,
        "played_at": played_at.map(|time| time.to_rfc3339()),
    })))
}

async fn save(
    db: &PgPool,
    match_data: &CalculatedMatch,
    played_at: Option<DateTime<Utc>>,
) -> sqlx::Result<Option<DateTime<Utc>>> {
    let id = match_data.match_id;
    let mut transaction = db.begin().await?;
    let played_at = sqlx::query_scalar(
        r#"INSERT INTO matches (match_id, map_id, patch_version, ssversion, rating_version, played_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (match_id) DO UPDATE SET map_id = EXCLUDED.map_id,
               patch_version = EXCLUDED.patch_version, ssversion = EXCLUDED.ssversion,
               rating_version = EXCLUDED.rating_version
           RETURNING played_at"#,
    )
    .bind(id)
    .bind(&match_data.map_id)
    .bind(&match_data.patch_version)
    .bind(&match_data.ssversion)
    .bind(&match_data.rating_version)
    .bind(played_at)
    .fetch_one(&mut *transaction)
    .await?;

    let player_ids: Vec<Uuid> = match_data
        .players
        .iter()
        .map(|player| player.player_id)
        .collect();
    sqlx::query("DELETE FROM match_players WHERE match_id = $1 AND NOT (player_id = ANY($2))")
        .bind(id)
        .bind(&player_ids)
        .execute(&mut *transaction)
        .await?;
    sqlx::query("DELETE FROM match_rounds WHERE match_id = $1")
        .bind(id)
        .execute(&mut *transaction)
        .await?;

    for player in &match_data.players {
        sqlx::query("INSERT INTO players (player_id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(player.player_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query(
            r#"INSERT INTO match_players (match_id, player_id, agent_id, team_id,
                                           kills, deaths, first_kills, swingscore,
                                           kill_diff, acs, hs_percent, first_deaths, kast, adr,
                                           assists, has_scoreboard_kd, rating)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
               ON CONFLICT (match_id, player_id) DO UPDATE SET
                   agent_id = EXCLUDED.agent_id,
                   team_id = EXCLUDED.team_id,
                   kills = CASE WHEN match_players.has_scoreboard_kd AND NOT EXCLUDED.has_scoreboard_kd
                                THEN match_players.kills ELSE EXCLUDED.kills END,
                   deaths = CASE WHEN match_players.has_scoreboard_kd AND NOT EXCLUDED.has_scoreboard_kd
                                 THEN match_players.deaths ELSE EXCLUDED.deaths END,
                   first_kills = COALESCE($18, match_players.first_kills),
                   swingscore = EXCLUDED.swingscore,
                   rating = EXCLUDED.rating,
                   kill_diff = CASE WHEN match_players.has_scoreboard_kd AND NOT EXCLUDED.has_scoreboard_kd
                                    THEN match_players.kill_diff ELSE EXCLUDED.kill_diff END,
                   acs = COALESCE(EXCLUDED.acs, match_players.acs),
                   hs_percent = COALESCE(EXCLUDED.hs_percent, match_players.hs_percent),
                   first_deaths = COALESCE(EXCLUDED.first_deaths, match_players.first_deaths),
                   kast = COALESCE(EXCLUDED.kast, match_players.kast),
                   adr = COALESCE(EXCLUDED.adr, match_players.adr),
                   assists = COALESCE(EXCLUDED.assists, match_players.assists),
                   has_scoreboard_kd = match_players.has_scoreboard_kd OR EXCLUDED.has_scoreboard_kd"#,
        )
        .bind(id)
        .bind(player.player_id)
        .bind(player.agent_id)
        .bind(&player.team_id)
        .bind(player.kills)
        .bind(player.deaths)
        .bind(player.first_kills)
        .bind(player.swingscore)
        .bind(&player.kill_diff)
        .bind(player.acs)
        .bind(player.hs_percent)
        .bind(player.first_deaths)
        .bind(player.kast)
        .bind(player.adr)
        .bind(player.assists)
        .bind(player.has_scoreboard_kd)
        .bind(player.rating)
        .bind(player.uploaded_first_kills)
        .execute(&mut *transaction)
        .await?;
    }
    for round in &match_data.rounds {
        let number = round.result["round_id"].as_i64().unwrap_or_default() as i32;
        sqlx::query(
            r#"INSERT INTO match_rounds (match_id, round_id, winner_team_id, result, timeline)
               VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(id)
        .bind(number)
        .bind(round.result["winner_team_id"].as_str())
        .bind(&round.result)
        .bind(&round.timeline)
        .execute(&mut *transaction)
        .await?;
    }
    transaction.commit().await?;
    Ok(played_at)
}

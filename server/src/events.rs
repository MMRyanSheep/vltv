use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::postgres::PgQueryResult;
use uuid::Uuid;

use crate::{ApiError, AppState, admin::Session};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/events", get(schedule))
        .route("/events/{id}", get(event))
        .route("/events/{event_id}/matches/{id}", get(series))
        .route("/teams", get(teams))
        .route("/teams/{id}", get(team))
        .route("/admin/events", get(management).post(create_event))
        .route("/admin/events/{id}", delete(delete_event).put(update_event))
        .route("/admin/events/{id}/placements/{team_id}", axum::routing::put(save_placement))
        .route("/admin/event-teams", post(create_team))
        .route(
            "/admin/event-teams/{id}",
            delete(delete_team).put(update_team),
        )
        .route("/admin/events/{id}/matches", post(create_series))
        .route(
            "/admin/events/{event_id}/matches/{id}",
            delete(delete_series).put(update_series),
        )
}

async fn teams(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(sqlx::query_scalar(
        "SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'logo_bytes' - 'logo_content_type' ORDER BY name, team_id), '[]') FROM event_teams t",
    ).fetch_one(&state.db).await?))
}

async fn team(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    sqlx::query_scalar(include_str!("team_detail.sql"))
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .map(Json)
        .ok_or_else(missing)
}

async fn schedule(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY name, event_id) FROM events e), '[]'),
            'series', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'veto' ||
                                    jsonb_build_object('actual_starts_at', m.played_at)
                                    ORDER BY s.starts_at, s.series_id)
                                FROM event_schedule s
                                LEFT JOIN event_series_maps first_map ON first_map.series_id = s.series_id AND first_map.slot = 1
                                LEFT JOIN matches m ON m.match_id = first_map.replay_id), '[]')
        )"#,
    ).fetch_one(&state.db).await?))
}

async fn event(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    sqlx::query_scalar(
        r#"SELECT to_jsonb(e) || jsonb_build_object(
            'series', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'veto' ||
                                    jsonb_build_object('actual_starts_at', m.played_at)
                                    ORDER BY s.starts_at, s.series_id)
                                FROM event_schedule s
                                LEFT JOIN event_series_maps first_map ON first_map.series_id = s.series_id AND first_map.slot = 1
                                LEFT JOIN matches m ON m.match_id = first_map.replay_id
                                WHERE s.event_id = e.event_id), '[]'),
            'placements', COALESCE((SELECT jsonb_agg(to_jsonb(p) - 'event_id' ORDER BY first_place, team_id)
                                    FROM event_placements p WHERE p.event_id = e.event_id), '[]')
        ) FROM events e WHERE event_id = $1"#,
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or_else(missing)
}

async fn series(
    State(state): State<AppState>,
    Path((event_id, id)): Path<(Uuid, Uuid)>,
) -> Result<Json<Value>, ApiError> {
    sqlx::query_scalar(
        "SELECT to_jsonb(s) FROM event_schedule s WHERE event_id = $1 AND series_id = $2",
    )
    .bind(event_id)
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .map(Json)
    .ok_or_else(missing)
}

async fn management(State(state): State<AppState>, _: Session) -> Result<Json<Value>, ApiError> {
    Ok(Json(sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
            'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY name, event_id) FROM events e), '[]'),
            'teams', COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'logo_bytes' - 'logo_content_type' ORDER BY tag)
                               FROM event_teams t), '[]'),
            'replays', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY COALESCE(played_at, imported_at) DESC, match_id)
                                 FROM match_summary r WHERE NOT EXISTS (
                                   SELECT 1 FROM event_series_maps sm WHERE sm.replay_id = r.match_id
                                 )), '[]')
        )"#,
    ).fetch_one(&state.db).await?))
}

#[derive(Deserialize)]
struct EventInput {
    name: String,
    tier: Option<EventTier>,
}

#[derive(Deserialize, Serialize)]
enum EventTier {
    S,
    A,
    B,
    C,
}

impl EventTier {
    fn label(&self) -> &'static str {
        match self {
            Self::S => "S",
            Self::A => "A",
            Self::B => "B",
            Self::C => "C",
        }
    }
}

#[derive(Deserialize)]
struct PlacementInput {
    first_place: Option<i32>,
    last_place: Option<i32>,
}

#[derive(Deserialize)]
struct TeamInput {
    name: String,
    tag: String,
}

#[derive(Deserialize)]
struct SeriesInput {
    starts_at: String,
    stage: Option<String>,
    best_of: i32,
    team_a: Uuid,
    team_b: Uuid,
    live: bool,
    score_a: Option<i32>,
    score_b: Option<i32>,
    maps: Vec<MapInput>,
    veto: Vec<Veto>,
}

#[derive(Deserialize)]
struct MapInput {
    map_id: Option<String>,
    replay_id: Option<Uuid>,
    a_is_blue: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum VetoAction {
    BanA,
    BanB,
    PickA,
    PickB,
    Decider,
}

#[derive(Deserialize, Serialize)]
struct Veto {
    action: VetoAction,
    map_id: String,
}

fn validate_text(value: &str, max: usize) -> Result<&str, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max || value.chars().any(char::is_control) {
        return Err(invalid(format!("请输入 {max} 字以内的单行文字")));
    }
    Ok(value)
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, message.into())
}

fn missing() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "找不到该记录".into())
}

fn conflict(message: &str) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}

fn write_error(error: sqlx::Error) -> ApiError {
    match error
        .as_database_error()
        .and_then(|error| error.constraint())
    {
        Some("event_teams_tag_key") => conflict("该战队简称已被使用"),
        Some("event_series_maps_replay_id_key") => conflict("该回放已关联至一张赛事地图"),
        Some("event_series_maps_replay_id_fkey") => invalid("找不到所选回放"),
        Some("event_series_team_a_fkey" | "event_series_team_b_fkey") => {
            conflict("请检查所选战队，已被比赛使用的战队无法删除")
        }
        Some("event_series_event_id_fkey") => missing(),
        _ => error.into(),
    }
}

fn changed(result: Result<PgQueryResult, sqlx::Error>) -> Result<StatusCode, ApiError> {
    if result.map_err(write_error)?.rows_affected() == 0 {
        return Err(missing());
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn create_event(
    State(state): State<AppState>,
    _: Session,
    Json(input): Json<EventInput>,
) -> Result<Json<Uuid>, ApiError> {
    Ok(Json(
        sqlx::query_scalar("INSERT INTO events (name, tier) VALUES ($1, $2) RETURNING event_id")
            .bind(validate_text(&input.name, 80)?)
            .bind(input.tier.as_ref().map(EventTier::label))
            .fetch_one(&state.db)
            .await?,
    ))
}

async fn update_event(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<EventInput>,
) -> Result<StatusCode, ApiError> {
    changed(
        sqlx::query("UPDATE events SET name = $2, tier = $3 WHERE event_id = $1")
            .bind(id)
            .bind(validate_text(&input.name, 80)?)
            .bind(input.tier.as_ref().map(EventTier::label))
            .execute(&state.db)
            .await,
    )
}

async fn save_placement(
    State(state): State<AppState>,
    _: Session,
    Path((event_id, team_id)): Path<(Uuid, Uuid)>,
    Json(input): Json<PlacementInput>,
) -> Result<StatusCode, ApiError> {
    match (input.first_place, input.last_place) {
        (None, None) => {
            sqlx::query("DELETE FROM event_placements WHERE event_id = $1 AND team_id = $2")
                .bind(event_id)
                .bind(team_id)
                .execute(&state.db)
                .await?;
        }
        (Some(first), last) if first > 0 && last.unwrap_or(first) >= first => {
            sqlx::query(
                "INSERT INTO event_placements VALUES ($1, $2, $3, $4)
                 ON CONFLICT (event_id, team_id) DO UPDATE SET
                     first_place = EXCLUDED.first_place, last_place = EXCLUDED.last_place",
            )
            .bind(event_id)
            .bind(team_id)
            .bind(first)
            .bind(last.unwrap_or(first))
            .execute(&state.db)
            .await
            .map_err(|error| {
                if error.as_database_error().is_some_and(|e| e.is_foreign_key_violation()) {
                    missing()
                } else {
                    error.into()
                }
            })?;
        }
        _ => return Err(invalid("请输入有效的名次或名次区间")),
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_event(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    changed(
        sqlx::query("DELETE FROM events WHERE event_id = $1")
            .bind(id)
            .execute(&state.db)
            .await,
    )
}

async fn create_team(
    State(state): State<AppState>,
    _: Session,
    Json(input): Json<TeamInput>,
) -> Result<Json<Uuid>, ApiError> {
    Ok(Json(
        sqlx::query_scalar("INSERT INTO event_teams (name, tag) VALUES ($1, $2) RETURNING team_id")
            .bind(validate_text(&input.name, 80)?)
            .bind(validate_text(&input.tag, 16)?.to_uppercase())
            .fetch_one(&state.db)
            .await
            .map_err(write_error)?,
    ))
}

async fn update_team(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<TeamInput>,
) -> Result<StatusCode, ApiError> {
    changed(
        sqlx::query("UPDATE event_teams SET name = $2, tag = $3 WHERE team_id = $1")
            .bind(id)
            .bind(validate_text(&input.name, 80)?)
            .bind(validate_text(&input.tag, 16)?.to_uppercase())
            .execute(&state.db)
            .await,
    )
}

async fn delete_team(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    changed(
        sqlx::query("DELETE FROM event_teams WHERE team_id = $1")
            .bind(id)
            .execute(&state.db)
            .await,
    )
}

async fn create_series(
    State(state): State<AppState>,
    _: Session,
    Path(event_id): Path<Uuid>,
    Json(input): Json<SeriesInput>,
) -> Result<Json<Uuid>, ApiError> {
    Ok(Json(save_series(&state, event_id, None, input).await?))
}

async fn update_series(
    State(state): State<AppState>,
    _: Session,
    Path((event_id, id)): Path<(Uuid, Uuid)>,
    Json(input): Json<SeriesInput>,
) -> Result<StatusCode, ApiError> {
    save_series(&state, event_id, Some(id), input).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_series(
    State(state): State<AppState>,
    _: Session,
    Path((event_id, id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    changed(
        sqlx::query("DELETE FROM event_series WHERE event_id = $1 AND series_id = $2")
            .bind(event_id)
            .bind(id)
            .execute(&state.db)
            .await,
    )
}

async fn save_series(
    state: &AppState,
    event_id: Uuid,
    id: Option<Uuid>,
    mut input: SeriesInput,
) -> Result<Uuid, ApiError> {
    if !matches!(input.best_of, 1 | 3 | 5) || input.maps.len() != input.best_of as usize {
        return Err(invalid("地图数量须与赛制一致"));
    }
    if input.team_a == input.team_b {
        return Err(invalid("请选择两支不同的战队"));
    }
    let starts_at = DateTime::parse_from_rfc3339(&input.starts_at)
        .map_err(|_| invalid("请输入带时区的比赛时间"))?
        .with_timezone(&Utc);
    let target = (input.best_of + 1) / 2;
    match (input.score_a, input.score_b) {
        (None, None) => {}
        (Some(a), Some(b))
            if (0..=target).contains(&a) && (0..=target).contains(&b) && a + b <= input.best_of => {
        }
        _ => return Err(invalid("请填写符合赛制的双方总比分，或将两项都留空")),
    }
    let stage = input
        .stage
        .as_deref()
        .map(|stage| validate_text(stage, 80))
        .transpose()?;
    if input.veto.len() > 7 {
        return Err(invalid("最多可录入 7 条选图记录"));
    }
    for veto in &mut input.veto {
        veto.map_id = validate_text(&veto.map_id, 80)?.to_owned();
    }
    let mut tx = state.db.begin().await?;
    let sql = if id.is_some() {
        r#"UPDATE event_series SET starts_at = $3, stage = $4, best_of = $5, team_a = $6, team_b = $7,
             live = $8, score_a = $9, score_b = $10, veto = $11
           WHERE event_id = $2 AND series_id = $1 RETURNING series_id"#
    } else {
        r#"INSERT INTO event_series (series_id, event_id, starts_at, stage, best_of, team_a, team_b,
                                     live, score_a, score_b, veto)
           VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING series_id"#
    };
    let id: Uuid = sqlx::query_scalar(sql)
        .bind(id)
        .bind(event_id)
        .bind(starts_at)
        .bind(stage)
        .bind(input.best_of)
        .bind(input.team_a)
        .bind(input.team_b)
        .bind(input.live)
        .bind(input.score_a)
        .bind(input.score_b)
        .bind(sqlx::types::Json(input.veto))
        .fetch_optional(&mut *tx)
        .await
        .map_err(write_error)?
        .ok_or_else(missing)?;
    sqlx::query("DELETE FROM event_series_maps WHERE series_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    for (index, map) in input.maps.into_iter().enumerate() {
        let map_id = map
            .map_id
            .as_deref()
            .map(|map_id| validate_text(map_id, 80))
            .transpose()?;
        sqlx::query("INSERT INTO event_series_maps (series_id, slot, map_id, replay_id, a_is_blue) VALUES ($1, $2, $3, $4, $5)")
            .bind(id).bind(index as i32 + 1).bind(map_id).bind(map.replay_id).bind(map.a_is_blue)
            .execute(&mut *tx).await.map_err(write_error)?;
    }
    tx.commit().await?;
    Ok(id)
}

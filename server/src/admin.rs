use std::{
    collections::HashMap,
    env,
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{Context, anyhow, ensure};
use axum::{
    Json, Router,
    extract::{FromRequestParts, Path, State},
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
    routing::{get, patch},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{ApiError, AppState};

const SESSION_SECONDS: u64 = 8 * 60 * 60;

#[derive(Default)]
struct Sessions {
    tokens: HashMap<String, Instant>,
    failures: Vec<Instant>,
}

pub struct Admin {
    username: String,
    key: hmac::Key,
    password_tag: hmac::Tag,
    sessions: Mutex<Sessions>,
}

impl Admin {
    pub fn from_env() -> anyhow::Result<Option<Self>> {
        let username = env::var_os("VLTV_ADMIN_USER");
        let password = env::var_os("VLTV_ADMIN_PASSWORD");
        if username.is_none() && password.is_none() {
            return Ok(None);
        }
        let username = env::var("VLTV_ADMIN_USER").context("Set VLTV_ADMIN_USER")?;
        let password = env::var("VLTV_ADMIN_PASSWORD").context("Set VLTV_ADMIN_PASSWORD")?;
        ensure!(
            !username.trim().is_empty(),
            "VLTV_ADMIN_USER must not be empty"
        );
        ensure!(
            !password.trim().is_empty(),
            "VLTV_ADMIN_PASSWORD must not be empty"
        );
        let key = hmac::Key::generate(hmac::HMAC_SHA256, &SystemRandom::new())
            .map_err(|_| anyhow!("Could not initialize admin authentication"))?;
        let password_tag = hmac::sign(&key, password.as_bytes());
        Ok(Some(Self {
            username,
            key,
            password_tag,
            sessions: Mutex::default(),
        }))
    }

    fn sessions(&self) -> Result<std::sync::MutexGuard<'_, Sessions>, ApiError> {
        self.sessions.lock().map_err(ApiError::internal)
    }
}

fn configured(state: &AppState) -> Result<&Admin, ApiError> {
    state
        .admin
        .as_deref()
        .ok_or_else(|| ApiError(StatusCode::SERVICE_UNAVAILABLE, "管理员账号尚未配置".into()))
}

pub(super) struct Session(String);

impl FromRequestParts<AppState> for Session {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let admin = configured(state)?;
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "))
            .filter(|token| token.len() == 43);
        if let Some(token) = token {
            if admin
                .sessions()?
                .tokens
                .get(token)
                .is_some_and(|expiry| *expiry > Instant::now())
            {
                return Ok(Self(token.into()));
            }
        }
        Err(ApiError(StatusCode::UNAUTHORIZED, "请重新登录".into()))
    }
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/admin/session",
            get(check_session).post(login).delete(logout),
        )
        .route("/admin/players", get(players))
        .route("/admin/players/{id}", patch(update_player))
        .route("/maps", get(maps))
        .route("/admin/maps", patch(update_map))
}

#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}

async fn login(
    State(state): State<AppState>,
    Json(credentials): Json<Credentials>,
) -> Result<Json<Value>, ApiError> {
    let admin = configured(&state)?;
    let mut sessions = admin.sessions()?;
    let now = Instant::now();
    sessions
        .failures
        .retain(|failure| now.duration_since(*failure) < Duration::from_secs(60));
    if sessions.failures.len() >= 5 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "尝试次数过多，请稍后重试".into(),
        ));
    }
    if credentials.username != admin.username
        || hmac::verify(
            &admin.key,
            credentials.password.as_bytes(),
            admin.password_tag.as_ref(),
        )
        .is_err()
    {
        sessions.failures.push(now);
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "用户名或密码错误".into(),
        ));
    }
    let mut bytes = [0; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| ApiError::internal("Could not generate admin session"))?;
    let token = URL_SAFE_NO_PAD.encode(bytes);
    sessions.tokens.retain(|_, expiry| *expiry > now);
    sessions
        .tokens
        .insert(token.clone(), now + Duration::from_secs(SESSION_SECONDS));
    Ok(Json(json!({ "token": token, "max_age": SESSION_SECONDS })))
}

async fn logout(
    State(state): State<AppState>,
    Session(token): Session,
) -> Result<StatusCode, ApiError> {
    configured(&state)?.sessions()?.tokens.remove(&token);
    Ok(StatusCode::NO_CONTENT)
}

async fn check_session(_: Session) -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn players(State(state): State<AppState>, _: Session) -> Result<Json<Vec<Value>>, ApiError> {
    let players = sqlx::query_scalar(
        r#"SELECT jsonb_build_object('player_id', p.player_id, 'display_name', p.display_name,
                                    'agent_id', latest.agent_id, 'avatar_version', p.avatar_version)
           FROM players p
           LEFT JOIN LATERAL (
               SELECT mp.agent_id FROM match_players mp JOIN matches m USING (match_id)
               WHERE mp.player_id = p.player_id
               ORDER BY COALESCE(m.played_at, m.imported_at) DESC, m.match_id LIMIT 1
           ) latest ON true
           ORDER BY p.display_name NULLS LAST, p.player_id"#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(players))
}

async fn maps(State(state): State<AppState>) -> Result<Json<Vec<Value>>, ApiError> {
    let maps = sqlx::query_scalar(
        r#"SELECT jsonb_build_object('map_id', ids.map_id, 'display_name', n.display_name,
                                    'image_version', i.version)
           FROM (SELECT map_id FROM matches UNION SELECT map_id FROM map_names
                 UNION SELECT map_id FROM map_images) ids
           LEFT JOIN map_names n USING (map_id)
           LEFT JOIN map_images i USING (map_id) ORDER BY ids.map_id"#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(maps))
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

fn display_name(value: &str) -> Result<Option<&str>, ApiError> {
    let name = value.trim();
    if name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "名称须为 80 字以内的单行文字".into(),
        ));
    }
    Ok((!name.is_empty()).then_some(name))
}

async fn update_player(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
    Json(input): Json<Name>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("UPDATE players SET display_name = $2 WHERE player_id = $1")
        .bind(id)
        .bind(display_name(&input.name)?)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "找不到该选手".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MapName {
    id: String,
    name: String,
}

async fn update_map(
    State(state): State<AppState>,
    _: Session,
    Json(input): Json<MapName>,
) -> Result<StatusCode, ApiError> {
    if input.id.trim().is_empty() || input.id.chars().any(char::is_control) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "地图编号无效".into()));
    }
    if let Some(name) = display_name(&input.name)? {
        sqlx::query(
            r#"INSERT INTO map_names (map_id, display_name) VALUES ($1, $2)
               ON CONFLICT (map_id) DO UPDATE SET display_name = EXCLUDED.display_name"#,
        )
        .bind(input.id)
        .bind(name)
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query("DELETE FROM map_names WHERE map_id = $1")
            .bind(input.id)
            .execute(&state.db)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

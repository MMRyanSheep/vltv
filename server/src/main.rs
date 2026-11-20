mod admin;
mod archive;
mod events;
mod import;
mod media;
mod weekly;

use std::{env, path::PathBuf, sync::Arc};

use anyhow::Context;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use sqlx::{
    PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use tokio::{net::TcpListener, sync::Semaphore};
use uuid::Uuid;

const IMPORT_LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone)]
struct AppState {
    db: PgPool,
    admin: Option<Arc<admin::Admin>>,
    calculator: Arc<import::Calculator>,
    import_slots: Arc<Semaphore>,
    vrfkit: PathBuf,
}

struct ApiError(StatusCode, String);

impl ApiError {
    fn internal(error: impl std::fmt::Display) -> Self {
        eprintln!("VLTV API: {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "服务处理失败，请查看本地 API 日志".into(),
        )
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        Self::internal(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let database_options = match env::var("DATABASE_URL") {
        Ok(url) => url.parse()?,
        Err(env::VarError::NotPresent) if env::var_os("PGHOST").is_some() => {
            PgConnectOptions::new()
        }
        Err(error) => return Err(error).context("Set DATABASE_URL or PostgreSQL PG* variables"),
    };
    let db = PgPoolOptions::new()
        .max_connections(8)
        .connect_with(database_options)
        .await?;
    sqlx::migrate!().run(&db).await?;

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let calculator = import::Calculator {
        python: env::var_os("VLTV_PYTHON").unwrap_or_else(|| "python".into()),
        script: root.join("calculate_report.py"),
        model: env::var_os("VLTV_SWING_MODEL")
            .map(PathBuf::from)
            .unwrap_or_else(|| root.join("../training/round_win_model.txt")),
    };
    let state = AppState {
        db,
        admin: admin::Admin::from_env()?.map(Arc::new),
        calculator: Arc::new(calculator),
        import_slots: Arc::new(Semaphore::new(1)),
        vrfkit: env::var_os("VRFKIT").map(PathBuf::from).unwrap_or_else(|| {
            let bundled = root.join("../target/vrfkit-build/release/vrfkit.exe");
            if bundled.is_file() {
                bundled
            } else {
                "vrfkit".into()
            }
        }),
    };

    let app = Router::new()
        .merge(admin::routes())
        .merge(media::routes())
        .merge(events::routes())
        .route("/health", get(health))
        .route("/overview", get(overview))
        .route("/player-of-the-week", get(weekly::current))
        .route(
            "/admin/player-of-the-week",
            get(weekly::candidates).put(weekly::update),
        )
        .route("/matches/{id}", get(match_detail))
        .route("/players/{id}", get(player_profile))
        .route(
            "/imports",
            post(import::handle).layer(DefaultBodyLimit::max(IMPORT_LIMIT)),
        )
        .route("/imports/replay", post(import::handle_replay))
        .with_state(state);
    let address = env::var("VLTV_API_ADDR").unwrap_or_else(|_| "127.0.0.1:3101".into());
    let listener = TcpListener::bind(&address).await?;
    println!("VLTV API listening on http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> Result<StatusCode, StatusCode> {
    sqlx::query("SELECT 1")
        .execute(&state.db)
        .await
        .map(|_| StatusCode::NO_CONTENT)
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE)
}

async fn overview(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(archive::overview(&state.db).await?))
}

async fn match_detail(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    archive::match_detail(&state.db, id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "找不到这场比赛".into()))
}

async fn player_profile(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    archive::player_profile(&state.db, id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "找不到该选手".into()))
}

use std::io::Cursor;

use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, put},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use image::{ImageFormat, ImageReader, Limits};
use ring::digest::{SHA256, digest};
use uuid::Uuid;

use crate::{ApiError, AppState, admin::Session};

const IMAGE_BYTES: usize = 5 * 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/media/players/{id}", get(avatar))
        .route("/media/maps/{id}", get(map_image))
        .route("/media/event-teams/{id}", get(team_logo))
        .route(
            "/admin/event-teams/{id}/image",
            put(save_team_logo).layer(DefaultBodyLimit::max(IMAGE_BYTES)),
        )
        .route(
            "/admin/players/{id}/image",
            put(save_avatar).layer(DefaultBodyLimit::max(IMAGE_BYTES)),
        )
        .route(
            "/admin/maps/{id}/image",
            put(save_map_image).layer(DefaultBodyLimit::max(IMAGE_BYTES)),
        )
}

async fn validate(bytes: Bytes) -> Result<(&'static str, Bytes), ApiError> {
    tokio::task::spawn_blocking(move || {
        let invalid = || {
            ApiError(
                StatusCode::BAD_REQUEST,
                "请选择有效的 JPG、PNG 或 WebP 图片".into(),
            )
        };
        let format = image::guess_format(&bytes).map_err(|_| invalid())?;
        let content_type = match format {
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::Png => "image/png",
            ImageFormat::WebP => "image/webp",
            _ => return Err(invalid()),
        };
        let mut reader = ImageReader::with_format(Cursor::new(bytes.as_ref()), format);
        let mut limits = Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        reader.limits(limits);
        reader.decode().map_err(|error| match error {
            image::ImageError::Limits(_) => {
                ApiError(StatusCode::BAD_REQUEST, "图片宽高须在 4096 像素以内".into())
            }
            _ => invalid(),
        })?;
        Ok((content_type, bytes))
    })
    .await
    .map_err(ApiError::internal)?
}

async fn save_avatar(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
    bytes: Bytes,
) -> Result<StatusCode, ApiError> {
    let (content_type, bytes) = validate(bytes).await?;
    let result = sqlx::query("UPDATE players SET avatar_content_type = $2, avatar_bytes = $3, avatar_version = $4 WHERE player_id = $1")
        .bind(id)
        .bind(content_type)
        .bind(bytes.as_ref())
        .bind(URL_SAFE_NO_PAD.encode(digest(&SHA256, &bytes)))
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "找不到该选手".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn save_map_image(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<String>,
    bytes: Bytes,
) -> Result<StatusCode, ApiError> {
    if id.trim().is_empty() || id.chars().any(char::is_control) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "地图编号无效".into()));
    }
    let (content_type, bytes) = validate(bytes).await?;
    sqlx::query(
        r#"INSERT INTO map_images (map_id, content_type, image_bytes, version) VALUES ($1, $2, $3, $4)
           ON CONFLICT (map_id) DO UPDATE SET content_type = EXCLUDED.content_type,
                                              image_bytes = EXCLUDED.image_bytes,
                                              version = EXCLUDED.version"#,
    )
    .bind(id)
    .bind(content_type)
    .bind(bytes.as_ref())
    .bind(URL_SAFE_NO_PAD.encode(digest(&SHA256, &bytes)))
    .execute(&state.db)
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn avatar(State(state): State<AppState>, Path(id): Path<Uuid>) -> Result<Response, ApiError> {
    let image = sqlx::query_as("SELECT avatar_content_type, avatar_bytes FROM players WHERE player_id = $1 AND avatar_bytes IS NOT NULL")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    image_response(image)
}

async fn save_team_logo(
    State(state): State<AppState>,
    _: Session,
    Path(id): Path<Uuid>,
    bytes: Bytes,
) -> Result<StatusCode, ApiError> {
    let (content_type, bytes) = validate(bytes).await?;
    let result = sqlx::query("UPDATE event_teams SET logo_content_type = $2, logo_bytes = $3, logo_version = $4 WHERE team_id = $1")
        .bind(id)
        .bind(content_type)
        .bind(bytes.as_ref())
        .bind(URL_SAFE_NO_PAD.encode(digest(&SHA256, &bytes)))
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "找不到该战队".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn team_logo(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let image = sqlx::query_as("SELECT logo_content_type, logo_bytes FROM event_teams WHERE team_id = $1 AND logo_bytes IS NOT NULL")
        .bind(id)
        .fetch_optional(&state.db)
        .await?;
    image_response(image)
}

async fn map_image(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let image =
        sqlx::query_as("SELECT content_type, image_bytes FROM map_images WHERE map_id = $1")
            .bind(id)
            .fetch_optional(&state.db)
            .await?;
    image_response(image)
}

fn image_response(image: Option<(String, Vec<u8>)>) -> Result<Response, ApiError> {
    let (content_type, bytes) =
        image.ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "找不到该图片".into()))?;
    Ok((
        [
            (header::CONTENT_TYPE, content_type.as_str()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes,
    )
        .into_response())
}

use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{ApiError, AppState, admin::Session};

pub async fn current(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let selection = sqlx::query_scalar(
        r#"WITH week AS (
               SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai')::date AS week_start
           )
           SELECT jsonb_build_object(
               'week_start', week.week_start,
               'selection', (
                   SELECT jsonb_build_object(
                       'player_id', p.player_id, 'display_name', p.display_name,
                       'reason', w.reason, 'highlight', w.highlight, 'agent_id', favorite.agent_id
                   )
                   FROM weekly_players w JOIN players p USING (player_id)
                   LEFT JOIN LATERAL (
                       SELECT mp.agent_id
                       FROM match_players mp JOIN matches m USING (match_id)
                       WHERE mp.player_id = w.player_id
                         AND COALESCE(m.played_at, m.imported_at) >= (w.week_start::timestamp AT TIME ZONE 'Asia/Shanghai')
                         AND COALESCE(m.played_at, m.imported_at) < ((w.week_start + 7)::timestamp AT TIME ZONE 'Asia/Shanghai')
                       GROUP BY mp.agent_id
                       ORDER BY count(*) DESC, max(COALESCE(m.played_at, m.imported_at)) DESC, mp.agent_id
                       LIMIT 1
                   ) favorite ON true
                   WHERE w.week_start = week.week_start
               )
           ) FROM week"#,
    )
    .fetch_one(&state.db)
    .await?;
    Ok(Json(selection))
}

pub async fn candidates(
    State(state): State<AppState>,
    _: Session,
) -> Result<Json<Value>, ApiError> {
    let Json(mut weekly) = current(State(state.clone())).await?;
    let stats: Value = sqlx::query_scalar(
        r#"WITH week AS (
               SELECT $1::text::date AS week_start
           ), weekly_matches AS (
               SELECT m.match_id, m.round_count
               FROM match_summary m CROSS JOIN week
               WHERE COALESCE(m.played_at, m.imported_at) >= (week.week_start::timestamp AT TIME ZONE 'Asia/Shanghai')
                 AND COALESCE(m.played_at, m.imported_at) < ((week.week_start + 7)::timestamp AT TIME ZONE 'Asia/Shanghai')
                 AND m.round_count > 0
           ), eligible_players AS (
               SELECT p.player_id
               FROM weekly_matches m JOIN match_players p USING (match_id)
               GROUP BY p.player_id
               HAVING count(*) >= 2
           ), results AS (
               SELECT p.player_id, metric.category, sum(metric.total) / sum(m.round_count) AS value,
                      count(*) AS match_count, sum(m.round_count) AS round_count
               FROM weekly_matches m JOIN match_players p USING (match_id)
               JOIN eligible_players e USING (player_id)
               CROSS JOIN LATERAL (VALUES
                   ('impact', p.swingscore * m.round_count),
                   ('damage', p.adr * m.round_count),
                   ('opening', p.first_kills * 100.0),
                   ('assists', p.assists::double precision),
                   ('participation', p.kast * m.round_count)
               ) AS metric(category, total)
               WHERE metric.total IS NOT NULL
               GROUP BY p.player_id, metric.category
           ), ranked AS (
               SELECT *, row_number() OVER (
                   PARTITION BY category ORDER BY value DESC, round_count DESC, player_id
               ) AS position
               FROM results
           ), shortlists AS (
               SELECT category, jsonb_agg(to_jsonb(ranked) - 'category' - 'position'
                                          ORDER BY position) AS candidates
               FROM ranked WHERE position <= 3
               GROUP BY category
           )
           SELECT jsonb_build_object(
               'match_count', (SELECT count(*) FROM weekly_matches),
               'round_count', (SELECT coalesce(sum(round_count), 0) FROM weekly_matches),
               'candidates', coalesce((SELECT jsonb_object_agg(category, candidates) FROM shortlists), '{}')
           )"#,
    )
    .bind(weekly["week_start"].as_str())
    .fetch_one(&state.db)
    .await?;
    weekly["stats"] = stats;
    Ok(Json(weekly))
}

#[derive(Deserialize)]
pub struct Selection {
    player_id: Uuid,
    reason: String,
    highlight: String,
}

pub async fn update(
    State(state): State<AppState>,
    _: Session,
    Json(input): Json<Option<Selection>>,
) -> Result<StatusCode, ApiError> {
    let Some(input) = input else {
        sqlx::query(
            "DELETE FROM weekly_players WHERE week_start = date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai')::date",
        )
        .execute(&state.db)
        .await?;
        return Ok(StatusCode::NO_CONTENT);
    };

    let reason = input.reason.trim();
    let highlight = input.highlight.trim();
    if reason.is_empty() || reason.chars().count() > 120 || reason.chars().any(char::is_control) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "上榜原因须为 1–120 字的单行文字".into(),
        ));
    }
    if highlight.chars().count() > 12 || highlight.chars().any(char::is_control) {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "高亮数据须为 12 字以内的单行文字".into(),
        ));
    }

    let result = sqlx::query(
        r#"INSERT INTO weekly_players (week_start, player_id, reason, highlight)
           SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Shanghai')::date, player_id, $2, $3
           FROM players WHERE player_id = $1
             AND EXISTS (SELECT 1 FROM match_players WHERE player_id = $1)
           ON CONFLICT (week_start) DO UPDATE SET
               player_id = EXCLUDED.player_id, reason = EXCLUDED.reason, highlight = EXCLUDED.highlight"#,
    )
    .bind(input.player_id)
    .bind(reason)
    .bind((!highlight.is_empty()).then_some(highlight))
    .execute(&state.db)
    .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError(StatusCode::NOT_FOUND, "找不到该选手".into()));
    }
    Ok(StatusCode::NO_CONTENT)
}

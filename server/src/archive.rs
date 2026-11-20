use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn overview(db: &PgPool) -> sqlx::Result<Value> {
    sqlx::query_scalar(
        r#"WITH best_per_player AS (
             SELECT DISTINCT ON (p.player_id) p.player_id, p.agent_id, p.swingscore,
                    p.match_id, m.map_id, u.display_name, u.avatar_version
             FROM match_players p JOIN matches m USING (match_id)
                                  JOIN players u USING (player_id)
             ORDER BY p.player_id, p.swingscore DESC, p.match_id
           ), leaders AS (
             SELECT * FROM best_per_player ORDER BY swingscore DESC, player_id LIMIT 5
           ), profiles AS (
             SELECT DISTINCT ON (p.player_id) p.player_id, p.agent_id, u.display_name,
                    u.avatar_version,
                    count(*) OVER (PARTITION BY p.player_id) AS match_count
             FROM match_players p JOIN matches m USING (match_id)
                                  JOIN players u USING (player_id)
             ORDER BY p.player_id, COALESCE(m.played_at, m.imported_at) DESC, m.match_id
           )
           SELECT jsonb_build_object(
             'matches', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY COALESCE(played_at, imported_at) DESC, match_id)
                                 FROM match_summary m), '[]'),
             'leaders', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY swingscore DESC, player_id)
                                  FROM leaders l), '[]'),
             'profiles', COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY match_count DESC, player_id)
                                   FROM profiles p), '[]'),
             'round_count', (SELECT count(*) FROM match_rounds)
           )"#,
    )
    .fetch_one(db)
    .await
}

pub async fn match_detail(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Value>> {
    sqlx::query_scalar(
        r#"SELECT to_jsonb(m) || jsonb_build_object(
             'players', (SELECT jsonb_agg((to_jsonb(p) - 'match_id' - 'has_scoreboard_kd')
                                          || jsonb_build_object('display_name', u.display_name,
                                                                'avatar_version', u.avatar_version)
                                          ORDER BY p.rating DESC NULLS LAST, swingscore DESC, kills DESC, player_id)
                         FROM match_players p JOIN players u USING (player_id)
                         WHERE p.match_id = m.match_id),
             'rounds', (SELECT jsonb_agg(jsonb_build_object('result', r.result, 'timeline', r.timeline)
                                         ORDER BY round_id)
                        FROM match_rounds r WHERE r.match_id = m.match_id)
           )
           FROM match_summary m WHERE m.match_id = $1"#,
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

pub async fn player_profile(db: &PgPool, id: Uuid) -> sqlx::Result<Option<Value>> {
    sqlx::query_scalar(
        r#"SELECT jsonb_build_object(
             'player_id', u.player_id,
             'display_name', u.display_name,
             'avatar_version', u.avatar_version,
             'matches', jsonb_agg(to_jsonb(m) || (to_jsonb(p) - 'player_id' - 'match_id' - 'has_scoreboard_kd')
                                  ORDER BY COALESCE(m.played_at, m.imported_at) DESC, m.match_id),
             'series', COALESCE((
                 SELECT jsonb_agg(to_jsonb(s) - 'veto' ORDER BY s.starts_at DESC, s.series_id)
                 FROM event_schedule s
                 WHERE s.series_id IN (
                     SELECT sm.series_id FROM match_players mp
                     JOIN event_series_maps sm ON sm.replay_id = mp.match_id
                     WHERE mp.player_id = $1
                 )
             ), '[]')
           )
           FROM players u JOIN match_players p USING (player_id)
                          JOIN match_summary m USING (match_id)
           WHERE u.player_id = $1
           GROUP BY u.player_id"#,
    )
    .bind(id)
    .fetch_optional(db)
    .await
}

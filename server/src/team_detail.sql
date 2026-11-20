WITH team_series AS MATERIALIZED (
    SELECT s.*, e.tier, raw.team_a = $1 AS target_is_a,
           s.starts_at BETWEEN now() - interval '3 months' AND now() AS recent
    FROM event_series raw
    JOIN event_schedule s USING (series_id)
    JOIN events e ON e.event_id = raw.event_id
    WHERE raw.team_a = $1 OR raw.team_b = $1
), team_maps AS (
    SELECT s.series_id, s.event_id, s.starts_at, s.recent,
           sm.slot, m.map_id, m.round_count, m.blue_score + m.red_score AS completed_rounds,
           CASE WHEN side.is_blue THEN m.blue_score ELSE m.red_score END AS team_score,
           CASE WHEN side.is_blue THEN m.red_score ELSE m.blue_score END AS opponent_score,
           COALESCE(lineup.players, '[]') AS players
    FROM team_series s
    JOIN event_series_maps sm USING (series_id)
    JOIN match_summary m ON m.match_id = sm.replay_id
    CROSS JOIN LATERAL (SELECT s.target_is_a = sm.a_is_blue AS is_blue) side
    CROSS JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
            'player_id', p.player_id, 'display_name', u.display_name, 'avatar_version', u.avatar_version,
            'agent_id', p.agent_id, 'kills', p.kills, 'deaths', p.deaths, 'assists', p.assists,
            'acs', p.acs, 'adr', p.adr, 'kast', p.kast, 'rating', p.rating, 'swingscore', p.swingscore
        ) ORDER BY p.player_id) AS players
        FROM match_players p JOIN players u USING (player_id)
        WHERE p.match_id = m.match_id AND p.team_id = CASE WHEN side.is_blue THEN 'Blue' ELSE 'Red' END
    ) lineup
), team_events AS (
    SELECT e.event_id, e.name, e.tier, p.first_place, p.last_place, activity.last_match
    FROM events e
    LEFT JOIN event_placements p ON p.event_id = e.event_id AND p.team_id = $1
    LEFT JOIN (
        SELECT event_id, max(starts_at) FILTER (WHERE status <> 'scheduled') AS last_match
        FROM team_series GROUP BY event_id
    ) activity ON activity.event_id = e.event_id
    WHERE p.team_id IS NOT NULL OR activity.event_id IS NOT NULL
)
SELECT jsonb_build_object(
    'team', to_jsonb(t) - 'logo_bytes' - 'logo_content_type',
    'series', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'veto' ORDER BY starts_at DESC, series_id)
                       FROM team_series s), '[]'),
    'maps', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY starts_at DESC, series_id, slot DESC)
                     FROM team_maps m), '[]'),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY last_match DESC NULLS LAST, name, event_id)
                       FROM team_events e), '[]')
) FROM event_teams t WHERE t.team_id = $1;

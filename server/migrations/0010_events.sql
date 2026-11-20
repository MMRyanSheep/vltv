CREATE TABLE event_teams (
    team_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    tag text NOT NULL UNIQUE,
    logo_content_type text,
    logo_bytes bytea,
    logo_version text
);

CREATE TABLE events (
    event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL
);

CREATE TABLE event_series (
    series_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    stage text,
    best_of integer NOT NULL CHECK (best_of IN (1, 3, 5)),
    team_a uuid NOT NULL REFERENCES event_teams,
    team_b uuid NOT NULL REFERENCES event_teams,
    live boolean NOT NULL,
    score_a integer,
    score_b integer,
    veto jsonb NOT NULL,
    CHECK (team_a <> team_b),
    CHECK (
        (score_a IS NULL AND score_b IS NULL)
        OR (score_a IS NOT NULL AND score_b IS NOT NULL
            AND score_a BETWEEN 0 AND (best_of + 1) / 2
            AND score_b BETWEEN 0 AND (best_of + 1) / 2
            AND score_a + score_b <= best_of)
    )
);

CREATE INDEX event_series_by_event ON event_series (event_id, starts_at);
CREATE INDEX event_series_by_team_a ON event_series (team_a);
CREATE INDEX event_series_by_team_b ON event_series (team_b);

CREATE TABLE event_series_maps (
    series_id uuid NOT NULL REFERENCES event_series ON DELETE CASCADE,
    slot integer NOT NULL CHECK (slot BETWEEN 1 AND 5),
    map_id text,
    replay_id uuid UNIQUE REFERENCES matches ON DELETE SET NULL,
    a_is_blue boolean NOT NULL,
    PRIMARY KEY (series_id, slot)
);

CREATE VIEW event_schedule AS
SELECT s.series_id, s.event_id, e.name AS event_name, s.stage, s.starts_at, s.best_of,
       jsonb_build_object('team_id', a.team_id, 'name', a.name, 'tag', a.tag, 'logo_version', a.logo_version) AS team_a,
       jsonb_build_object('team_id', b.team_id, 'name', b.name, 'tag', b.tag, 'logo_version', b.logo_version) AS team_b,
       COALESCE(s.score_a, maps.wins_a, 0) AS score_a,
       COALESCE(s.score_b, maps.wins_b, 0) AS score_b,
       CASE WHEN greatest(COALESCE(s.score_a, maps.wins_a, 0), COALESCE(s.score_b, maps.wins_b, 0)) >= (s.best_of + 1) / 2
            THEN 'finished' WHEN s.live OR COALESCE(s.score_a, maps.wins_a, 0) + COALESCE(s.score_b, maps.wins_b, 0) > 0
            THEN 'live' ELSE 'scheduled' END AS status,
       COALESCE(maps.entries, '[]') AS maps,
       s.score_a AS manual_score_a, s.score_b AS manual_score_b, s.live, s.veto
FROM event_series s
JOIN events e USING (event_id)
JOIN event_teams a ON a.team_id = s.team_a
JOIN event_teams b ON b.team_id = s.team_b
CROSS JOIN LATERAL (
    SELECT LEAST((s.best_of + 1) / 2, count(*) FILTER (WHERE decided AND score_a > score_b))::integer AS wins_a,
           LEAST((s.best_of + 1) / 2, count(*) FILTER (WHERE decided AND score_b > score_a))::integer AS wins_b,
           jsonb_agg(jsonb_build_object('slot', slot, 'map_id', map_id, 'replay_id', replay_id,
                        'planned_map_id', planned_map_id, 'a_is_blue', a_is_blue,
                        'score_a', score_a, 'score_b', score_b) ORDER BY slot) AS entries
    FROM (
        SELECT slot, COALESCE(m.map_id, sm.map_id) AS map_id, sm.map_id AS planned_map_id, sm.replay_id, sm.a_is_blue,
               CASE WHEN sm.a_is_blue THEN m.blue_score ELSE m.red_score END AS score_a,
               CASE WHEN sm.a_is_blue THEN m.red_score ELSE m.blue_score END AS score_b,
               m.round_count > 0 AND m.blue_score + m.red_score = m.round_count AS decided
        FROM event_series_maps sm LEFT JOIN match_summary m ON m.match_id = sm.replay_id
        WHERE sm.series_id = s.series_id
    ) maps
) maps;

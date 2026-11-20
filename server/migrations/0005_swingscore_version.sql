ALTER TABLE matches
    ADD COLUMN ssversion text NOT NULL DEFAULT '1.0'
    CHECK (ssversion ~ '^[0-9]+[.][0-9]+$');

ALTER TABLE matches ALTER COLUMN ssversion DROP DEFAULT;

CREATE OR REPLACE VIEW match_summary AS
SELECT m.match_id,
       m.map_id,
       m.patch_version,
       m.imported_at,
       s.round_count,
       s.blue_score,
       s.red_score,
       m.ssversion
FROM matches m
CROSS JOIN LATERAL (
    SELECT count(*)::integer AS round_count,
           count(*) FILTER (WHERE r.winner_team_id = 'Blue')::integer AS blue_score,
           count(*) FILTER (WHERE r.winner_team_id = 'Red')::integer AS red_score
    FROM match_rounds r WHERE r.match_id = m.match_id
) s;

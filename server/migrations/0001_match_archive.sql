CREATE TABLE matches (
    match_id uuid PRIMARY KEY,
    map_id text NOT NULL,
    patch_version text NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE players (
    player_id uuid PRIMARY KEY
);

CREATE TABLE match_players (
    match_id uuid NOT NULL REFERENCES matches ON DELETE CASCADE,
    player_id uuid NOT NULL REFERENCES players,
    agent_id uuid NOT NULL,
    team_id text NOT NULL CHECK (team_id IN ('Blue', 'Red')),
    kills integer NOT NULL CHECK (kills >= 0),
    deaths integer NOT NULL CHECK (deaths >= 0),
    first_kills integer NOT NULL CHECK (first_kills >= 0),
    swingscore double precision NOT NULL,
    PRIMARY KEY (match_id, player_id)
);

CREATE INDEX match_players_by_player ON match_players (player_id);

CREATE TABLE match_rounds (
    match_id uuid NOT NULL REFERENCES matches ON DELETE CASCADE,
    round_id integer NOT NULL CHECK (round_id > 0),
    winner_team_id text CHECK (winner_team_id IN ('Blue', 'Red')),
    result jsonb NOT NULL,
    timeline jsonb NOT NULL,
    PRIMARY KEY (match_id, round_id)
);

CREATE VIEW match_summary AS
SELECT m.*,
       s.round_count,
       s.blue_score,
       s.red_score
FROM matches m
CROSS JOIN LATERAL (
    SELECT count(*)::integer AS round_count,
           count(*) FILTER (WHERE r.winner_team_id = 'Blue')::integer AS blue_score,
           count(*) FILTER (WHERE r.winner_team_id = 'Red')::integer AS red_score
    FROM match_rounds r WHERE r.match_id = m.match_id
) s;

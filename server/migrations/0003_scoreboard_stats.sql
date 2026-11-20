ALTER TABLE match_players
    ADD COLUMN assists integer CHECK (assists >= 0),
    ADD COLUMN has_scoreboard_kd boolean NOT NULL DEFAULT false;

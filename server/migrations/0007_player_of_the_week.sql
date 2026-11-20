CREATE TABLE weekly_players (
    week_start date PRIMARY KEY CHECK (extract(isodow FROM week_start) = 1),
    player_id uuid NOT NULL REFERENCES players,
    reason varchar(120) NOT NULL CHECK (length(reason) > 0),
    highlight varchar(12)
);

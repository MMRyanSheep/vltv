ALTER TABLE players ADD COLUMN display_name text;

CREATE TABLE map_names (
    map_id text PRIMARY KEY,
    display_name text NOT NULL
);

ALTER TABLE events ADD COLUMN tier text CHECK (tier IN ('S', 'A', 'B', 'C'));

CREATE TABLE event_placements (
    event_id uuid NOT NULL REFERENCES events ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES event_teams ON DELETE CASCADE,
    first_place integer NOT NULL CHECK (first_place > 0),
    last_place integer NOT NULL CHECK (last_place >= first_place),
    PRIMARY KEY (event_id, team_id)
);

CREATE INDEX event_placements_by_team ON event_placements (team_id);

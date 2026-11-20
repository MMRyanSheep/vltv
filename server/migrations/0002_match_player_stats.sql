ALTER TABLE match_players
    ADD COLUMN kill_diff text,
    ADD COLUMN acs double precision,
    ADD COLUMN hs_percent double precision,
    ADD COLUMN first_deaths integer CHECK (first_deaths >= 0),
    ADD COLUMN kast double precision,
    ADD COLUMN adr double precision;

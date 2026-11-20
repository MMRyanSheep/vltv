ALTER TABLE players
    ADD COLUMN avatar_version text,
    ADD COLUMN avatar_content_type text,
    ADD COLUMN avatar_bytes bytea;

CREATE TABLE map_images (
    map_id text PRIMARY KEY,
    version text NOT NULL,
    content_type text NOT NULL,
    image_bytes bytea NOT NULL
);

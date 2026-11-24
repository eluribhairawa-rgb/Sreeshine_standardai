-- Logos printed on document headers, with alignment and assigned to one or more modules. Idempotent.
CREATE TABLE IF NOT EXISTS document_logos (
    id               SERIAL PRIMARY KEY,
    hospital_id      INTEGER NOT NULL,
    name             VARCHAR(100) NOT NULL,
    image_path       VARCHAR(500),
    image_mime       VARCHAR(50),
    width_px         INTEGER,
    height_px        INTEGER,
    alignment        VARCHAR(10) NOT NULL DEFAULT 'left',
    offset_x_mm      NUMERIC(6,2) NOT NULL DEFAULT 0,
    offset_y_mm      NUMERIC(6,2) NOT NULL DEFAULT 0,
    auto_fit_scaling BOOLEAN NOT NULL DEFAULT TRUE,
    modules          TEXT[] NOT NULL DEFAULT '{}',
    active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by       VARCHAR(100),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_logos_hospital ON document_logos (hospital_id);


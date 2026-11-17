-- Watermarks printed behind PDFs / prints, each assigned to one or more modules. Idempotent.
CREATE TABLE IF NOT EXISTS document_watermarks (
    id          SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL,
    name        VARCHAR(100) NOT NULL,
    image_path  VARCHAR(500),
    image_mime  VARCHAR(50),
    width_px    INTEGER,
    height_px   INTEGER,
    modules     TEXT[] NOT NULL DEFAULT '{}',
    opacity     NUMERIC(3,2) NOT NULL DEFAULT 0.12,
    scale_pct   INTEGER NOT NULL DEFAULT 60,
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  VARCHAR(100),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_watermarks_hospital ON document_watermarks (hospital_id);

-- Footers printed at the bottom of PDFs and prints, each assigned to one or more modules. Idempotent.
CREATE TABLE IF NOT EXISTS document_footers (
    id          SERIAL PRIMARY KEY,
    hospital_id INTEGER NOT NULL,
    name        VARCHAR(100) NOT NULL,
    image_path  VARCHAR(500),
    image_mime  VARCHAR(50),
    width_px    INTEGER,
    height_px   INTEGER,
    footer_text TEXT,
    modules     TEXT[] NOT NULL DEFAULT '{}',
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  VARCHAR(100),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_footers_hospital ON document_footers (hospital_id);

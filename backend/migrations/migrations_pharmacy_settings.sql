-- Pharmacy settings managed from Pharmacy > Settings (idempotent).
-- key/value like diag_settings; values are JSON (dosage_forms, store_locations).
CREATE TABLE IF NOT EXISTS pharmacy_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

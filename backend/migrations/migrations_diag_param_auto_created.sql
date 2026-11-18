-- Catalogue parameters created automatically from an uploaded lab report (OCR / CSV import).
-- Flagged so staff can review them; they are optional when finalizing other orders of the same test.
ALTER TABLE diag_service_parameters ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE;

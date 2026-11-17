-- Hospital IP number entered manually at IP Admission (idempotent).
-- Unique per hospital (case-insensitive) so one IP number never points at two admissions.
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS ip_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admissions_hospital_ip_number
    ON admissions (hospital_id, LOWER(ip_number)) WHERE ip_number IS NOT NULL AND ip_number <> '';

-- Body temperature is recorded in degrees Fahrenheit (hospital standard). Readings saved while the system used
-- Celsius (30-45 C) are converted once. Converted values are 86-113, so a re-run never touches them again.
UPDATE patient_vitals
SET temperature = ROUND(((temperature * 9.0 / 5.0) + 32)::numeric, 1)
WHERE temperature BETWEEN 30 AND 45;

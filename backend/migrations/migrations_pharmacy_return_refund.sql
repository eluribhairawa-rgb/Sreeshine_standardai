-- Refund value of a pharmacy return (share of the invoice incl. GST, after discount) and the part of it
-- that was paid back as money (the rest cancelled an unpaid balance). Idempotent.
ALTER TABLE pharmacy_returns ADD COLUMN IF NOT EXISTS refund_amount DOUBLE PRECISION DEFAULT 0;
ALTER TABLE pharmacy_returns ADD COLUMN IF NOT EXISTS cash_refunded DOUBLE PRECISION DEFAULT 0;

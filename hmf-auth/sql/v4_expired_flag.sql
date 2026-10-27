-- ============================================================================
-- VERSION 4: expired prescriptions are kept, not deleted.
-- Each prescription has an "expired" flag. Once it is on, the prescription
-- can't be dispensed, delivered or changed; the doctor must issue a new one.
-- Run after v3_delivery_validation.sql. Safe to run more than once.
-- ============================================================================

ALTER TABLE prescriptions
    ADD COLUMN IF NOT EXISTS is_expired   BOOLEAN NOT NULL DEFAULT FALSE,   -- the expired flag
    ADD COLUMN IF NOT EXISTS expired_at   TIMESTAMPTZ,                      -- when the flag was turned on
    ADD COLUMN IF NOT EXISTS renewed_from UUID REFERENCES prescriptions(prescription_id) ON DELETE SET NULL;
                                                                            -- the expired prescription this one replaces

CREATE INDEX IF NOT EXISTS idx_rx_expiry ON prescriptions(expiry_date) WHERE NOT is_expired;
CREATE INDEX IF NOT EXISTS idx_rx_renewed_from ON prescriptions(renewed_from);

-- Prescriptions that are already past their expiry date
UPDATE prescriptions
   SET is_expired = TRUE, expired_at = COALESCE(expired_at, now()), status = 'expired'
 WHERE expiry_date < CURRENT_DATE AND NOT is_expired;

-- The flag can only be turned on, never back off
CREATE OR REPLACE FUNCTION keep_expired() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.is_expired AND NOT NEW.is_expired THEN
        RAISE EXCEPTION 'An expired prescription cannot be made valid again. Issue a new prescription.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rx_keep_expired ON prescriptions;
CREATE TRIGGER trg_rx_keep_expired BEFORE UPDATE ON prescriptions
    FOR EACH ROW EXECUTE FUNCTION keep_expired();

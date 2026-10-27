-- ============================================================================
-- VERSION 3: driver logins, mobile app tokens, delivery tracking,
-- prescription validation rules and chatbot escalations.
-- Run after auth_schema.sql (and upgrade_v2.sql if you had the first version).
-- Run with psql so each statement commits on its own (needed for the enum change).
-- ============================================================================

-- ---------- driver logins (for the driver app) ----------
ALTER TYPE account_type ADD VALUE IF NOT EXISTS 'driver';

ALTER TABLE user_accounts
    ADD COLUMN IF NOT EXISTS driver_id UUID UNIQUE REFERENCES drivers(driver_id) ON DELETE CASCADE;

-- an account belongs to exactly one patient, staff member or driver
ALTER TABLE user_accounts DROP CONSTRAINT IF EXISTS chk_account_owner;
ALTER TABLE user_accounts ADD CONSTRAINT chk_account_owner CHECK (
    (account_type = 'patient' AND patient_id IS NOT NULL AND staff_id IS NULL AND driver_id IS NULL) OR
    (account_type = 'staff'   AND staff_id   IS NOT NULL AND patient_id IS NULL AND driver_id IS NULL) OR
    (account_type = 'driver'  AND driver_id  IS NOT NULL AND patient_id IS NULL AND staff_id IS NULL)
);

-- ---------- login tokens for the mobile apps ----------
-- only a hash of the token is stored
CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash    CHAR(64) PRIMARY KEY,
    account_id    UUID NOT NULL REFERENCES user_accounts(account_id) ON DELETE CASCADE,
    app           VARCHAR(20) NOT NULL,              -- 'patient' or 'driver'
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_account ON auth_tokens(account_id);

-- ---------- delivery tracking ----------
ALTER TABLE deliveries
    ADD COLUMN IF NOT EXISTS confirmation_code  VARCHAR(6),     -- patient gives this code to the driver
    ADD COLUMN IF NOT EXISTS driver_lat         NUMERIC(9,6),   -- last GPS position while out for delivery
    ADD COLUMN IF NOT EXISTS driver_lng         NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS driver_location_at TIMESTAMPTZ;

-- only one open delivery per prescription
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_delivery
    ON deliveries(prescription_id)
 WHERE status IN ('pending', 'assigned', 'out_for_delivery');

-- ---------- prescription validation rules ----------
-- Dose limits and allergy words for each medicine.
-- The sample values in seed.sql must be checked against an official source before real use.
CREATE TABLE IF NOT EXISTS medication_rules (
    medication_id      INTEGER PRIMARY KEY REFERENCES medications(medication_id) ON DELETE CASCADE,
    max_single_dose_mg NUMERIC(10,3),
    max_daily_dose_mg  NUMERIC(10,3),
    min_age_years      INTEGER,
    max_duration_days  INTEGER,
    allergy_keywords   TEXT[] NOT NULL DEFAULT '{}',    -- e.g. {penicillin, amoxicillin}
    notes              TEXT
);

-- Medicines that should not be taken together
CREATE TABLE IF NOT EXISTS drug_interactions (
    medication_a  INTEGER NOT NULL REFERENCES medications(medication_id) ON DELETE CASCADE,
    medication_b  INTEGER NOT NULL REFERENCES medications(medication_id) ON DELETE CASCADE,
    severity      VARCHAR(10) NOT NULL CHECK (severity IN ('minor', 'moderate', 'major')),
    description   TEXT NOT NULL,
    PRIMARY KEY (medication_a, medication_b),
    CHECK (medication_a < medication_b)                 -- store each pair once
);

-- ---------- chatbot hand-over to staff ----------
CREATE TABLE IF NOT EXISTS chat_escalations (
    escalation_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id      UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    category        VARCHAR(40) NOT NULL,
    urgency         VARCHAR(10) NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine', 'urgent', 'emergency')),
    patient_message TEXT NOT NULL,
    status          VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
    handled_by      UUID REFERENCES staff(staff_id) ON DELETE SET NULL,
    staff_notes     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON chat_escalations(status, created_at);

-- ============================================================================
-- LOGIN ACCOUNTS (patients and staff only, drivers use the mobile app)
-- Run this after postgres_schema.sql
-- ============================================================================

CREATE TYPE account_type AS ENUM ('patient', 'staff');

CREATE TABLE user_accounts (
    account_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_type    account_type NOT NULL,
    patient_id      UUID UNIQUE REFERENCES patients(patient_id) ON DELETE CASCADE,
    staff_id        UUID UNIQUE REFERENCES staff(staff_id) ON DELETE CASCADE,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(100) NOT NULL,          -- bcrypt hash, never the plain password
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,                     -- set after too many wrong passwords
    last_login_at   TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,                     -- staff only: when an admin approved the account
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- an account belongs to exactly one patient or one staff member
    CONSTRAINT chk_account_owner CHECK (
        (account_type = 'patient' AND patient_id IS NOT NULL AND staff_id IS NULL) OR
        (account_type = 'staff'   AND staff_id   IS NOT NULL AND patient_id IS NULL)
    )
);

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON user_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- one patient record per email
CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_email ON patients(lower(email));

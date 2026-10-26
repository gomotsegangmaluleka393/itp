-- ============================================================================
-- HMF HOSPITAL MANAGEMENT SYSTEM – COMPLETE POSTGRESQL DATABASE
-- ============================================================================
-- Builds every table the web portals, server and Android apps use, in one run.
--
-- How to run (creates a database called hmf):
--     createdb hmf
--     psql -d hmf -v ON_ERROR_STOP=1 -f hmf_postgres.sql
--
-- Then create the first admin from the hmf-auth folder:
--     node scripts/create-admin.js admin@hospital.co.za Admin1234 "First" "Last"
--
-- Run it on an EMPTY database. To start again: dropdb hmf && createdb hmf
-- Needs PostgreSQL 13 or newer.
--
-- Free-text clinical documents (notes, lab results, imaging, history) and chatbot
-- logs live in MongoDB – see hmf_mongodb.js. Rows here point to them through
-- medical_record_id (a MongoDB ObjectId stored as text).
-- ============================================================================

-- Hide info notices (e.g. "does not exist, skipping"); real errors still show
SET client_min_messages = warning;

-- ============================================================================
-- PART 1: CORE TABLES (your original schema)
-- ============================================================================
-- Handles: departments, staff, patients, appointments, prescriptions, billing
-- Free-text clinical documentation (notes, labs, imaging, history) lives in
-- MongoDB. Rows here that relate to a clinical encounter carry a
-- `medical_record_id` (a MongoDB ObjectId stored as text) that points at the
-- corresponding document in the `medical_records` collection.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
CREATE TYPE staff_role AS ENUM ('doctor', 'nurse', 'technician', 'admin', 'pharmacist', 'receptionist');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show');
CREATE TYPE prescription_status AS ENUM ('active', 'completed', 'cancelled', 'expired');
CREATE TYPE gender_type AS ENUM ('male', 'female', 'other', 'unspecified');
CREATE TYPE delivery_status AS ENUM ('pending', 'assigned', 'out_for_delivery', 'delivered', 'failed', 'cancelled', 'returned');
CREATE TYPE driver_employment_type AS ENUM ('employee', 'contractor');
CREATE TYPE driver_status AS ENUM ('active', 'on_leave', 'suspended', 'inactive');

-- ----------------------------------------------------------------------------
-- DEPARTMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE departments (
    department_id   SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL UNIQUE,
    location        VARCHAR(150),
    phone           VARCHAR(20),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- STAFF
-- ----------------------------------------------------------------------------
CREATE TABLE staff (
    staff_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name      VARCHAR(80) NOT NULL,
    last_name       VARCHAR(80) NOT NULL,
    role            staff_role NOT NULL,
    department_id   INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
    specialization  VARCHAR(120),
    license_number  VARCHAR(50) UNIQUE,       -- required for doctors/pharmacists
    email           VARCHAR(150) UNIQUE NOT NULL,
    phone           VARCHAR(20),
    hire_date       DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_department ON staff(department_id);
CREATE INDEX idx_staff_role ON staff(role);

-- ----------------------------------------------------------------------------
-- PATIENTS
-- ----------------------------------------------------------------------------
CREATE TABLE patients (
    patient_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name          VARCHAR(80) NOT NULL,
    last_name           VARCHAR(80) NOT NULL,
    date_of_birth       DATE NOT NULL,
    gender              gender_type NOT NULL DEFAULT 'unspecified',
    phone               VARCHAR(20),
    email               VARCHAR(150),
    address_line1       VARCHAR(150),
    address_line2       VARCHAR(150),
    city                VARCHAR(80),
    postal_code         VARCHAR(20),
    country             VARCHAR(80),
    emergency_contact_name  VARCHAR(120),
    emergency_contact_phone VARCHAR(20),
    insurance_provider  VARCHAR(120),
    insurance_policy_no VARCHAR(80),
    allergies_summary   TEXT,                 -- quick-reference only; full allergy history lives in Mongo
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_name ON patients(last_name, first_name);
CREATE INDEX idx_patients_dob ON patients(date_of_birth);

-- ----------------------------------------------------------------------------
-- APPOINTMENTS
-- ----------------------------------------------------------------------------
CREATE TABLE appointments (
    appointment_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id          UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    staff_id            UUID NOT NULL REFERENCES staff(staff_id) ON DELETE RESTRICT,
    department_id       INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
    scheduled_start      TIMESTAMPTZ NOT NULL,
    scheduled_end         TIMESTAMPTZ NOT NULL,
    status               appointment_status NOT NULL DEFAULT 'scheduled',
    reason               VARCHAR(255),
    room_number          VARCHAR(20),
    medical_record_id    VARCHAR(24),          -- FK reference to MongoDB medical_records._id (encounter note)
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_appt_time CHECK (scheduled_end > scheduled_start)
);

CREATE INDEX idx_appt_patient ON appointments(patient_id);
CREATE INDEX idx_appt_staff ON appointments(staff_id);
CREATE INDEX idx_appt_start ON appointments(scheduled_start);
CREATE INDEX idx_appt_status ON appointments(status);

-- ----------------------------------------------------------------------------
-- MEDICATIONS (reference/catalog table)
-- ----------------------------------------------------------------------------
CREATE TABLE medications (
    medication_id   SERIAL PRIMARY KEY,
    name            VARCHAR(150) NOT NULL,
    generic_name    VARCHAR(150),
    category        VARCHAR(100),
    manufacturer    VARCHAR(150),
    controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(name, manufacturer)
);

-- ----------------------------------------------------------------------------
-- PRESCRIPTIONS
-- ----------------------------------------------------------------------------
CREATE TABLE prescriptions (
    prescription_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id          UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    prescribing_staff_id UUID NOT NULL REFERENCES staff(staff_id) ON DELETE RESTRICT,
    appointment_id       UUID REFERENCES appointments(appointment_id) ON DELETE SET NULL,
    status               prescription_status NOT NULL DEFAULT 'active',
    issue_date            DATE NOT NULL DEFAULT CURRENT_DATE,
    expiry_date            DATE,
    medical_record_id     VARCHAR(24),          -- link to Mongo doc with clinical justification / notes
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rx_patient ON prescriptions(patient_id);
CREATE INDEX idx_rx_staff ON prescriptions(prescribing_staff_id);
CREATE INDEX idx_rx_status ON prescriptions(status);

-- A prescription can contain multiple medication line items
CREATE TABLE prescription_items (
    item_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    prescription_id  UUID NOT NULL REFERENCES prescriptions(prescription_id) ON DELETE CASCADE,
    medication_id    INTEGER NOT NULL REFERENCES medications(medication_id) ON DELETE RESTRICT,
    dosage           VARCHAR(80) NOT NULL,      -- e.g. "500mg"
    frequency        VARCHAR(80) NOT NULL,      -- e.g. "twice daily"
    route             VARCHAR(50),               -- e.g. "oral", "IV"
    duration_days     INTEGER,
    quantity           INTEGER,
    refills_allowed    INTEGER NOT NULL DEFAULT 0,
    instructions        TEXT
);

CREATE INDEX idx_rx_items_prescription ON prescription_items(prescription_id);
CREATE INDEX idx_rx_items_medication ON prescription_items(medication_id);

-- ----------------------------------------------------------------------------
-- DRIVERS (separate from clinical/administrative `staff` — covers both
-- employed and contracted delivery personnel)
-- ----------------------------------------------------------------------------
CREATE TABLE drivers (
    driver_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name            VARCHAR(80) NOT NULL,
    last_name              VARCHAR(80) NOT NULL,
    phone                    VARCHAR(20) NOT NULL,
    email                     VARCHAR(150) UNIQUE,
    driver_license_number      VARCHAR(50) NOT NULL UNIQUE,
    employment_type              driver_employment_type NOT NULL DEFAULT 'employee',
    status                        driver_status NOT NULL DEFAULT 'active',
    hire_date                      DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drivers_status ON drivers(status);

-- ----------------------------------------------------------------------------
-- DELIVERY VEHICLES (fleet used for prescription/supply deliveries)
-- ----------------------------------------------------------------------------
CREATE TABLE vehicles (
    vehicle_id       SERIAL PRIMARY KEY,
    plate_number     VARCHAR(20) NOT NULL UNIQUE,
    make_model       VARCHAR(100),
    vehicle_type     VARCHAR(50),              -- e.g. 'motorbike', 'van', 'car'
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- DELIVERIES (dispatching prescriptions/medical supplies to a patient address)
-- ----------------------------------------------------------------------------
CREATE TABLE deliveries (
    delivery_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id           UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    prescription_id       UUID REFERENCES prescriptions(prescription_id) ON DELETE SET NULL,
    driver_id               UUID REFERENCES drivers(driver_id) ON DELETE SET NULL,
    vehicle_id             INTEGER REFERENCES vehicles(vehicle_id) ON DELETE SET NULL,
    status                 delivery_status NOT NULL DEFAULT 'pending',

    -- delivery address defaults to the patient's address but can be overridden
    -- (e.g. delivering to a relative's home or a care facility)
    address_line1          VARCHAR(150) NOT NULL,
    address_line2           VARCHAR(150),
    city                     VARCHAR(80) NOT NULL,
    postal_code               VARCHAR(20),
    country                   VARCHAR(80) NOT NULL,
    contact_phone              VARCHAR(20),           -- number to reach at delivery address
    delivery_instructions        TEXT,                  -- e.g. "leave with security", gate code, etc.

    scheduled_date              DATE,
    scheduled_window_start        TIME,
    scheduled_window_end          TIME,
    dispatched_at                 TIMESTAMPTZ,
    delivered_at                   TIMESTAMPTZ,

    proof_of_delivery_url          VARCHAR(255),          -- signature/photo stored in object storage
    recipient_name                  VARCHAR(120),          -- who actually received it, if not the patient
    failure_reason                   TEXT,

    created_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                        TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_delivered_time CHECK (
        delivered_at IS NULL OR dispatched_at IS NULL OR delivered_at >= dispatched_at
    )
);

CREATE INDEX idx_deliveries_patient ON deliveries(patient_id);
CREATE INDEX idx_deliveries_prescription ON deliveries(prescription_id);
CREATE INDEX idx_deliveries_driver ON deliveries(driver_id);
CREATE INDEX idx_deliveries_status ON deliveries(status);
CREATE INDEX idx_deliveries_scheduled_date ON deliveries(scheduled_date);

-- ----------------------------------------------------------------------------
-- DELIVERY STATUS HISTORY (audit trail of every status change, e.g. for
-- tracking / ETA display and dispute resolution)
-- ----------------------------------------------------------------------------
CREATE TABLE delivery_status_history (
    history_id     BIGSERIAL PRIMARY KEY,
    delivery_id    UUID NOT NULL REFERENCES deliveries(delivery_id) ON DELETE CASCADE,
    status         delivery_status NOT NULL,
    changed_by_driver   UUID REFERENCES drivers(driver_id) ON DELETE SET NULL,
    changed_by_staff     UUID REFERENCES staff(staff_id) ON DELETE SET NULL,  -- e.g. dispatcher/admin
    changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes          TEXT
);

CREATE INDEX idx_delivery_history_delivery ON delivery_status_history(delivery_id);

-- ----------------------------------------------------------------------------
-- BILLING (optional but typical in a hospital framework)
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    invoice_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id       UUID NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
    appointment_id   UUID REFERENCES appointments(appointment_id) ON DELETE SET NULL,
    amount_due        NUMERIC(10,2) NOT NULL DEFAULT 0,
    amount_paid        NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    issued_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    due_date              DATE,
    paid                  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_invoices_patient ON invoices(patient_id);

-- ----------------------------------------------------------------------------
-- AUDIT LOG (recommended for HIPAA/POPIA-style compliance)
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
    log_id        BIGSERIAL PRIMARY KEY,
    staff_id      UUID REFERENCES staff(staff_id) ON DELETE SET NULL,
    action        VARCHAR(50) NOT NULL,        -- e.g. 'VIEW_RECORD', 'UPDATE_PRESCRIPTION'
    entity_type   VARCHAR(50) NOT NULL,        -- e.g. 'patient', 'medical_record', 'prescription'
    entity_id     VARCHAR(64) NOT NULL,        -- UUID or Mongo ObjectId as text
    occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    details          JSONB
);

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_staff ON audit_log(staff_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_staff_updated_at BEFORE UPDATE ON staff
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_appt_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_rx_updated_at BEFORE UPDATE ON prescriptions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_deliveries_updated_at BEFORE UPDATE ON deliveries
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON drivers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- PART 2: EXTRA CHECKS (from the Phase 3 "domain and check constraints" section)
-- ============================================================================
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_amounts CHECK (amount_due >= 0 AND amount_paid >= 0);
ALTER TABLE prescription_items ADD CONSTRAINT chk_item_numbers CHECK (
    refills_allowed >= 0 AND (quantity IS NULL OR quantity >= 0) AND (duration_days IS NULL OR duration_days > 0));
ALTER TABLE prescriptions ADD CONSTRAINT chk_rx_dates CHECK (expiry_date IS NULL OR expiry_date > issue_date);

-- ============================================================================
-- PART 3: LOGIN ACCOUNTS (patients, staff and drivers)
-- ============================================================================
CREATE TYPE account_type AS ENUM ('patient', 'staff', 'driver');

CREATE TABLE user_accounts (
    account_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_type    account_type NOT NULL,
    patient_id      UUID UNIQUE REFERENCES patients(patient_id) ON DELETE CASCADE,
    staff_id        UUID UNIQUE REFERENCES staff(staff_id) ON DELETE CASCADE,
    driver_id       UUID UNIQUE REFERENCES drivers(driver_id) ON DELETE CASCADE,
    email           VARCHAR(150) NOT NULL UNIQUE,
    password_hash   VARCHAR(100) NOT NULL,          -- bcrypt hash, never the plain password
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,                     -- set after too many wrong passwords
    last_login_at   TIMESTAMPTZ,
    approved_at     TIMESTAMPTZ,                     -- staff only: when an admin approved the account
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- an account belongs to exactly one patient, staff member or driver
    CONSTRAINT chk_account_owner CHECK (
        (account_type = 'patient' AND patient_id IS NOT NULL AND staff_id IS NULL AND driver_id IS NULL) OR
        (account_type = 'staff'   AND staff_id   IS NOT NULL AND patient_id IS NULL AND driver_id IS NULL) OR
        (account_type = 'driver'  AND driver_id  IS NOT NULL AND patient_id IS NULL AND staff_id IS NULL)
    )
);

CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON user_accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- one patient record per email
CREATE UNIQUE INDEX idx_patients_email ON patients(lower(email));

-- ============================================================================
-- PART 4: MOBILE APP TOKENS, DELIVERY TRACKING, VALIDATION RULES, CHATBOT HAND-OVER
-- ============================================================================
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

-- ============================================================================
-- PART 5: EXPIRED PRESCRIPTIONS ARE KEPT, NOT DELETED
-- Once expired, a prescription can't be dispensed, delivered or changed;
-- the doctor must issue a new one (linked through renewed_from).
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

-- ============================================================================
-- PART 6: STARTER DATA (departments, medicines, sample validation rules)
-- ============================================================================
INSERT INTO departments (name, location, phone) VALUES
  ('General Practice', 'Block A, Ground floor', '012 000 1001'),
  ('Cardiology',       'Block B, Level 2',      '012 000 1002'),
  ('Paediatrics',      'Block C, Level 1',      '012 000 1003'),
  ('Pharmacy',         'Block A, Level 1',      '012 000 1004')
ON CONFLICT (name) DO NOTHING;

INSERT INTO medications (name, generic_name, category, manufacturer, controlled_substance) VALUES
  ('Panado 500mg',        'Paracetamol',  'Analgesic',       'Adcock Ingram', FALSE),
  ('Amoxil 500mg',        'Amoxicillin',  'Antibiotic',      'GSK',           FALSE),
  ('Glucophage 850mg',    'Metformin',    'Antidiabetic',    'Merck',         FALSE),
  ('Norvasc 5mg',         'Amlodipine',   'Antihypertensive','Pfizer',        FALSE),
  ('Ventolin Inhaler',    'Salbutamol',   'Bronchodilator',  'GSK',           FALSE),
  ('Lipitor 20mg',        'Atorvastatin', 'Statin',          'Pfizer',        FALSE),
  ('Tramadol 50mg',       'Tramadol',     'Opioid analgesic','Sandoz',        TRUE)
ON CONFLICT (name, manufacturer) DO NOTHING;

-- ---------- validation rules for the starter medicines ----------
-- SAMPLE VALUES FOR TESTING ONLY. Check every limit against the package insert
-- or the SA Medicines Formulary before using this with real patients.
INSERT INTO medication_rules (medication_id, max_single_dose_mg, max_daily_dose_mg, min_age_years, max_duration_days, allergy_keywords)
SELECT m.medication_id, r.single, r.daily, r.min_age, r.max_days, r.words
  FROM medications m
  JOIN (VALUES
    ('Panado 500mg',     1000,  4000,  NULL, NULL, ARRAY['paracetamol','acetaminophen']),
    ('Amoxil 500mg',     1000,  3000,  NULL, NULL, ARRAY['penicillin','amoxicillin','beta-lactam']),
    ('Glucophage 850mg', 1000,  3000,  10,   NULL, ARRAY['metformin']),
    ('Norvasc 5mg',      10,    10,    6,    NULL, ARRAY['amlodipine']),
    ('Ventolin Inhaler', 0.2,   0.8,   NULL, NULL, ARRAY['salbutamol','albuterol']),
    ('Lipitor 20mg',     80,    80,    10,   NULL, ARRAY['atorvastatin','statin']),
    ('Tramadol 50mg',    100,   400,   12,   30,   ARRAY['tramadol','opioid'])
  ) AS r(name, single, daily, min_age, max_days, words) ON r.name = m.name
ON CONFLICT (medication_id) DO NOTHING;

INSERT INTO drug_interactions (medication_a, medication_b, severity, description)
SELECT LEAST(a.medication_id, b.medication_id), GREATEST(a.medication_id, b.medication_id), i.sev, i.descr
  FROM (VALUES
    ('Norvasc 5mg', 'Lipitor 20mg', 'minor',    'Amlodipine can raise atorvastatin levels; watch for muscle pain.'),
    ('Tramadol 50mg', 'Panado 500mg', 'minor',  'Often combined; keep the total paracetamol dose within limits.')
  ) AS i(a_name, b_name, sev, descr)
  JOIN medications a ON a.name = i.a_name
  JOIN medications b ON b.name = i.b_name
ON CONFLICT DO NOTHING;

-- ---------- database time zone ----------
-- Makes "today" use South African time on every connection (needed for hosted
-- databases like Neon, where the server's own setting may not stick).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Africa/Johannesburg');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE WARNING 'Could not set the database time zone; the server sets it instead.';
END $$;

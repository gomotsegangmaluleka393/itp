-- ============================================================================
-- CREATE AN ADMIN USER
-- ============================================================================
-- Change the name, email and password below, then run this once
-- (Neon SQL Editor, pgAdmin, or: psql "your-connection-string" -f create_admin.sql)
--
-- Password rule: at least 8 characters, with a letter and a number.
-- The password is stored as a bcrypt hash, never as plain text.
-- ============================================================================

-- pgcrypto makes the bcrypt hash (works on Neon and local PostgreSQL)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH new_staff AS (
  INSERT INTO staff (first_name, last_name, role, email, is_active)
  VALUES ('System', 'Admin', 'admin', lower('admin@hmf.co.za'), TRUE)   -- change name and email
  RETURNING staff_id, email
)
INSERT INTO user_accounts (account_type, staff_id, email, password_hash, approved_at)
SELECT 'staff', staff_id, email,
       crypt('Admin1234', gen_salt('bf', 12)),                          -- change password
       now()
  FROM new_staff;

-- Check it worked
SELECT s.first_name, s.last_name, s.role, a.email, a.approved_at
  FROM user_accounts a
  JOIN staff s ON s.staff_id = a.staff_id
 WHERE s.role = 'admin';

-- Only needed if you already ran the first version of auth_schema.sql
ALTER TABLE user_accounts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- staff who are already active count as approved
UPDATE user_accounts a SET approved_at = now()
  FROM staff s
 WHERE a.staff_id = s.staff_id AND s.is_active AND a.approved_at IS NULL;

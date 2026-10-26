// Checking an email and password (shared by the website and the mobile apps)
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, audit } = require('./db');

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const TOKEN_DAYS = 30;

// Returns { acc } on success or { status, error } on failure
async function verifyLogin(email, password) {
  if (!email || !password) return { status: 400, error: 'Email and password are required' };

  const q = await db.query(
    `SELECT a.*, s.is_active AS staff_active, s.role AS staff_role, d.status AS driver_status,
            COALESCE(p.first_name, s.first_name, d.first_name) AS first_name,
            COALESCE(p.last_name, s.last_name, d.last_name) AS last_name
       FROM user_accounts a
       LEFT JOIN patients p ON p.patient_id = a.patient_id
       LEFT JOIN staff s ON s.staff_id = a.staff_id
       LEFT JOIN drivers d ON d.driver_id = a.driver_id
      WHERE lower(a.email) = lower($1)`, [email.trim()]);
  const acc = q.rows[0];

  // same message for unknown email and wrong password
  const bad = { status: 401, error: 'Incorrect email or password' };
  if (!acc) return bad;

  if (acc.locked_until && new Date(acc.locked_until) > new Date()) {
    return { status: 423, error: `Account locked. Try again in ${LOCK_MINUTES} minutes.` };
  }

  if (!(await bcrypt.compare(password, acc.password_hash))) {
    const attempts = acc.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED_LOGINS;
    await db.query(
      `UPDATE user_accounts SET failed_attempts = $1,
         locked_until = CASE WHEN $2 THEN now() + ($3 || ' minutes')::interval ELSE NULL END
       WHERE account_id = $4`, [lock ? 0 : attempts, lock, String(LOCK_MINUTES), acc.account_id]);
    if (acc.staff_id) await audit(acc.staff_id, 'LOGIN_FAILED', 'staff', acc.staff_id);
    return bad;
  }

  if (acc.account_type === 'staff' && !acc.staff_active) {
    return { status: 403, error: acc.approved_at
      ? 'Your staff account has been deactivated. Please contact an administrator.'
      : 'Your staff account is waiting for admin approval' };
  }
  if (acc.account_type === 'driver' && acc.driver_status !== 'active') {
    return { status: 403, error: `Your driver account is ${String(acc.driver_status).replace('_', ' ')}. Please contact the hospital.` };
  }

  await db.query('UPDATE user_accounts SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE account_id = $1', [acc.account_id]);
  return { acc };
}

// The user object kept in the session (or attached to a mobile token)
function sessionUser(acc) {
  return {
    account_id: acc.account_id,
    type: acc.account_type,
    patient_id: acc.patient_id || null,
    staff_id: acc.staff_id || null,
    driver_id: acc.driver_id || null,
    role: acc.account_type === 'staff' ? acc.staff_role : acc.account_type, // 'patient' or 'driver'
    name: `${acc.first_name} ${acc.last_name}`,
    email: acc.email
  };
}

// ---------- mobile app tokens ----------

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function issueToken(accountId, app) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO auth_tokens (token_hash, account_id, app, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`, [hashToken(token), accountId, app, String(TOKEN_DAYS)]);
  return token;
}

async function userFromToken(token) {
  const q = await db.query(
    `UPDATE auth_tokens t SET last_used_at = now()
       FROM user_accounts a
       LEFT JOIN patients p ON p.patient_id = a.patient_id
       LEFT JOIN drivers d ON d.driver_id = a.driver_id
      WHERE t.token_hash = $1 AND t.expires_at > now() AND a.account_id = t.account_id
        AND a.account_type IN ('patient', 'driver')
     RETURNING a.*, COALESCE(p.first_name, d.first_name) AS first_name, COALESCE(p.last_name, d.last_name) AS last_name`,
    [hashToken(token)]);
  return q.rows[0] ? sessionUser(q.rows[0]) : null;
}

const revokeToken = (token) => db.query('DELETE FROM auth_tokens WHERE token_hash = $1', [hashToken(token)]);
const revokeAllTokens = (accountId) => db.query('DELETE FROM auth_tokens WHERE account_id = $1', [accountId]);

module.exports = { verifyLogin, sessionUser, issueToken, userFromToken, revokeToken, revokeAllTokens };

// Registration, login, logout and password change
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, transaction } = require('../lib/db');
const { homeFor, wrap, requireRole } = require('../lib/auth');
const { verifyLogin, sessionUser } = require('../lib/accounts');

const r = express.Router();

const STAFF_ROLES = ['doctor', 'nurse', 'technician', 'admin', 'pharmacist', 'receptionist'];
const LICENSED_ROLES = ['doctor', 'pharmacist'];
const GENDERS = ['male', 'female', 'other', 'unspecified'];

// ---------- helpers ----------

const clean = (v) => (typeof v === 'string' ? v.trim() : v);
const orNull = (v) => clean(v) || null;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');

// at least 8 characters with a letter and a number
const passwordOk = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
const PASSWORD_MSG = 'Password must be 8+ characters with a letter and a number';

function missing(body, fields) {
  const m = fields.filter((f) => !clean(body[f]));
  return m.length ? `Missing: ${m.join(', ')}` : null;
}

async function emailTaken(client, email) {
  const q = await client.query('SELECT 1 FROM user_accounts WHERE lower(email) = lower($1)', [email]);
  return q.rowCount > 0;
}

// ---------- departments (for the staff form) ----------

r.get('/departments', wrap(async (req, res) => {
  const q = await db.query('SELECT department_id, name FROM departments ORDER BY name');
  res.json(q.rows);
}));

// ---------- patient registration ----------

r.post('/register/patient', wrap(async (req, res) => {
  const b = req.body;
  const err = missing(b, ['first_name', 'last_name', 'date_of_birth', 'email', 'password']);
  if (err) return res.status(400).json({ error: err });
  if (!emailOk(b.email)) return res.status(400).json({ error: 'Invalid email address' });
  if (!passwordOk(b.password)) return res.status(400).json({ error: PASSWORD_MSG });
  if (new Date(b.date_of_birth) > new Date()) return res.status(400).json({ error: 'Date of birth cannot be in the future' });
  const gender = GENDERS.includes(b.gender) ? b.gender : 'unspecified';
  const email = clean(b.email).toLowerCase();

  const hash = await bcrypt.hash(b.password, 12);
  const result = await transaction(async (c) => {
    if (await emailTaken(c, email)) return null;

    // create the patient record
    const p = await c.query(
      `INSERT INTO patients (first_name, last_name, date_of_birth, gender, phone, email,
         address_line1, address_line2, city, postal_code, country,
         emergency_contact_name, emergency_contact_phone, insurance_provider, insurance_policy_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING patient_id`,
      [clean(b.first_name), clean(b.last_name), b.date_of_birth, gender, orNull(b.phone), email,
       orNull(b.address_line1), orNull(b.address_line2), orNull(b.city), orNull(b.postal_code),
       orNull(b.country), orNull(b.emergency_contact_name), orNull(b.emergency_contact_phone),
       orNull(b.insurance_provider), orNull(b.insurance_policy_no)]
    );

    // create the login account
    await c.query(
      `INSERT INTO user_accounts (account_type, patient_id, email, password_hash)
       VALUES ('patient', $1, $2, $3)`,
      [p.rows[0].patient_id, email, hash]
    );
    return true;
  });

  if (!result) return res.status(409).json({ error: 'An account with this email already exists' });
  res.status(201).json({ message: 'Registration successful. You can now log in.' });
}));

// ---------- staff registration ----------
// New staff accounts start inactive and must be approved by an admin

r.post('/register/staff', wrap(async (req, res) => {
  const b = req.body;
  const err = missing(b, ['first_name', 'last_name', 'role', 'email', 'password']);
  if (err) return res.status(400).json({ error: err });
  if (!STAFF_ROLES.includes(b.role)) return res.status(400).json({ error: 'Invalid staff role' });
  if (!emailOk(b.email)) return res.status(400).json({ error: 'Invalid email address' });
  if (!passwordOk(b.password)) return res.status(400).json({ error: PASSWORD_MSG });
  if (LICENSED_ROLES.includes(b.role) && !clean(b.license_number)) {
    return res.status(400).json({ error: 'A license number is required for doctors and pharmacists' });
  }
  const email = clean(b.email).toLowerCase();

  const hash = await bcrypt.hash(b.password, 12);
  const staffId = await transaction(async (c) => {
    if (await emailTaken(c, email)) return null;

    // create the staff record (inactive until approved)
    const s = await c.query(
      `INSERT INTO staff (first_name, last_name, role, department_id, specialization,
         license_number, email, phone, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE)
       RETURNING staff_id`,
      [clean(b.first_name), clean(b.last_name), b.role, b.department_id || null,
       orNull(b.specialization), orNull(b.license_number), email, orNull(b.phone)]
    );

    // create the login account
    await c.query(
      `INSERT INTO user_accounts (account_type, staff_id, email, password_hash)
       VALUES ('staff', $1, $2, $3)`,
      [s.rows[0].staff_id, email, hash]
    );
    return s.rows[0].staff_id;
  });

  if (!staffId) return res.status(409).json({ error: 'An account with this email already exists' });
  await audit(staffId, 'STAFF_REGISTERED', 'staff', staffId, { role: b.role });
  res.status(201).json({ message: 'Registration received. An administrator must approve your account before you can log in.' });
}));

// ---------- login ----------

r.post('/login', wrap(async (req, res) => {
  const result = await verifyLogin(clean(req.body.email), req.body.password);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const acc = result.acc;

  // drivers use the driver app, not the website
  if (acc.account_type === 'driver') return res.status(403).json({ error: 'Drivers sign in through the driver app' });
  if (acc.staff_id) await audit(acc.staff_id, 'LOGIN', 'staff', acc.staff_id);

  // new session id on login
  req.session.regenerate((e) => {
    if (e) return res.status(500).json({ error: 'Login failed' });
    const user = sessionUser(acc);
    req.session.user = user;
    res.json({ message: 'Logged in', user: { ...user, home: homeFor(user) } });
  });
}));

// ---------- session ----------

r.get('/me', requireRole(), (req, res) => {
  const u = req.session.user;
  res.json({ ...u, home: homeFor(u) });
});

r.post('/logout', (req, res) => {
  const u = req.session.user;
  req.session.destroy(() => {
    if (u && u.staff_id) audit(u.staff_id, 'LOGOUT', 'staff', u.staff_id);
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out' });
  });
});

// ---------- change password (any logged-in user) ----------

r.post('/account/password', requireRole(), wrap(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Fill in both passwords' });
  if (!passwordOk(new_password)) return res.status(400).json({ error: PASSWORD_MSG });

  const u = req.session.user;
  const q = await db.query('SELECT password_hash FROM user_accounts WHERE account_id = $1', [u.account_id]);
  if (!q.rows[0] || !(await bcrypt.compare(current_password, q.rows[0].password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const hash = await bcrypt.hash(new_password, 12);
  await db.query('UPDATE user_accounts SET password_hash = $1 WHERE account_id = $2', [hash, u.account_id]);
  if (u.staff_id) await audit(u.staff_id, 'PASSWORD_CHANGED', 'staff', u.staff_id);
  res.json({ message: 'Password updated' });
}));

module.exports = r;

// Admin API for deliveries, drivers and vehicles
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit, transaction } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');
const { validateStored } = require('../lib/rxValidation');
const { addHistory, sendSignature } = require('../lib/deliveries');
const { revokeAllTokens } = require('../lib/accounts');

const r = express.Router();
r.use(requireRole('admin'));

const me = (req) => req.session.user.staff_id;
const passwordOk = (p) => typeof p === 'string' && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

// ---------- deliveries ----------

r.get('/deliveries', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT d.delivery_id, d.status, d.prescription_id, d.scheduled_date, d.address_line1, d.city,
           d.created_at, d.dispatched_at, d.delivered_at, d.recipient_name, d.failure_reason,
           d.driver_id, d.vehicle_id, (d.proof_of_delivery_url IS NOT NULL) AS has_signature,
           d.driver_location_at,
           p.first_name || ' ' || p.last_name AS patient_name,
           dr.first_name || ' ' || dr.last_name AS driver_name, v.plate_number
      FROM deliveries d JOIN patients p ON p.patient_id = d.patient_id
      LEFT JOIN drivers dr ON dr.driver_id = d.driver_id
      LEFT JOIN vehicles v ON v.vehicle_id = d.vehicle_id
     WHERE ($1::text IS NULL OR d.status::text = $1
            OR ($1 = 'open' AND d.status IN ('pending','assigned','out_for_delivery')))
     ORDER BY (d.status = 'pending') DESC, d.created_at DESC
     LIMIT 300`, [req.query.status || null]);
  res.json(q.rows);
}));

// Assign a driver and vehicle
r.patch('/deliveries/:id/assign', wrap(async (req, res) => {
  const { driver_id, vehicle_id, scheduled_date, scheduled_window_start, scheduled_window_end } = req.body;
  const d = (await db.query('SELECT * FROM deliveries WHERE delivery_id = $1', [req.params.id])).rows[0];
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (!['pending', 'assigned'].includes(d.status)) return res.status(400).json({ error: 'Only deliveries that have not left can be assigned' });

  const drv = (await db.query(`SELECT status FROM drivers WHERE driver_id = $1`, [driver_id])).rows[0];
  if (!drv || drv.status !== 'active') return res.status(400).json({ error: 'Choose an active driver' });
  if (vehicle_id) {
    const v = (await db.query('SELECT is_active FROM vehicles WHERE vehicle_id = $1', [vehicle_id])).rows[0];
    if (!v || !v.is_active) return res.status(400).json({ error: 'Choose an active vehicle' });
  }

  // never send out medicine on an invalid prescription
  if (d.prescription_id) {
    const v = await validateStored(d.prescription_id);
    if (v.outcome === 'invalid') return res.status(422).json({ error: `Prescription failed validation: ${v.errors[0].message}`, validation: v });
  }

  await transaction(async (c) => {
    await c.query(`
      UPDATE deliveries SET driver_id = $2, vehicle_id = $3, status = 'assigned',
             scheduled_date = COALESCE($4::date, scheduled_date, CURRENT_DATE),
             scheduled_window_start = COALESCE($5::time, scheduled_window_start),
             scheduled_window_end = COALESCE($6::time, scheduled_window_end)
       WHERE delivery_id = $1`,
      [d.delivery_id, driver_id, vehicle_id || null, scheduled_date || null, scheduled_window_start || null, scheduled_window_end || null]);
    await addHistory(c, d.delivery_id, 'assigned', { staff_id: me(req) }, d.driver_id && d.driver_id !== driver_id ? 'Driver changed' : 'Driver assigned');
  });
  await audit(me(req), 'DELIVERY_ASSIGNED', 'delivery', d.delivery_id, { driver_id, vehicle_id });
  res.json({ message: 'Driver assigned' });
}));

r.patch('/deliveries/:id/cancel', wrap(async (req, res) => {
  const reason = (req.body.reason || 'Cancelled by hospital').slice(0, 300);
  const q = await db.query(`
    UPDATE deliveries SET status = 'cancelled', failure_reason = $2
     WHERE delivery_id = $1 AND status IN ('pending','assigned','out_for_delivery') RETURNING delivery_id`, [req.params.id, reason]);
  if (!q.rowCount) return res.status(400).json({ error: 'This delivery is already closed' });
  await addHistory(null, req.params.id, 'cancelled', { staff_id: me(req) }, reason);
  await audit(me(req), 'DELIVERY_CANCELLED', 'delivery', req.params.id, { reason });
  res.json({ message: 'Delivery cancelled' });
}));

r.get('/deliveries/:id/proof', wrap(async (req, res) => sendSignature(res, req.params.id)));

// ---------- drivers ----------

r.get('/drivers', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT d.*, a.email AS login_email, a.last_login_at,
      (SELECT count(*)::int FROM deliveries x WHERE x.driver_id = d.driver_id AND x.status IN ('assigned','out_for_delivery')) AS active_deliveries,
      (SELECT count(*)::int FROM deliveries x WHERE x.driver_id = d.driver_id AND x.status = 'delivered') AS delivered,
      (SELECT count(*)::int FROM deliveries x WHERE x.driver_id = d.driver_id AND x.status = 'failed') AS failed
      FROM drivers d LEFT JOIN user_accounts a ON a.driver_id = d.driver_id
     ORDER BY d.status = 'active' DESC, d.last_name`);
  res.json(q.rows);
}));

// Create a driver and their app login
r.post('/drivers', wrap(async (req, res) => {
  const b = req.body;
  for (const f of ['first_name', 'last_name', 'phone', 'email', 'driver_license_number', 'password']) {
    if (!(b[f] || '').trim()) return res.status(400).json({ error: `Missing: ${f.replace(/_/g, ' ')}` });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) return res.status(400).json({ error: 'Invalid email address' });
  if (!passwordOk(b.password)) return res.status(400).json({ error: 'Password must be 8+ characters with a letter and a number' });
  const email = b.email.trim().toLowerCase();
  if ((await db.query('SELECT 1 FROM user_accounts WHERE lower(email) = $1', [email])).rowCount) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const hash = await bcrypt.hash(b.password, 12);
  const id = await transaction(async (c) => {
    const d = await c.query(`
      INSERT INTO drivers (first_name, last_name, phone, email, driver_license_number, employment_type)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING driver_id`,
      [b.first_name.trim(), b.last_name.trim(), b.phone.trim(), email, b.driver_license_number.trim().toUpperCase(),
       b.employment_type === 'contractor' ? 'contractor' : 'employee']);
    await c.query(`INSERT INTO user_accounts (account_type, driver_id, email, password_hash) VALUES ('driver', $1, $2, $3)`,
      [d.rows[0].driver_id, email, hash]);
    return d.rows[0].driver_id;
  });
  await audit(me(req), 'DRIVER_CREATED', 'driver', id);
  res.status(201).json({ driver_id: id });
}));

r.patch('/drivers/:id', wrap(async (req, res) => {
  const status = req.body.status;
  if (!['active', 'on_leave', 'suspended', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const q = await db.query('UPDATE drivers SET status = $2 WHERE driver_id = $1 RETURNING driver_id', [req.params.id, status]);
  if (!q.rowCount) return res.status(404).json({ error: 'Driver not found' });
  if (status !== 'active') {
    // log them out of the app
    const a = (await db.query('SELECT account_id FROM user_accounts WHERE driver_id = $1', [req.params.id])).rows[0];
    if (a) await revokeAllTokens(a.account_id);
  }
  await audit(me(req), 'DRIVER_STATUS', 'driver', req.params.id, { status });
  res.json({ message: 'Saved' });
}));

// ---------- vehicles ----------

r.get('/vehicles', wrap(async (req, res) => {
  res.json((await db.query('SELECT * FROM vehicles ORDER BY is_active DESC, plate_number')).rows);
}));

r.post('/vehicles', wrap(async (req, res) => {
  const plate = (req.body.plate_number || '').trim().toUpperCase();
  if (!plate) return res.status(400).json({ error: 'Enter the number plate' });
  const q = await db.query('INSERT INTO vehicles (plate_number, make_model, vehicle_type) VALUES ($1,$2,$3) RETURNING *',
    [plate, req.body.make_model || null, req.body.vehicle_type || null]);
  res.status(201).json(q.rows[0]);
}));

r.patch('/vehicles/:id', wrap(async (req, res) => {
  await db.query('UPDATE vehicles SET is_active = $2 WHERE vehicle_id = $1', [req.params.id, !!req.body.is_active]);
  res.json({ message: 'Saved' });
}));

module.exports = r;

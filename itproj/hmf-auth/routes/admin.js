// Administrator portal API
const express = require('express');
const { db, audit } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');

const r = express.Router();
r.use(requireRole('admin'));

const STAFF_ROLES = ['doctor', 'nurse', 'technician', 'admin', 'pharmacist', 'receptionist'];
const like = (q) => `%${(q || '').trim()}%`;

// ---------- dashboard numbers ----------

r.get('/stats', wrap(async (req, res) => {
  const totals = await db.query(`
    SELECT
      (SELECT count(*)::int FROM patients)                                         AS patients,
      (SELECT count(*)::int FROM staff WHERE is_active)                             AS staff_active,
      (SELECT count(*)::int FROM staff s JOIN user_accounts a ON a.staff_id = s.staff_id
        WHERE NOT s.is_active AND a.approved_at IS NULL)                           AS staff_pending,
      (SELECT count(*)::int FROM appointments
        WHERE scheduled_start::date = CURRENT_DATE AND status <> 'cancelled')      AS appts_today,
      (SELECT count(*)::int FROM prescriptions
        WHERE status = 'active' AND expiry_date >= CURRENT_DATE)                    AS rx_active,
      (SELECT count(*)::int FROM prescriptions
        WHERE status = 'active' AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS rx_expiring,
      (SELECT count(*)::int FROM deliveries
        WHERE status IN ('pending','assigned','out_for_delivery'))                 AS deliveries_open,
      (SELECT count(*)::int FROM deliveries WHERE status = 'pending')               AS deliveries_pending,
      (SELECT count(*)::int FROM chat_escalations WHERE status <> 'resolved')       AS enquiries_open
  `);

  // appointments for the next 7 days
  const week = await db.query(`
    SELECT d::date AS day, count(a.appointment_id)::int AS count
      FROM generate_series(CURRENT_DATE, CURRENT_DATE + 6, interval '1 day') d
      LEFT JOIN appointments a ON a.scheduled_start::date = d::date AND a.status <> 'cancelled'
     GROUP BY d ORDER BY d`);

  // today's appointments by status
  const today = await db.query(`
    SELECT status, count(*)::int AS count FROM appointments
     WHERE scheduled_start::date = CURRENT_DATE GROUP BY status`);

  res.json({ ...totals.rows[0], week: week.rows, today: today.rows });
}));

// ---------- staff ----------

r.get('/staff', wrap(async (req, res) => {
  const status = req.query.status || 'all';
  const q = await db.query(`
    SELECT s.staff_id, s.first_name, s.last_name, s.role, s.department_id, d.name AS department,
           s.specialization, s.license_number, s.email, s.phone, s.hire_date, s.is_active,
           a.approved_at, a.last_login_at,
           CASE WHEN s.is_active THEN 'active'
                WHEN a.account_id IS NOT NULL AND a.approved_at IS NULL THEN 'pending'
                ELSE 'inactive' END AS account_status
      FROM staff s
      LEFT JOIN departments d ON d.department_id = s.department_id
      LEFT JOIN user_accounts a ON a.staff_id = s.staff_id
     WHERE (s.first_name || ' ' || s.last_name ILIKE $1 OR s.email ILIKE $1 OR coalesce(s.license_number,'') ILIKE $1)
     ORDER BY (s.is_active = FALSE AND a.approved_at IS NULL) DESC, s.last_name, s.first_name`,
    [like(req.query.q)]);
  const rows = status === 'all' ? q.rows : q.rows.filter((s) => s.account_status === status);
  res.json(rows);
}));

// approve, deactivate, or change role/department
r.patch('/staff/:id', wrap(async (req, res) => {
  const id = req.params.id;
  const me = req.session.user.staff_id;
  const b = req.body;

  if (id === me && (b.is_active === false || (b.role && b.role !== 'admin'))) {
    return res.status(400).json({ error: 'You cannot deactivate or demote your own account' });
  }
  if (b.role && !STAFF_ROLES.includes(b.role)) return res.status(400).json({ error: 'Invalid role' });

  const cur = await db.query('SELECT * FROM staff WHERE staff_id = $1', [id]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'Staff member not found' });
  const s = cur.rows[0];

  const role = b.role || s.role;
  if (['doctor', 'pharmacist'].includes(role) && !s.license_number && !b.license_number) {
    return res.status(400).json({ error: 'Doctors and pharmacists need a license number' });
  }

  const upd = await db.query(`
    UPDATE staff SET
      is_active      = COALESCE($2, is_active),
      role           = $3,
      department_id  = CASE WHEN $4::boolean THEN $5::int ELSE department_id END,
      license_number = COALESCE($6, license_number)
    WHERE staff_id = $1 RETURNING *`,
    [id, typeof b.is_active === 'boolean' ? b.is_active : null, role,
     'department_id' in b, b.department_id || null, b.license_number || null]);

  // first activation counts as approval
  if (b.is_active === true) {
    await db.query('UPDATE user_accounts SET approved_at = COALESCE(approved_at, now()) WHERE staff_id = $1', [id]);
  }

  const action = b.is_active === true ? 'STAFF_ACTIVATED' : b.is_active === false ? 'STAFF_DEACTIVATED' : 'STAFF_UPDATED';
  await audit(me, action, 'staff', id, { role, department_id: upd.rows[0].department_id });
  res.json(upd.rows[0]);
}));

// ---------- patients ----------

r.get('/patients', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT p.patient_id, p.first_name, p.last_name, p.date_of_birth, p.gender, p.phone, p.email,
           p.city, p.insurance_provider, p.created_at,
           (a.account_id IS NOT NULL) AS has_account,
           (SELECT count(*)::int FROM appointments x WHERE x.patient_id = p.patient_id) AS appointments
      FROM patients p
      LEFT JOIN user_accounts a ON a.patient_id = p.patient_id
     WHERE p.first_name || ' ' || p.last_name ILIKE $1 OR coalesce(p.email,'') ILIKE $1 OR coalesce(p.phone,'') ILIKE $1
     ORDER BY p.created_at DESC
     LIMIT 200`, [like(req.query.q)]);
  res.json(q.rows);
}));

// ---------- appointments ----------

r.get('/appointments', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT a.appointment_id, a.scheduled_start, a.scheduled_end, a.status, a.reason, a.room_number,
           p.first_name || ' ' || p.last_name AS patient_name,
           s.first_name || ' ' || s.last_name AS doctor_name,
           d.name AS department
      FROM appointments a
      JOIN patients p ON p.patient_id = a.patient_id
      JOIN staff s ON s.staff_id = a.staff_id
      LEFT JOIN departments d ON d.department_id = a.department_id
     WHERE ($1::date IS NULL OR a.scheduled_start::date = $1::date)
       AND ($2::text IS NULL OR a.status::text = $2)
     ORDER BY a.scheduled_start
     LIMIT 300`, [req.query.date || null, req.query.status || null]);
  res.json(q.rows);
}));

// ---------- departments ----------

r.get('/departments', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT d.*, count(s.staff_id)::int AS staff_count
      FROM departments d LEFT JOIN staff s ON s.department_id = d.department_id AND s.is_active
     GROUP BY d.department_id ORDER BY d.name`);
  res.json(q.rows);
}));

r.post('/departments', wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Department name is required' });
  const q = await db.query(
    'INSERT INTO departments (name, location, phone) VALUES ($1,$2,$3) RETURNING *',
    [name, req.body.location || null, req.body.phone || null]);
  await audit(req.session.user.staff_id, 'DEPARTMENT_CREATED', 'department', q.rows[0].department_id, { name });
  res.status(201).json(q.rows[0]);
}));

r.delete('/departments/:id', wrap(async (req, res) => {
  const q = await db.query('DELETE FROM departments WHERE department_id = $1 RETURNING name', [req.params.id]);
  if (!q.rows[0]) return res.status(404).json({ error: 'Department not found' });
  await audit(req.session.user.staff_id, 'DEPARTMENT_DELETED', 'department', req.params.id, q.rows[0]);
  res.json({ message: 'Deleted' });
}));

// ---------- audit log ----------

r.get('/audit', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT l.log_id, l.action, l.entity_type, l.entity_id, l.occurred_at, l.details,
           s.first_name || ' ' || s.last_name AS staff_name, s.role
      FROM audit_log l LEFT JOIN staff s ON s.staff_id = l.staff_id
     WHERE ($1::text IS NULL OR l.action = $1)
     ORDER BY l.occurred_at DESC
     LIMIT $2`, [req.query.action || null, Math.min(parseInt(req.query.limit, 10) || 100, 500)]);
  res.json(q.rows);
}));

module.exports = r;

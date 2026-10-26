// Prescription validation API (staff)
const express = require('express');
const { db, audit } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');
const { validateStored, expirePrescriptions } = require('../lib/rxValidation');

const r = express.Router();

// Check a prescription before dispensing: pharmacists, doctors and admins
r.post('/verify', requireRole('pharmacist', 'doctor', 'admin'), wrap(async (req, res) => {
  const { prescription_id, date_of_birth, last_name } = req.body;
  const result = await validateStored((prescription_id || '').trim(), { date_of_birth, last_name });
  await audit(req.session.user.staff_id, 'VERIFY_PRESCRIPTION', 'prescription', (prescription_id || '').trim() || 'none',
    { outcome: result.outcome, errors: result.errors.map((e) => e.code) });
  res.json(result);
}));

// Active prescriptions that will expire soon
r.get('/expiring', requireRole('pharmacist', 'admin'), wrap(async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const q = await db.query(`
    SELECT rx.prescription_id, rx.expiry_date, (rx.expiry_date - CURRENT_DATE) AS days_left, rx.status,
           p.first_name || ' ' || p.last_name AS patient_name, s.first_name || ' ' || s.last_name AS doctor_name
      FROM prescriptions rx JOIN patients p ON p.patient_id = rx.patient_id JOIN staff s ON s.staff_id = rx.prescribing_staff_id
     WHERE NOT rx.is_expired AND rx.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
     ORDER BY rx.expiry_date`, [days]);
  res.json(q.rows);
}));

// Expired prescriptions (kept in the database) and when the expiry check last ran
r.get('/expired', requireRole('admin', 'pharmacist'), wrap(async (req, res) => {
  const expired = await db.query(`
    SELECT rx.prescription_id, rx.issue_date, rx.expiry_date, rx.expired_at, rx.is_expired,
           p.first_name || ' ' || p.last_name AS patient_name, s.first_name || ' ' || s.last_name AS doctor_name,
           (SELECT count(*)::int FROM prescription_items i WHERE i.prescription_id = rx.prescription_id) AS items,
           (SELECT n.prescription_id FROM prescriptions n WHERE n.renewed_from = rx.prescription_id
             ORDER BY n.created_at DESC LIMIT 1) AS renewed_by
      FROM prescriptions rx JOIN patients p ON p.patient_id = rx.patient_id JOIN staff s ON s.staff_id = rx.prescribing_staff_id
     WHERE rx.is_expired
     ORDER BY rx.expired_at DESC NULLS LAST
     LIMIT 200`);
  const runs = await db.query(`
    SELECT occurred_at, details, s.first_name || ' ' || s.last_name AS run_by
      FROM audit_log l LEFT JOIN staff s ON s.staff_id = l.staff_id
     WHERE action = 'RX_EXPIRY_CHECK' ORDER BY occurred_at DESC LIMIT 10`);
  res.json({ expired: expired.rows, runs: runs.rows });
}));

// Run the expiry check now
r.post('/expire-now', requireRole('admin'), wrap(async (req, res) => {
  res.json(await expirePrescriptions(req.session.user.staff_id));
}));

module.exports = r;

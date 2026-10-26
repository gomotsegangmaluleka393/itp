// Doctor portal API
const express = require('express');
const { db, audit, transaction } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');
const { RX_SELECT, RX_GROUP, RX_STATUS } = require('../lib/prescriptions');
const { checkPrescription } = require('../lib/rxValidation');

const r = express.Router();
r.use(requireRole('doctor'));

const me = (req) => req.session.user.staff_id;
const like = (q) => `%${(q || '').trim()}%`;

// Status changes a doctor can make, and where they can go from each status
const NEXT_STATUS = {
  scheduled:   ['checked_in', 'in_progress', 'cancelled', 'no_show'],
  checked_in:  ['in_progress', 'completed', 'no_show'],
  in_progress: ['completed'],
  completed:   [],
  cancelled:   [],
  no_show:     []
};

// A doctor may only see patients they have an appointment with
async function isMyPatient(staffId, patientId) {
  const q = await db.query('SELECT 1 FROM appointments WHERE staff_id = $1 AND patient_id = $2 LIMIT 1', [staffId, patientId]);
  return q.rowCount > 0;
}

// ---------- dashboard ----------

r.get('/stats', wrap(async (req, res) => {
  const t = await db.query(`
    SELECT
      count(*) FILTER (WHERE scheduled_start::date = CURRENT_DATE AND status <> 'cancelled')::int AS today,
      count(*) FILTER (WHERE scheduled_start::date = CURRENT_DATE AND status IN ('scheduled','checked_in','in_progress'))::int AS remaining,
      count(*) FILTER (WHERE scheduled_start::date = CURRENT_DATE AND status = 'completed')::int AS completed,
      count(*) FILTER (WHERE scheduled_start::date > CURRENT_DATE AND scheduled_start::date <= CURRENT_DATE + 7
                         AND status = 'scheduled')::int AS next_week,
      count(DISTINCT patient_id)::int AS patients
    FROM appointments WHERE staff_id = $1`, [me(req)]);

  const rx = await db.query(
    `SELECT count(*)::int AS rx_active FROM prescriptions WHERE prescribing_staff_id = $1 AND status = 'active' AND expiry_date >= CURRENT_DATE`, [me(req)]);

  res.json({ ...t.rows[0], ...rx.rows[0] });
}));

// ---------- appointments ----------

r.get('/appointments', wrap(async (req, res) => {
  const view = req.query.view || 'day'; // day | upcoming | past
  const q = await db.query(`
    SELECT a.appointment_id, a.patient_id, a.scheduled_start, a.scheduled_end, a.status, a.reason, a.room_number,
           p.first_name || ' ' || p.last_name AS patient_name, p.date_of_birth, p.allergies_summary
      FROM appointments a JOIN patients p ON p.patient_id = a.patient_id
     WHERE a.staff_id = $1
       AND CASE $2
             WHEN 'upcoming' THEN a.scheduled_start >= now() AND a.status = 'scheduled'
             WHEN 'past'     THEN a.scheduled_start < now()
             ELSE a.scheduled_start::date = COALESCE($3::date, CURRENT_DATE)
           END
     ORDER BY a.scheduled_start ${view === 'past' ? 'DESC' : 'ASC'}
     LIMIT 200`, [me(req), view, req.query.date || null]);
  res.json(q.rows);
}));

r.patch('/appointments/:id', wrap(async (req, res) => {
  const cur = await db.query('SELECT status FROM appointments WHERE appointment_id = $1 AND staff_id = $2', [req.params.id, me(req)]);
  if (!cur.rows[0]) return res.status(404).json({ error: 'Appointment not found' });

  const { status, room_number } = req.body;
  if (status && !(NEXT_STATUS[cur.rows[0].status] || []).includes(status)) {
    return res.status(400).json({ error: `Cannot change a ${cur.rows[0].status} appointment to ${status}` });
  }

  const q = await db.query(`
    UPDATE appointments SET status = COALESCE($2::appointment_status, status), room_number = COALESCE($3, room_number)
     WHERE appointment_id = $1 RETURNING *`, [req.params.id, status || null, room_number || null]);
  await audit(me(req), 'UPDATE_APPOINTMENT', 'appointment', req.params.id, { status });
  res.json(q.rows[0]);
}));

// ---------- patients ----------

r.get('/patients', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT p.patient_id, p.first_name, p.last_name, p.date_of_birth, p.gender, p.phone, p.email,
           max(a.scheduled_start) FILTER (WHERE a.scheduled_start <= now()) AS last_visit,
           min(a.scheduled_start) FILTER (WHERE a.scheduled_start > now() AND a.status = 'scheduled') AS next_visit,
           count(a.appointment_id)::int AS visits
      FROM patients p JOIN appointments a ON a.patient_id = p.patient_id AND a.staff_id = $1
     WHERE p.first_name || ' ' || p.last_name ILIKE $2 OR coalesce(p.email,'') ILIKE $2
     GROUP BY p.patient_id
     ORDER BY p.last_name, p.first_name`, [me(req), like(req.query.q)]);
  res.json(q.rows);
}));

r.get('/patients/:id', wrap(async (req, res) => {
  const id = req.params.id;
  if (!(await isMyPatient(me(req), id))) return res.status(404).json({ error: 'Patient not found' });

  const p = await db.query(`
    SELECT patient_id, first_name, last_name, date_of_birth, gender, phone, email,
           address_line1, address_line2, city, postal_code, country,
           emergency_contact_name, emergency_contact_phone, insurance_provider, insurance_policy_no, allergies_summary
      FROM patients WHERE patient_id = $1`, [id]);
  const appts = await db.query(`
    SELECT appointment_id, scheduled_start, status, reason FROM appointments
     WHERE patient_id = $1 AND staff_id = $2 ORDER BY scheduled_start DESC`, [id, me(req)]);
  const rx = await db.query(`${RX_SELECT}
     WHERE rx.patient_id = $1 ${RX_GROUP} ORDER BY rx.issue_date DESC`, [id]);

  await audit(me(req), 'VIEW_RECORD', 'patient', id);
  res.json({ ...p.rows[0], appointments: appts.rows, prescriptions: rx.rows });
}));

// ---------- prescriptions ----------

r.get('/medications', wrap(async (req, res) => {
  const q = await db.query('SELECT medication_id, name, generic_name, category, controlled_substance FROM medications ORDER BY name');
  res.json(q.rows);
}));

r.get('/prescriptions', wrap(async (req, res) => {
  const q = await db.query(`${RX_SELECT}
     WHERE rx.prescribing_staff_id = $1 AND ($2::text IS NULL OR ${RX_STATUS} = $2)
     ${RX_GROUP}
     ORDER BY rx.issue_date DESC, rx.created_at DESC`, [me(req), req.query.status || null]);
  res.json(q.rows);
}));

// Run the validation system on a draft without saving it
r.post('/prescriptions/check', wrap(async (req, res) => {
  const b = req.body;
  if (!b.patient_id || !(await isMyPatient(me(req), b.patient_id))) return res.status(400).json({ error: 'Choose one of your patients' });
  res.json(await checkPrescription({ patient_id: b.patient_id, prescribing_staff_id: me(req), expiry_date: b.expiry_date, items: b.items || [] }));
}));

r.post('/prescriptions', wrap(async (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items : [];

  if (!b.patient_id) return res.status(400).json({ error: 'Choose a patient' });
  if (!b.expiry_date) return res.status(400).json({ error: 'Choose an expiry date' });
  if (items.length === 0) return res.status(400).json({ error: 'Add at least one medication' });
  for (const it of items) {
    if (!it.medication_id || !it.dosage || !it.frequency) {
      return res.status(400).json({ error: 'Each medication needs a dosage and frequency' });
    }
  }
  if (!(await isMyPatient(me(req), b.patient_id))) return res.status(403).json({ error: 'You can only prescribe for your own patients' });

  // "Issue new prescription" for an expired one: it must be the same patient's expired prescription
  if (b.renewed_from) {
    const old = (await db.query('SELECT patient_id, is_expired, expiry_date < CURRENT_DATE AS past FROM prescriptions WHERE prescription_id = $1', [b.renewed_from])).rows[0];
    if (!old || old.patient_id !== b.patient_id) return res.status(400).json({ error: 'The old prescription does not belong to this patient' });
    if (!old.is_expired && !old.past) return res.status(400).json({ error: 'Only an expired prescription can be replaced with a new one' });
  }

  // Validation system: errors block the prescription, warnings must be acknowledged
  const validation = await checkPrescription({ patient_id: b.patient_id, prescribing_staff_id: me(req), expiry_date: b.expiry_date, items });
  if (validation.outcome === 'invalid') {
    await audit(me(req), 'PRESCRIPTION_REJECTED', 'patient', b.patient_id, { errors: validation.errors.map((e) => e.code) });
    return res.status(422).json({ error: validation.errors[0].message, validation });
  }
  if (validation.outcome === 'warnings' && !b.acknowledge_warnings) {
    return res.status(409).json({ error: 'Please review the warnings before issuing', needs_ack: true, validation });
  }

  const num = (v) => (v === '' || v == null ? null : parseInt(v, 10));
  const id = await transaction(async (c) => {
    const rx = await c.query(`
      INSERT INTO prescriptions (patient_id, prescribing_staff_id, appointment_id, expiry_date, renewed_from)
      VALUES ($1,$2,$3,$4,$5) RETURNING prescription_id`,
      [b.patient_id, me(req), b.appointment_id || null, b.expiry_date, b.renewed_from || null]);
    const rxId = rx.rows[0].prescription_id;
    for (const it of items) {
      await c.query(`
        INSERT INTO prescription_items (prescription_id, medication_id, dosage, frequency, route,
          duration_days, quantity, refills_allowed, instructions)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [rxId, it.medication_id, it.dosage.trim(), it.frequency.trim(), it.route || null,
         num(it.duration_days), num(it.quantity), num(it.refills_allowed) || 0, it.instructions || null]);
    }
    return rxId;
  });

  await audit(me(req), b.renewed_from ? 'RENEW_PRESCRIPTION' : 'CREATE_PRESCRIPTION', 'prescription', id,
    { items: items.length, renewed_from: b.renewed_from || null, warnings_acknowledged: validation.warnings.map((w) => w.code) });
  res.status(201).json({ prescription_id: id, validation });
}));

r.patch('/prescriptions/:id', wrap(async (req, res) => {
  const status = req.body.status;
  if (!['cancelled', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const q = await db.query(`
    UPDATE prescriptions SET status = $3
     WHERE prescription_id = $1 AND prescribing_staff_id = $2 AND status = 'active' AND NOT is_expired AND expiry_date >= CURRENT_DATE RETURNING *`,
    [req.params.id, me(req), status]);
  if (!q.rows[0]) return res.status(400).json({ error: 'Only your active prescriptions can be changed. Expired prescriptions are kept as they are.' });
  await audit(me(req), 'UPDATE_PRESCRIPTION', 'prescription', req.params.id, { status });
  res.json(q.rows[0]);
}));

module.exports = r;

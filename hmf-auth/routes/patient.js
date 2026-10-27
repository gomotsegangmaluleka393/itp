// Patient portal API
const express = require('express');
const { db, transaction } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');
const { RX_SELECT, RX_GROUP, RX_STATUS } = require('../lib/prescriptions');
const { validateStored } = require('../lib/rxValidation');
const { newCode, addHistory, sendSignature } = require('../lib/deliveries');

const r = express.Router();
r.use(requireRole('patient'));

const me = (req) => req.session.user.patient_id;
const SLOT_MINUTES = 30;
const ACTIVE_APPT = `('scheduled','checked_in','in_progress','completed')`;

// Free 30-minute slots for a doctor on one day (weekdays 08:00 to 16:30)
async function freeSlots(staffId, date) {
  const q = await db.query(`
    SELECT s::timestamptz AS start, (s + interval '${SLOT_MINUTES} min')::timestamptz AS "end"
      FROM generate_series($2::date + time '08:00', $2::date + time '16:00', interval '${SLOT_MINUTES} min') s
     WHERE extract(isodow FROM $2::date) < 6
       AND s::timestamptz > now()
       AND NOT EXISTS (
         SELECT 1 FROM appointments a
          WHERE a.staff_id = $1 AND a.status IN ${ACTIVE_APPT}
            AND a.scheduled_start < s + interval '${SLOT_MINUTES} min' AND a.scheduled_end > s)
     ORDER BY s`, [staffId, date]);
  return q.rows;
}

// ---------- home page summary ----------

r.get('/summary', wrap(async (req, res) => {
  const next = await db.query(`
    SELECT a.appointment_id, a.scheduled_start, a.scheduled_end, a.status, a.reason, a.room_number,
           s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, d.location
      FROM appointments a JOIN staff s ON s.staff_id = a.staff_id
      LEFT JOIN departments d ON d.department_id = a.department_id
     WHERE a.patient_id = $1 AND a.scheduled_end >= now() AND a.status IN ('scheduled','checked_in','in_progress')
     ORDER BY a.scheduled_start LIMIT 1`, [me(req)]);

  const counts = await db.query(`
    SELECT
      (SELECT count(*)::int FROM appointments WHERE patient_id = $1 AND scheduled_start >= now() AND status = 'scheduled') AS upcoming,
      (SELECT count(*)::int FROM prescriptions WHERE patient_id = $1 AND status = 'active'
         AND expiry_date >= CURRENT_DATE) AS rx_active,
      (SELECT count(*)::int FROM prescriptions WHERE patient_id = $1 AND status = 'active'
         AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS rx_expiring,
      (SELECT count(*)::int FROM deliveries WHERE patient_id = $1
         AND status IN ('pending','assigned','out_for_delivery')) AS deliveries_open`, [me(req)]);

  res.json({ next: next.rows[0] || null, ...counts.rows[0] });
}));

// ---------- booking ----------

r.get('/departments', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT d.department_id, d.name, d.location FROM departments d
     WHERE EXISTS (SELECT 1 FROM staff s WHERE s.department_id = d.department_id AND s.role = 'doctor' AND s.is_active)
     ORDER BY d.name`);
  res.json(q.rows);
}));

r.get('/doctors', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT s.staff_id, s.first_name, s.last_name, s.specialization, s.department_id, d.name AS department
      FROM staff s LEFT JOIN departments d ON d.department_id = s.department_id
     WHERE s.role = 'doctor' AND s.is_active AND ($1::int IS NULL OR s.department_id = $1::int)
     ORDER BY s.last_name`, [req.query.department_id || null]);
  res.json(q.rows);
}));

r.get('/doctors/:id/slots', wrap(async (req, res) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) return res.status(400).json({ error: 'Choose a date' });
  res.json(await freeSlots(req.params.id, req.query.date));
}));

// ---------- appointments ----------

r.get('/appointments', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT a.appointment_id, a.scheduled_start, a.scheduled_end, a.status, a.reason, a.room_number,
           s.first_name || ' ' || s.last_name AS doctor_name, d.name AS department, d.location
      FROM appointments a JOIN staff s ON s.staff_id = a.staff_id
      LEFT JOIN departments d ON d.department_id = a.department_id
     WHERE a.patient_id = $1
     ORDER BY a.scheduled_start DESC`, [me(req)]);
  res.json(q.rows);
}));

r.post('/appointments', wrap(async (req, res) => {
  const { staff_id, start, reason } = req.body;
  if (!staff_id || !start) return res.status(400).json({ error: 'Choose a doctor and a time' });

  const doc = await db.query(`SELECT department_id FROM staff WHERE staff_id = $1 AND role = 'doctor' AND is_active`, [staff_id]);
  if (!doc.rows[0]) return res.status(400).json({ error: 'That doctor is not available' });

  const result = await transaction(async (c) => {
    // lock the doctor row so two people can't book the same slot at once
    await c.query('SELECT 1 FROM staff WHERE staff_id = $1 FOR UPDATE', [staff_id]);

    const day = await c.query('SELECT ($1::timestamptz)::date AS d', [start]);
    const slots = await freeSlots(staff_id, day.rows[0].d);
    const slot = slots.find((s) => s.start.getTime() === new Date(start).getTime());
    if (!slot) return { error: 'That time is no longer available. Please pick another.' };

    const clash = await c.query(`
      SELECT 1 FROM appointments WHERE patient_id = $1 AND status IN ('scheduled','checked_in','in_progress')
         AND scheduled_start < $3 AND scheduled_end > $2`, [me(req), slot.start, slot.end]);
    if (clash.rowCount) return { error: 'You already have an appointment at that time' };

    const ins = await c.query(`
      INSERT INTO appointments (patient_id, staff_id, department_id, scheduled_start, scheduled_end, reason)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [me(req), staff_id, doc.rows[0].department_id, slot.start, slot.end, (reason || '').trim().slice(0, 255) || null]);
    return { appt: ins.rows[0] };
  });

  if (result.error) return res.status(409).json({ error: result.error });
  res.status(201).json(result.appt);
}));

r.patch('/appointments/:id/cancel', wrap(async (req, res) => {
  const q = await db.query(`
    UPDATE appointments SET status = 'cancelled'
     WHERE appointment_id = $1 AND patient_id = $2 AND status = 'scheduled' AND scheduled_start > now()
     RETURNING appointment_id`, [req.params.id, me(req)]);
  if (!q.rows[0]) return res.status(400).json({ error: 'Only upcoming scheduled appointments can be cancelled' });
  res.json({ message: 'Appointment cancelled' });
}));

// ---------- prescriptions ----------

r.get('/prescriptions', wrap(async (req, res) => {
  const q = await db.query(`${RX_SELECT}
     WHERE rx.patient_id = $1 ${RX_GROUP}
     ORDER BY (${RX_STATUS} = 'active') DESC, rx.issue_date DESC`, [me(req)]);
  res.json(q.rows);
}));

// ---------- deliveries ----------

r.get('/deliveries', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT d.delivery_id, d.prescription_id, d.status, d.address_line1, d.address_line2, d.city, d.postal_code,
           d.contact_phone, d.delivery_instructions,
           d.scheduled_date, d.scheduled_window_start, d.scheduled_window_end,
           d.dispatched_at, d.delivered_at, d.recipient_name, d.failure_reason, d.created_at,
           CASE WHEN d.status IN ('pending','assigned','out_for_delivery') THEN d.confirmation_code END AS confirmation_code,
           CASE WHEN d.status = 'out_for_delivery' THEN d.driver_lat END AS driver_lat,
           CASE WHEN d.status = 'out_for_delivery' THEN d.driver_lng END AS driver_lng,
           CASE WHEN d.status = 'out_for_delivery' THEN d.driver_location_at END AS driver_location_at,
           (d.proof_of_delivery_url IS NOT NULL) AS has_signature,
           dr.first_name AS driver_name,
           (SELECT string_agg(m.name, ', ') FROM prescription_items i JOIN medications m ON m.medication_id = i.medication_id
             WHERE i.prescription_id = d.prescription_id) AS medicines,
           COALESCE((SELECT json_agg(json_build_object('status', h.status, 'at', h.changed_at, 'notes', h.notes)
                                     ORDER BY h.changed_at)
                       FROM delivery_status_history h WHERE h.delivery_id = d.delivery_id), '[]') AS history
      FROM deliveries d LEFT JOIN drivers dr ON dr.driver_id = d.driver_id
     WHERE d.patient_id = $1
     ORDER BY d.created_at DESC`, [me(req)]);
  res.json(q.rows);
}));

// Ask for a prescription to be delivered. The prescription is validated first.
r.post('/deliveries', wrap(async (req, res) => {
  const b = req.body;
  const rx = (await db.query('SELECT prescription_id FROM prescriptions WHERE prescription_id = $1 AND patient_id = $2',
    [b.prescription_id, me(req)])).rows[0];
  if (!rx) return res.status(404).json({ error: 'Prescription not found' });

  const v = await validateStored(rx.prescription_id);
  if (v.outcome === 'invalid') {
    return res.status(422).json({ error: `This prescription can't be delivered: ${v.errors[0].message}`, validation: v });
  }

  // Use the address given, or the one on the patient's profile
  const p = (await db.query('SELECT * FROM patients WHERE patient_id = $1', [me(req)])).rows[0];
  const pick = (f) => (typeof b[f] === 'string' && b[f].trim()) || p[f] || null;
  const addr = { address_line1: pick('address_line1'), address_line2: pick('address_line2'), city: pick('city'),
                 postal_code: pick('postal_code'), country: pick('country') || 'South Africa' };
  if (!addr.address_line1 || !addr.city) return res.status(400).json({ error: 'Add a delivery address (street and city)' });

  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.scheduled_date || '') ? b.scheduled_date : null;
  if (date && (await db.query('SELECT $1::date < CURRENT_DATE AS past', [date])).rows[0].past) {
    return res.status(400).json({ error: 'The delivery date cannot be in the past' });
  }

  const d = await transaction(async (c) => {
    const ins = await c.query(`
      INSERT INTO deliveries (patient_id, prescription_id, address_line1, address_line2, city, postal_code, country,
        contact_phone, delivery_instructions, scheduled_date, confirmation_code)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING delivery_id, confirmation_code`,
      [me(req), rx.prescription_id, addr.address_line1, addr.address_line2, addr.city, addr.postal_code, addr.country,
       pick('contact_phone') || p.phone, (b.delivery_instructions || '').trim().slice(0, 500) || null, date, newCode()]);
    await addHistory(c, ins.rows[0].delivery_id, 'pending', {}, 'Requested by patient');
    return ins.rows[0];
  }).catch((e) => {
    if (e.code === '23505') return null; // already an open delivery
    throw e;
  });
  if (!d) return res.status(409).json({ error: 'This prescription already has a delivery on the way' });
  res.status(201).json(d);
}));

r.patch('/deliveries/:id/cancel', wrap(async (req, res) => {
  const q = await db.query(`
    UPDATE deliveries SET status = 'cancelled', failure_reason = 'Cancelled by patient'
     WHERE delivery_id = $1 AND patient_id = $2 AND status IN ('pending','assigned') RETURNING delivery_id`,
    [req.params.id, me(req)]);
  if (!q.rowCount) return res.status(400).json({ error: 'Only deliveries that have not left yet can be cancelled' });
  await addHistory(null, req.params.id, 'cancelled', {}, 'Cancelled by patient');
  res.json({ message: 'Delivery cancelled' });
}));

// Signature captured at the door
r.get('/deliveries/:id/proof', wrap(async (req, res) => {
  const q = await db.query('SELECT 1 FROM deliveries WHERE delivery_id = $1 AND patient_id = $2', [req.params.id, me(req)]);
  if (!q.rowCount) return res.status(404).json({ error: 'Delivery not found' });
  sendSignature(res, req.params.id);
}));

// ---------- profile ----------

const PROFILE_FIELDS = ['phone', 'address_line1', 'address_line2', 'city', 'postal_code', 'country',
  'emergency_contact_name', 'emergency_contact_phone', 'insurance_provider', 'insurance_policy_no'];

r.get('/profile', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT patient_id, first_name, last_name, date_of_birth, gender, email, ${PROFILE_FIELDS.join(', ')}, allergies_summary
      FROM patients WHERE patient_id = $1`, [me(req)]);
  res.json(q.rows[0]);
}));

r.put('/profile', wrap(async (req, res) => {
  const values = PROFILE_FIELDS.map((f) => (typeof req.body[f] === 'string' && req.body[f].trim()) || null);
  const sets = PROFILE_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ');
  await db.query(`UPDATE patients SET ${sets} WHERE patient_id = $1`, [me(req), ...values]);
  res.json({ message: 'Profile saved' });
}));

module.exports = r;

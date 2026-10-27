// Driver app API (needs a driver token from /api/mobile/login)
const express = require('express');
const { db, transaction, audit } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');
const { validateStored } = require('../lib/rxValidation');
const { addHistory, saveSignature } = require('../lib/deliveries');

const r = express.Router();
r.use(requireRole('driver'));

const me = (req) => req.session.user.driver_id;

// Wrong confirmation codes per delivery (5 tries, then 15 minutes wait)
const codeTries = new Map();

// What a driver may see: first name and surname initial only, no medicine names
const DELIVERY_SELECT = `
  SELECT d.delivery_id, d.status, d.prescription_id,
         p.first_name || ' ' || left(p.last_name, 1) || '.' AS patient_name,
         d.address_line1, d.address_line2, d.city, d.postal_code, d.country,
         COALESCE(d.contact_phone, p.phone) AS contact_phone, d.delivery_instructions,
         d.scheduled_date, d.scheduled_window_start, d.scheduled_window_end,
         d.dispatched_at, d.delivered_at, d.recipient_name, d.failure_reason,
         v.plate_number, v.make_model,
         (SELECT count(*)::int FROM prescription_items i WHERE i.prescription_id = d.prescription_id) AS item_count,
         EXISTS (SELECT 1 FROM prescription_items i JOIN medications m ON m.medication_id = i.medication_id
                  WHERE i.prescription_id = d.prescription_id AND m.controlled_substance) AS id_check_required
    FROM deliveries d
    JOIN patients p ON p.patient_id = d.patient_id
    LEFT JOIN vehicles v ON v.vehicle_id = d.vehicle_id`;

async function getMine(req, id) {
  const q = await db.query(`${DELIVERY_SELECT} WHERE d.delivery_id = $1 AND d.driver_id = $2`, [id, me(req)]);
  return q.rows[0];
}

// The prescription must still pass validation before medicine leaves or is handed over
async function prescriptionProblem(d) {
  if (!d.prescription_id) return null; // e.g. medical supplies with no prescription
  const v = await validateStored(d.prescription_id);
  const blocking = v.errors.filter((e) => !['DUPLICATE_PRESCRIPTION'].includes(e.code));
  return blocking.length ? blocking[0].message : null;
}

// ---------- profile ----------

r.get('/me', wrap(async (req, res) => {
  const q = await db.query(`
    SELECT d.driver_id, d.first_name, d.last_name, d.phone, d.email, d.employment_type, d.status,
      (SELECT count(*)::int FROM deliveries x WHERE x.driver_id = d.driver_id AND x.status IN ('assigned','out_for_delivery')) AS active,
      (SELECT count(*)::int FROM deliveries x WHERE x.driver_id = d.driver_id AND x.status = 'delivered'
         AND x.delivered_at::date = CURRENT_DATE) AS delivered_today
    FROM drivers d WHERE d.driver_id = $1`, [me(req)]);
  res.json(q.rows[0]);
}));

// ---------- deliveries ----------

r.get('/deliveries', wrap(async (req, res) => {
  const done = req.query.scope === 'done';
  const q = await db.query(`${DELIVERY_SELECT}
     WHERE d.driver_id = $1 AND ${done
       ? `d.status IN ('delivered','failed','returned','cancelled') AND d.updated_at > now() - interval '30 days'`
       : `d.status IN ('assigned','out_for_delivery')`}
     ORDER BY ${done ? 'd.updated_at DESC' : `(d.status = 'out_for_delivery') DESC, d.scheduled_date NULLS LAST, d.scheduled_window_start NULLS LAST`}`,
    [me(req)]);
  res.json(q.rows);
}));

r.get('/deliveries/:id', wrap(async (req, res) => {
  const d = await getMine(req, req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  const h = await db.query(
    'SELECT status, changed_at AS at, notes FROM delivery_status_history WHERE delivery_id = $1 ORDER BY changed_at', [d.delivery_id]);
  res.json({ ...d, history: h.rows });
}));

// Picked up from the pharmacy and on the way
r.post('/deliveries/:id/start', wrap(async (req, res) => {
  const d = await getMine(req, req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (d.status !== 'assigned') return res.status(400).json({ error: `This delivery is already ${d.status.replace(/_/g, ' ')}` });

  const problem = await prescriptionProblem(d);
  if (problem) return res.status(422).json({ error: `Do not collect this order: ${problem}` });

  await transaction(async (c) => {
    await c.query(`UPDATE deliveries SET status = 'out_for_delivery', dispatched_at = now() WHERE delivery_id = $1`, [d.delivery_id]);
    await addHistory(c, d.delivery_id, 'out_for_delivery', { driver_id: me(req) }, 'Driver collected the order');
  });
  res.json({ message: 'Delivery started' });
}));

// GPS position while driving (the app sends this every minute or so)
r.post('/deliveries/:id/location', wrap(async (req, res) => {
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Invalid location' });
  }
  const q = await db.query(`
    UPDATE deliveries SET driver_lat = $3, driver_lng = $4, driver_location_at = now()
     WHERE delivery_id = $1 AND driver_id = $2 AND status = 'out_for_delivery' RETURNING delivery_id`,
    [req.params.id, me(req), lat.toFixed(6), lng.toFixed(6)]);
  if (!q.rowCount) return res.status(400).json({ error: 'Location is only shared while out for delivery' });
  res.json({ ok: true });
}));

// Handed over: needs the patient's code and a signature
r.post('/deliveries/:id/deliver', wrap(async (req, res) => {
  const { confirmation_code, recipient_name, signature_png, id_checked } = req.body;
  const d = await getMine(req, req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (d.status !== 'out_for_delivery') return res.status(400).json({ error: 'Start the delivery before completing it' });
  if (!recipient_name || !recipient_name.trim()) return res.status(400).json({ error: 'Enter the name of the person receiving the order' });
  if (d.id_check_required && !id_checked) return res.status(400).json({ error: 'This order has a controlled medicine. Check the patient\'s ID first.' });

  // confirmation code with limited tries
  const t = codeTries.get(d.delivery_id) || { n: 0, until: 0 };
  if (t.until > Date.now()) return res.status(429).json({ error: 'Too many wrong codes. Try again in 15 minutes or call the hospital.' });
  const code = (await db.query('SELECT confirmation_code FROM deliveries WHERE delivery_id = $1', [d.delivery_id])).rows[0].confirmation_code;
  if (!code || String(confirmation_code || '').trim() !== code) {
    t.n += 1;
    if (t.n >= 5) { t.n = 0; t.until = Date.now() + 15 * 60 * 1000; }
    codeTries.set(d.delivery_id, t);
    return res.status(400).json({ error: 'The confirmation code is not correct' });
  }
  codeTries.delete(d.delivery_id);

  const problem = await prescriptionProblem(d);
  if (problem) return res.status(422).json({ error: `Do not hand over: ${problem}` });

  const file = saveSignature(d.delivery_id, signature_png);
  if (!file) return res.status(400).json({ error: 'A signature is needed as proof of delivery' });

  await transaction(async (c) => {
    await c.query(`
      UPDATE deliveries SET status = 'delivered', delivered_at = now(), recipient_name = $2,
             proof_of_delivery_url = $3, driver_lat = NULL, driver_lng = NULL
       WHERE delivery_id = $1`, [d.delivery_id, recipient_name.trim().slice(0, 120), `/api/deliveries/${d.delivery_id}/proof`]);
    await addHistory(c, d.delivery_id, 'delivered', { driver_id: me(req) }, `Received by ${recipient_name.trim()}`);
    // mark the prescription completed once all refills are used
    if (d.prescription_id) {
      await c.query(`
        UPDATE prescriptions rx SET status = 'completed'
         WHERE rx.prescription_id = $1 AND rx.status = 'active'
           AND (SELECT count(*) FROM deliveries x WHERE x.prescription_id = rx.prescription_id AND x.status = 'delivered')
               >= 1 + COALESCE((SELECT min(refills_allowed) FROM prescription_items WHERE prescription_id = rx.prescription_id), 0)`,
        [d.prescription_id]);
    }
  });
  await audit(null, 'DELIVERY_COMPLETED', 'delivery', d.delivery_id, { driver_id: me(req), id_checked: !!id_checked });
  res.json({ message: 'Delivery completed' });
}));

// Could not deliver
r.post('/deliveries/:id/fail', wrap(async (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Say why the delivery failed' });
  const d = await getMine(req, req.params.id);
  if (!d) return res.status(404).json({ error: 'Delivery not found' });
  if (!['assigned', 'out_for_delivery'].includes(d.status)) return res.status(400).json({ error: 'This delivery is already closed' });

  await transaction(async (c) => {
    await c.query(`UPDATE deliveries SET status = 'failed', failure_reason = $2, driver_lat = NULL, driver_lng = NULL WHERE delivery_id = $1`,
      [d.delivery_id, reason.slice(0, 500)]);
    await addHistory(c, d.delivery_id, 'failed', { driver_id: me(req) }, reason.slice(0, 500));
  });
  res.json({ message: 'Marked as failed' });
}));

module.exports = r;

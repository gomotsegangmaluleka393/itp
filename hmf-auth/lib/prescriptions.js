// Shared query: prescriptions with their medicine lines as a JSON list

// Treat a prescription past its expiry date as expired straight away
const RX_STATUS = `(CASE WHEN rx.is_expired OR rx.expiry_date < CURRENT_DATE THEN 'expired' ELSE rx.status::text END)`;

const RX_SELECT = `
  SELECT rx.prescription_id, rx.patient_id, rx.appointment_id,
         ${RX_STATUS} AS status, rx.issue_date, rx.expiry_date, rx.created_at,
         (rx.expiry_date - CURRENT_DATE) AS days_left,
         -- expired: true when the flag is set or the expiry date has passed
         (rx.is_expired OR rx.expiry_date < CURRENT_DATE) AS is_expired, rx.expired_at, rx.renewed_from,
         (SELECT n.prescription_id FROM prescriptions n WHERE n.renewed_from = rx.prescription_id
           ORDER BY n.created_at DESC LIMIT 1) AS renewed_by,
         -- how many times it may be dispensed (first time + refills) and how many deliveries used it
         1 + COALESCE(min(i.refills_allowed), 0) AS times_allowed,
         (SELECT count(*)::int FROM deliveries dd WHERE dd.prescription_id = rx.prescription_id AND dd.status = 'delivered') AS times_dispensed,
         p.first_name || ' ' || p.last_name AS patient_name,
         ps.first_name || ' ' || ps.last_name AS doctor_name,
         COALESCE(json_agg(json_build_object(
           'medication_id', m.medication_id, 'medication', m.name, 'generic_name', m.generic_name, 'controlled', m.controlled_substance,
           'dosage', i.dosage, 'frequency', i.frequency, 'route', i.route,
           'duration_days', i.duration_days, 'quantity', i.quantity,
           'refills_allowed', i.refills_allowed, 'instructions', i.instructions
         ) ORDER BY m.name) FILTER (WHERE i.item_id IS NOT NULL), '[]') AS items
    FROM prescriptions rx
    JOIN patients p ON p.patient_id = rx.patient_id
    JOIN staff ps ON ps.staff_id = rx.prescribing_staff_id
    LEFT JOIN prescription_items i ON i.prescription_id = rx.prescription_id
    LEFT JOIN medications m ON m.medication_id = i.medication_id`;

const RX_GROUP = 'GROUP BY rx.prescription_id, p.patient_id, ps.staff_id';

module.exports = { RX_SELECT, RX_GROUP, RX_STATUS };

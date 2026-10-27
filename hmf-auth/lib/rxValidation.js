// Prescription validation system
//
// Checks a prescription against:
//   - the practitioner (active doctor with a license number)
//   - the patient (exists, age, allergies, identity when given)
//   - dates (issue/expiry, maximum validity, already expired)
//   - doses (single and daily limits from medication_rules)
//   - duplicates (same medicine in another active prescription)
//   - drug interactions (drug_interactions table)
//   - controlled substances (no refills, shorter validity)
// It also marks prescriptions as expired once their expiry date has passed.
// Expired prescriptions are kept in the database but can never be used again:
// the doctor must issue a new prescription.

const { db, audit } = require('./db');

const MAX_VALIDITY_DAYS = 180;            // normal prescriptions: 6 months
const MAX_CONTROLLED_VALIDITY_DAYS = 30;  // controlled substances: 30 days
const LICENSE_FORMAT = /^[A-Z]{2}\s?\d{5,8}$/; // e.g. MP0012345 (HPCSA style)

// ---------- reading dose and frequency text ----------

// "500mg" -> 500, "1 g" -> 1000, "200mcg" -> 0.2. Returns null if it can't be read.
function doseInMg(text) {
  const m = /(\d+(?:[.,]\d+)?)\s*(mg|g|mcg|µg|microgram)s?\b/i.exec(text || '');
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const unit = m[2].toLowerCase();
  if (unit === 'g') return n * 1000;
  if (unit === 'mcg' || unit === 'µg' || unit === 'microgram') return n / 1000;
  return n;
}

// "twice daily" -> 2, "every 8 hours" -> 3, "as needed" -> null
function timesPerDay(text) {
  const t = (text || '').toLowerCase();
  if (/\b(prn|as needed|when needed|if needed)\b/.test(t)) return null;
  const every = /every\s+(\d+)\s*(h|hr|hrs|hour|hours)\b/.exec(t);
  if (every) return Math.max(1, Math.floor(24 / parseInt(every[1], 10)));
  const words = [
    [/\b(four times|4 times|qid|qds)\b/, 4],
    [/\b(three times|3 times|tds|tid)\b/, 3],
    [/\b(twice|two times|2 times|bd|bid)\b/, 2],
    [/\b(once|one time|1 time|daily|od|nocte|at night|in the morning|mane)\b/, 1]
  ];
  for (const [re, n] of words) if (re.test(t)) return n;
  return undefined; // unknown wording
}

const fmtMg = (n) => (n < 1 ? `${+(n * 1000).toFixed(1)}mcg` : `${+n.toFixed(2)}mg`);

// ---------- the main check ----------
//
// draft = { prescription_id?, patient_id, prescribing_staff_id, status?, issue_date?, expiry_date,
//           items: [{ medication_id, dosage, frequency, duration_days, quantity, refills_allowed }] }
// identity = { date_of_birth?, last_name? } optional, to confirm who the patient is
//
// Returns { outcome: 'valid' | 'warnings' | 'invalid', errors: [], warnings: [], passed: [] }
async function checkPrescription(draft, identity = {}) {
  const errors = [];
  const warnings = [];
  const passed = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  const items = Array.isArray(draft.items) ? draft.items : [];
  const today = (await db.query('SELECT CURRENT_DATE AS d')).rows[0].d;
  const issue = draft.issue_date || today;

  // 1. Practitioner credentials
  const doc = (await db.query(
    `SELECT s.first_name, s.last_name, s.role, s.is_active, s.license_number, a.approved_at
       FROM staff s LEFT JOIN user_accounts a ON a.staff_id = s.staff_id WHERE s.staff_id = $1`,
    [draft.prescribing_staff_id])).rows[0];
  if (!doc) err('PRACTITIONER_UNKNOWN', 'The prescribing practitioner is not registered in the system.');
  else {
    const before = errors.length;
    if (doc.role !== 'doctor') err('PRACTITIONER_ROLE', `Dr ${doc.last_name} is registered as ${doc.role}, not as a doctor.`);
    if (!doc.is_active) err('PRACTITIONER_INACTIVE', `The prescribing doctor's account is not active.`);
    if (!doc.license_number) err('PRACTITIONER_NO_LICENSE', 'The prescribing doctor has no license number on record.');
    else if (!LICENSE_FORMAT.test(doc.license_number.toUpperCase())) {
      warn('LICENSE_FORMAT', `License number "${doc.license_number}" does not look like an HPCSA number (e.g. MP0012345).`);
    }
    if (errors.length === before) passed.push('Practitioner is an active, licensed doctor');
  }

  // 2. Patient
  const pat = (await db.query(
    `SELECT first_name, last_name, date_of_birth, allergies_summary,
            date_part('year', age(CURRENT_DATE, date_of_birth))::int AS age
       FROM patients WHERE patient_id = $1`, [draft.patient_id])).rows[0];
  if (!pat) err('PATIENT_UNKNOWN', 'The patient is not registered in the system.');
  else {
    let ok = true;
    if (identity.date_of_birth && identity.date_of_birth !== pat.date_of_birth) {
      err('IDENTITY_MISMATCH', 'Date of birth does not match the patient on this prescription.'); ok = false;
    }
    if (identity.last_name && identity.last_name.trim().toLowerCase() !== pat.last_name.toLowerCase()) {
      err('IDENTITY_MISMATCH', 'Surname does not match the patient on this prescription.'); ok = false;
    }
    if (ok) passed.push(identity.date_of_birth || identity.last_name ? 'Patient identity confirmed' : 'Patient is registered');
  }

  // 3. Expiry date (from the database record) and status
  const expiredMsg = (date) => `This prescription expired on ${date}. It can no longer be used – the doctor must issue a new prescription.`;
  if (!draft.expiry_date) err('NO_EXPIRY', 'The prescription has no expiry date.');
  else {
    const dates = (await db.query(
      `SELECT $1::date < CURRENT_DATE AS past_expiry, $1::date <= $2::date AS before_issue,
              $1::date - $2::date AS validity, $2::date > CURRENT_DATE AS future_issue,
              $1::date - CURRENT_DATE AS days_left`,
      [draft.expiry_date, issue])).rows[0];
    const before = errors.length;
    // expired if the flag is on OR the date has passed (even before the hourly job runs)
    if (draft.is_expired || draft.status === 'expired' || dates.past_expiry) err('EXPIRED', expiredMsg(draft.expiry_date));
    else if (draft.status && draft.status !== 'active') err('NOT_ACTIVE', `This prescription is ${draft.status}.`);
    if (dates.before_issue) err('EXPIRY_BEFORE_ISSUE', 'The expiry date must be after the issue date.');
    if (dates.future_issue) err('ISSUE_IN_FUTURE', 'The issue date is in the future.');
    if (dates.validity > MAX_VALIDITY_DAYS) err('VALIDITY_TOO_LONG', `A prescription can be valid for at most ${MAX_VALIDITY_DAYS} days.`);
    draft._validity = dates.validity;
    draft._days_left = dates.days_left;
    if (errors.length === before) passed.push(`Expiry date ${draft.expiry_date} checked: not expired (${dates.days_left} day(s) left)`);
  }

  // 4. Medicines
  if (items.length === 0) err('NO_ITEMS', 'The prescription has no medicines.');

  const ids = items.map((i) => parseInt(i.medication_id, 10)).filter(Boolean);
  const meds = ids.length ? (await db.query(
    `SELECT m.medication_id, m.name, m.generic_name, m.controlled_substance,
            r.max_single_dose_mg, r.max_daily_dose_mg, r.min_age_years, r.max_duration_days, r.allergy_keywords
       FROM medications m LEFT JOIN medication_rules r ON r.medication_id = m.medication_id
      WHERE m.medication_id = ANY($1::int[])`, [ids])).rows : [];
  const medById = Object.fromEntries(meds.map((m) => [m.medication_id, m]));

  const seen = new Set();
  let doseOk = true;
  let allergyOk = true;
  for (const it of items) {
    const m = medById[parseInt(it.medication_id, 10)];
    if (!m) { err('MEDICATION_UNKNOWN', 'A medicine on the prescription is not in the medicine catalogue.'); continue; }

    if (seen.has(m.medication_id)) err('DUPLICATE_ITEM', `${m.name} is listed more than once.`);
    seen.add(m.medication_id);

    // Allergies: compare the patient's allergy note with the medicine's allergy words
    if (pat && pat.allergies_summary) {
      const allergyText = pat.allergies_summary.toLowerCase();
      const words = [...(m.allergy_keywords || []), m.generic_name, m.name.split(' ')[0]].filter(Boolean).map((w) => w.toLowerCase());
      const hit = words.find((w) => w.length > 3 && allergyText.includes(w));
      if (hit) { err('ALLERGY', `Patient allergy "${pat.allergies_summary}" conflicts with ${m.name}.`); allergyOk = false; }
    }

    // Age limit
    if (pat && m.min_age_years && pat.age < m.min_age_years) {
      err('AGE', `${m.name} is not for patients under ${m.min_age_years} (patient is ${pat.age}).`);
    }

    // Dose limits
    const single = doseInMg(it.dosage);
    const perDay = timesPerDay(it.frequency);
    if (m.max_single_dose_mg == null && m.max_daily_dose_mg == null) {
      warn('NO_DOSE_RULE', `No dose limits are on record for ${m.name}, so the dose was not checked.`);
    } else if (single == null) {
      warn('DOSE_UNREADABLE', `Could not read the dose "${it.dosage}" for ${m.name}. Use a format like 500mg.`); doseOk = false;
    } else {
      if (m.max_single_dose_mg != null && single > +m.max_single_dose_mg) {
        err('DOSE_TOO_HIGH', `${m.name}: ${fmtMg(single)} per dose is above the maximum of ${fmtMg(+m.max_single_dose_mg)}.`); doseOk = false;
      }
      if (perDay === undefined) {
        warn('FREQUENCY_UNREADABLE', `Could not read the frequency "${it.frequency}" for ${m.name}.`); doseOk = false;
      } else if (perDay === null) {
        warn('PRN', `${m.name} is "as needed"; make sure the patient knows the daily maximum.`);
      } else if (m.max_daily_dose_mg != null && single * perDay > +m.max_daily_dose_mg) {
        err('DAILY_DOSE_TOO_HIGH', `${m.name}: ${fmtMg(single * perDay)} a day is above the maximum of ${fmtMg(+m.max_daily_dose_mg)}.`); doseOk = false;
      }
    }
    if (m.max_duration_days && parseInt(it.duration_days, 10) > m.max_duration_days) {
      err('DURATION_TOO_LONG', `${m.name} can be prescribed for at most ${m.max_duration_days} days.`);
    }
    if ((parseInt(it.refills_allowed, 10) || 0) < 0 || (parseInt(it.quantity, 10) || 0) < 0) {
      err('NEGATIVE_NUMBER', `${m.name}: quantity and refills cannot be negative.`);
    }

    // Controlled substances
    if (m.controlled_substance) {
      if ((parseInt(it.refills_allowed, 10) || 0) > 0) err('CONTROLLED_REFILLS', `${m.name} is a controlled substance and cannot have refills.`);
      if (draft._validity > MAX_CONTROLLED_VALIDITY_DAYS) {
        err('CONTROLLED_VALIDITY', `Prescriptions with ${m.name} can be valid for at most ${MAX_CONTROLLED_VALIDITY_DAYS} days.`);
      }
      warn('CONTROLLED', `${m.name} is a controlled substance: check the patient's ID when handing it over.`);
    }
  }
  if (items.length && doseOk) passed.push('Doses are within limits');
  if (items.length && allergyOk && pat) passed.push(pat.allergies_summary ? 'No conflict with recorded allergies' : 'No allergies on record');

  // 5. Duplicates and interactions with the patient's other active prescriptions
  if (pat && ids.length) {
    const other = (await db.query(
      `SELECT DISTINCT i.medication_id, m.name, rx.prescription_id, rx.issue_date
         FROM prescriptions rx
         JOIN prescription_items i ON i.prescription_id = rx.prescription_id
         JOIN medications m ON m.medication_id = i.medication_id
        WHERE rx.patient_id = $1 AND rx.status = 'active' AND rx.expiry_date >= CURRENT_DATE
          AND ($2::uuid IS NULL OR rx.prescription_id <> $2::uuid)`,
      [draft.patient_id, draft.prescription_id || null])).rows;

    const dupes = other.filter((o) => ids.includes(o.medication_id));
    dupes.forEach((d) => warn('DUPLICATE_PRESCRIPTION', `${d.name} is already on another active prescription (issued ${d.issue_date}).`));
    if (!dupes.length) passed.push('No duplicate active prescriptions');

    const allIds = [...new Set([...ids, ...other.map((o) => o.medication_id)])];
    const inter = (await db.query(
      `SELECT di.severity, di.description, a.name AS a_name, b.name AS b_name, di.medication_a, di.medication_b
         FROM drug_interactions di
         JOIN medications a ON a.medication_id = di.medication_a
         JOIN medications b ON b.medication_id = di.medication_b
        WHERE di.medication_a = ANY($1::int[]) AND di.medication_b = ANY($1::int[])`, [allIds])).rows
      // only pairs that involve at least one medicine from this prescription
      .filter((x) => ids.includes(x.medication_a) || ids.includes(x.medication_b));
    inter.forEach((x) => {
      const msg = `${x.a_name} + ${x.b_name} (${x.severity} interaction): ${x.description}`;
      if (x.severity === 'major') err('INTERACTION', msg); else warn('INTERACTION', msg);
    });
    if (!inter.length) passed.push('No known drug interactions');
  }

  // the same message once only
  const once = (list) => list.filter((x, i) => list.findIndex((y) => y.message === x.message) === i);
  const outcome = errors.length ? 'invalid' : warnings.length ? 'warnings' : 'valid';
  const isExpired = errors.some((e) => e.code === 'EXPIRED');
  const expiry = { expiry_date: draft.expiry_date || null, is_expired: isExpired, days_left: draft._days_left ?? null };
  // an expired prescription can't be used anyway, so clashes with other prescriptions don't matter
  const shown = isExpired ? warnings.filter((w) => !['DUPLICATE_PRESCRIPTION', 'INTERACTION'].includes(w.code)) : warnings;
  return { outcome, errors: once(errors), warnings: once(shown), passed, expiry };
}

// ---------- check a stored prescription by id ----------

async function validateStored(prescriptionId, identity = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(prescriptionId || '')) {
    return { outcome: 'invalid', errors: [{ code: 'BAD_ID', message: 'That is not a valid prescription number.' }], warnings: [], passed: [] };
  }
  const rx = (await db.query('SELECT * FROM prescriptions WHERE prescription_id = $1', [prescriptionId])).rows[0];

  if (!rx) {
    // Removed by the old delete-on-expiry job (before expired prescriptions were kept)?
    const gone = (await db.query(
      `SELECT occurred_at, details FROM audit_log WHERE action = 'PRESCRIPTION_DELETED' AND entity_id = $1
        ORDER BY occurred_at DESC LIMIT 1`, [prescriptionId])).rows[0];
    const message = gone
      ? `This prescription expired on ${gone.details.expiry_date} and was removed from the system.`
      : 'No prescription with this number exists.';
    return { outcome: 'invalid', errors: [{ code: gone ? 'DELETED_EXPIRED' : 'NOT_FOUND', message }], warnings: [], passed: [] };
  }

  const items = (await db.query('SELECT * FROM prescription_items WHERE prescription_id = $1', [prescriptionId])).rows;
  const result = await checkPrescription({ ...rx, items }, identity);

  // Refills: dispensed (delivered) once plus once per refill
  const use = (await db.query(`
    SELECT 1 + COALESCE(min(i.refills_allowed), 0) AS allowed,
           (SELECT count(*)::int FROM deliveries d WHERE d.prescription_id = $1 AND d.status = 'delivered') AS used
      FROM prescription_items i WHERE i.prescription_id = $1`, [prescriptionId])).rows[0];
  if (use && use.used >= use.allowed) {
    result.errors.push({ code: 'REFILLS_USED', message: `This prescription has already been dispensed ${use.used} time(s) and has no refills left.` });
    result.outcome = 'invalid';
  } else if (use) {
    result.passed.push(`Dispensed ${use.used} of ${use.allowed} time(s)`);
  }

  // Expired: point to the new prescription if the doctor has already issued one
  if (result.expiry.is_expired) {
    const next = (await db.query(
      `SELECT prescription_id, issue_date FROM prescriptions WHERE renewed_from = $1 ORDER BY created_at DESC LIMIT 1`,
      [prescriptionId])).rows[0];
    result.renewed_by = next || null;
    if (next) result.warnings.push({ code: 'RENEWED', message: `A new prescription was issued on ${next.issue_date}: ${next.prescription_id}` });
  }

  const summary = (await db.query(
    `SELECT p.first_name || ' ' || p.last_name AS patient_name, s.first_name || ' ' || s.last_name AS doctor_name,
            s.license_number, rx.issue_date, rx.expiry_date, rx.status, rx.is_expired, rx.expired_at,
            COALESCE(json_agg(json_build_object('medication', m.name, 'dosage', i.dosage, 'frequency', i.frequency,
              'controlled', m.controlled_substance)) FILTER (WHERE i.item_id IS NOT NULL), '[]') AS items
       FROM prescriptions rx JOIN patients p ON p.patient_id = rx.patient_id
       JOIN staff s ON s.staff_id = rx.prescribing_staff_id
       LEFT JOIN prescription_items i ON i.prescription_id = rx.prescription_id
       LEFT JOIN medications m ON m.medication_id = i.medication_id
      WHERE rx.prescription_id = $1
      GROUP BY rx.prescription_id, p.patient_id, s.staff_id`, [prescriptionId])).rows[0];

  return { ...result, prescription: { prescription_id: prescriptionId, ...summary } };
}

// ---------- mark expired prescriptions ----------
// Runs every hour and when the server starts.
// Turns on the expired flag for every prescription past its expiry date.
// The prescription is kept (for the patient's history) but can't be used again,
// and any delivery that hasn't happened yet is cancelled.

async function expirePrescriptions(triggeredBy = null) {
  const client = await db.connect();
  let expired = [];
  let cancelledDeliveries = 0;
  try {
    await client.query('BEGIN');

    expired = (await client.query(`
      UPDATE prescriptions
         SET is_expired = TRUE, expired_at = now(), status = 'expired'
       WHERE expiry_date < CURRENT_DATE AND NOT is_expired
      RETURNING prescription_id, patient_id, prescribing_staff_id, issue_date, expiry_date`)).rows;

    if (expired.length) {
      const ids = expired.map((r) => r.prescription_id);

      // Stop any delivery that hasn't happened yet
      const c = await client.query(`
        UPDATE deliveries SET status = 'cancelled', failure_reason = 'Prescription expired'
         WHERE prescription_id = ANY($1::uuid[]) AND status IN ('pending','assigned','out_for_delivery')
         RETURNING delivery_id`, [ids]);
      cancelledDeliveries = c.rowCount;
      for (const d of c.rows) {
        await client.query(
          `INSERT INTO delivery_status_history (delivery_id, status, notes) VALUES ($1, 'cancelled', 'Prescription expired')`,
          [d.delivery_id]);
      }

      for (const r of expired) {
        await client.query(
          `INSERT INTO audit_log (staff_id, action, entity_type, entity_id, details)
           VALUES (NULL, 'PRESCRIPTION_EXPIRED', 'prescription', $1, $2)`,
          [r.prescription_id, { expiry_date: r.expiry_date, patient_id: r.patient_id }]);
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await audit(triggeredBy, 'RX_EXPIRY_CHECK', 'prescription', 'all',
    { expired: expired.length, cancelled_deliveries: cancelledDeliveries });
  return { expired: expired.length, cancelled_deliveries: cancelledDeliveries };
}

module.exports = { checkPrescription, validateStored, expirePrescriptions, doseInMg, timesPerDay };

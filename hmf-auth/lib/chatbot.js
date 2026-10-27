// AI health assistant for patients.
//
// 1. Every message is sorted into one of the categories from the proposal
//    (symptom triage, medication, test terms, appointments, delivery, validation...).
// 2. Emergencies are always answered by fixed rules, never by the AI.
// 3. Answers use the patient's own appointments, prescriptions and deliveries.
// 4. If CORTI_API_KEY is set, Corti AI writes the reply;
//    otherwise the built-in replies are used.
// The assistant never diagnoses. It can hand the conversation to hospital staff.

const { db } = require('./db');

const EMERGENCY_NUMBERS = 'Call 10177 for an ambulance, or 112 from any cell phone.';
const CRISIS_LINE = 'SADAG Suicide Crisis Line: 0800 567 567 (free, 24 hours).';

// ---------- categories and the words that point to them ----------

const RED_FLAGS = [
  /chest (pain|tight)/, /tight(ness)? in (my )?chest/, /(can'?t|cannot|struggling to|hard to) breathe/, /difficulty breathing/,
  /\bstroke\b/, /face (is )?droop/, /slurred speech/, /unconscious/, /passed out/, /not breathing/, /seizure/, /\bfitting\b/,
  /(severe|heavy|won'?t stop) bleeding/, /bleeding (a lot|heavily)/, /overdose/, /poison/, /swallowed (bleach|pills)/,
  /anaphyla/, /throat (is )?(swelling|closing)/, /(coughing|vomiting) (up )?blood/
];
const SELF_HARM = [/suicid/, /kill myself/, /end my life/, /self[- ]?harm/, /hurt myself/, /don'?t want to live/];

const INTENTS = {
  symptom_triage: ['pain', 'ache', 'aching', 'fever', 'temperature', 'cough', 'headache', 'migraine', 'nausea', 'vomit', 'diarrh',
    'rash', 'dizzy', 'sore', 'flu', 'cold', 'tired', 'fatigue', 'swelling', 'swollen', 'itch', 'infection', 'sick', 'hurt',
    'symptom', 'feel unwell', 'not feeling well', 'stomach', 'burning', 'bleeding', 'breathless', 'wheez'],
  medication: ['medication', 'medicine', 'pill', 'tablet', 'dose', 'dosage', 'side effect', 'missed', 'refill',
    'take my', 'how much', 'how often', 'with food', 'alcohol', 'capsule', 'inhaler', 'antibiotic'],
  diagnostic_terms: ['what does', 'what is', 'mean', 'meaning', 'result', 'report', 'test', 'level', 'scan', 'blood work', 'diagnos'],
  appointments: ['appointment', 'book', 'booking', 'reschedul', 'cancel my', 'consult', 'see a doctor', 'see the doctor',
    'available', 'visit', 'check-up', 'checkup', 'when is my'],
  delivery: ['deliver', 'driver', 'courier', 'track', 'where is my', 'parcel', 'order', 'code', 'arrive'],
  validation: ['valid', 'expire', 'expiry', 'expired', 'verify', 'verification', 'deleted', 'removed', 'still use my prescription'],
  human: ['speak to', 'talk to', 'real person', 'human', 'nurse', 'call me', 'contact someone', 'staff member'],
  greeting: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'thank', 'thanks']
};

// Short explanations of common test and report words
const GLOSSARY = {
  hba1c: 'HbA1c shows your average blood sugar over the last 2–3 months. It is used to check and monitor diabetes.',
  'blood pressure': 'Blood pressure is written as two numbers, e.g. 120/80. The top number is the pressure when the heart beats, the bottom when it rests.',
  hypertension: 'Hypertension means high blood pressure. It often has no symptoms but raises the risk of heart disease and stroke.',
  cholesterol: 'Cholesterol is a fat in the blood. Too much of the "bad" type (LDL) can block blood vessels.',
  ldl: 'LDL is the "bad" cholesterol. Lower is usually better.',
  hdl: 'HDL is the "good" cholesterol that helps remove other cholesterol from the blood.',
  triglycerides: 'Triglycerides are a type of fat in the blood. High levels can be linked to diet, diabetes or heart risk.',
  ecg: 'An ECG (electrocardiogram) records the electrical activity of your heart to check its rhythm.',
  echo: 'An echocardiogram ("echo") is an ultrasound of the heart that shows how it pumps.',
  fbc: 'A full blood count (FBC) measures red cells, white cells and platelets.',
  cbc: 'A complete blood count (CBC) measures red cells, white cells and platelets.',
  haemoglobin: 'Haemoglobin carries oxygen in red blood cells. Low levels can mean anaemia.',
  hemoglobin: 'Haemoglobin carries oxygen in red blood cells. Low levels can mean anaemia.',
  anaemia: 'Anaemia means you have fewer red blood cells or less haemoglobin than normal, which can cause tiredness.',
  platelets: 'Platelets help your blood clot.',
  'white cell': 'White blood cells fight infection. High levels can be a sign of infection or inflammation.',
  wbc: 'WBC means white blood cell count. White cells fight infection.',
  egfr: 'eGFR estimates how well your kidneys filter the blood. Lower numbers can mean reduced kidney function.',
  creatinine: 'Creatinine is a waste product cleared by the kidneys. It is used to check kidney function.',
  tsh: 'TSH is a hormone that controls the thyroid. It is used to check for an over- or under-active thyroid.',
  glucose: 'Glucose is blood sugar. Fasting levels are used to check for diabetes.',
  'x-ray': 'An X-ray uses a small amount of radiation to take pictures of bones and some organs.',
  mri: 'An MRI uses magnets and radio waves (no radiation) to take detailed pictures inside the body.',
  'ct scan': 'A CT scan uses X-rays and a computer to make cross-section pictures of the body.',
  biopsy: 'A biopsy is a small sample of tissue taken to look at under a microscope.',
  benign: 'Benign means not cancer.',
  malignant: 'Malignant means cancerous.',
  tachycardia: 'Tachycardia means a fast heart rate (usually over 100 beats a minute at rest).',
  bradycardia: 'Bradycardia means a slow heart rate (usually under 60 beats a minute at rest).',
  bmi: 'BMI (body mass index) compares weight to height. 18.5–24.9 is the usual healthy range for adults.'
};

// ---------- sorting a message into a category ----------

function classify(text) {
  const t = ` ${text.toLowerCase()} `;
  if (SELF_HARM.some((re) => re.test(t))) return { intent: 'self_harm', confidence: 1 };
  if (RED_FLAGS.some((re) => re.test(t))) return { intent: 'emergency', confidence: 1 };

  let best = { intent: 'unknown', score: 0 };
  for (const [intent, words] of Object.entries(INTENTS)) {
    // short words must match whole words (so "hi" doesn't match "this")
    let score = words.reduce((n, w) => n + (new RegExp(`\\b${w}${w.length <= 4 ? '\\b' : ''}`).test(t) ? 1 : 0), 0);
    if (intent === 'diagnostic_terms' && Object.keys(GLOSSARY).some((k) => t.includes(k))) score += 2;
    if (intent === 'greeting' && score && t.trim().split(/\s+/).length > 4) score = 0.5; // "hi, my head hurts" is not a greeting
    if (score > best.score) best = { intent, score };
  }
  return { intent: best.intent, confidence: Math.min(1, best.score / 2) };
}

// ---------- the patient's own information ----------

async function loadContext(patientId) {
  const [p, appts, rx, del] = await Promise.all([
    db.query('SELECT first_name, allergies_summary FROM patients WHERE patient_id = $1', [patientId]),
    db.query(`
      SELECT a.scheduled_start, a.status, a.reason, s.first_name || ' ' || s.last_name AS doctor, d.name AS department
        FROM appointments a JOIN staff s ON s.staff_id = a.staff_id LEFT JOIN departments d ON d.department_id = a.department_id
       WHERE a.patient_id = $1 AND a.scheduled_start >= now() AND a.status = 'scheduled'
       ORDER BY a.scheduled_start LIMIT 3`, [patientId]),
    db.query(`
      SELECT rx.prescription_id, rx.expiry_date, (rx.expiry_date - CURRENT_DATE) AS days_left,
             m.name, m.generic_name, i.dosage, i.frequency, i.instructions, i.refills_allowed
        FROM prescriptions rx JOIN prescription_items i ON i.prescription_id = rx.prescription_id
        JOIN medications m ON m.medication_id = i.medication_id
       WHERE rx.patient_id = $1 AND rx.status = 'active' AND rx.expiry_date >= CURRENT_DATE
       ORDER BY rx.expiry_date`, [patientId]),
    db.query(`
      SELECT status, scheduled_date, confirmation_code, driver_location_at FROM deliveries
       WHERE patient_id = $1 AND status IN ('pending','assigned','out_for_delivery') ORDER BY created_at DESC`, [patientId])
  ]);
  return { first_name: p.rows[0]?.first_name || 'there', allergies: p.rows[0]?.allergies_summary || null,
           appointments: appts.rows, medicines: rx.rows, deliveries: del.rows };
}

const when = (d) => new Date(d).toLocaleString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: process.env.HOSPITAL_TZ || 'Africa/Johannesburg' });
const LINK = {
  book: { label: 'Book an appointment', href: '/patient/appointments.html?book=1' },
  appts: { label: 'My appointments', href: '/patient/appointments.html' },
  rx: { label: 'My prescriptions', href: '/patient/prescriptions.html' },
  deliveries: { label: 'Track deliveries', href: '/patient/deliveries.html' }
};
const escalate = (category, urgency, label = 'Ask a nurse to contact me') => ({ label, action: 'escalate', category, urgency });

// ---------- built-in replies ----------

function ruleReply(intent, text, ctx) {
  const t = text.toLowerCase();
  const name = ctx.first_name;

  switch (intent) {
    case 'self_harm':
      return { reply: `I'm really sorry you're feeling this way, ${name}. You deserve support right now. ${CRISIS_LINE} If you are in immediate danger, ${EMERGENCY_NUMBERS} I've also let our staff know so someone can contact you.`,
               auto_escalate: 'emergency' };

    case 'emergency':
      return { reply: `This could be a medical emergency. ${EMERGENCY_NUMBERS} If you are at the hospital, go straight to the emergency unit. Don't wait for a reply here. I've alerted our staff.`,
               auto_escalate: 'emergency' };

    case 'symptom_triage': {
      const long = /(\d+|few|several|many)\s*(days|weeks)|week|month/.test(t);
      const severe = /severe|very bad|worse|getting worse|unbearable|high fever|pregnan|baby|infant|newborn/.test(t);
      if (severe || long) {
        return { reply: `Thanks for telling me, ${name}. Because ${severe ? 'this sounds severe or is getting worse' : 'this has lasted a while'}, it should be checked by a doctor soon. I'd suggest booking the first available appointment, or I can ask a nurse to call you. If it suddenly gets much worse, ${EMERGENCY_NUMBERS}`,
                 actions: [LINK.book, escalate('symptom_triage', 'urgent')] };
      }
      return { reply: `I'm sorry you're not feeling well, ${name}. I can't diagnose, but for mild symptoms rest, fluids and over-the-counter relief usually help in the first day or two. Please book an appointment if it lasts more than 2–3 days, keeps getting worse, or you're worried. Go to emergency if you have chest pain, trouble breathing, confusion or heavy bleeding.`,
               actions: [LINK.book, escalate('symptom_triage', 'routine')] };
    }

    case 'medication': {
      const mine = ctx.medicines.find((m) => t.includes(m.name.toLowerCase().split(' ')[0]) || (m.generic_name && t.includes(m.generic_name.toLowerCase())));
      if (/missed|forgot/.test(t)) {
        return { reply: `If you missed a dose: take it when you remember, unless it's almost time for the next one. Then skip the missed dose. Never take a double dose. For medicine-specific advice, ask the pharmacist or a nurse.`,
                 actions: [LINK.rx, escalate('medication', 'routine', 'Ask a pharmacist or nurse')] };
      }
      if (/side effect|reaction|allerg|rash|swell/.test(t)) {
        return { reply: `Some side effects are mild, but a rash, swelling of the face or lips, or trouble breathing can be an allergic reaction. If you have trouble breathing, ${EMERGENCY_NUMBERS} Otherwise, stop and ask a nurse or pharmacist before your next dose.`,
                 actions: [escalate('medication', 'urgent', 'Ask a nurse about a side effect')] };
      }
      if (mine) {
        return { reply: `Your prescription for ${mine.name} says: ${mine.dosage}, ${mine.frequency}${mine.instructions ? `. ${mine.instructions}` : ''}. It is valid until ${mine.expiry_date} (${mine.days_left} days left). Follow these instructions unless your doctor tells you otherwise.`,
                 actions: [LINK.rx] };
      }
      if (ctx.medicines.length) {
        const list = [...new Set(ctx.medicines.map((m) => `${m.name} (${m.dosage}, ${m.frequency})`))].join('; ');
        return { reply: `Your active medicines are: ${list}. Ask me about any of them by name, or ask a pharmacist if you're unsure.`, actions: [LINK.rx] };
      }
      return { reply: `You don't have any active prescriptions at the moment. For questions about other medicines, please ask a pharmacist or a nurse.`,
               actions: [escalate('medication', 'routine', 'Ask a pharmacist or nurse')] };
    }

    case 'diagnostic_terms': {
      const hits = Object.entries(GLOSSARY).filter(([k]) => t.includes(k));
      if (hits.length) {
        return { reply: `${hits.slice(0, 3).map(([, v]) => v).join(' ')} What your own result means depends on your health history, so please go through it with your doctor.`,
                 actions: [LINK.book] };
      }
      return { reply: `I can explain common test words like HbA1c, cholesterol, ECG, FBC, eGFR or TSH. Which word on your report would you like explained?` };
    }

    case 'appointments': {
      if (ctx.appointments.length) {
        const a = ctx.appointments[0];
        return { reply: `Your next appointment is on ${when(a.scheduled_start)} with Dr ${a.doctor}${a.department ? ` (${a.department})` : ''}. You can book, view or cancel appointments on the Appointments page.`,
                 actions: [LINK.appts, LINK.book] };
      }
      return { reply: `You don't have an upcoming appointment. You can book one online. Choose a department, a doctor and a free time slot (weekdays 08:00–16:30).`, actions: [LINK.book] };
    }

    case 'delivery': {
      if (ctx.deliveries.length) {
        const d = ctx.deliveries[0];
        const status = { pending: 'waiting for a driver to be assigned', assigned: 'assigned to a driver', out_for_delivery: 'on its way to you' }[d.status];
        return { reply: `Your delivery is ${status}. When the driver arrives, give them your code ${d.confirmation_code} and sign on their phone. You can follow it live on the Deliveries page or in the patient app.`,
                 actions: [LINK.deliveries] };
      }
      return { reply: `You don't have a delivery in progress. To get medicine delivered, open My prescriptions and press "Request delivery" on an active prescription. The prescription is checked first, then a driver is assigned.`,
               actions: [LINK.rx] };
    }

    case 'validation': {
      const soon = ctx.medicines.filter((m) => m.days_left <= 7);
      const note = soon.length ? ` Note: ${[...new Set(soon.map((m) => m.name))].join(', ')} expires within 7 days.` : '';
      return { reply: `Every prescription is checked by our validation system: the doctor's registration, your identity and allergies, the dose, and duplicate or clashing medicines. A prescription is only valid until the expiry date on it. After that it is marked as expired: it stays in your records but can't be dispensed or delivered again, and your doctor has to issue a new prescription. Book a follow-up if you still need the medicine.${note}`,
               actions: [LINK.rx, LINK.book] };
    }

    case 'human':
      return { reply: `Of course. I can ask a nurse to contact you. Press the button below and they'll see your message. For anything urgent, ${EMERGENCY_NUMBERS}`,
               actions: [escalate('general', 'routine', 'Ask a nurse to contact me')] };

    case 'greeting':
      return { reply: /thank/.test(t) ? `You're welcome, ${name}! Anything else I can help with?`
        : `Hi ${name}! I'm the hospital's health assistant. I can help with symptoms, your medicines, test words, appointments, deliveries and prescription questions. What would you like to know?` };

    default:
      return { reply: `Sorry, I'm not sure I understood. I can help with symptoms, your medicines, explaining test results, appointments, deliveries and prescriptions. You can also ask to speak to a nurse.`,
               actions: [escalate('general', 'routine', 'Ask a nurse instead')] };
  }
}

// ---------- optional AI wording (Corti) ----------

// Corti writes the replies when CORTI_API_KEY is set. CHATBOT_PROVIDER=none turns it off.
function provider() {
  if ((process.env.CHATBOT_PROVIDER || '').toLowerCase() === 'none') return 'none';
  return process.env.CORTI_API_KEY ? 'corti' : 'none';
}

// Corti: OpenAI-style chat completions (https://docs.corti.ai)
async function callCorti(system, messages, signal) {
  const base = (process.env.CORTI_BASE_URL || 'https://ai.eu.corti.app/v1').replace(/\/$/, '');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CORTI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.CORTI_MODEL || 'corti-s1-instant',
      max_tokens: 400,
      temperature: 0.3, // calmer, more consistent answers
      messages: [{ role: 'system', content: system }, ...messages]
    })
  });
  if (!res.ok) throw new Error(`Corti returned ${res.status}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function aiReply(intent, history, text, ctx, fallback) {
  const which = provider();
  if (which === 'none') return null;

  const system = `You are the patient health assistant of a South African hospital. Reply in 2-5 short, warm sentences, plain English.
Only help with: symptom triage (general guidance, never a diagnosis), the patient's own medicines, explaining test and report terms,
appointments, medicine delivery, and how prescription validation and expiry work.
Never diagnose, never change a dose, never invent facts about the patient. If unsure, suggest a doctor, pharmacist or nurse.
If anything sounds urgent, tell them to call 10177 (ambulance) or 112.
The message was classified as: ${intent}.
A safe answer written by the hospital's rules is: "${fallback}". Keep its facts and advice; you may word it better.
Patient information (only use if relevant): ${JSON.stringify({
    first_name: ctx.first_name, allergies: ctx.allergies,
    upcoming_appointments: ctx.appointments.map((a) => ({ when: when(a.scheduled_start), doctor: a.doctor, department: a.department })),
    active_medicines: ctx.medicines.map((m) => ({ name: m.name, dosage: m.dosage, frequency: m.frequency, instructions: m.instructions, valid_until: m.expiry_date })),
    open_deliveries: ctx.deliveries.map((d) => ({ status: d.status }))
  })}`;

  const messages = [...history.slice(-8).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.text).slice(0, 1000) })),
    { role: 'user', content: text }];
  // the conversation must start with the patient's message
  while (messages.length && messages[0].role !== 'user') messages.shift();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const out = await callCorti(system, messages, ctrl.signal);
    return out || null;
  } catch (e) {
    console.error(`Chatbot AI (${which}) failed, using built-in reply:`, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- main entry ----------

async function answer(patientId, text, history = []) {
  const { intent, confidence } = classify(text);
  const ctx = await loadContext(patientId);
  const rule = ruleReply(intent, text, ctx);

  // emergencies always use the fixed reply
  let reply = rule.reply;
  let source = 'rules';
  if (!['emergency', 'self_harm'].includes(intent)) {
    const ai = await aiReply(intent, history, text, ctx, rule.reply);
    if (ai) { reply = ai; source = provider(); }
  }
  return { reply, intent, confidence, actions: rule.actions || [], auto_escalate: rule.auto_escalate || null, source };
}

module.exports = { answer, classify, GLOSSARY };

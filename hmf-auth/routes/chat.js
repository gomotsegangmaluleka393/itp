// Chatbot API for patients (web portal and patient app) and the staff inbox for hand-overs
const express = require('express');
const { db, audit } = require('../lib/db');
const { wrap, requireRole } = require('../lib/auth');
const { answer } = require('../lib/chatbot');
const { logChat } = require('../lib/chatLog');

const r = express.Router();
const URGENCY = ['routine', 'urgent', 'emergency'];

// At most 30 messages per patient every 10 minutes
const recent = new Map();
function tooMany(patientId) {
  const now = Date.now();
  const list = (recent.get(patientId) || []).filter((t) => now - t < 10 * 60 * 1000);
  list.push(now);
  recent.set(patientId, list);
  return list.length > 30;
}

async function createEscalation(patientId, category, urgency, message) {
  const q = await db.query(`
    INSERT INTO chat_escalations (patient_id, category, urgency, patient_message)
    VALUES ($1, $2, $3, $4) RETURNING escalation_id`,
    [patientId, String(category || 'general').slice(0, 40), URGENCY.includes(urgency) ? urgency : 'routine', String(message).slice(0, 2000)]);
  return q.rows[0].escalation_id;
}

// ---------- patient side ----------

r.post('/patient/chat', requireRole('patient'), wrap(async (req, res) => {
  const pid = req.session.user.patient_id;
  const text = String(req.body.message || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'Type a message' });
  if (tooMany(pid)) return res.status(429).json({ error: 'You have sent a lot of messages. Please wait a few minutes.' });

  const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];
  const out = await answer(pid, text, history);

  // emergencies are passed to staff straight away
  let escalation_id = null;
  if (out.auto_escalate) escalation_id = await createEscalation(pid, out.intent, out.auto_escalate, text);

  logChat({ patient_id: pid, message: text, reply: out.reply, intent: out.intent, confidence: out.confidence, source: out.source, escalation_id });
  res.json({ reply: out.reply, intent: out.intent, confidence: out.confidence, actions: out.actions, source: out.source, escalation_id });
}));

// Patient presses "Ask a nurse to contact me"
r.post('/patient/chat/escalate', requireRole('patient'), wrap(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message) return res.status(400).json({ error: 'Tell us briefly what you need help with' });
  const id = await createEscalation(req.session.user.patient_id, req.body.category, req.body.urgency, message);
  res.status(201).json({ escalation_id: id, message: 'A member of staff will contact you. For emergencies call 10177 or 112.' });
}));

r.get('/patient/chat/escalations', requireRole('patient'), wrap(async (req, res) => {
  const q = await db.query(`
    SELECT escalation_id, category, urgency, patient_message, status, staff_notes, created_at, resolved_at
      FROM chat_escalations WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.patient_id]);
  res.json(q.rows);
}));

// ---------- staff side ----------

r.get('/escalations', requireRole('admin', 'doctor', 'nurse'), wrap(async (req, res) => {
  const q = await db.query(`
    SELECT e.*, p.first_name || ' ' || p.last_name AS patient_name, p.phone, p.date_of_birth,
           s.first_name || ' ' || s.last_name AS handled_by_name
      FROM chat_escalations e JOIN patients p ON p.patient_id = e.patient_id
      LEFT JOIN staff s ON s.staff_id = e.handled_by
     WHERE ($1::text IS NULL OR e.status = $1 OR ($1 = 'open_all' AND e.status <> 'resolved'))
     ORDER BY (e.urgency = 'emergency') DESC, (e.urgency = 'urgent') DESC, e.created_at DESC
     LIMIT 200`, [req.query.status || null]);
  res.json(q.rows);
}));

r.patch('/escalations/:id', requireRole('admin', 'doctor', 'nurse'), wrap(async (req, res) => {
  const { status, staff_notes } = req.body;
  if (status && !['open', 'in_progress', 'resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const q = await db.query(`
    UPDATE chat_escalations SET status = COALESCE($2, status), staff_notes = COALESCE($3, staff_notes),
           handled_by = $4, resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
     WHERE escalation_id = $1 RETURNING escalation_id`,
    [req.params.id, status || null, staff_notes ?? null, req.session.user.staff_id]);
  if (!q.rowCount) return res.status(404).json({ error: 'Not found' });
  await audit(req.session.user.staff_id, 'ESCALATION_UPDATED', 'chat_escalation', req.params.id, { status });
  res.json({ message: 'Saved' });
}));

module.exports = r;

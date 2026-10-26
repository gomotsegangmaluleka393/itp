// Shared delivery helpers
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db } = require('./db');

// Signatures (proof of delivery) are stored outside the public folder
const PROOF_DIR = path.join(__dirname, '..', 'storage', 'proof');

const OPEN = ['pending', 'assigned', 'out_for_delivery'];

// 4-digit code the patient gives the driver at the door
const newCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0');

async function addHistory(client, deliveryId, status, by = {}, notes = null) {
  await (client || db).query(
    `INSERT INTO delivery_status_history (delivery_id, status, changed_by_driver, changed_by_staff, notes)
     VALUES ($1, $2, $3, $4, $5)`, [deliveryId, status, by.driver_id || null, by.staff_id || null, notes]);
}

// Save a base64 PNG signature and return its file name
function saveSignature(deliveryId, base64) {
  const data = String(base64 || '').replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(data, 'base64');
  // must be a real PNG and not too big
  if (buf.length < 100 || buf.length > 500 * 1024 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  fs.mkdirSync(PROOF_DIR, { recursive: true });
  const file = `${deliveryId}.png`;
  fs.writeFileSync(path.join(PROOF_DIR, file), buf);
  return file;
}

// Send the signature image (caller checks who is allowed to see it)
function sendSignature(res, deliveryId) {
  const file = path.join(PROOF_DIR, `${deliveryId}.png`);
  if (!/^[0-9a-f-]{36}$/i.test(deliveryId) || !fs.existsSync(file)) return res.status(404).json({ error: 'No signature on file' });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(file).pipe(res);
}

module.exports = { OPEN, newCode, addHistory, saveSignature, sendSignature };

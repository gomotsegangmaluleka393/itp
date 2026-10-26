// Database connection and small shared helpers
const { Pool, types } = require('pg');

// Keep DATE columns as 'YYYY-MM-DD' text so they don't shift by time zone
types.setTypeParser(1082, (v) => v);

// Hospital time zone, used for "today" and appointment slots
const TZ = /^[A-Za-z_\/+\-0-9]+$/.test(process.env.HOSPITAL_TZ || '')
  ? process.env.HOSPITAL_TZ
  : 'Africa/Johannesburg';

const db = new Pool({ connectionString: process.env.DATABASE_URL });
db.on('connect', (client) => client.query(`SET TIME ZONE '${TZ}'`));

// Hosted databases (e.g. Neon) close idle connections; log it instead of crashing
db.on('error', (e) => console.error('Database connection dropped:', e.message));

// Write a row to audit_log (never stops the request if it fails)
async function audit(staffId, action, entityType, entityId, details) {
  try {
    await db.query(
      'INSERT INTO audit_log (staff_id, action, entity_type, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [staffId || null, action, entityType, String(entityId), details || null]
    );
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

// Run several queries in one transaction
async function transaction(work) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { db, audit, transaction, TZ };

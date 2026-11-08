// Creates the database tables and the first admin if they are missing
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { db } = require('./db');

// Creates the database itself (e.g. hmf) if it does not exist yet
async function createDatabase() {
  const { Client } = require('pg');
  const url = new URL(process.env.DATABASE_URL);
  const name = decodeURIComponent(url.pathname.slice(1));
  url.pathname = '/postgres'; // connect to the default database to make the new one
  const c = new Client({ connectionString: url.toString() });
  await c.connect();
  try {
    await c.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
    console.log(`Database ${name} created`);
  } finally {
    await c.end();
  }
}

async function setupDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set in .env');

  // Database: make it if it is missing (error 3D000 = database does not exist)
  try {
    await db.query('SELECT 1');
  } catch (e) {
    if (e.code !== '3D000') throw e;
    await createDatabase();
  }

  // Tables: build them from sql/hmf_postgres.sql the first time
  const t = await db.query("SELECT to_regclass('public.user_accounts') AS found");
  if (!t.rows[0].found) {
    console.log('No tables found, creating them...');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'hmf_postgres.sql'), 'utf8');
    await db.query(sql);
    console.log('Tables created');
  }

  // First admin: only made when there is no admin yet
  const a = await db.query("SELECT 1 FROM staff WHERE role = 'admin' LIMIT 1");
  if (!a.rowCount) {
    const email = (process.env.ADMIN_EMAIL || 'admin@hmf.co.za').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || 'Admin1234';
    const hash = await bcrypt.hash(password, 12);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const s = await client.query(
        `INSERT INTO staff (first_name, last_name, role, email, is_active)
         VALUES ('System', 'Admin', 'admin', $1, TRUE) RETURNING staff_id`, [email]);
      await client.query(
        `INSERT INTO user_accounts (account_type, staff_id, email, password_hash, approved_at)
         VALUES ('staff', $1, $2, $3, now())`, [s.rows[0].staff_id, email, hash]);
      await client.query('COMMIT');
      console.log(`First admin created: ${email}`);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

module.exports = { setupDb };

// Can also be run on its own: npm run setup-db
if (require.main === module) {
  setupDb()
    .then(() => { console.log('Database ready'); return db.end(); })
    .catch((e) => { console.error('Database setup failed:', e.message); process.exit(1); });
}

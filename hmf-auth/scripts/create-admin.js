// Creates the first administrator account.
// Usage: node scripts/create-admin.js email password "First" "Last"
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, transaction } = require('../lib/db');

(async () => {
  const [email, password, first = 'System', last = 'Admin'] = process.argv.slice(2);
  if (!email || !password) {
    console.log('Usage: node scripts/create-admin.js email password "First" "Last"');
    process.exit(1);
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    console.log('Password must be 8+ characters with a letter and a number');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  await transaction(async (c) => {
    const s = await c.query(
      `INSERT INTO staff (first_name, last_name, role, email, is_active)
       VALUES ($1,$2,'admin',$3,TRUE) RETURNING staff_id`, [first, last, email.toLowerCase()]);
    await c.query(
      `INSERT INTO user_accounts (account_type, staff_id, email, password_hash, approved_at)
       VALUES ('staff',$1,$2,$3,now())`, [s.rows[0].staff_id, email.toLowerCase(), hash]);
  });
  console.log(`Admin ${email} created. You can now log in.`);
  await db.end();
})().catch(async (e) => {
  console.error('Could not create admin:', e.message);
  await db.end();
  process.exit(1);
});

// Login for the Android apps (patient app and driver app).
// The apps send the token back as:  Authorization: Bearer <token>
const express = require('express');
const { audit } = require('../lib/db');
const { wrap } = require('../lib/auth');
const { verifyLogin, sessionUser, issueToken } = require('../lib/accounts');

const r = express.Router();

r.post('/login', wrap(async (req, res) => {
  const { email, password, app } = req.body;
  if (!['patient', 'driver'].includes(app)) return res.status(400).json({ error: 'Unknown app' });

  const result = await verifyLogin(email, password);
  if (result.error) return res.status(result.status).json({ error: result.error });
  const acc = result.acc;

  // each app only accepts its own type of account
  if (acc.account_type !== app) {
    const msg = app === 'driver' ? 'This app is for delivery drivers. Patients should use the patient app.'
                                 : 'This app is for patients. Drivers should use the driver app.';
    return res.status(403).json({ error: msg });
  }

  const token = await issueToken(acc.account_id, app);
  if (acc.driver_id) await audit(null, 'DRIVER_LOGIN', 'driver', acc.driver_id);
  res.json({ token, user: sessionUser(acc) });
}));

module.exports = r;

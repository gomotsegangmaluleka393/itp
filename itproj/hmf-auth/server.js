// Web server for the portals and the API used by the Android apps
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { userFromToken, revokeToken } = require('./lib/accounts');
const { expirePrescriptions } = require('./lib/rxValidation');

const app = express();

// Render runs the app behind a proxy, so trust it for HTTPS and the visitor's IP
const isLive = process.env.NODE_ENV === 'production';
if (isLive) app.set('trust proxy', 1);

app.use(express.json({ limit: '1mb' })); // signatures from the driver app are sent as images

// Android's HttpURLConnection can't send PATCH, so the apps send POST with this header
app.use((req, res, next) => {
  const m = String(req.headers['x-http-method-override'] || '').toUpperCase();
  if (req.method === 'POST' && ['PATCH', 'PUT', 'DELETE'].includes(m)) req.method = m;
  next();
});

// Website users log in with a session cookie
const webSession = session({
  secret: process.env.SESSION_SECRET || 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isLive, maxAge: 1000 * 60 * 60 * 8 } // 8 hours, HTTPS only when live
});

// The Android apps send "Authorization: Bearer <token>" instead
async function appToken(req, res, next) {
  const token = req.headers.authorization.slice(7).trim();
  try {
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ error: 'Please log in again' });
    // same shape as a web session, so every route works for both
    req.session = { user, regenerate: (cb) => cb(), destroy: (cb) => revokeToken(token).then(() => cb && cb(), () => cb && cb()) };
    next();
  } catch (e) { next(e); }
}

app.use((req, res, next) => (/^Bearer /i.test(req.headers.authorization || '') ? appToken(req, res, next) : webSession(req, res, next)));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/chat'));
app.use('/api/mobile', require('./routes/mobile'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin', require('./routes/adminDelivery'));
app.use('/api/rx', require('./routes/rx'));
app.use('/api/doctor', require('./routes/doctor'));
app.use('/api/patient', require('./routes/patient'));
app.use('/api/driver', require('./routes/driver'));

app.get('/', (req, res) => res.redirect('/login.html'));

// Render checks this to know the server is up
app.get('/healthz', (req, res) => res.send('ok'));

// Unknown API route
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Turn database errors into friendly messages
app.use((err, req, res, next) => {
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Invalid value sent' });
  if (err.code === '23503') return res.status(400).json({ error: 'A linked record does not exist' });
  if (err.code === '23505') {
    const msg = (err.constraint || '').includes('license') ? 'This license number is already registered'
      : (err.constraint || '').includes('email') ? 'An account with this email already exists'
      : (err.constraint || '').includes('plate') ? 'This number plate is already registered'
      : 'This record already exists';
    return res.status(409).json({ error: msg });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

// Prescription expiry check: runs when the server starts, then every hour
// (Render's free plan sleeps when idle, so the check also runs each time it wakes up).
// It turns on the expired flag for prescriptions past their expiry date
async function expiryJob() {
  try {
    const r = await expirePrescriptions();
    if (r.expired) console.log(`Marked ${r.expired} prescription(s) as expired, cancelled ${r.cancelled_deliveries} delivery(ies)`);
  } catch (e) {
    console.error('Prescription expiry check failed:', e.message);
  }
}
expiryJob();
setInterval(expiryJob, 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HMF running on port ${PORT}`));

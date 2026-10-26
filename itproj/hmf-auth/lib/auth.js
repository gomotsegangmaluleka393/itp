// Login checks shared by all routes
const { db } = require('./db');

// Which portal each user lands on after login
function homeFor(user) {
  if (user.type === 'patient') return '/patient/';
  if (user.role === 'admin') return '/admin/';
  if (user.role === 'doctor') return '/doctor/';
  if (user.type === 'driver') return '/login.html'; // drivers use the app
  return '/dashboard.html'; // other staff roles for now
}

// Lets async route handlers pass errors to the error handler
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Only allow logged-in users with one of the given roles.
// Staff are re-checked each time so a deactivated account is logged out straight away.
function requireRole(...roles) {
  return wrap(async (req, res, next) => {
    const user = req.session.user;
    if (!user) return res.status(401).json({ error: 'Please log in' });

    if (user.staff_id) {
      const r = await db.query('SELECT role, is_active FROM staff WHERE staff_id = $1', [user.staff_id]);
      const s = r.rows[0];
      if (!s || !s.is_active) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'Your account is no longer active' });
      }
      user.role = s.role;
    }

    // Drivers are re-checked too (suspended drivers are logged out)
    if (user.driver_id) {
      const r = await db.query('SELECT status FROM drivers WHERE driver_id = $1', [user.driver_id]);
      if (!r.rows[0] || r.rows[0].status !== 'active') {
        return res.status(401).json({ error: 'Your driver account is not active' });
      }
    }

    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ error: 'You do not have access to this page' });
    }
    next();
  });
}

module.exports = { homeFor, wrap, requireRole };

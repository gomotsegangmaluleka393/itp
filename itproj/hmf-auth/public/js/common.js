// Small helpers shared by all pages

// ---------- talking to the server ----------

async function request(method, url, data) {
  const opts = { method, headers: {} };
  if (data !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));

  // Session ended while on a portal page: go back to login
  if (res.status === 401 && document.body.dataset.portal) {
    location.href = '/login.html';
    throw new Error(body.error || 'Please log in');
  }
  if (!res.ok) {
    const err = new Error(body.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    err.data = body; // e.g. validation results
    throw err;
  }
  return body;
}

const api = {
  get: (url) => request('GET', url),
  post: (url, data) => request('POST', url, data || {}),
  put: (url, data) => request('PUT', url, data || {}),
  patch: (url, data) => request('PATCH', url, data || {}),
  del: (url) => request('DELETE', url)
};

// Kept for the login and register pages
const postJSON = api.post;

// ---------- formatting ----------

// Make text safe to put inside HTML
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 'YYYY-MM-DD' is read as a local date so it doesn't shift a day
function toDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(v);
}

const LOCALE = 'en-ZA';
const fmtDate = (v) => (v ? toDate(v).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtDay = (v) => (v ? toDate(v).toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
const fmtTime = (v) => (v ? toDate(v).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const fmtDateTime = (v) => (v ? `${fmtDay(v)}, ${fmtTime(v)}` : '—');
const label = (s) => String(s || '').replace(/_/g, ' ');

// Today as 'YYYY-MM-DD' in the browser's time zone
function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function age(dob) {
  const d = toDate(dob);
  if (!d) return '';
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) a--;
  return a;
}

const initials = (name) => String(name || '?').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// Coloured status label
const BADGE_COLOURS = {
  active: 'green', completed: 'green', delivered: 'green',
  scheduled: 'blue', assigned: 'blue', checked_in: 'teal', in_progress: 'teal', out_for_delivery: 'teal',
  pending: 'amber', expiring: 'amber',
  cancelled: 'red', no_show: 'red', failed: 'red', expired: 'red', returned: 'red', inactive: 'red'
};
function badge(status, text) {
  return `<span class="badge ${BADGE_COLOURS[status] || ''}">${esc(text || label(status))}</span>`;
}

// ---------- tables ----------
// columns: [{ label, render: row => html, primary: true }]
// On phones each row becomes a card; "label" is shown next to each value.
function renderTable(container, columns, rows, opts = {}) {
  if (typeof container === 'string') container = document.getElementById(container);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">${esc(opts.empty || 'Nothing to show yet.')}</div>`;
    return;
  }
  const head = columns.map((c) => `<th>${esc(c.label)}</th>`).join('');
  const body = rows.map((row, i) => {
    const cells = columns.map((c) =>
      `<td class="${c.primary ? 'primary' : ''}" data-label="${esc(c.primary ? '' : c.label)}"><div class="cell">${c.render(row)}</div></td>`
    ).join('');
    return `<tr data-i="${i}" class="${opts.onRowClick ? 'clickable' : ''}">${cells}</tr>`;
  }).join('');
  container.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;

  if (opts.onRowClick) {
    container.querySelectorAll('tbody tr').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button, a, select, input')) return;
        opts.onRowClick(rows[tr.dataset.i]);
      });
    });
  }
}

// ---------- messages ----------

function toast(msg, type = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

// Error or success box at the top of a form (element id="alert" by default)
function showAlert(msg, type = 'error', id = 'alert') {
  const box = document.getElementById(id);
  box.textContent = msg;
  box.className = `alert show ${type}`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function hideAlert(id = 'alert') {
  const box = document.getElementById(id);
  if (box) box.className = 'alert';
}

// ---------- forms and dialogs ----------

// Turn a form into a plain object
function formData(form) {
  const obj = {};
  new FormData(form).forEach((v, k) => { obj[k] = typeof v === 'string' ? v.trim() : v; });
  return obj;
}

// Same password rule as the server
function passwordOk(p) {
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

// Run a button's action and stop double clicks
async function busy(btn, work) {
  btn.disabled = true;
  try { return await work(); } finally { btn.disabled = false; }
}

function openModal(id) { document.getElementById(id).showModal(); }
function closeModal(id) { document.getElementById(id).close(); }

// Any element with data-close shuts the dialog it is in
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-close]');
  if (btn) btn.closest('dialog').close();
});

function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

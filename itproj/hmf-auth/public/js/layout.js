// Builds the sidebar layout for every portal page.
//
// How to use on a new page:
//   <body class="loading" data-portal="doctor" data-page="patients" data-title="My patients">
//     <main class="page"> ...page content... </main>
//     <script src="/js/common.js"></script>
//     <script src="/js/layout.js"></script>
//     <script> App.ready.then(user => { ...load data... }) </script>
//   </body>
// data-portal="auto" makes a page shared: it shows the sidebar of whoever opens it.
// To add a link to the sidebar, add it to PORTALS below.

const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.4 0 4.2 1.8 4.6 4.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-7 8-7s7.2 2.8 8 7"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pill: '<rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M8.5 8.5l7 7"/>',
  truck: '<path d="M2 6h11v10H2z"/><path d="M13 9h4l4 4v3h-8z"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  steering: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M3.5 10h6.5M14 10h6.5M12 14v7"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  logout: '<path d="M15 4h4v16h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  send: '<path d="M4 12l16-8-6 16-2.5-6.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// Sidebar links for each portal. "roles" limits a link to some staff roles.
const PORTALS = {
  admin: {
    name: 'Administrator',
    home: '/admin/',
    links: [
      { page: 'dashboard', text: 'Dashboard', href: '/admin/', icon: 'home' },
      { page: 'staff', text: 'Staff', href: '/admin/staff.html', icon: 'users', countKey: 'staff_pending' },
      { page: 'patients', text: 'Patients', href: '/admin/patients.html', icon: 'user' },
      { page: 'appointments', text: 'Appointments', href: '/admin/appointments.html', icon: 'calendar' },
      { page: 'deliveries', text: 'Deliveries', href: '/admin/deliveries.html', icon: 'truck', countKey: 'deliveries_pending' },
      { page: 'drivers', text: 'Drivers & vehicles', href: '/admin/drivers.html', icon: 'steering' },
      { page: 'rx-checks', text: 'Prescription checks', href: '/admin/prescriptions.html', icon: 'shield' },
      { page: 'enquiries', text: 'Patient enquiries', href: '/shared/enquiries.html', icon: 'chat', countKey: 'enquiries_open' },
      { page: 'departments', text: 'Departments', href: '/admin/departments.html', icon: 'building' },
      { page: 'audit', text: 'Audit log', href: '/admin/audit.html', icon: 'list' }
    ]
  },
  doctor: {
    name: 'Doctor portal',
    home: '/doctor/',
    links: [
      { page: 'dashboard', text: 'Dashboard', href: '/doctor/', icon: 'home' },
      { page: 'appointments', text: 'My schedule', href: '/doctor/appointments.html', icon: 'calendar' },
      { page: 'patients', text: 'My patients', href: '/doctor/patients.html', icon: 'users' },
      { page: 'prescriptions', text: 'Prescriptions', href: '/doctor/prescriptions.html', icon: 'clipboard' },
      { page: 'verify', text: 'Verify prescription', href: '/shared/verify.html', icon: 'shield' },
      { page: 'enquiries', text: 'Patient enquiries', href: '/shared/enquiries.html', icon: 'chat' }
    ]
  },
  patient: {
    name: 'Patient portal',
    home: '/patient/',
    links: [
      { page: 'dashboard', text: 'Home', href: '/patient/', icon: 'home' },
      { page: 'appointments', text: 'Appointments', href: '/patient/appointments.html', icon: 'calendar' },
      { page: 'prescriptions', text: 'Prescriptions', href: '/patient/prescriptions.html', icon: 'pill' },
      { page: 'deliveries', text: 'Deliveries', href: '/patient/deliveries.html', icon: 'truck' },
      { page: 'assistant', text: 'Health assistant', href: '#assistant', icon: 'chat' },
      { page: 'profile', text: 'My profile', href: '/patient/profile.html', icon: 'user' }
    ]
  },
  staff: {
    name: 'Staff',
    home: '/dashboard.html',
    links: [
      { page: 'dashboard', text: 'Home', href: '/dashboard.html', icon: 'home' },
      { page: 'verify', text: 'Verify prescription', href: '/shared/verify.html', icon: 'shield', roles: ['pharmacist'] },
      { page: 'enquiries', text: 'Patient enquiries', href: '/shared/enquiries.html', icon: 'chat', roles: ['nurse'] }
    ]
  }
};

// Which portal a user belongs to
const portalFor = (u) => (u.type === 'patient' ? 'patient' : ['admin', 'doctor'].includes(u.role) ? u.role : 'staff');

const App = (() => {
  const body = document.body;
  const current = body.dataset.page;
  const title = body.dataset.title || document.title.split('|')[0].trim();
  const page = document.querySelector('main.page');
  let portal = null;

  // ---------- build the layout around the page ----------
  function build(user) {
    const nav = portal.links.filter((l) => !l.roles || l.roles.includes(user.role)).map((l) => `
      <a href="${l.href}" class="${l.page === current ? 'active' : ''}" title="${esc(l.text)}" data-page="${l.page}"
         ${l.page === current ? 'aria-current="page"' : ''}>
        ${icon(l.icon)}<span class="label">${esc(l.text)}</span>
        ${l.countKey ? `<span class="count hidden" data-count="${l.countKey}"></span>` : ''}
      </a>`).join('');

    const app = document.createElement('div');
    app.className = 'app';
    app.innerHTML = `
      <aside class="sidebar" id="sidebar" aria-label="Main menu">
        <a class="logo" href="${portal.home}"><span class="text">Hospital Management</span></a>
        <div class="portal-name">${esc(portal.name)}</div>
        <nav class="nav">${nav}</nav>
        <div class="side-foot">
          <div class="side-user">
            <div class="avatar" id="userAvatar"></div>
            <div class="who"><b id="userName"></b><span id="userRole"></span></div>
          </div>
          <button type="button" id="pwBtn" title="Change password">${icon('key')}<span class="label">Change password</span></button>
          <button type="button" id="logoutBtn" title="Log out">${icon('logout')}<span class="label">Log out</span></button>
        </div>
      </aside>
      <div class="backdrop" id="backdrop"></div>
      <div class="main">
        <header class="topbar">
          <button class="menu-btn" id="menuBtn" type="button" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
          <div class="title">${esc(title)}</div>
          <div class="right"><span class="user-name" id="topName"></span><div class="avatar" id="topAvatar"></div></div>
        </header>
      </div>`;
    body.insertBefore(app, body.firstChild);
    app.querySelector('.main').appendChild(page);

    const role = user.type === 'patient' ? 'Patient' : user.role;
    for (const id of ['userAvatar', 'topAvatar']) document.getElementById(id).textContent = initials(user.name);
    document.getElementById('userName').textContent = user.name;
    document.getElementById('userRole').textContent = role;
    document.getElementById('topName').textContent = user.name;

    buildPasswordDialog();
    wireMenu();

    // Patients get the health assistant on every page
    if (user.type === 'patient') {
      const s = document.createElement('script');
      s.src = '/js/chat.js';
      body.appendChild(s);
    }
  }

  // ---------- change password dialog ----------
  function buildPasswordDialog() {
    const pw = document.createElement('dialog');
    pw.className = 'modal';
    pw.id = 'pwModal';
    pw.innerHTML = `
      <form id="pwForm" novalidate>
        <div class="modal-head"><h2>Change password</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body">
          <div id="pwAlert" class="alert" role="alert"></div>
          <label>Current password <input type="password" name="current_password" autocomplete="current-password" required></label>
          <label>New password <input type="password" name="new_password" autocomplete="new-password" required>
            <div class="hint">At least 8 characters, with a letter and a number.</div></label>
          <label>Confirm new password <input type="password" name="confirm" autocomplete="new-password" required></label>
        </div>
        <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save password</button></div>
      </form>`;
    body.appendChild(pw);

    document.getElementById('pwBtn').addEventListener('click', () => {
      pw.querySelector('form').reset();
      hideAlert('pwAlert');
      pw.showModal();
    });
    document.getElementById('pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = formData(e.target);
      if (!passwordOk(d.new_password)) return showAlert('New password must be 8+ characters with a letter and a number.', 'error', 'pwAlert');
      if (d.new_password !== d.confirm) return showAlert('New passwords do not match.', 'error', 'pwAlert');
      try {
        await busy(e.submitter, () => api.post('/api/account/password', d));
        pw.close();
        toast('Password updated');
      } catch (err) { showAlert(err.message, 'error', 'pwAlert'); }
    });
  }

  // ---------- mobile menu and log out ----------
  function wireMenu() {
    const menuBtn = document.getElementById('menuBtn');
    const setMenu = (open) => {
      body.classList.toggle('nav-open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
    };
    menuBtn.addEventListener('click', () => setMenu(!body.classList.contains('nav-open')));
    document.getElementById('backdrop').addEventListener('click', () => setMenu(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', () => { if (innerWidth >= 768) setMenu(false); });
    App.closeMenu = () => setMenu(false);

    document.getElementById('logoutBtn').addEventListener('click', async () => {
      await api.post('/api/logout').catch(() => {});
      location.href = '/login.html';
    });
  }

  // ---------- login check ----------
  // Sends users to their own portal if they open the wrong one
  const ready = api.get('/api/me').then((user) => {
    const fixed = body.dataset.portal;
    const key = fixed && fixed !== 'auto' ? fixed : portalFor(user);
    portal = PORTALS[key] || PORTALS.staff;

    if (fixed && fixed !== 'auto' && user.home !== portal.home) {
      location.replace(user.home);
      return new Promise(() => {}); // stop the page loading
    }
    // shared pages: only open them if the user's sidebar has a link to them
    if (fixed === 'auto' && !portal.links.some((l) => l.page === current && (!l.roles || l.roles.includes(user.role)))) {
      location.replace(user.home);
      return new Promise(() => {});
    }

    build(user);
    body.classList.remove('loading');
    refreshCounts();
    return user;
  }).catch(() => new Promise(() => {}));

  // Little number badges in the admin sidebar
  async function refreshCounts() {
    if (portal !== PORTALS.admin) return;
    try {
      const s = await api.get('/api/admin/stats');
      document.querySelectorAll('[data-count]').forEach((el) => {
        const n = s[el.dataset.count];
        el.textContent = n;
        el.classList.toggle('hidden', !n);
      });
    } catch (e) { /* not important */ }
  }

  return { ready, icon, refreshCounts, closeMenu: () => {} };
})();

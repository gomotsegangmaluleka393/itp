// Health assistant chat for patients.
// layout.js loads this on every patient page. It adds a floating button,
// and the "Health assistant" link in the sidebar opens it too.
(() => {
  const STORE = 'hmf-chat';
  const QUICK = [
    'When is my next appointment?',
    'How do I take my medicine?',
    'Where is my delivery?',
    'What does HbA1c mean?',
    'I want to talk to a nurse'
  ];

  // Conversation is kept for this browser tab only
  let history = [];
  try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch (e) { history = []; }
  const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch (e) { /* ignore */ } };

  // ---------- build the button and panel ----------
  const fab = document.createElement('button');
  fab.className = 'chat-fab';
  fab.type = 'button';
  fab.setAttribute('aria-label', 'Open health assistant');
  fab.innerHTML = `${App.icon('chat')}<span class="label">Health assistant</span>`;

  const panel = document.createElement('section');
  panel.className = 'chat-panel hidden';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Health assistant');
  panel.innerHTML = `
    <div class="chat-head">
      <div class="avatar">AI</div>
      <div><b>Health assistant</b><small>Answers about your care · not a doctor</small></div>
      <button type="button" class="icon-btn" id="chatClose" aria-label="Close">${App.icon('x')}</button>
    </div>
    <div class="chat-warning">Emergency? Call <b>10177</b> or <b>112</b>. Don't wait for a reply here.</div>
    <div class="chat-log" id="chatLog" aria-live="polite"></div>
    <form class="chat-form" id="chatForm">
      <input id="chatInput" maxlength="1000" placeholder="Type your question…" autocomplete="off" aria-label="Message">
      <button class="btn" type="submit" aria-label="Send">${App.icon('send')}</button>
    </form>`;
  document.body.append(fab, panel);
  document.body.classList.add('has-chat');

  const log = panel.querySelector('#chatLog');
  const input = panel.querySelector('#chatInput');

  // ---------- showing messages ----------
  function bubble(role, text) {
    const div = document.createElement('div');
    div.className = `msg ${role === 'user' ? 'me' : 'bot'}`;
    div.textContent = text;
    log.appendChild(div);
    return div;
  }

  // Buttons under a reply: links to pages, or "ask a nurse"
  function actions(list, forMessage) {
    if (!list || !list.length) return;
    const row = document.createElement('div');
    row.className = 'msg-actions';
    list.forEach((a) => {
      if (a.href) {
        const link = document.createElement('a');
        link.className = 'chip';
        link.href = a.href;
        link.textContent = a.label;
        row.appendChild(link);
      } else if (a.action === 'escalate') {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = a.label;
        b.addEventListener('click', () => escalate(a, forMessage, b));
        row.appendChild(b);
      }
    });
    log.appendChild(row);
  }

  function quickReplies() {
    const row = document.createElement('div');
    row.className = 'msg-actions';
    QUICK.forEach((q) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = q;
      b.addEventListener('click', () => { row.remove(); send(q); });
      row.appendChild(b);
    });
    log.appendChild(row);
  }

  function render() {
    log.innerHTML = '';
    bubble('bot', 'Hi! I can help with symptoms, your medicines, test words, appointments, deliveries and prescriptions. I can also pass your question to a nurse.');
    history.forEach((h) => { bubble(h.role, h.text); if (h.actions) actions(h.actions, h.question); });
    if (!history.length) quickReplies();
    log.scrollTop = log.scrollHeight;
  }

  // ---------- sending ----------
  async function send(text) {
    text = text.trim();
    if (!text) return;
    bubble('user', text);
    const typing = bubble('bot', 'Typing…');
    typing.classList.add('typing');
    log.scrollTop = log.scrollHeight;
    try {
      const res = await api.post('/api/patient/chat', { message: text, history: history.map(({ role, text: t }) => ({ role, text: t })) });
      typing.remove();
      history.push({ role: 'user', text });
      history.push({ role: 'bot', text: res.reply, actions: res.actions, question: text });
      save();
      bubble('bot', res.reply);
      actions(res.actions, text);
      if (res.escalation_id) bubble('bot', 'Our staff have been alerted and will contact you.');
    } catch (err) {
      typing.remove();
      bubble('bot', err.message);
    }
    log.scrollTop = log.scrollHeight;
  }

  async function escalate(a, message, btn) {
    try {
      btn.disabled = true;
      const res = await api.post('/api/patient/chat/escalate', { category: a.category, urgency: a.urgency, message: message || 'Patient asked to speak to staff' });
      bubble('bot', res.message);
      btn.textContent = 'Request sent';
    } catch (err) {
      btn.disabled = false;
      bubble('bot', err.message);
    }
    log.scrollTop = log.scrollHeight;
  }

  // ---------- open and close ----------
  function open() {
    panel.classList.remove('hidden');
    fab.classList.add('hidden');
    if (App.closeMenu) App.closeMenu();
    render();
    input.focus();
  }
  function close() {
    panel.classList.add('hidden');
    fab.classList.remove('hidden');
    fab.focus();
  }

  fab.addEventListener('click', open);
  panel.querySelector('#chatClose').addEventListener('click', close);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  panel.querySelector('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = input.value;
    input.value = '';
    send(t);
  });

  // Sidebar link "Health assistant"
  document.querySelectorAll('a[href="#assistant"]').forEach((link) => link.addEventListener('click', (e) => { e.preventDefault(); open(); }));
  if (location.hash === '#assistant') open();

  window.HealthAssistant = { open, ask: (q) => { open(); send(q); } };
})();

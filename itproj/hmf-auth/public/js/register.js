// Registration page logic

const patientForm = document.getElementById('patientForm');
const staffForm = document.getElementById('staffForm');
const tabs = document.querySelectorAll('.tabs button');

// Switch between patient and staff forms
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('active', t === tab));
    patientForm.classList.toggle('hidden', tab.dataset.tab !== 'patient');
    staffForm.classList.toggle('hidden', tab.dataset.tab !== 'staff');
    hideAlert();
  });
});

// Open the staff tab if the link says ?type=staff
if (new URLSearchParams(location.search).get('type') === 'staff') {
  document.querySelector('[data-tab="staff"]').click();
}

// Stop future birth dates
patientForm.date_of_birth.max = new Date().toISOString().split('T')[0];

// Load departments from the database
fetch('/api/departments')
  .then((r) => r.json())
  .then((list) => {
    const select = document.getElementById('deptSelect');
    list.forEach((d) => select.add(new Option(d.name, d.department_id)));
  })
  .catch(() => {});

// License number is required for doctors and pharmacists
const roleSelect = document.getElementById('roleSelect');
roleSelect.addEventListener('change', () => {
  const needed = ['doctor', 'pharmacist'].includes(roleSelect.value);
  document.getElementById('licenseInput').required = needed;
  document.getElementById('licenseOpt').textContent = needed ? '(required)' : '(optional)';
});

// Check required fields and passwords before sending
function validate(form, data) {
  let firstBad = null;
  form.querySelectorAll('[required]').forEach((el) => {
    const bad = !el.value.trim() || (el.type === 'email' && !el.checkValidity());
    el.classList.toggle('invalid', bad);
    if (bad && !firstBad) firstBad = el;
  });
  if (firstBad) { firstBad.focus(); return 'Please fill in the highlighted fields.'; }
  if (!passwordOk(data.password)) return 'Password must be at least 8 characters with a letter and a number.';
  if (data.password !== data.confirm) return 'Passwords do not match.';
  return null;
}

async function submit(form, url, type) {
  const data = formData(form);
  const error = validate(form, data);
  if (error) return showAlert(error);
  delete data.confirm;

  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    await postJSON(url, data);
    location.href = `login.html?registered=${type}`;
  } catch (err) {
    showAlert(err.message);
  } finally {
    btn.disabled = false;
  }
}

patientForm.addEventListener('submit', (e) => { e.preventDefault(); submit(patientForm, '/api/register/patient', 'patient'); });
staffForm.addEventListener('submit', (e) => { e.preventDefault(); submit(staffForm, '/api/register/staff', 'staff'); });

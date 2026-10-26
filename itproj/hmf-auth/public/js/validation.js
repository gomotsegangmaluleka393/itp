// Shows the result of the prescription validation system
// result = { outcome: 'valid' | 'warnings' | 'invalid', errors: [], warnings: [], passed: [], prescription? }
function renderValidation(result) {
  const titles = {
    valid: 'Prescription is valid',
    warnings: 'Valid, but check the warnings',
    invalid: 'Prescription is NOT valid – do not dispense'
  };
  const rx = result.prescription;
  const summary = rx && rx.patient_name ? `
    <dl class="details" style="margin:8px 0 12px">
      <dt>Patient</dt><dd>${esc(rx.patient_name)}</dd>
      <dt>Doctor</dt><dd>Dr ${esc(rx.doctor_name)} <span class="muted small">(${esc(rx.license_number || 'no license')})</span></dd>
      <dt>Issued / expires</dt><dd>${esc(fmtDate(rx.issue_date))} – ${esc(fmtDate(rx.expiry_date))}</dd>
      <dt>Medicines</dt><dd>${rx.items.map((i) => `${esc(i.medication)} ${esc(i.dosage)}, ${esc(i.frequency)}${i.controlled ? ' <span class="badge red">controlled</span>' : ''}`).join('<br>')}</dd>
    </dl>` : '';
  return `
    <div class="vresult ${result.outcome}" role="status">
      <h3>${titles[result.outcome]}</h3>
      ${result.expiry && result.expiry.expiry_date ? `
        <div class="card-head" style="margin:8px 0">
          <span class="small">Expiry date on record: <b>${esc(fmtDate(result.expiry.expiry_date))}</b>
            ${result.expiry.is_expired ? '' : `<span class="muted">(${result.expiry.days_left} day(s) left)</span>`}</span>
          ${result.expiry.is_expired ? badge('expired') : ''}
        </div>` : ''}
      ${result.renewed_by ? `<p class="small">New prescription issued: <a href="?id=${esc(result.renewed_by.prescription_id)}" class="mono">${esc(result.renewed_by.prescription_id)}</a></p>` : ''}
      ${summary}
      <ul>
        ${result.errors.map((e) => `<li class="e">${esc(e.message)}</li>`).join('')}
        ${result.warnings.map((w) => `<li class="w">${esc(w.message)}</li>`).join('')}
        ${(result.passed || []).map((p) => `<li class="p">${esc(p)}</li>`).join('')}
      </ul>
    </div>`;
}

// Wires a verify form: <form> with prescription_id, date_of_birth, last_name and an output element
function wireVerifyForm(form, output) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    if (!d.prescription_id) { output.innerHTML = '<div class="alert error show">Enter a prescription number.</div>'; return; }
    try {
      const btn = e.submitter || form.querySelector('button[type=submit]');
      const res = await busy(btn, () => api.post('/api/rx/verify', d));
      output.innerHTML = renderValidation(res);
    } catch (err) {
      output.innerHTML = `<div class="alert error show">${esc(err.message)}</div>`;
    }
  });
}

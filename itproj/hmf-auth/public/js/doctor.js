// Shared doctor helpers: appointment status buttons

// Next step buttons for each appointment status
const APPT_STEPS = {
  scheduled: [['checked_in', 'Check in', ''], ['no_show', 'No show', 'danger']],
  checked_in: [['in_progress', 'Start', ''], ['no_show', 'No show', 'danger']],
  in_progress: [['completed', 'Complete', '']]
};

function apptActions(a) {
  const steps = APPT_STEPS[a.status] || [];
  if (!steps.length) return '';
  return `<div class="actions">${steps.map(([s, text, cls]) =>
    `<button class="btn sm ${cls}" data-appt="${a.appointment_id}" data-status="${s}">${text}</button>`).join('')}</div>`;
}

// Call once per container; reload runs after a change
function wireApptActions(container, reload) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-appt]');
    if (!btn) return;
    if (btn.dataset.status === 'no_show' && !confirm('Mark this patient as a no show?')) return;
    try {
      await busy(btn, () => api.patch(`/api/doctor/appointments/${btn.dataset.appt}`, { status: btn.dataset.status }));
      toast(`Marked as ${label(btn.dataset.status)}`);
      reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}

// Checks that your Corti API key works.
// Usage: node scripts/test-corti.js
// Reads CORTI_API_KEY, CORTI_BASE_URL and CORTI_MODEL from your .env file.
require('dotenv').config();

const key = process.env.CORTI_API_KEY;
const base = (process.env.CORTI_BASE_URL || 'https://ai.eu.corti.app/v1').replace(/\/$/, '');
const model = process.env.CORTI_MODEL || 'corti-s1-instant';

(async () => {
  if (!key) {
    console.log('CORTI_API_KEY is not set in .env');
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // 1. Which models can this key use?
  const m = await fetch(`${base}/models`, { headers });
  const models = await m.json().catch(() => ({}));
  if (!m.ok) {
    console.log(`Key check failed (${m.status}):`, models.error || models.detail || models);
    console.log(m.status === 401 ? 'The key is wrong or has been revoked.' : 'Check CORTI_BASE_URL (eu or us).');
    process.exit(1);
  }
  const ids = (models.data || []).map((x) => x.id);
  console.log('Key works. Models available:', ids.join(', ') || '(none listed)');
  if (ids.length && !ids.includes(model)) console.log(`Note: CORTI_MODEL "${model}" is not in that list – change it in .env.`);

  // 2. A short test chat
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 120,
      messages: [
        { role: 'system', content: 'You are a hospital patient assistant. Answer in one sentence.' },
        { role: 'user', content: 'What does HbA1c measure?' }
      ]
    })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.log(`Chat failed (${r.status}):`, data.error || data.detail || data);
    process.exit(1);
  }
  console.log(`Test reply from ${model}:`, data.choices?.[0]?.message?.content);
})().catch((e) => {
  console.log('Could not reach Corti:', e.message);
  process.exit(1);
});

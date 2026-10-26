-- Starter data so the portals have something to show (safe to run more than once)

INSERT INTO departments (name, location, phone) VALUES
  ('General Practice', 'Block A, Ground floor', '012 000 1001'),
  ('Cardiology',       'Block B, Level 2',      '012 000 1002'),
  ('Paediatrics',      'Block C, Level 1',      '012 000 1003'),
  ('Pharmacy',         'Block A, Level 1',      '012 000 1004')
ON CONFLICT (name) DO NOTHING;

INSERT INTO medications (name, generic_name, category, manufacturer, controlled_substance) VALUES
  ('Panado 500mg',        'Paracetamol',  'Analgesic',       'Adcock Ingram', FALSE),
  ('Amoxil 500mg',        'Amoxicillin',  'Antibiotic',      'GSK',           FALSE),
  ('Glucophage 850mg',    'Metformin',    'Antidiabetic',    'Merck',         FALSE),
  ('Norvasc 5mg',         'Amlodipine',   'Antihypertensive','Pfizer',        FALSE),
  ('Ventolin Inhaler',    'Salbutamol',   'Bronchodilator',  'GSK',           FALSE),
  ('Lipitor 20mg',        'Atorvastatin', 'Statin',          'Pfizer',        FALSE),
  ('Tramadol 50mg',       'Tramadol',     'Opioid analgesic','Sandoz',        TRUE)
ON CONFLICT (name, manufacturer) DO NOTHING;

-- ---------- validation rules for the starter medicines ----------
-- SAMPLE VALUES FOR TESTING ONLY. Check every limit against the package insert
-- or the SA Medicines Formulary before using this with real patients.
INSERT INTO medication_rules (medication_id, max_single_dose_mg, max_daily_dose_mg, min_age_years, max_duration_days, allergy_keywords)
SELECT m.medication_id, r.single, r.daily, r.min_age, r.max_days, r.words
  FROM medications m
  JOIN (VALUES
    ('Panado 500mg',     1000,  4000,  NULL, NULL, ARRAY['paracetamol','acetaminophen']),
    ('Amoxil 500mg',     1000,  3000,  NULL, NULL, ARRAY['penicillin','amoxicillin','beta-lactam']),
    ('Glucophage 850mg', 1000,  3000,  10,   NULL, ARRAY['metformin']),
    ('Norvasc 5mg',      10,    10,    6,    NULL, ARRAY['amlodipine']),
    ('Ventolin Inhaler', 0.2,   0.8,   NULL, NULL, ARRAY['salbutamol','albuterol']),
    ('Lipitor 20mg',     80,    80,    10,   NULL, ARRAY['atorvastatin','statin']),
    ('Tramadol 50mg',    100,   400,   12,   30,   ARRAY['tramadol','opioid'])
  ) AS r(name, single, daily, min_age, max_days, words) ON r.name = m.name
ON CONFLICT (medication_id) DO NOTHING;

INSERT INTO drug_interactions (medication_a, medication_b, severity, description)
SELECT LEAST(a.medication_id, b.medication_id), GREATEST(a.medication_id, b.medication_id), i.sev, i.descr
  FROM (VALUES
    ('Norvasc 5mg', 'Lipitor 20mg', 'minor',    'Amlodipine can raise atorvastatin levels; watch for muscle pain.'),
    ('Tramadol 50mg', 'Panado 500mg', 'minor',  'Often combined; keep the total paracetamol dose within limits.')
  ) AS i(a_name, b_name, sev, descr)
  JOIN medications a ON a.name = i.a_name
  JOIN medications b ON b.name = i.b_name
ON CONFLICT DO NOTHING;

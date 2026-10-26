// ============================================================================
// HMF HOSPITAL MANAGEMENT SYSTEM – MONGODB DATABASE
// ============================================================================
// Creates the document collections, their validation rules and indexes.
//
// How to run (needs mongosh, the MongoDB Shell):
//     mongosh "mongodb://localhost:27017/hmf" hmf_mongodb.js
//
// Safe to run more than once: existing collections get the latest rules,
// and existing data is not touched.
//
// Collections
//   medical_records  – clinical documents: encounter notes, lab results, imaging, etc.
//                      PostgreSQL rows point here with medical_record_id (this _id as text).
//   patient_history  – one document per patient: allergies, chronic conditions,
//                      operations, family history, immunisations.
//   chat_logs        – health assistant conversations (written by the server).
//
// MongoDB can't check that a patient_id exists in PostgreSQL, so the server
// does that before saving (see "Constraints across the hybrid architecture"
// in the Phase 3 document).
// ============================================================================

const dbName = db.getName() === 'test' ? 'hmf' : db.getName();
const hmf = db.getSiblingDB(dbName);

// UUID text, as used for patient_id, staff_id etc. in PostgreSQL
const UUID = { bsonType: 'string', pattern: '^[0-9a-fA-F-]{36}$' };
const UUID_OR_NULL = { bsonType: ['string', 'null'], pattern: '^[0-9a-fA-F-]{36}$' };

// Create a collection with rules, or update the rules if it already exists
function setup(name, schema) {
  const exists = hmf.getCollectionNames().includes(name);
  const options = { validator: { $jsonSchema: schema }, validationLevel: 'strict', validationAction: 'error' };
  if (exists) hmf.runCommand({ collMod: name, ...options });
  else hmf.createCollection(name, options);
  print(`${exists ? 'Updated' : 'Created'} ${name}`);
}

// ---------------------------------------------------------------------------
// 1. medical_records – one document per clinical record
// ---------------------------------------------------------------------------
setup('medical_records', {
  bsonType: 'object',
  required: ['patient_id', 'record_type', 'author_staff_id', 'title', 'created_at'],
  properties: {
    patient_id: UUID,                                   // patients.patient_id
    record_type: {
      enum: ['encounter_note', 'lab_result', 'imaging_report', 'prescription_note',
             'discharge_summary', 'referral', 'other']
    },
    appointment_id: UUID_OR_NULL,                       // appointments.appointment_id
    prescription_id: UUID_OR_NULL,                      // prescriptions.prescription_id
    author_staff_id: UUID,                              // staff.staff_id of the doctor/nurse who wrote it
    title: { bsonType: 'string', minLength: 1, maxLength: 200 },
    content: { bsonType: 'string' },                    // free-text notes

    // diagnoses with ICD-10 codes, e.g. { code: 'I10', description: 'Hypertension' }
    diagnoses: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['description'],
        properties: { code: { bsonType: 'string' }, description: { bsonType: 'string' } }
      }
    },

    // vital signs taken at the visit
    vitals: {
      bsonType: 'object',
      properties: {
        bp_systolic: { bsonType: 'number' }, bp_diastolic: { bsonType: 'number' },
        pulse: { bsonType: 'number' }, temperature_c: { bsonType: 'number' },
        weight_kg: { bsonType: 'number' }, height_cm: { bsonType: 'number' },
        oxygen_saturation: { bsonType: 'number' }
      }
    },

    // lab_result: one entry per test, e.g. HbA1c 7.2 %
    results: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['test', 'value'],
        properties: {
          test: { bsonType: 'string' },
          value: { bsonType: ['number', 'string'] },
          unit: { bsonType: 'string' },
          reference_range: { bsonType: 'string' },
          flag: { enum: ['normal', 'low', 'high', 'critical', null] }
        }
      }
    },

    // imaging_report
    imaging: {
      bsonType: 'object',
      properties: {
        modality: { enum: ['x-ray', 'ct', 'mri', 'ultrasound', 'ecg', 'echo', 'other'] },
        body_part: { bsonType: 'string' },
        findings: { bsonType: 'string' },
        impression: { bsonType: 'string' }
      }
    },

    // scans or PDFs kept in file storage (only the link is stored here)
    attachments: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['file_name', 'url'],
        properties: { file_name: { bsonType: 'string' }, url: { bsonType: 'string' }, mime_type: { bsonType: 'string' } }
      }
    },

    visible_to_patient: { bsonType: 'bool' },           // false until a doctor releases it to the patient portal
    version: { bsonType: 'number', minimum: 1 },
    amended_from: { bsonType: ['objectId', 'null'] },   // earlier version of this record, if corrected
    created_at: { bsonType: 'date' },
    updated_at: { bsonType: 'date' }
  }
});

hmf.medical_records.createIndex({ patient_id: 1, created_at: -1 }, { name: 'by_patient_newest' });
hmf.medical_records.createIndex({ record_type: 1, created_at: -1 }, { name: 'by_type' });
hmf.medical_records.createIndex({ appointment_id: 1 }, { name: 'by_appointment', sparse: true });
hmf.medical_records.createIndex({ prescription_id: 1 }, { name: 'by_prescription', sparse: true });
hmf.medical_records.createIndex({ title: 'text', content: 'text' }, { name: 'text_search' });

// ---------------------------------------------------------------------------
// 2. patient_history – one document per patient
// ---------------------------------------------------------------------------
setup('patient_history', {
  bsonType: 'object',
  required: ['patient_id', 'updated_at'],
  properties: {
    patient_id: UUID,
    allergies: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['substance'],
        properties: {
          substance: { bsonType: 'string' },            // e.g. Penicillin
          reaction: { bsonType: 'string' },             // e.g. rash, anaphylaxis
          severity: { enum: ['mild', 'moderate', 'severe', null] },
          recorded_at: { bsonType: 'date' },
          recorded_by: UUID_OR_NULL
        }
      }
    },
    chronic_conditions: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['name'],
        properties: {
          name: { bsonType: 'string' },
          icd10: { bsonType: 'string' },
          diagnosed_on: { bsonType: 'date' },
          status: { enum: ['active', 'controlled', 'resolved', null] }
        }
      }
    },
    surgeries: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['procedure'],
        properties: { procedure: { bsonType: 'string' }, date: { bsonType: 'date' }, notes: { bsonType: 'string' } }
      }
    },
    family_history: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['relation', 'condition'],
        properties: { relation: { bsonType: 'string' }, condition: { bsonType: 'string' } }
      }
    },
    immunisations: {
      bsonType: 'array',
      items: {
        bsonType: 'object',
        required: ['vaccine'],
        properties: { vaccine: { bsonType: 'string' }, date: { bsonType: 'date' }, dose: { bsonType: 'string' } }
      }
    },
    social_history: {
      bsonType: 'object',
      properties: {
        smoking: { enum: ['never', 'former', 'current', null] },
        alcohol: { enum: ['none', 'occasional', 'regular', null] },
        notes: { bsonType: 'string' }
      }
    },
    updated_at: { bsonType: 'date' },
    updated_by: UUID_OR_NULL
  }
});

hmf.patient_history.createIndex({ patient_id: 1 }, { name: 'one_per_patient', unique: true });

// ---------------------------------------------------------------------------
// 3. chat_logs – health assistant conversations
// The server (lib/chatLog.js) writes these fields when MONGODB_URI is set.
// ---------------------------------------------------------------------------
setup('chat_logs', {
  bsonType: 'object',
  required: ['patient_id', 'message', 'reply', 'intent', 'created_at'],
  properties: {
    patient_id: UUID,
    message: { bsonType: 'string', maxLength: 2000 },   // what the patient typed
    reply: { bsonType: 'string' },                      // what the assistant answered
    intent: {
      enum: ['symptom_triage', 'medication', 'diagnostic_terms', 'appointments', 'delivery',
             'validation', 'human', 'greeting', 'emergency', 'self_harm', 'unknown']
    },
    confidence: { bsonType: 'number', minimum: 0, maximum: 1 },
    source: { enum: ['rules', 'corti', 'claude'] },     // who wrote the reply
    escalation_id: UUID_OR_NULL,                        // chat_escalations.escalation_id if passed to staff
    created_at: { bsonType: 'date' }
  }
});

hmf.chat_logs.createIndex({ patient_id: 1, created_at: -1 }, { name: 'by_patient_newest' });
hmf.chat_logs.createIndex({ intent: 1, created_at: -1 }, { name: 'by_intent' });
hmf.chat_logs.createIndex({ escalation_id: 1 }, { name: 'by_escalation', sparse: true });

// Optional: delete chat logs automatically after a set time (POPIA: keep data only as long as needed).
// Remove the // below to keep chats for 2 years.
// hmf.chat_logs.createIndex({ created_at: 1 }, { name: 'expire_after_2_years', expireAfterSeconds: 2 * 365 * 24 * 3600 });

print(`\nDone. Database "${dbName}" has: ${hmf.getCollectionNames().sort().join(', ')}`);

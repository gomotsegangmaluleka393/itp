# HMF – database setup

| File | Database | What it creates |
|---|---|---|
| `hmf_postgres.sql` | PostgreSQL 13+ | All 18 tables: patients, staff, departments, appointments, prescriptions, medicines, deliveries, drivers, vehicles, invoices, logins, app tokens, validation rules, chatbot hand-overs, audit log + starter data |
| `hmf_mongodb.js` | MongoDB 5+ | 3 collections with validation rules and indexes: `medical_records`, `patient_history`, `chat_logs` |

## PostgreSQL

```
createdb hmf
psql -d hmf -v ON_ERROR_STOP=1 -f hmf_postgres.sql
```

Run it on an empty database (to start again: `dropdb hmf && createdb hmf`).
Then create the first admin from the `hmf-auth` folder:

```
node scripts/create-admin.js admin@hospital.co.za Admin1234 "First" "Last"
```

pgAdmin: create a database called `hmf`, open the Query Tool, open `hmf_postgres.sql` and run it.

## MongoDB

```
mongosh "mongodb://localhost:27017/hmf" hmf_mongodb.js
```

MongoDB Compass: connect, open the **mongosh** tab at the bottom, run `use hmf`, then `load("C:/path/to/hmf_mongodb.js")`.

Safe to run again; it updates the rules and keeps your data.

## Connect the server

In `hmf-auth/.env`:

```
DATABASE_URL=postgres://postgres:yourpassword@localhost:5432/hmf
MONGODB_URI=mongodb://localhost:27017/hmf
```

## How the two databases link

PostgreSQL holds the structured records. MongoDB holds free-text clinical documents and chat logs.
`appointments.medical_record_id` and `prescriptions.medical_record_id` store the `_id` of a
`medical_records` document as text. MongoDB documents store PostgreSQL ids (`patient_id`,
`appointment_id`, `prescription_id`, `author_staff_id`) as UUID text. MongoDB can't check these
links itself, so the server checks them (Phase 3: "Constraints across the hybrid architecture").

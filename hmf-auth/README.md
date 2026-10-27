# HMF – Web portals and server

Login, registration and portals with a sidebar for **Administrators**, **Doctors**, **Patients**, **Pharmacists** and **Nurses**.
The same server is used by the two Android apps in `hmf-mobile` (patient app and driver app).

## Setup

1. Create the database. Quickest: run the single file `sql/hmf_postgres.sql` (everything below in one go),
   and `mongosh "mongodb://localhost:27017/hmf" sql/hmf_mongodb.js` for MongoDB. Or run the SQL files in this order:
   ```
   psql -d hmf -f postgres_schema.sql
   psql -d hmf -f sql/auth_schema.sql
   psql -d hmf -f sql/v3_delivery_validation.sql
   psql -d hmf -f sql/v4_expired_flag.sql
   psql -d hmf -f sql/seed.sql          # departments, medicines and sample dose rules
   ```
   Upgrading an older copy? Run `sql/upgrade_v2.sql` (if you had the first version), then `v3_…` and `v4_…`.
   All files can be run again safely.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` and `SESSION_SECRET`.
3. Install, create the first admin, and start:
   ```
   npm install
   node scripts/create-admin.js admin@hospital.co.za Admin1234 "First" "Last"
   npm start
   ```
4. Open http://localhost:3000

## Hosting on Render (free)

The live server runs on Render. The databases stay on Neon (PostgreSQL) and MongoDB Atlas.

1. Push the whole `itproj` folder to GitHub (`.env` is ignored, so your keys stay private).
2. On https://render.com sign up with GitHub, then **New > Blueprint** and pick the repo.
   Render reads `render.yaml` and creates the `hmf` web service.
3. Render asks for the values marked `sync: false`. Paste them from your `.env`
   (`DATABASE_URL`, `MONGODB_URI`, `MONGODB_DB`, `CHATBOT_PROVIDER`, `CORTI_API_KEY`, `CORTI_BASE_URL`, `CORTI_MODEL`).
4. Wait for the deploy, then open `https://hmf.onrender.com` (or the address Render shows).
5. In MongoDB Atlas, under **Network Access**, allow `0.0.0.0/0` so Render can connect.

Every push to GitHub deploys again automatically.

Free plan notes:
- The server sleeps after 15 minutes with no visitors. The first visit after that takes about a minute.
  Open the site a minute before a demo.
- The prescription expiry check runs each time the server wakes up, and every hour while it is awake.
- Logins are kept in memory, so everyone has to log in again after the server restarts or sleeps.

## Who goes where after login

| User | Portal |
|---|---|
| Admin | `/admin/` – dashboard, staff approval, patients, appointments, deliveries, drivers & vehicles, prescription checks, patient enquiries, departments, audit log |
| Doctor | `/doctor/` – schedule, my patients, prescriptions (with validation), verify prescription, patient enquiries |
| Patient | `/patient/` – home, appointments, prescriptions (request delivery / reorder), deliveries, health assistant, profile |
| Pharmacist | `/dashboard.html` + **Verify prescription** |
| Nurse | `/dashboard.html` + **Patient enquiries** (questions the health assistant passed to staff) |
| Driver | Driver app only (blocked from the website) |

Opening another role's portal sends you back to your own.

## Rules built in

- New staff can't log in until an admin approves them (Admin → Staff → Approve).
- Doctors and pharmacists need a unique license number.
- Doctors only see patients who have booked with them, and only prescribe for those patients.
- Patients book 30-minute slots, weekdays 08:00–16:30. Taken slots are hidden, and a slot can't be double booked.
- Expired prescriptions are kept but can't be used again; the doctor must issue a new one.
- Deliveries need the patient's 4-digit code and a signature. Drivers share GPS while on the way.
- 5 wrong passwords locks an account for 15 minutes. Any user can change their password from the sidebar.
- Staff logins, record views, prescription and staff changes are written to `audit_log`.

## Prescription validation system (`lib/rxValidation.js`)

Runs when a doctor issues a prescription, when a pharmacist verifies one, when a delivery is requested,
when an admin assigns a driver, and when the driver collects and hands over the medicine.

| Check | Result if it fails |
|---|---|
| Doctor is active, has the doctor role and a license number | Invalid |
| License number looks like an HPCSA number (e.g. MP0012345) | Warning |
| Patient exists; date of birth / surname match (when given) | Invalid |
| Expiry date on record has not passed, and the expired flag is off | Invalid ("the doctor must issue a new prescription") |
| Prescription is active (not cancelled or completed) | Invalid |
| Expiry after issue date, at most 180 days (30 for controlled medicine) | Invalid |
| Dose per time and per day within `medication_rules` limits | Invalid |
| Medicine conflicts with the patient's recorded allergies | Invalid |
| Patient is old enough for the medicine | Invalid |
| Controlled medicine has refills | Invalid |
| Same medicine on another active prescription | Warning |
| Interaction in `drug_interactions` (major = invalid) | Warning / Invalid |
| All refills already dispensed | Invalid |

Doctors must tick through warnings before issuing ("I have checked – issue anyway"); errors block the prescription.

**Expired prescriptions are kept, not deleted.** Each prescription has an `is_expired` flag in the database:

- Every hour (and when the server starts) the server checks the expiry date stored on each prescription.
  Any prescription past that date is flagged and its status set to `expired`.
  Deliveries for it that hadn't happened yet are cancelled. Each change is written to `audit_log` (`PRESCRIPTION_EXPIRED`).
- Validation reads the expiry date from the database, so a prescription past its date is refused straight away,
  even before the hourly check runs.
- Screens show it with the red **Expired** status label. Nobody can un-expire a prescription by hand,
  and the database refuses to clear the flag.
- An expired prescription can't be dispensed, delivered, completed or cancelled. The doctor presses
  **Issue new prescription** on it: the form opens with the same patient and medicines, and the new
  prescription is linked to the old one (`renewed_from`). Checking the old one then shows the new one's number.
- Admins see all expired prescriptions, and whether a new one has been issued, under **Prescription checks**,
  and can run the check by hand.

The dose limits and interactions in `seed.sql` are **sample values for testing**. Replace them with values
from the SA Medicines Formulary or package inserts before using the system with real patients.

## Health assistant (chatbot) (`lib/chatbot.js`)

Patients open it from the round button on every patient page, the sidebar, or the patient app.

- Sorts each message into the proposal's categories: symptom triage, medication, test/report terms,
  appointments, delivery, prescription validation, talk to a person.
- Uses the patient's own appointments, medicines and deliveries in the answers.
- Emergencies (chest pain, breathing problems, stroke signs, heavy bleeding…) and self-harm messages always get
  fixed replies with 10177 / 112 / SADAG numbers and are sent straight to staff.
- "Ask a nurse to contact me" creates an enquiry that nurses, doctors and admins see under **Patient enquiries**.
- Works without any AI service. To let Corti AI word the replies, set `CORTI_API_KEY` in `.env`
  (`CHATBOT_PROVIDER=none` turns it off). The built-in answer is passed to the AI
  so the facts stay the same, emergencies never go to the AI, and if the AI fails the built-in reply is used.
  Patient details are sent to that service, so check your POPIA consent.
- Check a Corti key with `node scripts/test-corti.js` (lists your models and sends one test question).
- Set `MONGODB_URI` to save conversations to the MongoDB `chat_logs` collection.

## API for the Android apps

| Method | Route | Who |
|---|---|---|
| POST | `/api/mobile/login` `{email, password, app: "patient" or "driver"}` → token | both |
| GET | `/api/driver/me`, `/api/driver/deliveries?scope=done`, `/api/driver/deliveries/:id` | driver |
| POST | `/api/driver/deliveries/:id/start`, `/location {lat,lng}`, `/deliver {confirmation_code, recipient_name, signature_png, id_checked}`, `/fail {reason}` | driver |
| GET/POST | `/api/patient/deliveries`, PATCH `/api/patient/deliveries/:id/cancel`, GET `/:id/proof` | patient |
| POST | `/api/patient/chat {message, history}`, `/api/patient/chat/escalate` | patient |

Apps send `Authorization: Bearer <token>`. PATCH can be sent as POST with `X-HTTP-Method-Override: PATCH`.

## Adding a new page (responsive by default)

Every page uses one stylesheet (`public/css/app.css`) and one layout script (`public/js/layout.js`).

```html
<link rel="stylesheet" href="/css/app.css">
<body class="loading" data-portal="doctor" data-page="notes" data-title="Notes">
  <main class="page">
    <div class="page-head"><div><h1>Notes</h1></div></div>
    <section class="card flush"><div id="table"></div></section>
  </main>
  <script src="/js/common.js"></script>
  <script src="/js/layout.js"></script>
  <script>
    App.ready.then(async () => {
      const rows = await api.get('/api/doctor/notes');
      renderTable('table', [
        { label: 'Title', primary: true, render: (r) => esc(r.title) },
        { label: 'Date', render: (r) => fmtDate(r.created_at) }
      ], rows);
    });
  </script>
</body>
```

Then add the link to `PORTALS` in `layout.js`. The sidebar, login check, mobile menu and log out come for free.
Use `data-portal="auto"` for a page several roles share (it shows each user's own sidebar, e.g. `/shared/verify.html`).

Useful classes: `grid-stats` + `stat`, `grid-2`, `grid-3`, `grid-main`, `grid-auto`, `card`, `row`, `row-3`,
`toolbar`, `tabs`, `btn` (`secondary`, `danger`, `sm`), `badge`, `list`, `details`, `dialog.modal`.

Screen sizes:
- Phone (under 768px): sidebar slides in from a menu button, grids and form rows stack, modals go full screen.
- Tablet (768–1023px): sidebar becomes an icon bar.
- Under 1024px: tables made with `renderTable` turn into cards.

## Files

| Path | Purpose |
|---|---|
| `server.js` | Starts the app, error handling, hourly expiry check |
| `lib/` | Database, logins and app tokens, prescription validation, chatbot, delivery helpers |
| `routes/auth.js`, `mobile.js` | Website and app login, logout, change password |
| `routes/admin.js`, `adminDelivery.js`, `doctor.js`, `patient.js`, `driver.js`, `rx.js`, `chat.js` | API (role checked on every request) |
| `storage/proof/` | Delivery signatures (created automatically, not public) |
| `scripts/create-admin.js` | Creates the first admin |
| `sql/` | Login table, v3 (drivers, tokens, rules, enquiries), v4 (expired flag), upgrade script, starter data |
| `public/css/app.css` | The only stylesheet |
| `public/js/common.js` | API calls, formatting, tables, toasts |
| `public/js/layout.js` | Sidebar and top bar for every portal page |
| `public/js/chat.js`, `validation.js` | Health assistant widget, validation result box |
| `public/admin/`, `public/doctor/`, `public/patient/`, `public/shared/` | Portal pages |

Note: sessions are kept in memory, so everyone is logged out when the server restarts.
For production use a session store such as `connect-pg-simple`.

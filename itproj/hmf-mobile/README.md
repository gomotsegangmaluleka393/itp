# HMF Mobile – delivery apps (Android, Java)

One Android Studio project with two apps that share code:

| Module | What it is |
|---|---|
| `core` | Shared code: talking to the server, login screen, formatting, theme |
| `driver` | **HMF Driver** – for delivery drivers |
| `patient` | **HMF Patient** – for patients |

Both apps use the same server as the web portal (`hmf-auth`).

## Open and run

1. Open the `hmf-mobile` folder in Android Studio (Koala or newer) and let Gradle sync.
2. Make sure the server is running on Render (or run `npm start` in `hmf-auth` to test locally).
3. Choose `driver` or `patient` in the run menu and press Run.

The apps connect to the live server on Render, `https://hmf.onrender.com`.
If your Render address is different, change it in `core/src/main/res/values/config.xml`.
The first request after the server has been idle can take about a minute while it wakes up.

To test against your own computer instead, tap **Server settings** on the login screen and enter
`http://10.0.2.2:3000` (Android emulator) or your computer's address, e.g. `http://192.168.1.20:3000`
(real phone on the same Wi-Fi).

Plain `http://` only works in debug builds. Release builds need an `https://` server.

## Accounts

- **Drivers**: an admin creates them on the website under *Drivers & vehicles* (email + password).
- **Patients**: the same account as the patient web portal.

Drivers can't log in to the website or the patient app, and patients can't log in to the driver app.

## Driver app

- List of deliveries to do (assigned to you) and completed ones
- **Open route in Google Maps** with all stops in time-window order
- Delivery screen: navigate, call the patient, instructions, ID-check warning for controlled medicine
- **Start delivery**: the server validates the prescription again, then GPS sharing starts
  (a notification shows while location is shared; it stops automatically when the delivery ends)
- **Complete delivery**: the patient's 4-digit code, the name of the person receiving it,
  and a **signature** drawn on the screen (proof of delivery)
- **Could not deliver** with a reason

Drivers only see the patient's first name and surname initial, the address and the number of medicines,
not the medicine names.

## Patient app

- Deliveries with a progress bar, the 4-digit code for the driver, and **See driver on map**
  (live GPS position while on the way). Screens refresh every 30 seconds while a delivery is active.
- **Notifications** when a driver is assigned, the medicine is on the way, delivered or failed
  (checked in the background about every 15 minutes)
- Prescriptions with **Request delivery**, and **Reorder** for prescriptions with refills
- Expired prescriptions stay in the list with an **Expired** label but can't be delivered; the app tells the patient to ask their doctor for a new one
- Signature shown after delivery
- **Health assistant** chat (same chatbot as the web portal), including "ask a nurse"

## How it talks to the server

`core/.../Api.java` sends JSON to the server with a login token (`Authorization: Bearer …`).
Android's built-in HTTP client can't send PATCH, so PATCH requests are sent as POST with
`X-HTTP-Method-Override: PATCH`, which the server understands.

Only Android's own libraries plus AndroidX/Material are used (no OkHttp, Retrofit or Google Play Services),
so there is nothing extra to set up. Location uses Android's `LocationManager`.

## Not included yet

- **Push notifications through Firebase (FCM)**: the patient app checks for changes in the background instead.
  FCM needs a Firebase project and `google-services.json` from your own Google account.
- **Map inside the app**: "See driver on map" opens Google Maps (or any maps app). An in-app map needs a
  Google Maps API key.
- The token is stored in the app's private storage. For production, consider `EncryptedSharedPreferences`.

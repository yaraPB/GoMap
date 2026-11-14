# GoMap setup guide (external services)

Everything below is what you set up **outside the code**: accounts, keys, databases, builds.
GoMap runs without any of them (local answers, in-memory MongoDB, recorded voice through the
server). Each item unlocks one thing. Keys go in `server/.env` (copy `server/.env.example`)
or `mobile/.env.local`. Never commit them.

| Service | Unlocks | Where the key goes | Cost |
|---|---|---|---|
| Gemini (Google AI Studio) | Open questions, "I lost my card"-style problems the local router misses | `server/.env` `GEMINI_API_KEY` | Free tier |
| Soniox | Live words while you speak (dev build); best Arabic/Darija/French transcription | `server/.env` `SONIOX_API_KEY` | Pay per minute, free credit to start |
| MongoDB Atlas | Map data that survives restarts (places, pins, reports) | `server/.env` `MONGODB_URI` | Free M0 cluster |
| Mapbox | The map itself, admin map, geometry import | `mobile/.env.local`, `admin/.env.local` | Free tier |
| EAS (Expo) | A dev build: on-device speech, Soniox streaming | `eas login` | Free tier |

---

## 1. Gemini: the assistant's model

**Why Gemini, not ChatGPT or Groq.** GoMap needs three things from the model:
1. **Reliable function calling**: every answer must come from our tools (`find_place`,
   `get_person_office`, `get_procedure`, `find_service`, `campus_info`), never invented.
2. **Arabic and French**, including Darija mixed with French.
3. **Low latency at near-zero cost** for a student app.

Gemini Flash-Lite does all three on a free tier, with parallel tool calls. GPT-4.1-mini is
comparable but paid from the first call. Groq is the fastest, but its open models are weaker
at Arabic and at tool choice. Alerts, leaving the chat for directions and procedure steps are
built by **our server** from our records, so the model only has to pick the right tool. That
is also why switching models later is a one-file change (`server/src/assistant/gemini.ts`).

**Steps**
1. Go to <https://aistudio.google.com/apikey> and sign in. Click **Create API key**.
2. In `server/.env`:
   ```
   GEMINI_API_KEY=your-key
   GEMINI_MODEL=gemini-3.5-flash-lite
   ```
3. Check it: `cd server && npm run gemini:check`.

The key stays on the server. The phone never sees it.

## 2. Soniox: voice

There are two modes, both using the same key:
- **Recorded** (works in Expo Go): the phone records, and the server sends the clip to
  Soniox's async API (`SONIOX_MODEL=stt-async-v6`).
- **Live** (dev build): the server mints a **5-minute temporary key**
  (`POST /api/assistant/stt-session`). The phone streams 16 kHz PCM straight to
  `wss://stt-rt.soniox.com/transcribe-websocket` and words appear as you speak. The
  permanent key never leaves the server.

**Steps**
1. Create an account at <https://console.soniox.com>. Under **API keys**, create a key.
2. In `server/.env`:
   ```
   SONIOX_API_KEY=your-key
   SONIOX_MODEL=stt-async-v6
   SONIOX_RT_MODEL=stt-rt-v6
   ```
   If Soniox renames its models, check the models page in their docs and update these two lines.
3. Restart the API. In the app, the voice screen says **"live words by Soniox"** when
   streaming works. Otherwise it falls back on its own: first on-device recognition, then
   record-and-transcribe.

Without Soniox, recorded voice is transcribed by Gemini instead.

## 3. MongoDB Atlas: map data

Without `MONGODB_URI`, the API starts an in-memory MongoDB and re-seeds it on every start.
That's fine for development, but admin edits to places and reports are lost on restart.

1. Create a free **M0** cluster at <https://cloud.mongodb.com>. A region close to Morocco
   (e.g. Paris or Frankfurt) is best.
2. **Database Access** → add a user with a password.
3. **Network Access** → add your IP (or `0.0.0.0/0` while developing only).
4. **Connect → Drivers** → copy the `mongodb+srv://…` string and add the database name:
   ```
   MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/gomap
   ```
5. Run `cd server && npm run seed` once. It fills the empty collections and leaves existing
   data alone.

## 4. SQLite: people, offices, procedures, accounts (nothing to set up)

- File: `server/data/gomap.sqlite`, created automatically. Override with `GOMAP_DB=…`.
- It is filled from `data/aui_departments_faculty.json`:
  - faculty and staff
  - the 26 offices and services
  - the 30 "where to go for…" rows
  - working hours: Mon–Fri 09:00–17:30, closed 13:00–14:00 for lunch
- **Updating the JSON:** replace the file and restart the API. It notices the change and
  re-imports everything **except rows edited in the admin dashboard**.
- An old file from the first prototype is upgraded in place. Its old `services` table is kept
  as `legacy_services`.
- To start fresh, stop the API and delete `server/data/gomap.sqlite*`.
- Postgres for users comes later, with GoCampus sign-in. The schema is already Postgres-safe.

> Hours: TODO.md assumed 9–17 with lunch 12–14, but the updated JSON says 09:00–17:30 with
> lunch 13:00–14:00, so GoMap uses the JSON. Change it in **Admin → Offices & services →
> Campus working hours**.

## 5. Mapbox

1. Go to <https://account.mapbox.com/access-tokens>. Use the default **public** token
   (`pk.…`), or create one with the public scopes only.
2. Add a **URL restriction** for your web domains before going public. Mobile apps can't be
   URL-restricted, so keep usage alerts on.
3. Set the token:
   ```
   # mobile/.env.local
   EXPO_PUBLIC_MAPBOX_TOKEN=pk.…
   # admin/.env.local (optional; falls back to the mobile one)
   VITE_MAPBOX_TOKEN=pk.…
   ```
4. Re-import paths, roads and buildings when the campus changes: `cd server && npm run geo:import`.

## 6. Admin dashboard token

In `server/.env`, set `ADMIN_TOKEN=a-long-random-string` and use it to sign in at the admin
app. The local default is `dev-admin-token`. This gets replaced by GoCampus SSO later.

## 7. Running on your phone

1. Phone and computer on the **same Wi-Fi**.
2. In `mobile/.env.local`, set `EXPO_PUBLIC_API_URL=http://YOUR-PC-LAN-IP:4000`. Find the
   IP with `ipconfig` and look for the "IPv4 Address".
3. Windows: allow Node.js through the firewall on private networks when asked, or open TCP
   port 4000.
4. Check that **only one API** is running on port 4000. An old one left in a terminal answers
   with old data, and new screens then show "Not found".

## 8. Dev build: native voice and live Soniox

Expo Go runs everything, with voice in record-then-send mode. A dev build adds on-device
recognition (`expo-speech-recognition`) and PCM streaming for live Soniox.

```bash
npm i -g eas-cli
eas login
cd mobile
npx expo install expo-dev-client
eas build:configure                    # creates eas.json
eas build --profile development --platform android   # or ios (needs an Apple developer account)
```

Install the build on the phone, then run `npx expo start --dev-client`. To pin one voice
engine, set `EXPO_PUBLIC_SPEECH_ENGINE=soniox` (or `native` / `recorded`) in
`mobile/.env.local`.

## 9. AR and GPS: what to expect on campus

- AR uses the camera, GPS, compass and the gyro-fused motion sensor. No ARCore or Unity is
  needed.
- GPS is filtered: jumps are ignored and the dot is snapped onto walkways. Accuracy is still
  worse next to tall buildings and indoors, and the AR arrows dim when GPS is above ±15 m.
- If the arrows point slightly off, tap **Recalibrate → Align with the path** while pointing
  the phone along the path ahead.
- Android: say yes to **"Improve location accuracy"** when asked. It turns on Wi-Fi-assisted
  GPS.

## 10. Checklist

- [ ] `GEMINI_API_KEY` set, `npm run gemini:check` passes
- [ ] `SONIOX_API_KEY` set (optional), voice screen shows live words in the dev build
- [ ] `MONGODB_URI` set and `npm run seed` run (optional for development)
- [ ] `ADMIN_TOKEN` changed from the default
- [ ] Mapbox token in `mobile/.env.local`
- [ ] `EXPO_PUBLIC_API_URL` points at your PC's LAN IP
- [ ] One walk on campus: GPS dot on the paths, AR arrows on the floor, "where do I pay my fees?" by voice

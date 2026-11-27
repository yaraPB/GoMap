# GoMap setup guide (external services)

Everything below is what you set up **outside the code**: accounts, keys, databases, builds. GoMap runs without any of
them (local answers, in-memory MongoDB, recorded voice through the server). Each item unlocks one thing.

Keys go in `server/.env` (copy `server/.env.example`) or `mobile/.env.local`. **Never commit them, and never paste a
key in a chat or an issue.** When a step says "tell me", send the *result* (e.g. "gemini:check passes"), not the key.

| Service | Unlocks | Where the key goes | Cost |
| --- | --- | --- | --- |
| Gemini (Google AI Studio) — **your current setup** | Open questions the local router can't answer; voice fallback | `server/.env` `GEMINI_API_KEY` | Free tier |
| Claude (Anthropic) — optional | The same, if you ever want a paid model | `server/.env` `ANTHROPIC_API_KEY` | Pay per use |
| Soniox | Live words while you speak; best Arabic/Darija/French transcription | `server/.env` `SONIOX_API_KEY` | Pay per minute, free credit |
| MongoDB Atlas | Map data that survives restarts (places you draw, reports) | `server/.env` `MONGODB_URI` | Free M0 |
| Mapbox | The map, admin map, geometry import | `mobile/.env.local`, `admin/.env.local` | Free tier |
| EAS (Expo) | A dev build: on-device speech, live Soniox | `eas login` | Free tier |

---

## 0. What changed in this round (read first)

**Assistant round (27 Nov 2026)**
- **Two things only you can do:** turn on **billing** for the Google AI Studio project (section 1), and **top up Soniox**
  (section 3: the account says "Organization balance exhausted"). Until then the assistant and voice still work, on
  the fallbacks.
- **The assistant stays on AUI.** Dangerous requests, attempts to change its rules ("ignore your instructions…"),
  off-topic questions and gibberish get a fixed, polite refusal. Someone who mentions self-harm gets Counseling and
  Security's 24/7 number, never a refusal. The obvious cases are caught on the server for free; the model has a
  `decline` tool for the rest and never writes a refusal itself.
- **New things it does:** "from the library to building 11" (the route starts at the library; EN/FR/AR/Darija);
  "where can I eat / sports facilities / the dorms" switches the map's filter chip; "tell me about SSE" (school,
  dean, programs, website); professors' office hours, whether they are in, and their email in one answer; housing
  questions go to the Housing reception in **Building 38** (Building 39 mentioned too); greetings and "thanks".
- **New procedures** (status *review*: confirm them in Admin → Procedures, then set them *live*): declare a
  concentration, pre-registration clearance, and three **online** ones: add/drop, refilling the cash wallet, housing
  reservation. Online answers say "on the student portal": name it and add its link in **Admin → Procedures →
  Student portal**. Every procedure answer ends with who to contact.
- **15 more starter tests** in Admin → Assistant → Tests (33 in all). They are added once to existing databases.
- **Repeated questions are instant:** what the model resolved is reused for 6 hours (cleared on every admin edit),
  except inside a conversation.

**Previous round**

- **New: Claude as the assistant model.** The server picks the model with `ASSISTANT_PROVIDER`:
  `auto` (default: Claude if `ANTHROPIC_API_KEY` is set, otherwise Gemini), `claude`, or `gemini`.
- **New tables** (events, assistant rules, assistant tests, note expiry) are created automatically on the next start.
  Nothing to migrate by hand, in SQLite or in Atlas.
- **Three sample events** are added on the first start so the map has something to show. They are labelled
  "Sample". Delete them in Admin → Events; they never come back.
- **One example rule** (Emergency → Security 24/7) is added once. Edit or delete it in Admin → Assistant → Rules.
- **Restart the API** after pulling (it rebuilds the routing graph; that is what fixes Building 14).
- **Accounts are email + password now** (no Outlook). Try any role with the test accounts: `s.student@aui.ma`,
  `f.faculty@aui.ma`, `st.staff@aui.ma`, `a.admin@aui.ma`, `d.dev@aui.ma`, all with the password `123abc` (section 8).
- **Atlas hiccups no longer crash the API.** A dropped connection (`ECONNRESET`) is logged and the driver reconnects
  by itself (section 4).

## 1. The assistant model: Gemini 3.5 Flash, with flash-lite as the fallback

**Why the model matters less than you'd think.** Most questions never reach it: your rules, places, people, offices,
procedures and events are answered locally, for free, in ~50 ms. The model only resolves what is left, and it can only
*choose* one of our records through tools (`campus_rule`, `find_place`, `route_between`, `browse_category`,
`get_person_office`, `get_procedure`, `find_service`, `find_department`, `whats_on`, `campus_info`, `decline`). The facts
on screen are built by the server from that record.

**What was measured on your key (15 Nov 2026).** `npm run assistant:eval -- --model-only <models>` sends 16 indirect
questions (EN/FR/Darija, plus two off-topic ones) straight to each model and scores where the answer lands:

| Model | Correct | Answered (rest = quota errors) | Avg time |
| --- | --- | --- | --- |
| **gemini-3.5-flash-lite** ✔ keep | 13/16 | 13 — every one right | 2.6 s |
| gemini-3.1-flash-lite (fallback) | 13/16 | 15 — 2 wrong "I don't know" in French | 5.2 s |
| gemini-3-flash-preview | 9/16 | 8 | 3.2 s |
| gemini-3.6-flash | 5/16 | 3 | 36 s |
| gemini-3.5-flash, 3.7/3.8-flash, 3.1-pro | — | no free quota on this key | — |
| gemini-2.5-* | — | retired (404) | — |

Your key is on the **free tier**: the bigger models have no quota, and even the light ones allow only a few requests a
minute. So the model you already had is the right one; what was wrong was handling the limits. The server now:
- waits and retries once when Google says "try again in a few seconds";
- moves to the next model in `GEMINI_FALLBACK_MODELS` when a model has no quota ("limit: 0") or was retired, and keeps
  using the one that works (the configured model is retried every 10 minutes).

**Now (27 Nov): `gemini-3.5-flash` is the configured model**, because it follows the scope rules and picks tools
better than flash-lite. Your `server/.env` already says so (the second line is optional; these are the defaults):
```env
GEMINI_MODEL=gemini-3.5-flash
GEMINI_FALLBACK_MODELS=gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest
```

**It needs billing.** Measured on your key today: `gemini-3.5-flash` never answers (no free quota; Google leaves the
request hanging instead of saying 429), while `gemini-3.5-flash-lite` answers in 0.4–1 s. So the server gives a model
8 seconds; if it hangs, it moves to the next one and skips the hung one for 10 minutes. Until billing is on, the first
model question after a start takes ~9 s and then flash-lite answers in ~1 s. **To fix:** Google AI Studio → your
project → **Set up billing**. The same key then reaches `gemini-3.5-flash` (very cheap at campus volume: most questions
never reach the model). Then run `npm run assistant:eval` and **tell me** the score.

**Faster:** the model uses Gemini's "low" thinking level (choosing a tool is not a reasoning task).

**Claude (optional).** Set `ANTHROPIC_API_KEY` (and `ASSISTANT_PROVIDER=claude` or leave `auto`) to switch; `CLAUDE_MODEL`
defaults to `claude-opus-5-5` (`claude-haiku-5-5` is cheaper). Gemini stays the voice fallback either way.

The keys stay on the server. The phone never sees them.

## 2. Teach the assistant (Admin → Assistant)

This is where "the admin is responsible for the rules" lives.

1. **Try a question** — type what a student would ask (EN/FR/AR). You see the answer and *how it was found* (which
   records competed, their scores, which tools the model called). Nothing here is logged or shown to students.
2. **Rules** — your own answers, word for word. Give it the phrases people say ("print", "printer", "imprimer",
   "طباعة"), the answer (French and Arabic optional), and optionally directions / an office card / procedure steps.
   Rules beat everything else. "Urgent" shows it in red with a Call button.
3. **Tests** — questions that must keep landing right. 18 starter questions are there. Add one from any answer with
   **Keep as a test**. Click **Run all (free)** after every change; the AI-model run costs a fraction of a cent.
4. **What people asked** — unanswered questions first; **Answer it** turns one into a rule in one click.

## 3. Soniox: voice

Two modes, same key:
- **Recorded** (Expo Go): the phone records, the server sends the clip to Soniox's async API (`SONIOX_MODEL=stt-async-v6`).
- **Live** (dev build): the server mints a **5-minute temporary key** (`POST /api/assistant/stt-session`); the phone
  streams 16 kHz PCM to `wss://stt-rt.soniox.com/transcribe-websocket`. The permanent key never leaves the server.

**Steps**
1. <https://console.soniox.com> → **API keys** → create a key.
2. In `server/.env`: `SONIOX_API_KEY=…`, `SONIOX_MODEL=stt-async-v6`, `SONIOX_RT_MODEL=stt-rt-v6`.
   If Soniox renames its models, update these two lines from their models page.
3. Restart the API. The voice screen says **"live words by Soniox"** when streaming works. **Tell me** if it doesn't.

Without Soniox, recorded voice is transcribed by Gemini.

**Your account is out of credit (checked 27 Nov).** The key and the models are fine, but Soniox answers every
transcription with "Organization balance exhausted". Add funds or enable autopay at <https://console.soniox.com> →
Billing. Meanwhile voice keeps working: recorded questions fall back to Gemini on the server, and a dev build that
gets the same refusal on the live stream switches to the phone's own speech recognition for the rest of the session.

## 4. MongoDB Atlas: map data that persists

Without `MONGODB_URI` the API uses an in-memory MongoDB, re-seeded at every start: **buildings you draw or delete in the
admin are lost on restart.** Use Atlas for anything you want to keep.

1. Free **M0** cluster at <https://cloud.mongodb.com>, region Paris or Frankfurt.
2. **Database Access** → add a user. **Network Access** → add your IP (`0.0.0.0/0` only while developing).
3. **Connect → Drivers** → copy the string and add the database name:
   `MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/gomap`
4. `cd server && npm run seed` once (fills empty collections, leaves existing data alone).

Atlas closes idle connections and Wi-Fi drops them. The API keeps going: the log says `MongoDB disconnected:
reconnecting by itself…` then `MongoDB reconnected.`, and requests in between wait or retry. If it never reconnects,
check **Network Access** (your IP changed?) and the password in `MONGODB_URI`.

> **Security note.** A copy of an Atlas username, password and connection string sits in `misc.txt` at the repo root.
> It is git-ignored, but it is a live credential on disk: **rotate that database user's password in Atlas** and keep
> the new one only in `server/.env`.

## 5. SQLite (nothing to set up)

`server/data/gomap.sqlite`, created automatically (override with `GOMAP_DB`). Filled from
`data/aui_departments_faculty.json`; replacing the JSON re-imports everything **except rows edited in the admin**. To
start fresh, stop the API and delete `server/data/gomap.sqlite*`. Postgres-safe schema for the later move.

## 6. Mapbox

1. <https://account.mapbox.com/access-tokens> → default **public** token (`pk.…`).
2. Add a **URL restriction** for your web domains before going public; keep usage alerts on (mobile can't be restricted).
3. `mobile/.env.local`: `EXPO_PUBLIC_MAPBOX_TOKEN=pk.…` · `admin/.env.local` (optional): `VITE_MAPBOX_TOKEN=pk.…`
4. Satellite: the app asks Mapbox first and falls back to Esri World Imagery if your token is refused (HTTP 429/403).
   The admin uses Esri imagery directly. **Tell me** if satellite stays blank.

## 7. Buildings missing from the map (needs someone who knows campus)

The basemap lacked some buildings; they are now traced from satellite imagery and shown in 3D, but have no number
(no open map source labels 12, 13, 16, 20, 28 or 37).
1. Admin → **Places & POIs** → **Outlines**: amber = no name yet, blue = linked to a place.
2. Click an amber outline → give it its number, name, category, height → **Add to the map**. Or **Draw a building**:
   switch the map to **Satellite**, click the corners on the photo, press Enter.
3. It appears as a 3D building in the app with an estimated entrance; drag the green dot to the real door.
4. Use Atlas (section 4) first, or the buildings vanish when the API restarts.

## 8. Accounts (email + password), and the dev dashboard

People create a GoMap account in the app (**Your account → Create account**) with their email and a password. The
password is hashed on the API (scrypt) and never stored or logged in clear. The role comes from the email and from the
**dev dashboard** (`http://localhost:5173/dev.html`), where developers assign student / faculty / staff / admin / dev.

**Which role a new account gets** (first match wins): a role assigned in the dev dashboard → an email in `DEV_EMAILS`
(developer) → the faculty directory knows the email (faculty / staff, linked to their office card) → an allowed domain
(default `aui.ma`) gives the default role (student) → anyone else is refused, with a message saying who to ask. Roles
apply at the person's next tap; nobody has to sign out.

**Test accounts** (all with the password `123abc`), created when the API starts:

| Email | Role |
| --- | --- |
| `s.student@aui.ma` | student |
| `f.faculty@aui.ma` | faculty (Harit Satt's office card) |
| `st.staff@aui.ma` | staff |
| `a.admin@aui.ma` | admin → `http://localhost:5173` |
| `d.dev@aui.ma` | developer → `http://localhost:5173/dev.html` |

The app, the admin and the dev dashboard show them as one-tap buttons on the sign-in screen.

**1. `server/.env`**
```env
SESSION_SECRET=a-long-random-string          # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
DEV_EMAILS=your.name@aui.ma                  # becomes developer when this email creates its account
```
Without `SESSION_SECRET` a random one is made at each start, and everyone has to sign in again after a restart.

**2. Give people their roles**
1. Open `http://localhost:5173/dev.html` → tap **d.dev@aui.ma** (or sign in with your `DEV_EMAILS` account).
2. Type an email: the page says what they would get today (e.g. "faculty, from the faculty directory"). Pick a role →
   **Assign**. **Many at once** takes one email per line (`name@aui.ma, staff`). The role waits until they sign up.
3. Forgotten password: the key button in their row sets a new one (tell them; they can change it in the app).
4. Faculty / staff not in the directory: **Link office card** in their row, so they can post their status.
5. **Before launch:** untick *Test accounts*. From then on the five test accounts can no longer sign in and unsigned
   visitors are just visitors. Give your real developer account the dev role first.

You cannot remove or demote your own account, and the last developer cannot be removed: GoMap always keeps a way in.
`DEV_TOKEN` (optional) opens the dev dashboard without an account; `ADMIN_TOKEN` keeps working for the admin.

## 9. Admin dashboard token

`server/.env`: `ADMIN_TOKEN=a-long-random-string`. It still opens the admin next to admin accounts (setup, scripts).
Local default `dev-admin-token`.

### Installing dependencies (`npm ci`)

Run it in each folder (`server`, `mobile`, `admin`, `e2e`) with **Node 22.13 or newer** (`node -v`; Node 24 is what we test on).
If it fails on Windows with `EPERM`, `EBUSY` or "operation not permitted" / "resource busy":
1. Stop everything that runs from that folder: the API (`npm start`), Expo, the e2e suite, and the admin's Vite server.
   (`npm ci` deletes `node_modules` first, and Windows refuses to delete files a running program holds.)
2. If it still fails, reload the editor window (its TypeScript server keeps files open) and run `npm ci` again.
3. A half-finished `npm ci` can leave `node_modules` broken (for example "tsc is not the command you are looking
   for"): run `npm ci` once more with everything stopped.

The server's in-memory MongoDB binary is **not** downloaded during install (only the first time the API runs without
`MONGODB_URI`), so an install never waits on a several-hundred-MB download.

## 10. Running on your phone

1. Phone and computer on the **same Wi-Fi**; `EXPO_PUBLIC_API_URL=http://YOUR-PC-LAN-IP:4000` (`ipconfig` → IPv4).
2. Windows: allow Node.js on private networks, or open TCP 4000.
3. Only **one** API on port 4000 (`netstat -ano | findstr :4000`): an old one answers with old data.

## 11. Dev build: native voice and live Soniox

```bash
npm i -g eas-cli && eas login
cd mobile && npx expo install expo-dev-client
eas build:configure
eas build --profile development --platform android   # or ios (Apple developer account)
npx expo start --dev-client
```
Pin one voice engine with `EXPO_PUBLIC_SPEECH_ENGINE=soniox` (or `native` / `recorded`) in `mobile/.env.local`.

## 12. AR: what to expect, and the upgrade path

**Now:** camera + GPS + compass + gyro fusion. Works in Expo Go, no ARCore/Unity. The screen tells you how to hold the
phone, says "Turn around" when you face away, and dims the arrows when GPS is worse than ±15 m. If arrows drift, tap the
GPS pill → **Align with the path** while pointing along the path. Android: accept **"Improve location accuracy"**.

**If you want world-locked arrows later** (they stay glued to the paving as you walk), the path is a dev build with
ViroReact (`@reactvision/react-viro`) plus either ARCore Geospatial (Google Cloud key, depends on Street View coverage in
Ifrane) or plane detection + our GPS route. It cannot run in Expo Go and needs on-campus testing; **tell me** when you
have a dev build on a phone and I'll add it behind a switch.

## 13. Checklist — send me the ticks

- [x] `GEMINI_API_KEY` set; log shows `Assistant model: gemini (gemini-3.5-flash-lite)`
- [ ] Admin → Assistant → Tests: **Run with the AI model** score: ___ / 18 (local run: 18/18)
- [ ] Billing on the Google AI Studio project once real students use it (free tier = a few questions a minute)
- [x] `SONIOX_API_KEY` set; voice screen shows live words in the dev build
- [x] `MONGODB_URI` set · [ ] **Atlas password from `misc.txt` rotated**
- [x] `ADMIN_TOKEN` changed from the default
- [x] Mapbox token in `mobile/.env.local`
- [ ] `SESSION_SECRET` and `DEV_EMAILS` set in `server/.env`; log says `Accounts: email + password`
- [ ] Roles assigned in the dev dashboard; **test accounts (password 123abc) turned off** before launch
- [ ] Numbers given to the new outlines in Admin → Places → Outlines (the 13 satellite traces have none yet)
- [ ] One walk on campus with the [README checklist](README.md#6-on-campus-checklist-a-real-phone-outdoors)

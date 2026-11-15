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

- **New: Claude as the assistant model.** The server picks the model with `ASSISTANT_PROVIDER`:
  `auto` (default: Claude if `ANTHROPIC_API_KEY` is set, otherwise Gemini), `claude`, or `gemini`.
- **New tables** (events, assistant rules, assistant tests, note expiry) are created automatically on the next start.
  Nothing to migrate by hand, in SQLite or in Atlas.
- **Three sample events** are added on the first start so the map has something to show. They are labelled
  "Sample". Delete them in Admin → Events; they never come back.
- **One example rule** (Emergency → Security 24/7) is added once. Edit or delete it in Admin → Assistant → Rules.
- **Restart the API** after pulling (it rebuilds the routing graph; that is what fixes Building 14).

## 1. The assistant model: Gemini (what you have), Claude optional

**Why the model matters less than you'd think.** Most questions never reach it: your rules, places, people, offices,
procedures and events are answered locally, for free, in ~50 ms. The model only resolves what is left, and it can only
*choose* one of our records through tools (`campus_rule`, `find_place`, `get_person_office`, `get_procedure`,
`find_service`, `whats_on`, `campus_info`). The facts on screen are built by the server from that record.

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

**Your `server/.env` (nothing to change; the second line is optional, these are the defaults):**
```env
GEMINI_MODEL=gemini-3.5-flash-lite
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest
```

**If students use it a lot,** the free tier will run out (you'd see "the assistant is busy"). Enable billing on the
Google AI Studio project: the same key then gets real quotas, and `gemini-3.5-flash` becomes worth a re-test with the
eval. Re-run `npm run assistant:eval` after any model change and **tell me** the score.

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

## 4. MongoDB Atlas: map data that persists

Without `MONGODB_URI` the API uses an in-memory MongoDB, re-seeded at every start: **buildings you draw or delete in the
admin are lost on restart.** Use Atlas for anything you want to keep.

1. Free **M0** cluster at <https://cloud.mongodb.com>, region Paris or Frankfurt.
2. **Database Access** → add a user. **Network Access** → add your IP (`0.0.0.0/0` only while developing).
3. **Connect → Drivers** → copy the string and add the database name:
   `MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/gomap`
4. `cd server && npm run seed` once (fills empty collections, leaves existing data alone).

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

## 8. Admin dashboard token

`server/.env`: `ADMIN_TOKEN=a-long-random-string`; sign in with it at the admin. Local default `dev-admin-token`.
Replaced by GoCampus SSO later.

## 9. Running on your phone

1. Phone and computer on the **same Wi-Fi**; `EXPO_PUBLIC_API_URL=http://YOUR-PC-LAN-IP:4000` (`ipconfig` → IPv4).
2. Windows: allow Node.js on private networks, or open TCP 4000.
3. Only **one** API on port 4000 (`netstat -ano | findstr :4000`): an old one answers with old data.

## 10. Dev build: native voice and live Soniox

```bash
npm i -g eas-cli && eas login
cd mobile && npx expo install expo-dev-client
eas build:configure
eas build --profile development --platform android   # or ios (Apple developer account)
npx expo start --dev-client
```
Pin one voice engine with `EXPO_PUBLIC_SPEECH_ENGINE=soniox` (or `native` / `recorded`) in `mobile/.env.local`.

## 11. AR: what to expect, and the upgrade path

**Now:** camera + GPS + compass + gyro fusion. Works in Expo Go, no ARCore/Unity. The screen tells you how to hold the
phone, says "Turn around" when you face away, and dims the arrows when GPS is worse than ±15 m. If arrows drift, tap the
GPS pill → **Align with the path** while pointing along the path. Android: accept **"Improve location accuracy"**.

**If you want world-locked arrows later** (they stay glued to the paving as you walk), the path is a dev build with
ViroReact (`@reactvision/react-viro`) plus either ARCore Geospatial (Google Cloud key, depends on Street View coverage in
Ifrane) or plane detection + our GPS route. It cannot run in Expo Go and needs on-campus testing; **tell me** when you
have a dev build on a phone and I'll add it behind a switch.

## 12. Checklist — send me the ticks

- [x] `GEMINI_API_KEY` set; log shows `Assistant model: gemini (gemini-3.5-flash-lite)`
- [ ] Admin → Assistant → Tests: **Run with the AI model** score: ___ / 18 (local run: 18/18)
- [ ] Billing on the Google AI Studio project once real students use it (free tier = a few questions a minute)
- [x] `SONIOX_API_KEY` set; voice screen shows live words in the dev build
- [x] `MONGODB_URI` set · [ ] **Atlas password from `misc.txt` rotated**
- [x] `ADMIN_TOKEN` changed from the default
- [x] Mapbox token in `mobile/.env.local`
- [ ] Numbers given to the new outlines in Admin → Places → Outlines (the 13 satellite traces have none yet)
- [ ] One walk on campus with the [README checklist](README.md#6-on-campus-checklist-a-real-phone-outdoors)

# GoMap

The campus map feature for **GoCampus**, Al Akhawayn University. It answers three questions: *where is this place*, *is this person in their office*, and *where do I go to get this done*.

Design: [design/README.md](design/README.md) (31 screens in `design/*.html`). Build plan: [design/IMPLEMENTATION.md](design/IMPLEMENTATION.md).

**Status:** working prototype on branch `yara-redesign`. Building numbers, positions, footpaths and roads come from the real map data. Categories, entrances, opening hours and procedures are **unverified** until the campus office confirms them, and the app says so on every screen.

## What's in the repo

```text
server/   Express API · MongoDB (map data) · SQLite (everything else) · routing · assistant
mobile/   Expo app (runs in Expo Go) · one persistent Mapbox map · assistant + voice · AR guidance
admin/    Vite + React dashboard for the one person who keeps the data true
data/     faculty directory, imported campus geometry, hand-drawn mock paths
```

| Store | Holds | Why |
|---|---|---|
| **MongoDB** | places, entrances, walkways, report pins | GeoJSON with `2dsphere` indexes: "nearest place to this pin" and "reports within 20 m" are one query each |
| **SQLite** | people, today's presence, procedures, crowding, assistant cache and log | built into Node, Postgres-safe types for a later move |
| Postgres | users, later | not ours until GoCampus SSO |

## Run it

Requirements: Node 22.13+ (24 recommended), a [Mapbox public token](https://account.mapbox.com/access-tokens/) (`pk.…`), and optionally a [Gemini key](https://aistudio.google.com/app/apikey).

### 1. API

```bash
cd server
npm ci
cp .env.example .env      # add GEMINI_API_KEY; leave MONGODB_URI empty for an in-memory database
npm start                 # http://localhost:4000/api/health → {"ok":true}
```

With no `MONGODB_URI`, the server starts an in-memory MongoDB and seeds it on every start. The first run downloads a MongoDB binary, which takes a minute. To keep data between restarts, point `MONGODB_URI` at Atlas (free tier) or a local `mongod`.

Without a Gemini key, the assistant still answers places, people and procedures, because those are handled locally. Open questions, and voice in Expo Go, need the key.

### 2. Mobile

```bash
cd mobile
npm ci
cp .env.example .env.local   # EXPO_PUBLIC_API_URL=http://YOUR_WIFI_IP:4000 and EXPO_PUBLIC_MAPBOX_TOKEN=pk.…
npx expo start --clear --lan # scan with Expo Go (SDK 58)
```

Use your computer's Wi-Fi IPv4 address (`ipconfig`), not `localhost`, for a physical phone. Android emulator: `http://10.0.2.2:4000`.

**Away from campus?** The blue dot remains at your real location. The graph covers campus only, so a route preview starts from the main plaza and is labeled as a demo. Once started, **Simulate walk** moves a demo position along that route. The camera overlay in demo mode is not aligned to your real surroundings.

**Assistant and voice.** Set `GEMINI_API_KEY` in `server/.env`; the key stays on the server. Known places, people and procedures are resolved locally. Gemini can resolve less direct questions using the campus records; factual answers and actions are built from those records. Run `npm run gemini:check` in `server/` to test the configured key and tool calls with a synthetic question. The assistant uses the device voice for spoken replies. In Expo Go, the app records a question and transcribes it after release using Soniox if `SONIOX_API_KEY` is configured, otherwise Gemini. A dev build can use on-device recognition with live partial words; set `EXPO_PUBLIC_SPEECH_ENGINE=recorded` to use server transcription instead. Restart Expo after changing environment variables.

**AR guidance.** Open a route and tap AR, or ask for directions with “AR”. Allow camera, location and motion access and use precise location outdoors. The camera opens immediately; ground arrows wait for a recent GPS fix (within 15 m), motion data and a usable or manually aligned compass. Tap the warning or calibration button, point along the next path, and choose **Align with the path**. The 2D route is always available. This is a GPS/compass and motion-based overlay, not ARCore/ARKit world tracking: camera field of view, phone height and position are estimates, so arrows can shift or be misplaced. The actual paths and estimated entrances must be checked on campus before relying on them.

### 3. Admin

```bash
cd admin
npm ci
npm run dev                  # http://localhost:5173, token: ADMIN_TOKEN from server/.env (dev default: dev-admin-token)
```

The admin reuses the Mapbox token from `mobile/.env.local`. Set `VITE_MAPBOX_TOKEN` / `VITE_API_URL` in `admin/.env.local` to override.

## Campus geometry

Footpaths, roads, stairs, building labels and footprints are imported from **Mapbox Streets vector tiles**. Mapbox tags footpaths (`class=path`, `type=footway/steps/crossing`) separately from roads (`street`, `service`, `tertiary`…), so nothing needs hand-tracing:

```bash
cd server
npm run geo:import           # Mapbox (uses MAPBOX_TOKEN or the mobile token) → data/campus/*.geojson
npm run geo:import -- --osm  # same output straight from OpenStreetMap (open licence)
npm run graph:check          # nodes, connected pieces, dead ends: run after every import
```

The imported files are committed, so nobody else needs a token to run the server. **Before a public release, switch to `--osm`:** Mapbox's terms limit storing tile data, while OpenStreetMap's licence (ODbL) allows it with attribution. The data is the same underneath. If neither import exists, the server falls back to the hand-drawn `data/walking_paths.geojson` and `data/driving_roads.geojson`. A line drawn in both is treated as a shared road.

Known gaps in the map data: Building 16 (NAB) has no label, so its pin is estimated and flagged; Buildings 12–14, 20 and 28 are missing; two labels both read "29". Entrances are estimated as the point where the path network meets each building, until someone confirms the real doors in the admin.

## Checks

```bash
cd server && npm run check && npm test && npm run graph:check
cd mobile && npx tsc --noEmit && npm test && npx expo export --platform android
cd admin  && npm run build
```

## On-campus test checklist (needs a real phone, outdoors)

1. Reopen the app: see the whole globe, then a smooth trip down to AUI. **Take me to campus** skips the trip; reduced motion opens directly on campus. Check your blue dot outdoors on the plaza.
2. Ask "take me to building 8B" by voice: directions open without a second tap.
3. Start AR facing the route: green arrows lie on the paving, stay put when you tilt the phone, and fade past about 8 m.
4. If arrows point off the path, tap the calibrate button, point along the path and tap **Align with the path**.
5. Walk off-route by about 30 m: it says "Rerouting" and draws a new route.
6. Next to a tall building, GPS worse than ±15 m should bring up the calibration screen with "Use the 2D map instead".
7. As faculty (Layers → Demo account), set "Busy until 15:00": the card, the office list and the assistant all show it.
8. Report a closed path, confirm it in the admin: the next walking route goes around it.

### Try the new map tour

Tap **Show me around** after arriving, or open map settings and choose **Take a quick tour**. Choose Food, Study, or Sports to change the actual map. Tap a colored pin (or the suggested place) to see its name, then open its details or continue to the guide. Try typing, speaking, or the library question. Back and Skip tour are always available. Leaving the tour shows all places again.

The tour keeps the map usable, with a small card that scrolls on shorter screens. Buildings have a slightly deeper warm gray. These changes use [NN/g’s guidance on learning through interaction](https://www.nngroup.com/articles/onboarding-tutorials/) and [Apple’s plain-language guidance](https://developer.apple.com/design/human-interface-guidelines/writing). Check the appearance and touch feel on a phone as well as in the browser.

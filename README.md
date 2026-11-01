# GoMap Revamped

React Native + TypeScript mobile prototype backed by a Node.js + SQLite API. The mobile experience is a single, map-first GoMap screen for exploring AUI, searching campus destinations, and filtering the map. The browser map uses MapTiler satellite hybrid imagery, terrain, and 3D building shapes when a local MapTiler key is configured.

## What was implemented

| Implemented | Current limit |
| --- | --- |
| Single-screen campus map with search, category filters, 3D toggle, and selected-place card | The 14 destinations are sample locations pending AUI verification |
| Browser map with MapTiler satellite hybrid imagery, terrain, and building extrusions | MapTiler key is local development configuration; set a permitted origin for deployment |
| API with SQLite destination search and service suggestions | Entrances and walking routes are not verified; the current sample data has no verified entrances |

> **What needs to be done:** Talk to stakeholders. There are no verified walking directions, AI assistant, AR navigation, or admin publishing flow yet. That matches the priorities in [SPRINT_PLAN.md](SPRINT_PLAN.md).

## Run locally for the first time (Windows)

You do **not** need to install React Native globally. This project already has Expo and React Native in `mobile/node_modules`. You need Node.js 22.13+ and the **Expo Go** app on an Android or iPhone. An Android emulator also works.

Open two PowerShell terminals in the `GoMap` folder. In **each** terminal, run this first so Node is on the path:

```powershell
$env:Path = "C:\Program Files\nodejs;$env:Path"
```

Use `npm.cmd` and `npx.cmd` in PowerShell. On some Windows setups, the plain `npm` or `npx` command resolves to a blocked `.ps1` script.

**Terminal 1 — API and SQLite:**

```powershell
cd server
npm.cmd start
```

Leave it running. It should print `GoMap API on http://localhost:4000`. Open `http://localhost:4000/api/health` in your computer's browser; it should show `{"ok":true}`. The SQLite file is created at `server/data/gomap.sqlite`.

**Before Terminal 2, if using a real phone:** run `ipconfig` and find your computer's Wi-Fi adapter **IPv4 Address** (for example `192.168.1.23`). Create `mobile/.env.local` with one line, replacing the example address with *your* IPv4 address:

```text
EXPO_PUBLIC_API_URL=http://192.168.1.23:4000
```

The line belongs in `.env.local`, not in `api.ts` or `seed.js`. The file is ignored by Git. Your phone and computer must be on the same network, and the firewall must allow port 4000.

**Terminal 2 — mobile app:**

```powershell
cd mobile
npx.cmd expo start
```

Leave this running too. Expo displays a QR code. On Android, scan it from **Expo Go → Scan QR code**; on iPhone, scan it with the Camera app. If the phone cannot load the Expo project, check the network or try `npx.cmd expo start --tunnel`. A tunnel helps Expo reach the phone, but the phone still needs access to the API address in `.env.local`.

An Android emulator uses `http://10.0.2.2:4000` by default and does not need `.env.local`; an iOS simulator uses `http://localhost:4000`. After changing `.env.local`, reload the app in Expo Go. Stop either terminal with **Ctrl+C**. This API is for local development only; it has no authentication and should not be exposed publicly.

### Git Bash commands

If you use Git Bash, open two terminals in the `GoMap` folder. Run the API in the first:

```bash
cd server
"/c/Program Files/nodejs/node.exe" src/server.js
```

Run Expo in the second. Scan its QR code with Expo Go on Android:

```bash
cd mobile
"/c/Program Files/nodejs/node.exe" node_modules/expo/bin/cli start --clear --lan
```

For a real phone, set `mobile/.env.local` to your computer's Wi-Fi IPv4 address as shown above before starting Expo. Restart Expo after changing it.

## Demo journey

1. Open the map and try the **Academic**, **Services**, **Dining**, and **Housing** filters.
2. Search for `library`, `registration`, or `sports` and select a result to focus it on the map.
3. Use the **3D/2D** toggle and center control to inspect the campus view.
4. Select a place and point out the notice that its sample pin needs AUI verification.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/places?q=&category=` | Search or filter seeded destinations |
| `GET /api/places/:id` | Destination details |
| `GET /api/services` | Need-to-service recommendations |
| `POST /api/reports` | Save a correction report |

Destination responses include linked `entrances`. An entrance appears as a separate map marker only after its coordinates are verified. It is eligible as a future route endpoint only after both its survey and access status are approved. The current sample dataset contains no verified entrance records, so its building pins are not route endpoints.

Run the API integration test with `cd server; npm.cmd test`. Type-check the app with `cd mobile; npx.cmd tsc --noEmit`.

See [SPRINT_PLAN.md](SPRINT_PLAN.md) for the two-person plan, story priorities, stakeholder questions, and acceptance criteria.

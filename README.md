# GoMap Revamped

React Native + TypeScript mobile prototype backed by a Node.js + SQLite API. The first increment implements a complete discovery flow: search or select a campus service, open a destination on the map, and submit a correction report stored in SQLite.

## What was implemented

| Implemented | Current limit |
| --- | --- |
| React Native home, search, help, map, destination details, and saved places screens | Saved places last only for the app session |
| Node API with SQLite for destinations, service suggestions, search, and correction reports | The 14 destinations and four service matches are sample data |
| Category pins, map controls, loading errors, and retry | The latest Android map change still needs a phone check |
| Report an issue from a destination | Reports are stored, but there is no reviewer screen yet |

> **What needs to be done:** Talking to stakehodlers. There are no verified walking directions, AI assistant, AR navigation, or admin publishing flow yet. That matches the priorities in [SPRINT_PLAN.md](C:/Users/yarak/Desktop/GoMap/SPRINT_PLAN.md).

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

1. Open **Find Help** and select **Ask about a scholarship**.
2. See the suggested Financial Aid Office on the map, including the note that the match and pin need verification.
3. Open **Search** and try `library` or `registration`; results come from the SQLite API.
4. Open a destination and submit **Report an issue**. The API stores it in the `reports` table for review.
5. Show a nonsense search to demonstrate the empty state; stop the API and tap **Retry** to demonstrate the connection error state.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/places?q=&category=` | Search or filter seeded destinations |
| `GET /api/places/:id` | Destination details |
| `GET /api/services` | Need-to-service recommendations |
| `POST /api/reports` | Save a correction report |

Run the API integration test with `cd server; npm.cmd test`. Type-check the app with `cd mobile; npx.cmd tsc --noEmit`.

See [SPRINT_PLAN.md](SPRINT_PLAN.md) for the two-person plan, story priorities, stakeholder questions, and acceptance criteria.

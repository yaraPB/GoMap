# GoMap

GoMap is a campus discovery prototype for Al Akhawayn University. The mobile app helps someone find a place or the office likely to handle a request, view a sample pin, and report information that needs correction. It also includes an AI assistant and a camera-based direction guide.

**Project status:** local prototype. The seeded destinations, coordinates, service matches, hours, and entrances have not been approved as official campus information. The camera guide is not a verified walking route.#

## Running the application

Server

```bash
cd ~/Desktop/GoMap/server
npm run dev
```

Mobile

```bash
cd ~/Desktop/GoMap/mobile
npm start
```

## Features

| Area | What the app does |
| --- | --- |
| Home | Shows shortcuts to the map, search, service finder, and AI assistant, plus a few example destinations. |
| Campus map | Displays category-colored pins on Mapbox, lets users select a pin, filter by category, recenter the map, and change the map tilt. A public Mapbox token and internet access are required. |
| Search | Searches places by name, description, and service terms through the API; includes an empty state. |
| Find help | Shows sample needs such as scholarship, registration, Wi-Fi, and library help, then opens the suggested destination. |
| Place details | Shows a description, category, and any available hours or entrance information. Missing details are labeled as awaiting verification. |
| Correction reports | Accepts an issue type and details for a place. The API stores the report in SQLite without changing the published place record. |
| AI assistant | Sends a question and recent chat history to the server. The server gives Gemini the sample place and service records, requests a JSON answer, and links only place IDs found in the database. The assistant can still be wrong. |
| Camera guide | Opens the phone camera for a selected place, estimates straight-line distance and turn direction from GPS and compass readings, and captures a photo preview in the app cache. It does not upload photos or provide spatial AR routing. |
| Error handling | Shows loading, connection, map failure, permission, and retry states where applicable. |

## Tech stack

- **Mobile:** React Native, TypeScript, Expo SDK 58, Expo Camera, Expo Location, and a WebView for Mapbox GL JS.
- **API:** Node.js, TypeScript, Express, and Node's built-in SQLite module.
- **AI:** Gemini Generate Content API, called from the server so the Gemini key is not bundled into the mobile app.
- **Data:** seeded sample places and service matches in SQLite; correction reports persist in the local database file.

```text
GoMap/
├── mobile/
│   ├── App.tsx                 screens and navigation
│   ├── src/api.ts              API client and types
│   ├── src/CampusMap.tsx        Mapbox map and pin bridge
│   ├── src/ARPreview.tsx        camera, location, compass, capture
│   └── test/                   map tests
├── server/
│   ├── src/server.ts           Express routes
│   ├── src/db.ts               SQLite schema and seeding
│   ├── src/seed.ts             sample campus records
│   ├── src/assistant.ts        Gemini request and response checks
│   └── test/                   API tests
├── README.md
└── TODO.md                     planned improvements
```

## Run locally on an Android phone

### 1. Requirements

- Node.js 22.13+ and npm. Node 24 is recommended for the built-in SQLite module.
- [Expo Go for Android SDK 58](https://expo.dev/go?device=true&platform=android&sdkVersion=58).
- A [Mapbox public access token](https://account.mapbox.com/access-tokens/) beginning with `pk.`.
- Optional: a [Gemini API key](https://aistudio.google.com/app/apikey) to enable the assistant.
- Phone and computer on the same Wi-Fi network for local API access.

### 2. Install dependencies

From Git Bash:

```bash
cd ~/Desktop/GoMap/server
npm ci
cd ../mobile
npm ci
```

### 3. Configure the API and Mapbox

Find your computer's Wi-Fi **IPv4 address** with `ipconfig`. Do not use `localhost` or the example IP for a physical phone. In `mobile/`:

```bash
cp .env.example .env.local
notepad .env.local
```

Set these values in `mobile/.env.local` (without quotes):

```text
EXPO_PUBLIC_API_URL=http://YOUR_COMPUTER_WIFI_IP:4000
EXPO_PUBLIC_MAPBOX_TOKEN=pk.YOUR_PUBLIC_MAPBOX_TOKEN
```

An Android emulator uses `http://10.0.2.2:4000` for the API URL. The Mapbox token is still required. `EXPO_PUBLIC_` values are bundled into the app, so put only the **public** Mapbox token there.

To enable the AI assistant, create `server/.env` from `server/.env.example` and set your Gemini key:

```bash
cd ~/Desktop/GoMap/server
cp .env.example .env
notepad .env
```

```text
GEMINI_API_KEY=YOUR_GEMINI_KEY
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=4000
```

The Gemini key belongs on the server only. The rest of the app runs without it; the assistant will show a configuration error. Both local environment files are ignored by Git.

### 4. Start both processes

Terminal 1:

```bash
cd ~/Desktop/GoMap/server
npm start
```

Check `http://localhost:4000/api/health` in your computer browser. It should return `{"ok":true}`.

Terminal 2:

```bash
cd ~/Desktop/GoMap/mobile
npx expo start --clear --lan
```

Scan the QR code with Expo Go. Keep both terminals running. Restart Expo after changing `mobile/.env.local`, and restart the server after changing `server/.env`.

If the phone cannot load campus data, open `http://YOUR_COMPUTER_WIFI_IP:4000/api/health` in the **phone's browser**. If that page does not load, check that both devices are on the same Wi-Fi and that Windows Firewall allows Node.js on the private network. `npx expo start --tunnel` can help the phone reach Expo, but it does not tunnel the local API.

## API

The API listens on port 4000 by default.

| Method and path | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/places?q=&category=` | List, search, or filter places |
| `GET /api/places/:id` | Get one place |
| `GET /api/services` | List sample need-to-office suggestions |
| `POST /api/reports` | Store a correction report |
| `POST /api/assistant` | Ask the Gemini assistant about the sample records |

The SQLite file is created at `server/data/gomap.sqlite`. Set `GOMAP_DB` to choose a different file.

## Checks

```bash
cd ~/Desktop/GoMap/server
npm run check
npm test
npm run build

cd ../mobile
npx expo install --check
npx tsc --noEmit
npm test
npx expo export --platform android
```

## Current limits

- Pins and service suggestions are sample data. AUI staff must verify locations, entrances, hours, contacts, and processes before public use.
- The camera arrow uses approximate GPS and compass readings; it does not account for buildings, paths, closures, or accessible entrances.
- The assistant is limited to the seeded records but can still produce an inaccurate answer. It needs evaluation against approved information.
- The API has no authentication or report review interface and is intended for local development. Do not expose it directly to the public internet.
- Mapbox and Gemini require their own accounts and may have usage limits or charges.

See [TODO.md](TODO.md) for the deployment plan and the next improvements.

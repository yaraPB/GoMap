# GoMap

Expo SDK 58 React Native app with a TypeScript/Express/SQLite API. Search sample AUI campus places, view them on Mapbox, ask a Gemini-powered assistant about the records, report corrections, and open a camera guide for a selected destination.

## Requirements

- Node.js 22.13+ (Node 24 is recommended for the built-in SQLite module)
- Android phone with [Expo Go for SDK 58](https://expo.dev/go?device=true&platform=android&sdkVersion=58)
- A [Mapbox public token](https://account.mapbox.com/access-tokens/) beginning with `pk.`
- Optional: a [Gemini API key](https://aistudio.google.com/app/apikey) for the AI assistant. The default model is `gemini-3.5-flash-lite`; check Google's current [free-tier limits](https://ai.google.dev/gemini-api/docs/pricing).

The Mapbox token is public and goes in the Expo environment file. Keep the Gemini key in the server environment file only.

## Run on an Android phone

Use two terminals in this folder. In PowerShell, use `npm.cmd` and `npx.cmd` if script execution blocks `npm` or `npx`.

1. Install dependencies:

   ```powershell
   cd server
   npm.cmd ci
   cd ../mobile
   npm.cmd ci
   ```

2. Find your computer's Wi-Fi IPv4 address with `ipconfig`. The phone and computer must use the same network. Copy `mobile/.env.example` to `mobile/.env.local`, replace the sample IP, and add your Mapbox token:

   ```text
   EXPO_PUBLIC_API_URL=http://192.168.1.23:4000
   EXPO_PUBLIC_MAPBOX_TOKEN=pk.your-public-token
   ```

   For an Android emulator, use `http://10.0.2.2:4000` as the API URL. The Mapbox token is still required.

3. Optional AI setup: copy `server/.env.example` to `server/.env` and set `GEMINI_API_KEY`. If no key is configured, the rest of the app works and the assistant shows a setup message. The server reads `.env` at startup.

4. Start the API in the first terminal:

   ```powershell
   cd server
   npm.cmd start
   ```

   Check `http://localhost:4000/api/health` in a computer browser; it should return `{"ok":true}`.

5. Start Expo in the second terminal:

   ```powershell
   cd mobile
   npx.cmd expo start --clear --lan
   ```

   Scan the QR code from Expo Go. If Expo Go says the project SDK is incompatible, install the **SDK 58 Android build** from the link above, then restart Expo. If the QR code cannot reach Metro, try `npx.cmd expo start --clear --tunnel`. The phone must still reach the API IP and port 4000; allow it through the Windows firewall if needed. Restart Expo after changing `.env.local`.

## Features and limits

| Feature | Current behavior |
| --- | --- |
| Map | Mapbox GL JS in an Expo Go compatible WebView, using a public token. Place pins remain sample coordinates. Requires internet and device WebGL support. |
| AI assistant | Sends the question and short conversation history to the Express API. The server supplies the sample place/service records to Gemini and checks returned place IDs before linking them. It can still make mistakes, so verify details with AUI. |
| Camera guide | Opens the real camera, estimates straight-line distance and turn direction from phone GPS/compass, and captures a temporary photo preview. It is a visual aid, not spatial AR or a verified walking route. No photo is uploaded. |
| Reports | Stores corrections in SQLite for review without changing published place data. |

Mapbox usage can incur charges beyond its account limits. Gemini free-tier availability and limits depend on the Google account and model. API keys and tokens are not included in this repository.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Health check |
| `GET /api/places?q=&category=` | Search/filter places |
| `GET /api/places/:id` | Place details |
| `GET /api/services` | Suggested service matches |
| `POST /api/reports` | Save a correction report |
| `POST /api/assistant` | Gemini answer grounded in sample records |

## Verify

```powershell
cd server
npm.cmd run check
npm.cmd test
npm.cmd run build
cd ../mobile
npx.cmd expo install --check
npx.cmd tsc --noEmit
npm.cmd test
npx.cmd expo export --platform android
```

The SQLite database is created at `server/data/gomap.sqlite`. Set `GOMAP_DB` to use another file. The API is designed for local development and has no authentication; do not expose it on a public network.

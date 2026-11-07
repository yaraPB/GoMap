# GoMap TODO

This is the roadmap for moving the current local prototype toward a dependable campus pilot. Check off an item only after it works on a real device and the relevant campus data has been verified.

## 1. Deployment

- [ ] Choose where the Express API and database will run. Use a persistent database and an HTTPS endpoint; the current phone-to-laptop IP address is only for local development.
- [ ] Create separate development, staging, and production configuration. Set `EXPO_PUBLIC_API_URL` and the public Mapbox token for each mobile build; store `GEMINI_API_KEY` only in the server environment. Never commit real keys.
- [ ] Configure an Android development/preview build and a production build with [Expo EAS Build](https://docs.expo.dev/build/introduction/). Test an installed build without Expo Go or a local Metro server.
- [ ] Add automated checks for TypeScript, tests, and the Android bundle before deployment. Record the commit used for each release.
- [ ] Add health checks, structured logs, error reporting, backups, and a rollback procedure. Verify the API from a phone outside the developer's Wi-Fi network.
- [ ] Decide who owns hosting, account billing, key rotation, incident response, and campus data approvals.

**Done when:** a test user can install the app and use the API over HTTPS without the developer's laptop running.

## 2. More intuitive UI and navigation

- [ ] Run short usability sessions with students and visitors. Watch them search, choose a service, open a pin, return to the previous screen, and report a mistake.
- [ ] Simplify the bottom navigation and map buttons. Give each icon a clear label, make the back action consistent, and keep primary actions visible in the destination sheet.
- [ ] Improve search with useful suggestions, spelling tolerance, clear filters, and a visible loading/error state.
- [ ] Make map pins and category filters easier to understand. Test sheet size, scrolling, and button placement on small Android screens.
- [ ] Check touch target size, contrast, screen reader labels, font scaling, and keyboard behavior.

**Done when:** new users can complete the main discovery flow without explanation.

## 3. Migrate SQLite to PostgreSQL

- [ ] Design PostgreSQL tables and versioned migrations for places, services, reports, verification metadata, and future editor/reviewer accounts.
- [ ] Replace SQLite-specific queries and Node's `DatabaseSync` calls with a PostgreSQL data layer and connection pool. Keep the API response shapes stable for the mobile app.
- [ ] Export and validate the current seed data and any real reports, then import them into PostgreSQL. Keep a backup and a rollback plan.
- [ ] Run the API integration tests against a temporary PostgreSQL database in CI, including search and report creation.
- [ ] Define backup, restore, retention, and access rules before hosting real campus data.

**Done when:** the API runs against PostgreSQL and its existing mobile flows pass unchanged.

## 4. Improve the AI assistant

- [ ] Build a small evaluation set from real campus questions and verified answers. Compare candidate Gemini models for accuracy, latency, and cost before changing `GEMINI_MODEL`.
- [ ] Rewrite the prompt around approved records and explicit uncertainty. Return structured place IDs and source/verification information, and say when the available data cannot answer a question.
- [ ] Retrieve only relevant approved records instead of sending the entire database on every question. Keep unverified sample records clearly marked.
- [ ] Add tests for wrong-office suggestions, invented hours or routes, prompt injection, multilingual questions, malformed model output, and API outages.
- [ ] Add rate limits, usage monitoring, and a feedback path so bad answers can be reviewed.

**Done when:** the assistant consistently answers the evaluation questions from verified sources and handles unknowns safely.

## 5. Build 3D campus models

- [ ] Obtain permission and accurate footprints/heights or 3D assets for a small set of buildings. Record each model's source and verification date.
- [ ] Prototype 3D building extrusions or lightweight models aligned to the map and measure load time, memory use, and frame rate on typical phones.
- [ ] Add clear building labels and accessible entrances. Keep a usable 2D view for devices that struggle with 3D rendering.
- [ ] If the camera guide becomes spatial AR, validate positioning and orientation on campus before showing any route over the camera image.

**Done when:** the 3D view improves building recognition on a real phone without hiding essential map information.

## 6. Other improvements

### Verified campus data and editing

- [ ] Replace sample pins and service matches with approved records. Include source, owner, verification date, and review status for each field.
- [ ] Build an editor and reviewer workflow for correction reports; do not publish a report automatically.
- [ ] Add official hours, contacts, entrances, and accessibility information only after confirmation by the responsible campus team.

### Navigation and camera guide

- [ ] Create a verified walking-path network and route only to approved entrances. Show a clear unavailable state when no safe route is known.
- [ ] Test GPS and compass accuracy around buildings; improve the camera cue or disable it when readings are too uncertain.
- [ ] Decide whether captured photos should be saved, shared, or deleted, then make that choice clear in the UI.

### Reliability, privacy, and quality

- [ ] Persist saved places across app launches; consider accounts and sync only if users need them.
- [ ] Add API authentication and authorization before exposing reports or editing tools publicly. Restrict CORS and protect write endpoints.
- [ ] Add meaningful tests for search, AI validation, camera permission failures, and on-device map behavior. Test on the actual Android phones used by students.
- [ ] Add offline or poor-connection behavior for essential place details, subject to the map provider's caching rules.
- [ ] Document data retention and privacy handling for reports, AI questions, location, and captured photos.

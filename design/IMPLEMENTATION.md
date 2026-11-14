# GoMap — implementation plan

**Stack:** Node + Express + SQLite (→ Postgres), React Native via Expo dev build, Mapbox, Gemini.

## 0. Read this part first

Nine features were designed. Two people cannot build nine features in three weeks and have any of them work. So this plan sorts them into three tiers, and the week-by-week schedule only commits to tier 1 and 2.

**Tier 1 — the spine. Without these there is no demo.**
Map with filters · search · building → offices → professor · routing on your own paths · turn-by-turn.

**Tier 2 — what makes it GoMap rather than a map.**
The assistant (text + voice) · AR guidance · admin dashboard · faculty status · problem reports.

**Tier 3 — cut first, in this order.**
Crowding heatmap → Arabic and French → step-free as a separate route type → real ARCore plane tracking.

Faculty status and problem reports stay in tier 2 despite being late additions, because they are the cheapest things on the list: a column, a toggle, a form and a table. Roughly a day each. AR and routing are where your weeks actually go.

**The honest risk:** the single biggest unplanned cost is not code, it is **tracing the campus**. Everything geographic sits on that file. Budget two half-days and do it in week 1, not week 2.

---

## 1. Architecture

```
┌─────────────────────┐      ┌──────────────────────┐
│  Expo RN app        │      │  Admin (Vite+React)  │
│  @rnmapbox/maps     │      │  plain web app       │
│  expo-camera (AR)   │      └──────────┬───────────┘
│  expo-location      │                 │
│  expo-speech-recog  │                 │
└──────────┬──────────┘                 │
           │  REST/JSON                 │  REST/JSON
           └─────────────┬──────────────┘
                         │
              ┌──────────▼───────────┐
              │  Express API         │
              │  ├ places / offices  │
              │  ├ routing engine    │  ← graph built in memory at boot
              │  ├ assistant         │  ← Gemini, server-side only
              │  └ reports / status  │
              └──────────┬───────────┘
                         │
         ┌───────────────┼────────────────┐
         │               │                │
   ┌─────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐
   │  SQLite   │  │ walkways    │  │ Gemini API  │
   │ (→ Postgres)│ │ .geojson   │  │             │
   └───────────┘  └─────────────┘  └─────────────┘
```

Two rules that save you pain later:

- **The Gemini key lives on the server only.** Never in the app bundle. The app calls `POST /assistant/ask`, never Google.
- **The app holds no cached truth.** Admin edits must appear in the app, so refetch on screen focus with a short stale time. No hand-rolled offline cache in three weeks.

### Repo layout

```
gomap/
  api/        Express, SQLite, routing, Gemini
  app/        Expo React Native
  admin/      Vite + React
  data/       walkways.geojson, places.geojson, seeds
  docs/       README.md (design), IMPLEMENTATION.md (this)
```

Keep it one repo, three folders, no monorepo tooling. Turborepo or pnpm workspaces would cost you half a day and buy nothing at this size.

---

## 2. Database

SQLite now, Postgres later. The migration is painless **if** you decide these four things now:

1. **Use Drizzle ORM.** It has both a SQLite and a Postgres driver with nearly identical schema definitions. Swapping is changing the driver and regenerating migrations, not rewriting queries.
2. **No SQLite-only behaviour.** Don't lean on dynamic typing, don't use `AUTOINCREMENT` quirks, always declare types.
3. **Timestamps are ISO 8601 strings** in a `TEXT` column, UTC, always. Not SQLite's date functions, which don't exist in Postgres the same way.
4. **Geometry is GeoJSON in a `TEXT` column** called `geom`. In Postgres this becomes a PostGIS `geometry` column with a GiST index. Until then do spatial work in Node with Turf, not in SQL.

### Schema

```sql
-- a building, car park, café, sports hall, anything with a pin
CREATE TABLE places (
  id             TEXT PRIMARY KEY,          -- 'building-11'
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,             -- academic | residential | dining | athletics
                                            -- | admin | services | facilities
  school         TEXT,                      -- sba | sse | shss | lc | NULL
  aliases        TEXT,                      -- JSON array, for search
  lat            REAL NOT NULL,
  lng            REAL NOT NULL,
  geom           TEXT,                      -- GeoJSON Polygon footprint, optional
  opening_hours  TEXT,                      -- JSON, see note below
  status         TEXT NOT NULL DEFAULT 'open',   -- open | closed
  closed_reason  TEXT,
  closed_from    TEXT,
  closed_until   TEXT,
  verified_at    TEXT,
  review_months  INTEGER NOT NULL DEFAULT 6,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- a door. routing targets these, not the centroid of the building
CREATE TABLE entrances (
  id         TEXT PRIMARY KEY,
  place_id   TEXT NOT NULL REFERENCES places(id),
  name       TEXT NOT NULL,                 -- 'North entrance'
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  step_free  INTEGER NOT NULL DEFAULT 0,    -- 0/1, typed as boolean in Drizzle
  node_id    TEXT                           -- nearest walkway graph node
);

CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  title         TEXT,
  department    TEXT,
  email         TEXT,
  phone         TEXT,
  profile_url   TEXT,
  role          TEXT NOT NULL DEFAULT 'faculty',  -- faculty | staff
  place_id      TEXT REFERENCES places(id),
  office_number TEXT,
  floor         INTEGER,
  office_hours  TEXT,                       -- JSON, see note
  verified_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- "I'm in / I'm out". today only, cleared nightly
CREATE TABLE presence (
  person_id  TEXT PRIMARY KEY REFERENCES people(id),
  status     TEXT NOT NULL,                 -- in | busy | out
  reason     TEXT,                          -- meeting | teaching | campus | away | none
  until      TEXT,                          -- ISO timestamp, or NULL for rest of day
  set_at     TEXT NOT NULL
);

CREATE TABLE procedures (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,             -- 'Declare a minor'
  owner_office   TEXT NOT NULL,             -- 'Registrar's Office'
  place_id       TEXT REFERENCES places(id),-- THIS is what makes "guide me there" work
  contact_email  TEXT,
  steps          TEXT NOT NULL,             -- JSON array of {title, body}
  match_phrases  TEXT NOT NULL,             -- JSON array, drives matching before Gemini
  status         TEXT NOT NULL DEFAULT 'draft', -- draft | review | live
  verified_at    TEXT,
  updated_at     TEXT NOT NULL
);

CREATE TABLE reports (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,                -- closed | broken | info | hazard | light | access
  lat         REAL NOT NULL,
  lng         REAL NOT NULL,
  place_id    TEXT REFERENCES places(id),   -- nearest place, resolved server-side
  note        TEXT,
  photo_path  TEXT,
  duration    TEXT,                         -- today | days | unknown
  reporter    TEXT,                         -- mock user id for now
  status      TEXT NOT NULL DEFAULT 'new',  -- new | confirmed | dismissed | resolved
  created_at  TEXT NOT NULL
);

-- simulated now, GPS traces later. same shape either way
CREATE TABLE crowding (
  edge_id    TEXT NOT NULL,
  weekday    INTEGER NOT NULL,              -- 0-6
  hour       INTEGER NOT NULL,              -- 8-20
  load       REAL NOT NULL,                 -- 0.0-1.0
  PRIMARY KEY (edge_id, weekday, hour)
);
```

**Hours format.** One shape for both places and people, so one renderer and one "open now" function:

```json
{ "mon": [["09:00","11:00"], ["13:00","14:00"]],
  "tue": [],
  "wed": [["09:00","11:00"], ["13:00","14:00"]] }
```

An empty array means explicitly closed. A **missing key** means not published — and those are different things. The design shows "Hours not published" with an email fallback, and that only works if the data can tell them apart.

### Seeding

Write `api/scripts/seed.ts` that reads the SBA JSON you already have and inserts places, people and office hours. Keep the real gaps: Lakshmi Goel with no office, Jawad Abrache with no email, the Chetioui 108/109 conflict. Those feed the admin conflict screen and they make the demo honest.

---

## 3. The walkway graph

This is the part the whole app rests on. Do it first.

### Tracing

1. Open **geojson.io**, switch the basemap to Mapbox Satellite.
2. Draw the walkways as `LineString` features. You do **not** need the whole campus. Trace the academic core plus the paths to one residence cluster and one car park — enough for every route in the demo. 40 to 60 segments.
3. Draw entrance points as `Point` features.
4. Save to `data/walkways.geojson`.

Feature properties:

```json
{ "type": "Feature",
  "properties": {
    "id": "w-012",
    "kind": "walkway",     // walkway | road | crossing | stairs | ramp
    "step_free": true,
    "covered": false,
    "lit": true
  },
  "geometry": { "type": "LineString", "coordinates": [[-5.1065,33.5389], ...] }
}
```

`kind: "road"` is how the design tells car routes from footpaths, and `kind: "crossing"` is where the crossing markers come from. `kind: "stairs"` with `step_free: false` is what step-free routing excludes.

### The gotcha that will cost you a day if nobody warns you

Hand-drawn lines **do not share exact endpoints**. Two paths that look joined on screen are two unconnected lines 0.4 m apart, and your router will say "no route found" with no clue why.

So the graph builder must **merge nodes within a tolerance**:

```ts
// api/src/routing/graph.ts
import createGraph from 'ngraph.graph';
import * as turf from '@turf/turf';

const TOLERANCE_M = 3;           // merge endpoints closer than this
const keyOf = (c: number[]) => `${c[0].toFixed(5)},${c[1].toFixed(5)}`;

export function buildGraph(features: Feature[]) {
  const graph = createGraph();
  const nodes: { id: string; coord: number[] }[] = [];

  const nodeFor = (coord: number[]) => {
    for (const n of nodes) {
      if (turf.distance(coord, n.coord, { units: 'meters' }) < TOLERANCE_M) return n.id;
    }
    const id = keyOf(coord);
    nodes.push({ id, coord });
    graph.addNode(id, { coord });
    return id;
  };

  for (const f of features) {
    const cs = f.geometry.coordinates;
    for (let i = 0; i < cs.length - 1; i++) {
      const a = nodeFor(cs[i]);
      const b = nodeFor(cs[i + 1]);
      if (a === b) continue;
      const length = turf.distance(cs[i], cs[i + 1], { units: 'meters' });
      const data = { length, ...f.properties, edgeId: `${f.properties.id}:${i}` };
      graph.addLink(a, b, data);
      graph.addLink(b, a, data);      // undirected, both ways
    }
  }
  return graph;
}
```

That nested loop is O(n²). At 60 segments it runs in milliseconds, so leave it. If the network ever grows past a few hundred segments, put the nodes in a grid index.

**Write a validator** (`npm run graph:check`) that reports: node count, edge count, and any node with degree 1 that is not an entrance. Every unexpected dangling node is a gap in your tracing. Run it every time you edit the GeoJSON.

### Routing

```ts
import path from 'ngraph.path';

export function route(graph, fromNode, toNode, opts: { stepFree?: boolean }) {
  const finder = path.aStar(graph, {
    distance: (a, b, link) => link.data.length,
    heuristic: (a, b) =>
      turf.distance(a.data.coord, b.data.coord, { units: 'meters' }),
    // excluded edges are simply unreachable
    blocked: (link) =>
      (opts.stepFree && link.data.step_free === false) ||
      closedEdgeIds.has(link.data.edgeId),
  });
  return finder.find(fromNode, toNode);
}
```

`closedEdgeIds` is a `Set` rebuilt whenever a report is confirmed. That is the whole closure feature on the routing side: a confirmed closure adds edge ids to a set, and routes stop going through them.

**Snapping.** The user is never standing on a node. Snap their GPS to the nearest edge with `@turf/nearest-point-on-line`, then route from the closer of that edge's two nodes.

**Maneuvers.** Derive turn instructions from bearing deltas, don't store them:

```ts
const delta = ((turf.bearing(b, c) - turf.bearing(a, b) + 540) % 360) - 180;
const turn = Math.abs(delta) < 20 ? 'straight'
           : Math.abs(delta) < 60 ? (delta > 0 ? 'slight right' : 'slight left')
           :                        (delta > 0 ? 'right' : 'left');
```

Merge consecutive `straight` segments into one step so you don't produce "continue straight for 4 m" eleven times.

**Response shape:**

```json
{ "distance_m": 390, "duration_s": 300,
  "geometry": { "type": "LineString", "coordinates": [...] },
  "steps": [ { "turn": "right", "distance_m": 60, "text": "Turn right at the roundabout",
               "crossing": true, "at": [-5.1065, 33.5389] } ],
  "destination": { "place_id": "building-11", "entrance": "North entrance", "step_free": true } }
```

The app feeds `geometry` straight into a Mapbox `ShapeSource`, and `steps` drives both the turn-by-turn banner and the AR waypoints.

---

## 4. The assistant

### Don't send everything to Gemini

On the free tier you will hit rate limits, and most questions don't need a model. Route locally first:

```
user text
   ↓
1. place match?      fuzzy match against places.name + aliases
                     → { intent: 'navigate', place_id }     no LLM call
   ↓ no
2. person match?     fuzzy match against people.name
                     → { intent: 'person', person_id }      no LLM call
   ↓ no
3. procedure match?  match against procedures.match_phrases
                     → { intent: 'procedure', procedure_id } no LLM call
   ↓ no
4. Gemini with function calling
```

Steps 1–3 answer most of the demo, instantly and for free. Use `fuse.js` for the fuzzy matching, threshold around 0.3.

### Gemini layer

Declare your database as tools and let the model pick:

```ts
const tools = [{
  functionDeclarations: [
    { name: 'find_place',
      description: 'Find a place on campus by name or description',
      parameters: { type: 'object',
        properties: { query: { type: 'string' } }, required: ['query'] } },
    { name: 'get_person_office',
      description: 'Office, floor and current availability of a professor or staff member',
      parameters: { type: 'object',
        properties: { name: { type: 'string' } }, required: ['name'] } },
    { name: 'get_procedure',
      description: 'How to do a university procedure: where, who, what steps',
      parameters: { type: 'object',
        properties: { query: { type: 'string' } }, required: ['query'] } },
  ],
}];
```

The server executes the call against SQLite and returns a **structured answer**, never raw markdown:

```json
{ "intent": "procedure",
  "text": "You declare a minor through the Registrar's Office, after your advisor signs the form.",
  "steps": [ { "title": "...", "body": "..." } ],
  "place": { "id": "building-2", "name": "Registrar's Office", "hours": "8:30–17:30" },
  "contact": { "email": "registrar@aui.ma" },
  "source": "Academic procedures register",
  "verified_at": "2026-11-02",
  "action": { "type": "route", "place_id": "building-2" } }
```

The app renders cards from those fields. **`action` is what makes directions open by themselves** — the app sees `action.type === 'route'` and pushes the route screen. That behaviour you liked is three lines of client code, as long as the server returns the field.

**System prompt, in short:** answer only from the supplied function results; if nothing matches, say you don't know and offer the contact; never invent a building number or an email. Set `temperature: 0.2`.

**Rate limits.** Cache answers by normalised question text in a `TEXT` column for 24 h. The same twenty questions will be asked all demo day.

### Voice

```
expo-speech-recognition  →  interim results  →  live partial text on screen
                         →  final transcript →  POST /assistant/ask
```

Gemini never touches audio, which keeps your quota for the thinking. Put it behind an interface:

```ts
interface SpeechProvider {
  start(lang: 'en-US' | 'fr-FR' | 'ar-MA'): void;
  stop(): void;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
}
```

If Arabic accuracy disappoints in testing, swap in a Soniox implementation of that interface. Nothing else changes.

---

## 5. AR

**Build the compass overlay, not ARCore.** Reasons: it runs in an Expo dev build with `expo-camera` and `expo-location` and no native module wrangling; it is about two days instead of five; and on an open plaza it looks nearly identical to plane-tracked AR. `@reactvision/react-viro` is a week-3 stretch goal if you are somehow ahead.

How it works:

```ts
// relative bearing: where the next waypoint is, versus where the phone points
const target  = turf.bearing(userPos, nextWaypoint);     // 0-360 true north
const heading = deviceHeading;                           // expo-location watchHeadingAsync
const rel = ((target - heading + 540) % 360) - 180;      // -180..180, 0 = dead ahead

const FOV = 60;                                          // approx camera horizontal FOV
const visible = Math.abs(rel) < FOV / 2;
const x = (rel / (FOV / 2)) * (SCREEN_W / 2);            // horizontal offset in px
```

Then: the chevron ladder is five views at fixed vertical positions with decreasing width (the values are in the design, board 18). Drive their opacity with the `ar-flow` stagger using `react-native-reanimated`. When `visible` is false, show an arrow at the screen edge pointing the way to turn.

**Required for this to not feel broken:**

- Smooth the heading. Raw magnetometer jitters several degrees; a low-pass filter (`smoothed = smoothed * 0.85 + raw * 0.15`) settles it.
- Show the accuracy pill honestly. `expo-location` gives you `accuracy` in metres. Above 15 m, show the calibration screen (board 19) rather than lying with confident arrows.
- Keep the 2D route mounted underneath so switching back is instant.

---

## 6. Admin

Vite + React, plain `fetch`, no framework. Four screens matching boards 24–27 and 30: overview, places, offices and hours, procedures, reports.

**"Changes should be reflected"** — the whole point of the admin. Two things make that true:

1. No aggressive caching in the app. React Query with `staleTime: 30_000` and `refetchOnWindowFocus`. When a screen regains focus, it refetches.
2. When a report is confirmed, the API rebuilds `closedEdgeIds` and the in-memory graph immediately, so the *next* route request already avoids it.

That is good enough. Websockets or SSE for live push is not worth a day of your three weeks.

Auth: a hardcoded token in an env var, checked by middleware. You said no SSO, so don't build one. Write `// TODO: replace with GoCampus SSO` where it goes.

---

## 7. API surface

```
GET    /places?category=&school=&q=
GET    /places/:id                       includes entrances, departments, counts
GET    /places/:id/people                the office list, grouped by floor
GET    /people?q=&department=&open_now=
GET    /people/:id                       includes presence override
PUT    /people/:id/presence              faculty status  { status, reason, until }
POST   /route                            { from:{lat,lng}, to_place_id, step_free }
GET    /procedures?q=
POST   /assistant/ask                    { text, lang } → structured answer
POST   /reports                          multipart, photo optional
GET    /crowding?weekday=&hour=          GeoJSON with a load property per segment
GET    /geo/walkways                     the network, for drawing road vs path

-- admin, token-gated
GET    /admin/reports
POST   /admin/reports/:id/confirm        { from, until, reason } → closes the place
PUT    /admin/places/:id
PUT    /admin/people/:id
PUT    /admin/procedures/:id
```

---

## 8. Three weeks

Person **A** = API, routing, admin. Person **B** = mobile app. Converge in week 3.

### Week 1 — spine

| | A | B |
|---|---|---|
| Mon | Express + Drizzle + schema + seed from the SBA JSON | **Get the Expo dev build running on a real device.** Do not skip to day 2 until it does. |
| Tue | places / people / entrances endpoints | `@rnmapbox/maps` with bounds locked to AUI, markers from the API |
| Wed | **Trace `walkways.geojson`** (both of you, it is faster in pairs) | |
| Thu | graph builder + validator + `/route` | chips filter, search, building sheet |
| Fri | maneuvers, step-free, response shape | office list, professor card, presence badge |

**End of week 1: you can search a building and see a route line drawn on the map.** If you are not here on Friday, cut tier 3 immediately rather than hoping.

### Week 2 — the things that make it GoMap

| | A | B |
|---|---|---|
| Mon | local intent router (places, people, procedures) | route preview + turn-by-turn screens |
| Tue | Gemini function calling, structured answer, cache | assistant sheet, answer cards, `action` → auto-open directions |
| Wed | procedures table + admin scaffold | voice: `expo-speech-recognition`, partials, send final |
| Thu | admin places + offices CRUD | AR: camera, heading, bearing maths, chevrons |
| Fri | presence endpoint, nightly clear job | AR: smoothing, accuracy pill, calibration fallback |

### Week 3 — close the loop, then stop adding

| | A | B |
|---|---|---|
| Mon | reports endpoint, confirm → closure → graph rebuild | report screen, faculty status screen |
| Tue | crowding seed + endpoint | crowding line layer on the map |
| Wed | admin reports screen | arrival screen, edge states, empty states |
| **Thu** | **freeze. bugs only.** | **freeze. bugs only.** |
| **Fri** | demo rehearsal on the actual device, on campus | |

Two full days of buffer at the end is not generosity, it is the part that makes the demo work. Protect it.

---

## 9. What will go wrong

| Risk | Early warning | What to do |
|---|---|---|
| Expo dev build fights you | Day 1 drags past noon | Pair on it. It is a day-1 blocker, not a background task. |
| Tracing is slower than you think | Wednesday ends with half a network | Trace a smaller area. One quarter, traced properly, beats the whole campus traced badly. |
| Graph has invisible gaps | "No route found" on a path you can see | The validator. Run it after every edit. |
| Gemini free tier throttles mid-demo | 429s | The local router answers most questions. Cache the rest. Have a canned answer path. |
| Heading jitter makes AR feel broken | Chevrons twitch | Low-pass filter. Test outside, away from buildings. |
| Scope creep from a good idea in week 3 | "This would be quick" | It would not be. Write it in the backlog. |

---

## 10. Decisions to lock now

1. **Drizzle, SQLite driver, Postgres-safe types.** Migration becomes a config change.
2. **Entrances, not centroids.** Routes end at a door with a name and a step-free flag. Retrofitting this later means re-tracing.
3. **`action` in every assistant answer.** It is what makes directions open by themselves.
4. **`SpeechProvider` interface.** Soniox stays a one-file swap.
5. **Hours: missing key ≠ empty array.** "Not published" and "closed" are different answers, and the whole trust story in the design depends on telling them apart.

---

## 11. Still open

- Registrar's building and `registrar@aui.ma` are unconfirmed. Mark them `status: 'draft'` in `procedures` so the app shows the unverified banner until someone checks.
- Mock roles: decide the shape now (`{ id, name, role: 'student'|'faculty'|'admin'|'guest' }` in an env-seeded table) so swapping in GoCampus SSO later is an auth middleware, not a refactor.
- French and Arabic copy needs a native reviewer before the tags come off.

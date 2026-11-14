# GoMap

A map feature inside **GoCampus**, the Al Akhawayn University app (deviteam.aui.ma).

GoMap answers three questions that currently cost people time on campus: *where is this place*, *is this person in their office*, and *where do I go to get this thing done*. It is built on Mapbox, fenced to the AUI campus, and designed so that the information stays true without one administrator having to chase it.

This document covers the design as it stands on the canvas: 31 screens across 7 sections.

---

## 1. Scope

### In scope

| Feature | What it does |
|---|---|
| Map and filters | 3D campus map, category chips, school narrowing, clustering |
| AI assistant | Places, procedures and app help, by text or voice, in EN / FR / AR |
| Directions | Walking, step-free and indoor-shortcut routes drawn on walkways |
| AR guidance | Camera view with arrows on the ground, with a 2D fallback |
| Professor office lookup | Office, floor, hours, open-now state, contact |
| Crowding heatmap | Historic footfall per walkway segment, by hour |
| Faculty status | "I'm in / I'm out" override on published office hours |
| Problem reports | Anyone pins what is wrong; the admin confirms it onto the map |
| Admin dashboard | Places, offices, procedures, reports, conflicts and review queue |

### Explicitly out of scope

- Live tracking of people. Crowding is historic and anonymous, by path segment, never by person or building occupancy.
- Indoor floor plans. Routing stops at the correct entrance and gives written in-building directions instead.
- Social features. No check-ins, no friend map, no sharing location.

### Priority

English ships first, because AUI is an American-curriculum university and that is the common language of the student body. French and Arabic are designed and built into the screens but marked "translation under review" until a native reviewer signs them off. Arabic drives a full right-to-left layout, not a string swap.

---

## 2. Personas

**1 · Visitor.** Parents, guests, candidates. Signed in as a guest in GoCampus. Here once, often for one event. Needs parking, the venue, dining and a welcome desk. Gets no office hours, no procedures, no saved places.

**2 · New student, staff or faculty.** Knows nothing about the campus and may not know the app either. Needs the full catalogue of services and help using GoMap itself. The app detects a first session and offers a four-step walkthrough, reachable later from the Help chip or by asking "how do I use this map?".

**3 · Continuing student, staff or faculty.** Knows the buildings. Needs the things that are rare enough to forget: pre-registration, a minor declaration, an internship signature, a new room, a professor's hours this semester.

**4 · Admin.** Likely one person. Owns every published place, office, procedure and report. The dashboard opens on what is wrong rather than on usage statistics, because that is the job.

---

## 3. Features in detail

### 3.1 Map and filtering

The map is a Mapbox render fenced to the AUI bounds. Minimum zoom stops at campus extent, so the world is only ever visible during the opening fly-in.

**Cold start.** The camera flies world → Morocco → AUI over 2.0 s, ease-out cubic, pitch 0° to 55°. Any touch skips to the end. Chips stagger in at 1.6 s.

**Filtering has no panel.** The chips at the top *are* the filter. Tap one, pins cross-fade in 180 ms and the camera eases to fit the matches. Tap it again to clear. Choosing Academic reveals a second row of school chips (Business Administration, Science & Engineering, Humanities & Social Sciences, Language Center).

Categories and their colours:

| Category | Colour |
|---|---|
| Academic | `#2563EB` |
| Residential | `#E0841F` |
| Dining | `#D1473F` |
| Athletics & recreation | `#11864F` |
| Administrative | `#6D5BD0` |
| Campus services | `#0E7490` |
| Facilities & parking | `#6B7280` |

**Clustering.** Below 60 m apart, pins group into a counted circle. Tapping one opens it. This matters most for the 41 residences.

**Walkways versus roads.** Walkways draw as a fine dotted line, vehicle roads as a solid band with a dashed centre line. Wherever a route crosses from one to the other, a crossing marker appears. There is a "Show where cars go" toggle in Layers.

**Map styles.** Default, Satellite and High contrast, plus toggles for 3D buildings, crowding, step-free routing and per-building labels.

### 3.2 AI assistant

One persistent pill at the bottom of the map. Two inputs: type, or hold the mic. It is the most reachable control on the screen without costing any map chrome.

Three intents, three reply shapes:

- **A place.** Answers with distance and time, and *the directions are already open*. No second tap.
- **A procedure.** Answers with the steps, the office that owns it, where that office is, its hours and a contact address, plus a working "Guide me there".
- **App help.** Answers with coach marks over the real interface.

**Mode switching.** The answer card carries Walk, AR route and Step-free. Say it or tap it, and the same answer re-renders as a map route, a camera view, or a longer level route with its own time, facts and start button.

**Honesty rules.** The assistant never answers a question about an office or a procedure without naming the source and the last-verified date. If a procedure is not in the register, it says it does not know and offers a contact. It does not improvise.

**Languages.** EN / FR / ع switch live. Arabic flips the sheet to right-to-left, uses Noto Sans Arabic, and mirrors the chevrons. Board 05b is the whole map home in Arabic with the controls mirrored.

### 3.3 Directions and AR

Three route types: **Walk**, **Step-free** (no stairs, gradient under 5%, dropped kerbs at crossings) and **Indoor shortcut** (cuts through a building's ground floor in bad weather).

Routes are drawn on the walkway network, not snapped to roads. The step count ends at a named entrance, and arrival hands over to written in-building directions, since there are no floor plans.

**AR** is an enhancement, never the default. The 2D route always sits underneath and is one tap away.

- Arrows are `#16A34A`, laid on the ground plane 1.5 to 8 m ahead, fading past 8 m so the camera never fills with chevrons.
- A destination label floats, anchored to the building.
- Below ±15 m GPS accuracy, or on a heading drift over 30°, the screen falls back to calibration with a prominent "use the 2D map instead".

### 3.4 Professor office lookup

The data model is the thing that matters here: **a building holds many offices**, so the building sheet never lists people. It lists departments with a count. One level down is the office list, grouped by floor.

- **Open now** is computed from published office hours against the current time.
- **Missing hours are never guessed.** They show "hours not published" with an email fallback.
- **Shared offices are flagged.** Office 111 in Building 11 is shared by three people, so the card says so and suggests emailing ahead.
- Every record carries a last-verified date. Past its review interval, it shows an "unverified" banner rather than quietly going stale.

### 3.5 Faculty status: "I'm in / I'm out"

The fix for stale office hours, moved to the person who actually knows.

Three states, at most three taps: **In**, **Busy**, **Not in**. Busy and Not in take an optional reason (in a meeting, teaching, elsewhere on campus, off campus, rather not say) and an until (30 min, a clock time, rest of today).

Design decisions:

- **Today only, and it clears itself at 18:30.** Nobody has to remember to undo it. This is what keeps the feature alive after week two.
- **It never edits posted hours.** The override sits on top. The weekly pattern stays intact and the admin's record stays clean.
- **"I am in" outside posted hours is a first-class case.** A professor in their office for something else can say so, and students see it, without the posted hours changing.
- **The faculty member sees a live preview** of exactly what students will see before they publish it.

The override propagates to the professor card, the office list and anything the assistant says about that office. The card shows who set it and when, and marks the day's posted hours as paused rather than hiding them.

### 3.6 Report a problem

Anyone can drop a pin on something that is wrong: closed or blocked, out of order, wrong information, hazard, lighting, access blocked. Optional note, photo and a guess at how long it lasts.

**Nothing reaches the map until the admin confirms it.** The report goes to the queue with the reporter's name attached so they can be asked about it.

On confirmation the admin sets a from date, an until date and the reason shown. Then:

- the pin greys out and carries the reason
- walking routes stop going through it
- the assistant says it is closed if anyone asks
- everyone who reported it is told it is handled

Duplicate reports within 20 m are clustered into one item, so four people reporting the same fenced-off car park is one decision, not four.

### 3.7 Crowding heatmap

Zoomed to a stretch of walkway rather than spread over the whole campus, and drawn **along the path like a route**, in segments, each carrying the delay it adds at that hour. An hour scrubber runs 08:00 to 20:00 over a typical weekday, from the past four weeks.

Read-only history. No live tracking, no identities. "We do not track people" is a much easier sentence to defend than any amount of anonymisation.

### 3.8 Admin dashboard

Six sections: Overview, Places & POIs, Offices & hours, Services & procedures, Reports, Assistant log, Change history.

The overview opens on **conflicts, stale records and questions the assistant could not answer** — the three things that make the app wrong.

- **Places** edits a place's name, category, owner, aliases, hours, entrances with accessibility, and its position by dragging a pin.
- **Offices** resolves conflicts between sources, and edits hours day by day. An empty day publishes "no office hours", never a guess.
- **Services** is the register the assistant answers from: owning office, linked place, contact, steps, and the phrasings a question should match. Linking a place is what makes "show me the way" route. There is a live preview of exactly what the student will be told.
- **Reports** is the queue described above.

---

## 4. Design

**Basemap.** Real Mapbox renders at three camera distances (campus, academic quarter, path level), taken from the GoCampus build so the tiles, 3D extrusions and road colours are the real ones. The AR frames use a photograph of the main plaza.

**Type.** Inter throughout, Noto Sans Arabic for Arabic, Space Grotesk for the launch board only.

**Core colours.** Ink `#15171A`, muted `#6B7280`, hairline `#EFEFEC`, white panels on a dark map. Wayfinding green `#16A34A` for routes and AR. Crowding runs `#FDE68A` → `#F59E0B` → `#B45309`. Status: open `#0B6B3F` on `#E6F4EC`, busy `#6B4A05` on `#FFF3DB`, closed `#5F6368` on `#F2F3F0`, missing `#9A2B23` on `#FFF1F0`.

**Motion.** One small vocabulary, nothing looping faster than 2.2 s except the route dash:

| Name | Use |
|---|---|
| `drop-in` | Pins landing, staggered 32 ms apart |
| `rise` | Sheets and banners entering |
| `pop` | Confirmations and dropped markers |
| `halo` | Live location, destination, a pin awaiting confirmation |
| `route-flow` | A dash travelling along the route in the direction of travel |
| `wave` | The voice waveform |

Every screen honours `prefers-reduced-motion`.

**Accessibility.** Real buttons, links and labelled inputs everywhere, including in static mockups. Icon-only controls carry `aria-label`. Touch targets 44 px and up. Text contrast at least 4.5:1. Colours that must be told apart differ in lightness, not only hue.

---

## 5. Screen index

### 1 · Entry and map core
| # | Screen |
|---|---|
| 01 | Launch, world to AUI |
| 02 | Map home, chips filter live |
| 03 | Chip filter narrowed to a school |
| 04 | Clusters at campus zoom |
| 05 | Layers and map style |
| 05b | Map home in Arabic, right-to-left |

### 2 · Find a place, an office or a professor
| # | Screen |
|---|---|
| 06 | Search |
| 07 | Building detail |
| 08 | Offices in a building |
| 09 | Professor lookup |
| 10 | Professor detail |

### 3 · AI assistant
| # | Screen |
|---|---|
| 11 | Assistant home, EN / FR / AR |
| 12 | Voice input |
| 13 | Nav intent, with Walk / AR / Step-free switching |
| 14 | Procedure answer |
| 15 | New-user help |

### 4 · Directions and AR guidance
| # | Screen |
|---|---|
| 16 | Route preview |
| 17 | Turn-by-turn, 2D |
| 18 | AR guidance |
| 19 | AR calibration and fallback |
| 20 | Arrival |

### 5 · Crowding, guest mode and edge states
| # | Screen |
|---|---|
| 21 | Crowding by walkway segment |
| 22 | Guest / visitor mode |
| 23 | Edge states: location off, offline, no results, unverified record |

### 6 · Admin dashboard
| # | Screen |
|---|---|
| 24 | Overview |
| 25 | Places and POIs |
| 26 | Offices and hours |
| 27 | Services the assistant answers from |

### 7 · Keeping the information true
| # | Screen |
|---|---|
| 28 | Faculty: I'm in / I'm out |
| 29 | Report a problem here |
| 30 | Admin: reports and closures |

---

## 6. Data

The screens are populated from the real School of Business Administration directory, including its gaps, because the gaps are what the design has to handle.

Real cases drawn on purpose:

- **Youssef Chetioui** appears in Building 11 Office 109 in the faculty directory and Office 108 in the SBA staff contacts. This drives the conflict-resolution screen.
- **Office 111, Building 11** is listed for three people. This drives the shared-office warning.
- **Lakshmi Goel** has a profile but no office, hours or email. This drives the "unverified record" state.
- **Jawad Abrache** has an office and hours but no published email.

### Placeholders to confirm before this goes further

| Item | Status |
|---|---|
| Registrar's Office in Building 2 | From your example, not verified |
| `registrar@aui.ma` | Assumed address, needs confirming |
| Building 2 opening hours (8:30 to 17:30) | Assumed |
| Guest-mode event name | Marked `[EVENT NAME]`, comes from the events feed |

---

## 7. Backlog

### Agreed, designed, not yet decided on

- **Reminder at the end of a closure.** When an admin confirms a closure with an end date, they should get a reminder when it expires. Otherwise a reopened car park stays closed on the map until somebody notices.

### Considered and declined for now

Course code to room lookup · QR codes on building doors · accessibility as a saved preference · next-class nudge · shuttle times on the stop pin · indoor floor plans.

### Rejected on principle

Live crowd tracking. The historic model gives most of the value with none of the privacy exposure.

---

## 8. Open questions

1. Confirm the Registrar's building, office and contact address.
2. Who reviews the French and Arabic copy before the "translation under review" tag comes off?
3. Who owns the admin account in practice, and what is the review interval per record type?
4. Does the events feed exist yet, or is guest mode's event card manual for now?

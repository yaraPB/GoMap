# GoMap: two-person delivery plan

**Planning window:** 13 October to roughly 27 October–3 November 2026. Confirm the actual hand-in date with the professor. Treat each weekly review as a working product increment that includes UI, API, data, and a short test.

## Show the professor first

Demo the working path **need or search → suggested destination → map pin and details → correction report**. It covers the highest-value part of the charter: helping somebody who does not know an office name find a likely destination. The current implementation uses real React Native screens, a Node API, and a persistent SQLite database. Its records are explicitly labeled *sample* until AUI validates them.

Tell the professor the narrowed release goal: **a trustworthy campus discovery pilot for a small verified set of destinations**, with normal walking directions only if connected paths and entrances are validated in time. AR and AI are feasibility work, not delivery promises for this deadline.

| Priority | Stories from board | End-to-end increment and acceptance check | State |
| --- | --- | --- | --- |
| P0 | US-02, US-03, US-04, US-16 | Open and pan/zoom a mobile campus map; show distinguishable category pins from API records; tap a pin for details. | Demo built; pin coordinates unverified |
| P0 | US-06, US-08, US-10 | Search destinations by name or service term via API, filter category, and show useful empty/error states. | Demo built; usability check pending |
| P0 | US-09, US-11 | Select a need such as scholarship or minor declaration, see the suggested office, then read its description and any verified hours or entrance. Never imply missing fields are known. | Demo built with sample matches; verification pending |
| P0 | US-38 (report portion) | Submit a correction tied to a destination; store it as open without changing published data. Tracking status can follow when a reviewer workflow exists. | Submit flow built and API tested |
| P1 | US-12, US-13, US-14 | Add verified services, opening hours and official contact information to destination details. | Requires service owners and approved records |
| P1 | US-01, US-05, US-36 | Verify an initial inventory and at least one connected walking route on site, then route to an approved entrance. Show “route unavailable” otherwise. | Requires AUI/Deviteam path and entrance data |
| P1 | US-21, US-22, US-24, US-25 | Authorized editor proposes a draft, reviewer approves and publishes, and map/search/details read the same published record. | Later vertical slice; requires roles and ownership agreement |
| P1 | US-37, US-39, US-40 | Run a short task test, capture results, correct defects, and hand over data ownership and setup. | Schedule during final week |
| Later | US-31–35, AR walkthrough, professor-office directory | Pilot only after approved records, AI access, positioning tests, and device support. | Excluded from the short delivery commitment |

## Weekly sequence

1. **13–19 Oct: usable discovery.** Finish and demo this repository's core journey. Teammate obtains approval for 5–10 pilot destinations and two need-to-office matches. Replace only approved sample records, recording verifier and date. Test scholarship, minor declaration, library, and a failed search on a real phone.
2. **20–26 Oct: one navigation or maintenance slice.** If path and entrance data arrive, implement one verified walking route end to end with a selectable start and an honest unavailable state. If not, implement the editor → reviewer → publish slice for the initial inventory. Do not spend the week building both partially.
3. **27 Oct–3 Nov, if available: pilot and handover.** Run 5–8 short tasks with students and at least one visitor or newcomer. Record completion, time, wrong selections, and satisfaction. Fix top defects, document setup and data owners, and demo the measured results.

## Split the work

**You: engineering owner.** Own the React Native app, Node API, SQLite schema, mobile/API integration, code review, and the weekly demo. Keep each selected story vertical. A story is done when a user can complete the task on a phone, data is persisted or read through the API, a failure state is handled, and its acceptance check passes.

**Teammate: product and verification owner.** Own a single prioritized backlog, stakeholder interviews, source-of-truth inventory, on-campus pin/entrance checks, test participants, acceptance notes, and a short handover. They can enter verified seed data and test the app, but should not produce speculative office locations or hours to make the demo look complete. Put each data request in a shared sheet with field, source, owner, date checked, visitor visibility, and approval status.

| Ask this person/team | Questions and artifact needed |
| --- | --- |
| Professor Houda Chakiri | Confirm the revised hand-in date, grading expectations, and approval of the P0-only demo scope. |
| Ilyas Lhafi / Deviteam GoCampus owner | Obtain existing map data, API/integration guidance, branding constraints, and permission to use GoCampus records. The charter has inconsistent name/email spelling; confirm the correct contact before outreach. |
| AUI administration or designated service owners | Validate the first 5–10 public destinations, scholarship and minor-declaration responsibility, office hours, official form links, and who may approve changes. |
| Facilities/security/accessibility contact | Walk selected entrances and connected paths; document closed or restricted access and any accessibility claims. |
| ITS | Confirm hosting/network constraints, data backup, and who may operate a pilot API. |
| 5–8 students, plus a visitor/newcomer if available | Try “find scholarship help,” “find the library,” and “recover from a failed search”; record completion and confusion without coaching. |

## Review checklist

- Show a phone demo that works with the API and SQLite, including no-results and connection-failure behavior.
- Label sample/unapproved records visibly; route only on validated connected paths.
- Keep story IDs and acceptance evidence together in Jira or one shared backlog. Move a story to Done only after the working UI, API/data, and acceptance check are demonstrated together.
- Present AI, AR, professor lookup, and bulk editing as later scope until the required records and access are available.

# GoMap TODO

Legend: [x] done and checked here (tests or screenshots) · [~] done, needs a phone on campus to confirm

* [~] display the arrows and I sadi for the AR you can whatever technogology I just want it to be as good as possible.
  → Arrows no longer wait for the compass (motion-sensor north first), never hide on weak GPS (they dim), and a big 3D guide arrow lies on the floor at the bottom and always turns towards the way to go. Floor ribbon + raised chevrons + turn marker stay. `mobile/app/ar.tsx`, `mobile/src/ar/orientation.ts`
* [x] The keyboard, esp on phone when I make an action and end it pls make it disappear.
  → Closes after sending a question, submitting a search, picking a result, opening voice, saving a status; lists dismiss it on scroll.
* [x] Make the transitions smoother pls
  → Softer sheet springs + fade-out on close, screens slide out the way they came in, staggered search results, animated widget fold.
* [x] I don't like u using emojis, at least use a better pack of SVG or other libraries (MUI) that are more sleek and modern.
  → Lucide icons everywhere (mobile `lucide-react-native`, admin `lucide-react`), no emojis left. `mobile/src/ui/icons.tsx`
* [x] For the light I don't want the boxes, I want more the building itself to be for example in a lighter color or ideally emitting light
  → Open buildings light up themselves (warm emissive 3D shell + flood light on the ground) in evening/dark; pin halos and ground circles removed.
* [x] remove the clear from the dashboard what I want is that when u click on smth and it's selected then it gets removed.
  → No Clear button: tap a selected chip (or school) again to clear it.
* [x] In the skins I would love to add the evening (so we have actually three: Day, evening which is orange/golden (the new one) and dark)
  → Layers → Time of day: Auto (campus clock), Day, Evening (golden), Dark.
* [x] For path density, make it current (like an additional that u can add on the screen and when it's empty or light just leave it as is pls).
  → Flame button toggles "busy paths now" (current hour); only busy/very busy paths are coloured, quiet ones untouched. "By hour" keeps the old scrubber.
* [x] The translations french & arabic are not working and displaying properly please make them do so (other then the names everything else should be tranlated). And don't forget for arabic RTL.
  → Every screen translated (~510 strings FR + AR, route instructions and statuses included); Arabic mirrors the whole layout. A test fails if a string is missing a translation.
* [x] For the sticky I was thinking more right next to the professor's names and a bit inclined (for example when I search for them).
  → Tilted door-note tag next to the name in search, office lists, people list and the professor card.
* [x] When the professor says they're missing, make sure that they give either time or it may be even multiple days, and sometimes it might even be a semester off.
  → "Away" → rest of today / back tomorrow / 3 days / a week / pick the return date / this semester. Survives the 18:30 reset; card says "Away · back Fri 20 Nov".
* [x] Skin layers don't work (satekkite and high contrast). fix it.
  → Bug: the style command was queued and never sent. Fixed. Satellite is now a photo layer that falls back to Esri imagery because Mapbox answers HTTP 429 for satellite tiles on our token (check the Mapbox account). High contrast stays in daylight with bold paths.
* [x] For visitors the navigation is still kinda clanky pls fix it.
  → Visitor start card: Admissions, Main Auditorium, Library, Cafeteria, Mosque, Parking, one tap straight into the route. Placeholder event card removed.
* [x] also pls check the last commit in main branch my teammate added the missing building and paths pls if they are of any use to u or u see new things pls add them (you will have to pull from the main first).
  → Fetched `main` (df6e9a9). Their 47 traced features → `data/campus/traced.geojson`: paths join routing (+1.3 km), new footprints fill gaps. Did not merge their app code (it targets the old prototype).
* [x] I want a better UI for http://localhost:5173/#issues (pls study actual dashboards and make it as intuitive as possible).
  → Map of offices sized by problems routed, KPIs, search + office filter chips, clean read-only table, edit in a drawer that pushes the table aside.
* [x] No the admin doesn't get the choice of y the professor didn't come pls (neither this Door note (shown as a sticky note in the app) Nor this Today and lunch) should be for the admin (the admin only gets to c the total number of hours spent by the professor in the office).
  → Removed from the admin (and from the admin API). Admin sees hours spent in office (7 / 30 days + heatmap) only.
* [x] The calendar is kinda clanky also pls study online on how to make it smoother pls.
  → Google-Calendar-style blocks: drag to create, drag to move (also across days), pull edges to resize, 15-min snap, overlaps merge, click to edit on a clock, Delete key, "same on Mon–Fri".
* [x] In admin (remove change history pls)
* [x] For places and PIOs pls make it better pls (I would love to have the map there and then depending on the category u c what u can and cannot change, etc...).
  → Big map first (click a building, drag its pin or its entrances); fields depend on the category, locked ones say why (e.g. car parks: no hours).
* [x] And always please display the calendar or the map first in every page of the admin pls and make a very interactive clock setting system pls
  → Every page opens on a map or a calendar/heatmap. Times are set on a draggable analog clock face (hours ring 1–12 / 13–00, then minutes).

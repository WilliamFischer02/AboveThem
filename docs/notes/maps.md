# maps agent notes (2026-10-22, overnight session)

Branch `worktree-agent-aa0041fc9ecc9d7d7`. **Heads-up for the lead:** this worktree was created on the stale
`71c2c1b Base repo` commit (58 commits behind `main`, no `src/input/`, Polus a stub). I fast-forwarded it to
`main` (7bf75ba) before working. Check the other agents' worktrees for the same problem before merging.

## TL;DR
- **Map detection never worked, on any map.** Two independent bugs: (1) Rust compared the whole `map_name`
  region text — which includes the "ROOM SETTINGS" label — against bare map names, so the score stayed under
  the 0.55 threshold; (2) even when `game://map` fired, the frontend lost it because the event effect re-runs
  on every lobby-code change and `pendingMap` was effect-local. Evidence: the NDJSON logs of the two Polus
  games last night (`2026-10-22_07-23-42`, `07-32-42`: task list "Laboratory: Fix Weather Node",
  "O2: Fill Canisters", "Insert Keys") were created with `"map":"skeld"` and never got a `settings` map event.
- **The MIRA "nothing detected" report is NOT explained by map code.** No TS path refuses to create a match on
  MIRA (a stub map only produced a toast and a silent Skeld fallback), and no Rust region or marker is
  map-specific. There is **no NDJSON at all after 01:57 local** (07:57 UTC), i.e. no match was ever created
  for the MIRA game — not even the "Game in progress" provisional match a single phase event creates. That
  points at the watcher/capture not running (app restarted by a rebuild, capture failed on the window, or an
  older build), not at MIRA. I could not run the game; the lead/bugs-rust should check `watcher_status` /
  the capture status line the next time it happens.
- Fixed what was mine: full MIRA HQ / Airship / Fungle data, `MapInfo`, travel + vent helpers, map-name and
  map-inference fallbacks, fail-soft map choice. Rust change is minimal and **UNVERIFIED** (not built).

## Root cause with references (as of main 7bf75ba)
| # | Where | What |
|---|---|---|
| 1 | `src-tauri/src/regions.rs:100` | `map_name: Rect::new(1500, 345, 380, 90)` — on `lobby_v2.png` the small "ROOM SETTINGS" label sits at y≈355, inside the rect, above the "THE SKELD" logo. |
| 2 | `src-tauri/src/watcher.rs:412-420` (old) | `fuzzy_best(&mt, ["The Skeld", "MIRA HQ", …])` on the whole text: "roomsettingsmirahq" vs "mirahq" = 12 edits / 18 → 0.33 < 0.55 → no `game://map`. Replaced by `map_id_of` (keyword search + per-line fuzzy). UNVERIFIED. |
| 3 | `src/input/useGameEvents.ts:172` + `:750` (old) | `let pendingMap` lives inside the effect whose deps are `[settings, lobbyCode]`. The watcher emits `game://lobby` and then `game://map` in the same loop iteration (watcher.rs step 6 → 6a), `setLobbyCode` re-runs the effect, the new closure starts with `pendingMap = null`, and Rust never re-emits an unchanged map (`last_map`). Now a module-level `detectedMap` seeds `pendingMap`. |
| 4 | `useGameEvents.ts:344`, `:492`, `:553` (old) | A detected map without rooms was dropped and the match silently used Skeld rooms — wrong deductions on the wrong map. Now any detected map is used; room rules see `rooms.length === 0` and stand down (this is moot now that all five maps have data). |
| 5 | (new) `useGameEvents.ts` `inferMapFrom` | Fail-soft fallback when the lobby read is missed (joined late, panel covered): room popups + task-list lines feed `inferMapFromLabels`; the match map switches with an "(auto, from …)" toast when the labels clearly point elsewhere. Never overrides a lobby-panel read. |

## What changed
- `src/data/maps/mira.json`, `airship.json`, `fungle.json`: complete (14 / 22 / 18 rooms, 1 / 4 / 3 vent
  systems with per-hop `links`, 20 / 24 / 26 tasks). `skeld.json`, `polus.json`: added `info` and `aliases`
  only; their rooms/vents/tasks matched the wiki tables (re-checked: Skeld vents, visual set, Divert Power,
  Download/Upload, Fix Wiring order; Polus vents, visual set, task kinds) — no errors found.
- `src/types/game.ts` (additive): `MapInfo`, `MapSabotage`, `MapFeature`, `MapData.info?`, `MapRoom.aliases?`,
  `MapRoom._note?`, `MapVentNetwork.links?`, `_note?` on vents/tasks.
- `src/engine/map.ts` (additive): `hasMapData`, `VENT_HOP_SEC`, `ventLinks`, `ventNeighbours`, `ventReachable`,
  `travelMatrix` (Floyd–Warshall, cached), `fastestSeconds`, `couldReach`, `ventShortcutNote`, `mapIdFromText`,
  `inferMapFromLabels`, `validateMap`. Tests: `src/engine/map.test.ts`, `src/data/maps/maps.test.ts` (54 tests).
- `src/input/useGameEvents.ts` (small, marked): module-level map memory, fail-soft map choice, "Map set to …"
  settings line, label inference.
- `src-tauri/src/watcher.rs`: `map_id_of` + two tests (one fixture-based, windows only). **UNVERIFIED, not built.**
- `docs/GAME_INTEGRATION.md` §6 Per-map.

## Disagreements and things I did not follow from the brief (blunt)
- **Brief said MIRA visual tasks = Scan, Asteroids, Garbage. Wrong.** The wiki Visual_tasks table, the
  Clear_Asteroids/Prime_Shields pages, GameWith and the research relay all say MIRA has ONE visual task:
  Submit Scan. Encoding Asteroids/Garbage as visual would hand out false hard-clears. Data follows the wiki.
- **Brief said "admin table on every map". Wrong for The Fungle** (no Admin; wiki Admin_(ability) lists
  Skeld/MIRA/Polus Admin, Airship Cockpit + Records). `info.admin` is `[]` on Fungle.
- **Fungle vents** — sources disagree on names (wiki map page vs wiki vent table vs Pocket Tactics). I kept
  `_verified.vents = false` and listed the union (beach/cafeteria/storage/splashZone/laboratory;
  kitchen/jungle; reactor/lookout/cliffs/communications). Over-inclusive on purpose: a missing vent link
  would let the engine call a true alibi a lie.
- **MIRA vent links**: Locker Room–Decontamination and Decontamination–Launchpad appear only in the wiki vent
  table rows; kept and noted. Irrelevant to reachability (one network either way).
- **Research relay reconciliation** (game-knowledge.md §1.5–1.9, §4): agreed on vents, visuals, commons,
  monitors, ladders. Took from them: Airship crash-course keypads are both in Gap Room (I had guessed Records),
  Airship spawn list, dummy panels (Skeld Reactor divert, Polus Office divert, Airship Armory/Comms/Vault
  wiring, Airship Lounge garbage bin — removed Lounge from Airship Empty Garbage rooms), Fungle Communications
  ↔ Upper Engine ladder (added as an edge; the wiki map page only mentions a ladder to Communications —
  both modelled, noted). Polus Seismic Stabilizers: relay says both sides of the Dropship, I had Laboratory —
  union listed, unverified. Airship / Fungle door rooms: union, unverified.
- **Travel seconds are eyeballed** from the wiki map images for every map (`_verified.durations = false`).
  They are good enough for "could not have walked there" with slack, not for second-level precision. The
  first live game on each map should be used to calibrate: log `myRoom` stamps and compare.

## Room hotkeys (single letter, v/k/z reserved)
Shared rooms keep the same letter across maps where possible: c Cafeteria, a Admin, m MedBay/Medical,
q Communications, t Storage, e Electrical, s Security, r Reactor/Records, l Laboratory/Lounge, f Office/
Ventilation(fans), o O2/Locker Room/Mining Pit, w Weapons/Showers/Lookout. Per-map tables are in each JSON `_note`.

## Unverified / for the lead
1. Rust `map_id_of` + tests: build and run `cargo test map_name` (bugs-rust agent).
2. Live check: start a lobby on each map, expect a "Map: … (auto)" toast; check the NDJSON init/settings line.
3. MIRA "nothing detected": if it recurs, note the AutoStatus line (capture running? watcher phase?) — the
   map is not the cause per the code.
4. Map inference thresholds (similarity ≥ 0.8, lead ≥ 1 point) are untested on real OCR task lines beyond the
   Polus strings from last night's logs.

## Round 2 (after the first merge, 16e83d1)
- `src/data/maps/questions.json` — per-map meeting questions (from the research digest §4) and lie notes, selected by
  situation `{bodyRoom, claimRoom, claimTask, sabotage, claimMonitor}` through `src/engine/mapQuestions.ts`
  (`selectMapQuestions`, `fillTemplate`, `validateQuestions`). The validator caught one bad entry of mine
  (Polus "Divert Power" as a claimTask — not a Polus task id); that case is covered by `claimedTaskExists` → notOnMap
  plus the Office dummy panel instead.
- `src/engine/mapChecks.ts` — `findTask`, `claimedTaskExists` (not on map / wrong room / dummy panel),
  `commonTaskMismatch` (claimed common task missing from my fully-read list), `monitorContradiction` (Admin empty room,
  Vitals DED before the claimed sighting, MIRA Doorlog crossing without an entry — shaky because vents skip sensors).
  `walkPath` added to map.ts. Nothing reads Admin/Vitals/Doorlog screens yet; the checks are ready for manual input or OCR.
- **Fungle vents**: now `_verified.vents = true`. The per-location wiki pages (Beach, Splash_Zone, Laboratory, Jungle,
  Kitchen, The_Cliffs, Communications, Reactor) agree with each other and with Pocket Tactics on the three systems; the
  wiki vent TABLE's "Communications" is the clifftop vent outside its lower door. Cafeteria/Storage stay in system 1
  only because Pocket Tactics names the beach vents after them (over-inclusive on purpose).
- **Travel seconds: not refined, deliberately.** The wiki gives no distances or walking speed in world units, and the
  wiki map images are not on a common scale, so any "refinement" from pixels would be my eyeballing with extra decimals.
  Added `src/engine/mapDiameter.test.ts` as a typo guard instead (longest walk at speed 1.0: Skeld 28 s, MIRA 25 s,
  Polus 43 s, Airship 33 s, Fungle 27 s). My honest guess: Airship and Fungle are 20–30 % too short (ladders, the
  platform wait and the Fungle's size). Real fix: log `myRoom` transitions with stamps in live games and take medians.

## Next ideas
- Read Admin / Vitals / Doorlog screens when the local player opens them (legit: own screen) → observations.
- Detect Mushroom Mixup (all nameplates hidden + random colours) and mark sightings in that window shaky.
- Calibrate `adjacent[].sec` from logged `myRoom` transitions (median per edge) and write back to JSON.

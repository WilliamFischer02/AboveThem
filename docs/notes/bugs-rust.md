# bugs-rust — session 5 notes

Branch `worktree-agent-ab52dc93eabd202c8`. **The worktree started at the old "Base repo" commit (71c2c1b); I reset it
to main 7bf75ba before any work, and merged main again after the maps agent landed.**

Tests at the end: Vitest 162 (was 72 + other agents' merged tests), Rust 52 (+1 ignored probe; was 31).
`npm run check` = tsc + vitest + `cargo test --lib` (set `CARGO_TARGET_DIR=C:\dev\AboveThem\src-tauri\target` in a
worktree to reuse the build cache).

## Bug 2 — Russian chat neither shown nor translated: the actual chain
1. **Only en-US OCR is installed.** Measured: the en-US engine reads "кто убил? голосуем за синего" as
   `KTO y6nn? ronocyeM aa Chi-lero` (Latin look-alikes). Nothing can read real Cyrillic without the Russian OCR pack.
2. **`translate::detect` returned ISO 639-3 codes** (whatlang: "rus", "eng"), documented as 639-1. `translate_text`
   passed `sl=rus` to Google → request failed → TS `catch {}` swallowed it → no translation, no trace. This hit exactly
   the long, clearly-foreign lines (the only ones whatlang calls reliable). Logs confirm: the garbage lines in the
   NDJSONs have no `chatPatch` at all. Fixed with `iso639_1()` + retry with auto-detect + a `translateFailed` diag.
3. **`looksEnglish` was not script-aware:** it stripped everything non-ASCII *before* the non-ASCII check, so pure
   Cyrillic became zero words → "English" → never translated (would have bitten as soon as a ru OCR pack existed).
4. **Bubbles with no readable text were dropped** (`if !m.text.is_empty()`), so a message OCR could not read vanished.
   I suspected the 23 px line-height floor too, but measured: Windows OCR line boxes are not tight, x-height-only
   Cyrillic still came back ~29 px. Lowered it inside bubbles anyway (harmless there).

What changed: `chat.rs` finds the white bubbles from pixels (tested on lobby_chat: 4 bubbles, mine/others right),
assigns OCR lines to bubbles (name = top 40 px of the bubble), ignores names showing through the panel, reports
unreadable bubbles (`unreadable`, `script_hint: "cyrillic"`, `cyrillic_guess`), re-OCRs weak bubbles with every other
installed OCR language and keeps the most plausible (`textscore::plausibility`), caching the winner per sender. The
watcher confirms an empty unreadable bubble over two reads and dedupes it by bubble pixel hash. TS: unreadable lines
are shown with a hint (ChatHint: "install the Russian OCR pack"), never parsed into claims; a Cyrillic look-alike guess
is translated from `ru` and labelled "≈ guess". Every dropped bubble logs a `diag` (`chatDropped` with why,
`chatUnreadable`). The Screen reading panel lists OCR languages + install steps.

UNVERIFIED: the multi-language path (no ru pack on this PC); bubble geometry at non-16:9 resolutions; the game's actual
Cyrillic chat font (the fixture is GDI+ Arial pasted into a real bubble).

## Other fixes (all tested)
- `useGameEvents` re-registered every listener on each room code and on every keystroke in "my name" (deps
  `[settings, lobbyCode]`): events in the gap were lost and closure state (role, pending map/settings, colour votes,
  grid count) wiped. Now keyed on "settings loaded"; lobby code + settings via refs.
- `loadSettings` rejection left `settings = null` forever (no auto layer at all); resume had no catch.
- Grid read removed slot-less duplicates with `removePlayer` (their chat lines / claims dangled) → `mergePlayers`.
- Reducer had no default: an unknown event kind (newer build's log) made `replay` return undefined state.
  `parseLines` accepted `null`/numbers.
- Watcher: `catch_unwind` around the loop; on panic `running=false` so the 8 s tick restarts it (it used to stay
  "running" and dead forever). Poison-tolerant locks in watcher/capture/ipc/hotkeys.
- Capture: prefers the window titled exactly "Among Us" (a browser tab / Discord window containing the words could win);
  removed the second lookup + `expect("window vanished")` panic. Stale-session restart (running, no frame for 20 s),
  `started_ms` / `last_error` in `capture_status`; AutoStatus shows "Capture lost since hh:mm" / "Screen reader
  stopped since hh:mm"; diag lines `captureStart/captureFailed/captureRestart/watcherRestart/watcherStalled`, queued
  until a match exists so the next NDJSON explains the gap.
- Hotkeys: one key taken by another app failed `register_multiple` and killed every hotkey → per-key registration,
  taken keys reported in the hotkey error line. useHotkeys leaked listeners that resolved after cleanup (double chords).
- Handoff #7: ejection text gone + no meeting/lobby/role/end screen for 5 s ⇒ round (`fallback_phase`, UNVERIFIED live).
- Handoff #9: `gridOrder` (first complete grid where all alive cards matched) + `order` bonus 1.5 in `pairScore` when a
  card's alive rank equals the player's alive rank; off whenever an alive player lacks an order or orders collide.
  The game fact "grid = player index order, dead last" is UNVERIFIED (taken from the handoff).
- Clock drift: phases are confirmed 2–12 frames late (≈ 2.5 s after a meeting); `PhaseEvent.lag_ms` → `PhaseChange.lagMs`
  back-dates round starts / meeting freezes (clamped). Before, every post-meeting round's `t` was ~2.5 s short.
- Maps agent's `map_id_of` built and kept; its fixture test failed because the `map_name` rect held only
  "ROOM SETTINGS" (the logo sat below, half cut). Rect moved onto the logo, read binarised (`read_map_logo`). Verified on
  lobby_v2 (THE SKELD) only.

## Dubious, NOT changed (file:line on this branch)
- `src/state/events.ts:62` — auto events (OCR chat lines, auto sightings, myTasks, addPlayer) are undoable, so the user's
  undo hotkey often undoes something the watcher did, not the user's last action. Needs "undo only `source: me`" — design call.
- `src/input/useHotkeys.ts:133` — cleanup fires `clear_hotkeys` asynchronously; a quick map change could in theory clear
  the new registration if IPC reorders. Never seen.
- `src/engine/rosterConsolidate.ts:85` — two real players with similar names ("Bob"/"Bobby") merge before the first grid.
  An icon-hash "different person" veto would fix it but dead-card hashes differ from alive ones; left alone.
- `src-tauri/src/capture.rs:230` `crop_bgra` / `src-tauri/src/regions.rs:167` `dhash`: no guard for zero-size frames
  (the watcher's catch_unwind now contains it).
- `src-tauri/src/watcher.rs:295` `stop()` joins the thread; an OCR call that hangs would block the command.
- `src-tauri/src/watcher.rs:154` — ejection→round fallback fires if the game ended after the ejection and the end screen
  went unrecognised (victory/defeat colours still UNVERIFIED).
- `src/state/settings.ts:23` — settings.json is shared with Rust's `translate` block; it survives only because callers
  spread the loaded object.
- `src-tauri/src/watcher.rs:623` — chat dedupe key includes the raw sender; OCR jitter in the name line can duplicate a
  short line (TS dedupe only covers ≥ 12 chars).
- `src/input/useGameEvents.ts:509` — "established" roster blocks newcomers after 4 slotted players; a late joiner in the
  lobby who first appears on the grid is dropped as an OCR miss.
- Keyless Google endpoint: no backoff when rate-limited (failures now visible as `translateFailed` diags).

## Next ideas
- Install the Russian OCR pack on the dev PC and record a real Cyrillic chat frame as a fixture.
- Fixtures for Mira/Polus/Airship/Fungle lobby logos to verify `read_map_logo`.
- Undo restricted to user-sourced events.

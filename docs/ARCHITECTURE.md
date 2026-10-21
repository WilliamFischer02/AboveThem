# Architecture

## TL;DR

Two processes: a **Rust/Tauri backend** that watches the screen and talks to
translation providers, and a **React overlay** that holds match state and runs
the reasoning engine. They talk over Tauri IPC events. The engine is pure TS so
it can be tested without a game, a screen, or Windows.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Among Us (stock client, untouched)                                      │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ pixels only (Windows Graphics Capture)
┌──────────────▼───────────────────────────────────────────────────────────┐
│ src-tauri (Rust)                                                        │
│  capture.rs   → frame grabber, ~4–8 fps idle, burst to 15 fps in meeting │
│  regions.rs   → resolution-relative ROI definitions (chat, vote grid,    │
│                 task list, map name, role card)                          │
│  ocr.rs       → Windows.Media.Ocr on cropped ROIs; diff-based, only runs │
│                 when a region's pixels changed                           │
│  colors.rs    → samples player-color swatches in vote grid / chat rows   │
│  phase.rs     → detects game phase from UI markers (lobby/round/meeting/ │
│                 voting/ejected/end)                                      │
│  translate/   → trait Provider { detect, translate } + DeepL/Google/     │
│                 LibreTranslate/local impls                               │
│  hotkeys.rs   → global hotkeys (observation logging without alt-tabbing) │
│  ipc.rs       → emits typed events; receives commands                    │
└──────────────┬───────────────────────────────────────────────────────────┘
               │ Tauri events: ChatLine, PlayerRoster, PhaseChange, TaskList…
┌──────────────▼───────────────────────────────────────────────────────────┐
│ src (React + TS)                                                        │
│  state/       → match store (players, events, claims, votes, phase)      │
│  engine/      → PURE TS:                                                 │
│     observations.ts  normalise raw inputs into Observation events        │
│     alibi.ts         alibi graph (who was with whom, when, where)        │
│     suspicion.ts     evidence-weighted suspect scoring + explanations    │
│     contradictions.ts claim-vs-observation + claim-vs-claim checks       │
│     meetingScript.ts  generates questions/statements/vote rec            │
│     impostor/         lieLedger.ts, alibiGen.ts, fakeTasks.ts, defense.ts│
│     translate.ts     client-side orchestration of translator state       │
│  ui/          → overlay panels (Roster, Timeline, Meeting, Impostor,     │
│                 Translator, Settings)                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

## Process model

- **Overlay window:** transparent, always-on-top, click-through *except* on its
  panels. Tauri 2 supports `transparent: true`, `decorations: false`,
  `alwaysOnTop: true`. Click-through toggling via `set_ignore_cursor_events`.
- **Docked mode (fallback):** a normal window you place on a second monitor or
  beside the game in windowed mode. Must be fully functional — not everyone plays
  fullscreen-windowed.
- **Capture cadence:** idle 4 fps. On `PhaseChange → Meeting`, burst to 15 fps on
  chat + vote ROIs only. OCR only runs on an ROI when a cheap perceptual hash of
  that ROI changes. This keeps CPU negligible while a game is running.

## Data flow during one round

1. `phase.rs` sees the round start (task bar + map visible) → `PhaseChange(Round)`.
2. User presses a global hotkey chord (e.g. `Ctrl+Alt+<colorKey>` then
   `<roomKey>`) or clicks the overlay → `Observation` event into the store.
3. Engine recomputes alibi graph + suspicion incrementally (cheap; <10 players).
4. On `PhaseChange(Meeting)`:
   - OCR reads the vote grid → confirms roster (names, colors, alive/dead).
   - OCR streams chat lines → translation pipeline → `ChatLine` events.
   - `meetingScript.ts` produces: *Ask*, *Say*, *Vote*, *Watch for* blocks,
     ranked and each annotated with the evidence that generated it.
5. User logs claims made in chat ("Red says they were in Nav") with one click
   on the chat line → `Claim` event → `contradictions.ts` checks it live.
6. Votes revealed (if lobby setting on) → OCR reads vote icons → `Vote` events →
   voting-pattern analysis feeds next round's suspicion.

## Persistence

- Match log written as newline-delimited JSON to
  `%APPDATA%/AboveThem/matches/<timestamp>.ndjson`. Everything is replayable.
- Settings in `settings.json` (same folder): translation provider + key, pinned
  language, hotkeys, ROI calibration per resolution, overlay layout.

## Why Tauri over Electron / Python

- Electron adds ~150–300 MB RAM and a Chromium process beside a game. Tauri uses
  the system WebView2 (already on every Win10/11 box).
- Python + PySide was the fastest to prototype but global hotkeys + transparent
  always-on-top + WinRT OCR interop are all cleaner from Rust via the `windows` crate.
- Vite/React/TS matches William's existing toolchain, so UI iteration is fast.

## Testing strategy

- `src/engine/**` → Vitest unit tests with fixture matches in
  `src/engine/__fixtures__/*.json`. Target: a full fake match replays through the
  engine and produces a known meeting script.
- Rust capture/OCR → integration tests use saved screenshots in
  `src-tauri/fixtures/screens/<resolution>/<phase>.png` so OCR/region logic is
  testable without the game running.
- Manual: a `dev:replay` script that feeds a saved `.ndjson` match into the UI.

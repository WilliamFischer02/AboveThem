# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-21, end of session 1)

- **Phase 0: DONE** on William's machine (Windows 11 Home 26200). Versions below.
- **Phase 1: functionally complete, not yet played with.** Everything runs in
  `npm run tauri dev`; nothing has been used in a real lobby yet.
  - Store: append-only event log, undo-as-event, NDJSON at
    `%APPDATA%\AboveThem\matches\<timestamp>.ndjson` (ADR-008). Presets by lobby
    code in `presets.json`. "Open / replay" on the setup screen loads a log.
  - Hotkeys: prefix+colour then room/action (ADR-009). **Verified end to end
    with Notepad focused** — chords reached the app and landed in the log. The
    in-window chord machine also works (browser dev / docked focus).
    **UNVERIFIED with Among Us itself** (fullscreen-windowed) — first thing to try.
  - UI: lobby setup (players as crewmate heads, settings, presets), roster chips
    with mini-menu (seen in…, with me, visual task, vent, kill → victim, sus/clear,
    found dead → room), timeline newest-first with undo, toast + pending chord,
    meeting panel (headline / say / ask / vote / watch, "why" expanders), chat-claim
    entry with live verification, vote-result entry → ejection → next round.
    Styled after the game: own crewmate SVG + bundled Fredoka (ADR-010).
  - Engine: hard facts + counting; alibi graph with kill-window clears (1 extra
    hop); contradictions (location vs my sightings, story changes, companion
    confirm/contradict, task-not-in-room, visual-task check, accusations vs
    bandwagon, post-ejection re-weighting incl. pair tells, silent-near-body);
    observation rules (self-report, proximity/vent-only, leaving body room, last
    seen with victim, unaccounted, task duration/task-bar/visual-no-animation,
    sabotage fixers, never-vote-each-other); meeting script from `crew.json`
    situations, EIG-ranked questions, endgame framing, insufficient-info path.
  - Tests: 33 Vitest (engine, state, hotkeys) + 8 Rust unit tests, all green.
    Fixtures: 01 (original), 02 (2 impostors, one ejected, claims + contradictions),
    03 (insufficient info → skip).
  - Skeld data: rooms/vents/tasks checked against the wiki (see `_note` in
    `skeld.json`); `_verified.durations` stays false.
- **Not done / known gaps**
  - Body / kill chords can't name the victim (2-key limit): `Space+room` logs a
    body with victim `unknown`; the user picks the victim via the roster
    ("Found dead…"). Same for `colour+k`. Consider a 3rd keypress only for these.
  - "Claims a common task I don't have" (weight 2.5) needs my own task list —
    no input for it yet (Phase 2 OCR or a manual picker).
  - `deflectsWithQuestions`, `oddArrivalAfterLights`, `ignoredCriticalSabotage`,
    `commsAfterVisualAnnounced`, `lastSecondSwitch`, `skipOnCriticalVote` have
    no rule yet (need chat parsing / vote timing).
  - Overlay mode (transparent/click-through) is Phase 5; window is docked only.
  - Translator, impostor panel: Phases 3–4.
  - Roster chips show % for everyone from the prior alone (e.g. 29% with 2 imp /
    7 others). Consider hiding the number until any evidence exists.

## Toolchain versions that worked (2026-10-21)

| Tool | Version |
|---|---|
| Windows | 11 Home 10.0.26200 |
| Node / npm | v24.19.0 / 12.0.2 |
| Rust (stable-x86_64-pc-windows-msvc) | rustc 1.97.1, cargo 1.97.1 |
| Tauri CLI | `@tauri-apps/cli` 2.12.3 (npm devDep; no global `cargo tauri`) |
| VS Build Tools | 2026 (18.3.11520.95) with VC x64 tools |
| Windows SDK | 10.0.26100.0 |
| WebView2 runtime | 155.0.4283.62 |

### Pinned npm (exact, `package.json`)
`@tauri-apps/api` 2.12.4 · `@tauri-apps/cli` 2.12.3 · `react`/`react-dom` 18.3.1 ·
`zustand` 5.0.15 · `typescript` 5.9.3 · `vite` 8.3.5 · `vitest` 5.0.5 ·
`@vitejs/plugin-react` 6.1.2 · `@types/react` 18.3.31 · `@types/react-dom` 18.3.7.
`npm audit` = 0 (ADR-007).

### Pinned crates (exact, `src-tauri/Cargo.toml`)
`tauri` 2.12.4 · `tauri-build` 2.7.3 · `tauri-plugin-global-shortcut` 2.4.1 ·
`tauri-plugin-clipboard-manager` 2.5.0 · `serde` 1.0.229 · `serde_json` 1.0.154 ·
`thiserror` 2.0.21 · `anyhow` 1.0.104 · `tokio` 1.54.0 · `reqwest` 0.12.28 ·
`whatlang` 0.16.4 · `windows` 0.62.2 · `windows-capture` 2.0.1 (ADR-006).

Build notes: cold `cargo check` ~55 s, warm ~20 s; `tauri dev` rebuilds the
Rust side on any `src-tauri` change (~10 s). crates.io had a ~5-minute outage
mid-session — on "spurious network error", just retry. Vite's dep optimizer
once produced a duplicate-React "Invalid hook call" after a new import; it
self-healed on reload.

### Dev smoke-test recipe (no Among Us needed)
Setup screen → "dev: start demo lobby" (DEV builds only; also `Ctrl+Alt+D`
in-window). Focus any other app and press `Ctrl+Alt+R` then `E` — "Red in
Electrical" appears in the timeline and in the newest `.ndjson`. PowerShell
`WScript.Shell.SendKeys` can drive this (chords as `'^%r'` then `'e'`).

## Next 3 tasks

1. **Play 3 real lobbies** (Phase 1 acceptance) with the app docked on a second
   monitor. First check: do the chords work while Among Us is focused in
   fullscreen-windowed? If not → implement the `WH_KEYBOARD_LL` fallback in
   `hotkeys.rs` (ADR-009). Collect the `.ndjson` logs; they're the test data for
   tuning weights.
2. **Fix what the lobbies show**, likely: victim on body/kill chords, hide the
   prior-only % on chips, task-list picker for the common-task rule, roster
   "alone" flag on hotkey sightings (currently only via the mini-menu).
3. **Phase 2 start:** `windows-capture` frame grabber + calibration screen
   (needs William's resolution), phase detection from UI markers.

## Open questions for William

- Fullscreen, fullscreen-windowed, or windowed? (Decides whether the hotkey
  fallback and overlay mode are urgent.)
- Public randoms (translation first) or friends on a custom server (mod exporter)?
- Translation provider: DeepL free key OK?
- Monitor resolution(s) for ROI calibration.
- Skeld in-game confirmation: (a) is Clear Asteroids listed as a **long** task
  in the current build? (b) is the Cafeteria/Admin vent network's third vent in
  the hallway **in front of Shields**? Also any task timings you can time.
- Font: Fredoka is the stand-in. If you have a licence for the game's UI font,
  drop it at `src/assets/fonts/custom/ui.ttf` (git-ignored) and it's used.

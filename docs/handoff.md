# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-21, end of session 1 — Phases 0, 1 and most of 2)

**Phase 0: DONE.** **Phase 1: DONE** (manual input, engine, meeting script).
**Phase 2: WORKING LIVE** — during William's second real lobby the app, with no
clicks, started capture, saw the meeting, read the vote grid (13 names, 9 dead)
and created the match by itself. Verified from the NDJSON log and a screenshot.

### How the automatic layer works (read this before touching it)
- `capture.rs` keeps only the *latest* BGRA frame from Windows Graphics Capture
  (`windows-capture`), throttled to 200 ms. Nothing is stored or streamed.
- `watcher.rs` polls that frame at 5 Hz. For 5 small marker regions it keeps a
  dhash; when a region changes and holds for one poll it OCRs it (≈ 40 ms).
  Markers → `PhaseDetector` with hysteresis → `game://phase`. Meeting + 1.2 s →
  `roster.rs` reads the vote grid → `game://roster` (re-read every 4 s while
  changed). Ejection text that stopped animating → `game://eject`. Role card →
  `game://role`. Lobby code → `game://lobby`.
- `src/input/useGameEvents.ts` turns those into store events: first roster with
  no match → `newMatch` (me = `settings.myName` fuzzy-matched, else a picker);
  phases → `setPhase`; ejections → `ejection` event; later rosters → dead flags
  + new players. `settings.json` (`myName`, `autoCapture`) lives next to the
  match logs.
- Everything manual still works and is the fallback (hotkeys, chips, buttons).

### Verified on real frames (fixtures in `src-tauri/fixtures/screens/1920x1080/`)
- OCR: names, room code (`PFRXRG`), role card (both layouts), task list, eject
  text, meeting header. 35–60 ms per region at 2×. Only `en-US` OCR language
  is installed on William's PC (non-Latin chat needs a Windows language pack).
- Vote grid: 10/10 and 13/13 names read; dead X detected (cards are dimmed, X ≈
  R132 G61 B53); reporter badge. **Colour from icons is only reliable for strong
  hues** (blue, cyan, red…); warm colours blur (orange/yellow/banana/brown).
  Names are the identity key; the user fixes a colour with one click.
- Hotkeys with the prefix held for both keys reach the app from another window.
  Still **UNVERIFIED while Among Us itself is focused** (William has not pressed
  a chord in-game yet; the auto layer made it less urgent).

### Known gaps / bugs to fix next
- Role was read as IMPOSTOR during a meeting because "Who Is The Impostor?" sits
  inside the (now larger) role-card region. Fixed in code at the end of the
  session (`role_card = !meeting && standalone word`), **not yet seen live**.
- Two `init` lines were written for one match (listener registered twice under
  React StrictMode + two roster events racing). Guarded in code, not yet seen live.
- No game-over detection (victory/defeat screen never captured). After a game
  the match stays open; "Close match" is manual.
- Chat OCR (Phase 3) not started; `meeting_chat.png` fixture exists. Chat
  bubbles are white with black text, names above text; the panel covers the vote
  grid when open (so roster reads must skip frames with chat open — not handled).
- Overlay window (`overlay.rs`, `Overlay.tsx`) builds and is wired to the
  "Overlay" button, **never seen on top of the game yet**.
- Sabotage banner / map-open / task minigame screens are not classified; a
  minigame hides the task list, which the watcher reads as "not round" — the
  Lobby hysteresis (6 polls ≈ 1.5 s) covers short tasks only.
- Vote-grid read while the chat panel is open returns garbage names (chat text
  lands in cells) — needs a "chat open" marker (chat input box is bright green).
- `windows-capture` `WithoutBorder` fallback is UNVERIFIED (the yellow capture
  border was not observed; it may simply be off on this Windows build).

## Toolchain versions that worked (2026-10-21)

| Tool | Version |
|---|---|
| Windows | 11 Home 10.0.26200 |
| Node / npm | v24.19.0 / 12.0.2 |
| Rust (stable-x86_64-pc-windows-msvc) | rustc 1.97.1, cargo 1.97.1 |
| Tauri CLI | `@tauri-apps/cli` 2.12.3 (npm devDep) |
| VS Build Tools | 2026 (18.3.11520.95) with VC x64 tools |
| Windows SDK | 10.0.26100.0 |
| WebView2 runtime | 155.0.4283.62 |
| Among Us | v19s (build 7489), 1920×1080 borderless fullscreen-windowed on the primary monitor |

Pinned npm: `@tauri-apps/api` 2.12.4 · `@tauri-apps/cli` 2.12.3 · `react` 18.3.1 ·
`zustand` 5.0.15 · `typescript` 5.9.3 · `vite` 8.3.5 · `vitest` 5.0.5 ·
`@vitejs/plugin-react` 6.1.2. Pinned crates: `tauri` 2.12.4 · `tauri-build` 2.7.3 ·
`tauri-plugin-global-shortcut` 2.4.1 · `tauri-plugin-clipboard-manager` 2.5.0 ·
`serde` 1.0.229 · `serde_json` 1.0.154 · `thiserror` 2.0.21 · `anyhow` 1.0.104 ·
`tokio` 1.54.0 · `reqwest` 0.12.28 · `whatlang` 0.16.4 · `windows` 0.62.2 ·
`windows-capture` 2.0.1 · `image` 0.25.10 · `base64` 0.22.1.

Monitors: primary 1920×1080 at 0,0 (game); DISPLAY1 1920×1080 at −1920,82
(the app opens there: `tauri.conf.json` x −1900 y 100); DISPLAY2 720×1280 portrait.

### Dev recipes
- Demo lobby without the game: setup screen → "dev: start demo lobby".
- Frame capture loop (PowerShell, saves a PNG when the screen changes) and the
  WinRT OCR probe used this session are in the session scratchpad; the useful
  outputs are the fixtures. `cargo test --lib` runs OCR against them.
- Smoke test chords: focus Notepad, press `Ctrl+Alt+R` then `Ctrl+Alt+E`.

## Next 3 tasks

1. **Play one more lobby with the fixed build** and watch `game://role`,
   duplicate `init`, phase transitions across a full game (round → meeting →
   eject → round). Add a "chat open" marker (green input box) so roster reads
   skip those frames. Capture the victory/defeat screen and add game-over.
2. **Phase 3 chat OCR**: bubbles in `chat_panel` (meeting + lobby), dedupe by
   (sender, text), sender = name line above the text, language detect with
   `whatlang`, then the translator panel. Fixture: `meeting_chat.png`,
   `lobby_chat.png`.
3. **Streamline further**: auto-open the overlay on match start
   (`settings.autoOverlay`), hide prior-only % on chips, "found dead" from the
   roster read should also log a `bodyFound` when the reporter is known, kill
   chord victim picker.

## Open questions for William

- Does the overlay show on top of the game? (Click "Overlay" on the match
  screen during a round.) If not, we need `transparent` + `alwaysOnTop` checks
  on borderless-fullscreen.
- Do chords work while the game is focused? (`Ctrl+Alt+R` then `Ctrl+Alt+E`
  mid-round; the overlay/toast should show "Red in Electrical".)
- Set your in-game name in the settings box on the setup screen so the
  auto-roster picks "me" without the picker.
- Public lobbies seem to be your mode (two public games tonight) → translation
  (Phase 3) is next. DeepL free key OK?
- Font: Fredoka is a stand-in; the real UI face is tall/condensed. If you want
  it closer, I can swap headings to a condensed OFL face (e.g. Barlow Condensed).

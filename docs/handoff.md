# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-21, session 1)

- **Phase 0: DONE and verified on William's machine (Windows 11 Home 26200).**
  - `npm install` → `npm test` 6/6 (now 12/12 with the Phase 1 state tests) →
    `tsc --noEmit` → `vite build` all green.
  - `cargo check` + `cargo test` (3/3 Rust unit tests) green with pinned crates.
  - `npm run tauri dev` opens the 420×800 window, renders the fixture meeting
    script, and the window has `WS_EX_TOPMOST` set (checked via
    `GetWindowLong(GWL_EXSTYLE)` from PowerShell, not by eyeballing).
- **Phase 1: started.** `src/state/events.ts` (append-only event log + reducer +
  undo-as-event + NDJSON), `src/state/clock.ts` (round clock → `Stamp`),
  `src/data/maps/index.ts` (MapId → MapData). Tests in `src/state/events.test.ts`.
  Nothing wired to the UI or to disk yet.
- **What does NOT exist:** Tauri file commands (NDJSON append / presets),
  hotkey chords, Roster/Timeline/Meeting panels, lobby setup, full rule set.
  Every Windows API call in `src-tauri/src/*.rs` beyond what Tauri itself does
  is still a stub with `// UNVERIFIED:`.

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
`npm audit` = 0 (the scaffold's vite 5 / vitest 2 had esbuild + tinypool advisories; ADR-007).

### Pinned crates (exact, `src-tauri/Cargo.toml`)
`tauri` 2.12.4 · `tauri-build` 2.7.3 · `tauri-plugin-global-shortcut` 2.4.1 ·
`tauri-plugin-clipboard-manager` 2.5.0 · `serde` 1.0.229 · `serde_json` 1.0.154 ·
`thiserror` 2.0.21 · `anyhow` 1.0.104 · `tokio` 1.54.0 · `reqwest` 0.12.28 ·
`whatlang` 0.16.4 · `windows` 0.62.2 (feature list in Cargo.toml compiles as-is) ·
`windows-capture` 2.0.1 (ADR-006; same `windows` 0.62.2 as Tauri's tree).

Note: `cargo check` from the Linux sandbox was impossible; on Windows the
Tauri crate graph compiles in ~55 s cold, ~20 s warm. crates.io had a ~5-minute
outage mid-session; if `cargo` shows "spurious network error", just retry.

## Next 3 tasks

1. Phase 1.1 (finish): Tauri commands `append_match_event`, `read_app_file`,
   `write_app_file`, `list_matches`, `read_match` under `%APPDATA%/AboveThem/`;
   zustand store on top of `events.ts` that appends every event and replays on
   undo; `dev:replay` script.
2. Phase 1.2–1.4: Lobby setup panel (players, impostor count, `LobbySettings`,
   presets by lobby code), hotkey chords (Rust `hotkey://chord` → store),
   Roster + Timeline panels with 1.5 s toast + Ctrl+Z.
3. Phase 1.5–1.7: full rule set (alibi graph, contradictions, task/meeting/
   counting rules, EIG question ranking) with fixtures; Meeting panel with
   "why" expanders and claim entry; vote outcome → ejection → next round.

## Open questions for William

- Does he play fullscreen, fullscreen-windowed, or windowed? (Affects capture +
  overlay strategy; windowed on a second monitor is the easy path for Phase 1.)
- Typical lobby: public randoms (translation matters most) or friends on a
  custom server (mod exporter becomes attractive)?
- Preferred translation provider / willing to make a DeepL free account?
- Monitor resolution(s) for ROI calibration.
- Skeld map data: see Phase 1.8 — the vent list and task durations need an
  in-game check that only he can do.

# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-21)

- **Phase:** 0 — scaffold, not yet built on William's machine.
- **What exists:** docs (architecture, game integration, deduction engine,
  impostor playbook, translation, UI spec, roadmap, ADRs), domain model
  (`src/types/game.ts`), engine skeleton (`src/engine/suspicion.ts` + test),
  Skeld map data (partially verified), tactic JSON seeds, Tauri/Vite config,
  Rust module stubs, mod stub.
- **What does NOT exist:** any working capture, OCR, hotkeys, translation, or UI
  beyond a placeholder `App.tsx`.
- **Verified in the generating sandbox (Linux, Node 22):** `npm install`,
  `npm test` (6/6 engine tests pass), `tsc --noEmit`, `vite build`. Placeholder
  icon set generated with `tauri icon`.
- **NOT verified:** `cargo check` — the Linux sandbox lacks GTK, so the Tauri
  crate graph resolved (see `Cargo.lock`) but nothing compiled. The Windows-only
  `windows` crate features in `Cargo.toml` are a best guess. Every Windows API call
  in `src-tauri/src/*.rs` is a stub with `// UNVERIFIED:` markers.

## Next 3 tasks

1. Phase 0: get `npm run tauri dev` and `npm test` green on Windows. Pin versions
   in `package.json` / `Cargo.toml` once they resolve. Record versions here.
2. Phase 1: implement hotkey chords (Rust global hotkeys → Tauri events) and the
   Roster/Timeline panels. Log sightings into the store.
3. Phase 1: flesh out `src/engine/` (alibi graph + hard constraints + scoring +
   meeting script) against `src/engine/__fixtures__/skeld_match_01.json`.

## Open questions for William

- Does he play fullscreen, fullscreen-windowed, or windowed? (Affects capture +
  overlay strategy; windowed on a second monitor is the easy path for Phase 1.)
- Typical lobby: public randoms (translation matters most) or friends on a
  custom server (mod exporter becomes attractive)?
- Preferred translation provider / willing to make a DeepL free account?
- Monitor resolution(s) for ROI calibration.

## Toolchain versions that worked

_(fill in during Phase 0)_

| Tool | Version |
|---|---|
| Node | |
| Rust | |
| Tauri CLI | |
| Windows SDK | |

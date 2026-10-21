# Decision log (ADR, append-only)

## ADR-001 — Stack: Tauri 2 + Rust backend, Vite/React/TS frontend
**Date:** 2026-10-21
**Status:** accepted
**Why:** need an always-on-top transparent overlay with global hotkeys beside a
running game; WinRT OCR and Graphics Capture interop are cleanest from Rust via
the `windows` crate; React/TS is the existing toolchain. Electron rejected for
memory footprint; Python/PySide rejected for overlay + interop friction.
**Consequences:** two languages in repo; engine must stay in pure TS so the
Windows-only Rust layer never blocks testing.

## ADR-002 — Game reading: screen capture + OCR, no memory/injection/network
**Date:** 2026-10-21
**Status:** accepted
**Why:** official-server ban risk; keeps the product honest (only what's on screen);
survives game updates better than memory offsets. Optional BepInEx exporter mod
allowed in `mod/` for custom servers only, with a strict export allow-list.

## ADR-003 — "No information advantage" is a product invariant
**Date:** 2026-10-21
**Status:** accepted
**Why:** the value is better *reasoning* over visible information. Any feature
that requires hidden info is rejected at design time. Code review rule for the
mod: if a crewmate couldn't see it on screen, it doesn't get exported.

## ADR-004 — Engine is pure TypeScript with config-driven weights
**Date:** 2026-10-21
**Status:** accepted
**Why:** testable without the game; weights in `data/tactics/weights.json` so a
post-match learning loop can tune them without code changes.

## ADR-005 — Map data is explicit JSON with `_verified` flags
**Date:** 2026-10-21
**Status:** accepted
**Why:** wrong vent/visual/common-task data produces confidently wrong deductions.
Every map file carries `_verified` per section; the engine lowers weight of any
rule that depends on unverified data.

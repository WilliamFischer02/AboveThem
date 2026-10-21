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

## ADR-006 — Screen capture via the `windows-capture` crate, not raw `Graphics::Capture`
**Date:** 2026-10-21
**Status:** accepted (Phase 0; implementation lands in Phase 2)
**Why:** both options sit on the same Windows Graphics Capture API. Raw
`windows::Graphics::Capture` needs us to own the D3D11 device, the
`Direct3D11CaptureFramePool`, the `GraphicsCaptureSession`, the interop
`IDirect3DDxgiInterfaceAccess` → `ID3D11Texture2D` → staging-texture → `Map`
copy, and the dispatcher-queue thread — ~300 lines of unsafe ceremony before
the first BGRA byte. `windows-capture` 2.0.1 wraps exactly that and hands a
callback a frame with a width/height/BGRA buffer, supports capture by HWND,
lets us toggle the yellow border and cursor, and depends on `windows =
^0.62.2` — the same copy Tauri 2.12 / wry / webview2-com already pull, so no
duplicate `windows` build. Resolved and checked on 2026-10-21.
**Consequences:** we keep the `windows` crate for `Media.Ocr` /
`Graphics.Imaging` (OCR needs a `SoftwareBitmap`, which `windows-capture`
does not produce; we build it from the BGRA buffer). If `windows-capture`
stalls on a future `windows` bump, fallback is the raw API — the frame type
in `capture.rs` is ours, so callers don't change.

## ADR-007 — Frontend toolchain pinned to Vite 8 / Vitest 5 (not the scaffold's 5 / 2)
**Date:** 2026-10-21
**Status:** accepted
**Why:** the scaffold's `vite@^5` resolved to 5.4.21 → `esbuild 0.21.5`
(GHSA-67mh-4wv8-2f99: any website can hit the dev server), and `vitest@^2`
→ `tinypool` with a prototype-pollution RCE. `tauri dev` runs that dev
server every session. Vite 8.3.5 + Vitest 5.0.5 + `@vitejs/plugin-react`
6.1.2 clear `npm audit` to zero and the 6 engine tests, `tsc --noEmit` and
`vite build` all pass unchanged. React stays on 18.3.1 and TypeScript on
5.9.3 (TS 7 is the native-port rewrite; no reason to be an early adopter in
a build pipeline). All versions are exact-pinned in `package.json`.

## ADR-008 — Undo is an event; the NDJSON log is append-only
**Date:** 2026-10-21
**Status:** accepted
**Why:** `MatchState` is the reduction of the event log (`src/state/events.ts`).
Rewriting the file on undo would let disk and memory drift and lose the
record of what the user retracted. An `undo` line removes the latest
surviving undoable event at replay time, so a crash mid-match loses at most
the last line and a replay reproduces exactly what was shown.
**Consequences:** `init` can't be undone; the store replays from scratch on
undo (N is tiny); `dev:replay` is just "load the file".

## ADR-009 — Hotkey chords via RegisterHotKey with a temporary second layer
**Date:** 2026-10-21
**Status:** accepted (fallback documented)
**Why:** `tauri-plugin-global-shortcut` (RegisterHotKey) already in the tree.
Prefix chords (`Ctrl+Alt+<key>`) are permanent; on a prefix press the bare
second-layer keys (rooms, `.`, `v`, `!`, `k`, `+`, `-`) are registered for
≤ 1.5 s and unregistered on completion/timeout. Verified end to end with
Notepad focused: chords reach the app and land in the NDJSON log. Cost: for
that ≤ 1.5 s window the game does not receive those keys — acceptable, since
the user is mid-chord. UNVERIFIED with Among Us itself in fullscreen-windowed.
**Fallback:** a `WH_KEYBOARD_LL` hook thread in `hotkeys.rs` if the game
swallows RegisterHotKey events; same `hotkey://chord` contract, no frontend
change.
**Consequences:** room keys must be single characters (chord = exactly two
keypresses, per CLAUDE.md §1). `docs/UI_SPEC.md` had `b` (body) and `t`
(translator) colliding with Blue/Tan: body is now `Space`; translator moves
to Phase 3 with its own key.

## ADR-010 — Among Us look without game assets
**Date:** 2026-10-21
**Status:** accepted
**Why:** William wants the companion to look like the game (crewmate heads,
game-like font). We don't ship Innersloth assets. The crewmate is our own SVG
(`src/ui/components/Crewmate.tsx`) coloured from the palette; the font is
Fredoka (SIL OFL, bundled) with an optional git-ignored
`src/assets/fonts/custom/ui.ttf` slot that wins if present.

## ADR-011 — Automatic game reading: pull-based watcher, markers by dhash + OCR
**Date:** 2026-10-21
**Status:** accepted (live-tested once)
**Why:** William wants zero-trigger operation. A background thread polls the
latest captured frame at 5 Hz, hashes five small marker regions and OCRs a
region only when its pixels changed and settled (≈ 40 ms each). Markers drive
the phase state machine with hysteresis; roster/eject/role/lobby are emitted
as `game://*` events the frontend applies to the store. Pull-based + latest-
frame-only means a slow OCR never backs up and the game is never touched.
**Consequences:** the frontend's manual controls become fallbacks; every auto
action shows a toast with "(auto)" so mistakes are visible and undoable.

## ADR-012 — Colour classification is brightness-invariant; names are identity
**Date:** 2026-10-21
**Status:** accepted
**Why:** vote-grid icons are shaded half-bodies behind cosmetics and dead cards
are dimmed; Lab ΔE mislabelled them. Comparing the RGB *direction* (normalised
by max channel) with a saturation term and a "cannot be brighter than the
candidate" penalty gets strong hues right; warm hues stay ambiguous. So the
roster keys on OCR'd names (snapped to known names), colour is a hint the user
can correct with one click, and the engine never depends on colour.

## ADR-013 — Hotkey chords hold the prefix for both keys
**Date:** 2026-10-21
**Status:** accepted (supersedes ADR-009's temporary bare second layer)
**Why:** William plays with WASD; registering bare letters even for 1.5 s was a
risk. Both keys now carry `Ctrl+Alt`; the same physical shortcut is a colour
as first key and a room as second, disambiguated by the pending state.

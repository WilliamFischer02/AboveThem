# AboveThem — Claude Code launch prompt

Copy everything below the line into Claude Code, run from the repo root.
Later sessions: just say "Read docs/handoff.md and continue."

---

You are starting work on **AboveThem**, a Windows companion app for Among Us.
The repo you're in is a scaffold I generated; nothing has been built on this
machine yet. Your job this session is Phase 0 and the start of Phase 1.

## Read first, in this order
1. `CLAUDE.md` — project rules (especially the three non-negotiables).
2. `docs/handoff.md` — current state + next tasks + open questions for me.
3. `docs/ARCHITECTURE.md`, `docs/GAME_INTEGRATION.md`, `docs/DEDUCTION_ENGINE.md`,
   `docs/IMPOSTOR_PLAYBOOK.md`, `docs/TRANSLATION.md`, `docs/UI_SPEC.md`, `docs/ROADMAP.md`.
4. `src/types/game.ts`, `src/engine/*.ts`, `src/data/maps/skeld.json`, `src/data/tactics/*.json`.
5. `src-tauri/src/*.rs` — every Windows-specific function is a stub marked `// UNVERIFIED:`.

Then tell me, in ≤ 15 lines: what the product is in your words, the three
hard rules, and anything in the docs you think is wrong or under-specified.
Be blunt. If the Tauri/OCR plan has a hole, say so before we build on it.

## Phase 0 — make the scaffold real (do this before anything else)
1. Check toolchain: Node ≥ 20, Rust stable, Tauri CLI 2, VS Build Tools + Windows SDK.
   Tell me exactly what's missing and the one-line install for each. Don't guess versions.
2. `npm install` then `npm test`. `src/engine/suspicion.test.ts` must pass. Fix the
   engine if it doesn't — but don't weaken the tests to make them pass.
3. `cd src-tauri && cargo check`. Resolve crate versions; the `windows` crate feature
   names in `Cargo.toml` are a best guess — correct them against the version that
   resolves. If `windows-capture` is a better fit than raw `Graphics::Capture`, make
   the case and switch.
4. `npm run tauri dev` must open the placeholder window (it renders the fixture
   match's meeting script). Always-on-top must work.
5. Pin every version that worked in `package.json`/`Cargo.toml`, record them in
   `docs/handoff.md`, commit as `chore: phase 0 scaffold builds`.

## Phase 1 — manual-input companion (start if Phase 0 is green)
Work in this order; stop and update `docs/handoff.md` whenever you're about to
run out of context.
1. **Store + NDJSON log.** `src/state/store.ts` → every event appended to
   `%APPDATA%/AboveThem/matches/<ts>.ndjson` via a Tauri command. Undo = pop + replay.
2. **Lobby setup panel.** Players (color/name), impostor count, the settings in
   `LobbySettings`. Remember presets by lobby code.
3. **Global hotkey chords** per `docs/UI_SPEC.md`. Rust side emits `hotkey://chord`;
   frontend maps to `Observation` events; 1.5 s toast + `Ctrl+Z` undo. Verify the
   chords reach the app while Among Us is focused in fullscreen-windowed mode —
   if Among Us swallows them, document the workaround (e.g. windowed + second monitor).
4. **Roster + Timeline panels.** Chips with color/name/status/verdict/sus bar;
   timeline newest-first.
5. **Engine, full Phase 1 rule set** from `docs/DEDUCTION_ENGINE.md` §3–5: alibi
   graph (`alibi.ts`), contradictions (`contradictions.ts`), task rules, meeting/claim
   rules, counting/endgame logic, expected-information-gain question ranking. Every
   rule = one small function returning `EvidenceItem[]` + a Vitest case. Extend
   `src/engine/__fixtures__/` with at least one 2-impostor fixture and one
   "insufficient info → skip" fixture.
6. **Meeting panel** rendering `MeetingScript` with "why" expanders showing the
   evidence chain, plus manual chat-claim entry (location / companion / task /
   accusation) feeding the contradiction engine.
7. **Vote outcome entry** → ejection → counting update → next-round reset.
8. **Verify Skeld map data** against the live game (rooms, adjacency seconds, vents,
   visual/common tasks, durations) and flip `_verified` flags. Ask me to confirm
   anything you can't verify yourself; do not guess.

## Working agreements
- Blunt, candid feedback. If a design in the docs is bad, propose the fix and why.
- Structured replies: TL;DR → what you did → what's next → questions. Checklists.
- Never claim it runs unless you ran it. `// UNVERIFIED:` on anything you couldn't.
- No information advantage, ever. If a feature needs hidden game state, reject it
  and offer the legit version.
- Update `docs/handoff.md` at the end of the session. Append ADRs to
  `docs/decisions.md` for any architecture change.

Start with the toolchain check and your ≤ 15-line read-back.

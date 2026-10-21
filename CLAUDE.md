# CLAUDE.md — AboveThem project context

You are working in **AboveThem**, a Windows companion app for Among Us built by
William Fischer (Goob Entertainment Co.). Read this file fully before touching code.

## 0. Session protocol

1. Read `docs/handoff.md` first — it holds the current state and the next task.
2. Read `docs/decisions.md` before changing architecture. Append, never rewrite.
3. At the end of every session, update `docs/handoff.md` (state, what changed,
   next 3 tasks, open questions). This is non-negotiable.
4. Never claim something builds or works unless you ran it. If you can't run it
   (e.g., Windows-only API in a non-Windows sandbox), say so explicitly and leave a
   `// UNVERIFIED:` comment.

## 1. Non-negotiable product rules

- **No information advantage.** The app only uses what the local player can see
  on their own screen. Never read game memory, never inject into the stock client,
  never sniff packets, never surface roles/positions/anything hidden. If a
  feature idea needs hidden info, it's out — say so and propose the legit version.
- **Evidence-traceable reasoning.** Every suspect score, every suggested line in a
  meeting script, every "safe lie" must link back to logged observations. The UI
  must be able to show *why*.
- **Speed over completeness during a round.** Logging an observation must take
  ≤ 2 keypresses or 1 click. Rounds are 60–120 seconds; meetings are 15–120 s.
  Anything slower won't get used.
- **Fail soft.** If OCR misses the chat or a name, the app keeps working with
  manual input. OCR is an accelerator, not a dependency.

## 2. Stack & conventions

- **Tauri 2 + Rust** backend; **Vite + React + TypeScript** frontend.
- `src/engine/` is **pure TypeScript, no DOM, no React, no Tauri imports**. It
  must be unit-testable with Vitest. All game reasoning lives here.
- `src/types/game.ts` is the canonical domain model. Change it deliberately and
  update all consumers in the same commit.
- Map data lives in `src/data/maps/<map>.json`. Mark anything unverified with
  `"_verified": false` and a `"_note"`. Never silently guess vent connections or
  visual tasks — wrong map data produces wrong deductions.
- Tactics/playbook content lives in `src/data/tactics/*.json`, structured so the
  engine can select entries by situation, not just display a wall of text.
- Rust side: one module per concern (`capture.rs`, `ocr.rs`, `regions.rs`,
  `translate/`, `hotkeys.rs`, `ipc.rs`). Expose Tauri commands with a thin layer;
  keep logic testable.
- Prefer `// UNVERIFIED:` markers over confident guesses for Windows-API code you
  couldn't run.
- Commits: conventional commits (`feat:`, `fix:`, `docs:`, `chore:`).

## 3. Formatting for William

- Blunt, candid. If an idea is bad or a lib is a dead end, say so and why.
- Structured output: TL;DR first, then headings/bullets/checklists.
- Teach tiered: big picture → details, when explaining something new.

## 4. Where things are

| Need | File |
|---|---|
| Current state / next task | `docs/handoff.md` |
| System design | `docs/ARCHITECTURE.md` |
| How we read the game (OCR regions, colors, optional mod) | `docs/GAME_INTEGRATION.md` |
| Crewmate reasoning model | `docs/DEDUCTION_ENGINE.md` |
| Impostor deception model | `docs/IMPOSTOR_PLAYBOOK.md` |
| Chat translation pipeline | `docs/TRANSLATION.md` |
| Overlay UI + hotkeys | `docs/UI_SPEC.md` |
| Phases + acceptance criteria | `docs/ROADMAP.md` |
| Domain model | `src/types/game.ts` |
| Engine entry points | `src/engine/*.ts` |

## 5. Definition of done (per feature)

- [ ] Engine logic has Vitest coverage for the happy path and ≥ 1 edge case
- [ ] Works with manual input even if OCR is off
- [ ] Any new tactic content is structured JSON, not prose in a component
- [ ] `docs/handoff.md` updated

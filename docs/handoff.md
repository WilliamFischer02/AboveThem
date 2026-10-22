# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-22, session 5 — overnight multi-agent build)

Seven parallel agents (chat NLU, suspicion engine, UI, maps, research, features, bugs/Rust)
worked ~90 minutes each in git worktrees; the lead merged everything into `main`, built the
release exe and pushed. Per-agent notes live in `docs/notes/<agent>.md` — read the one for the
area you touch. Tests: **Vitest 585** (72 at the start of the night), **Rust 52 + 1 ignored**
(31 at the start). `npm run check` = tsc + vitest + `cargo test --lib`.

**Nothing from tonight has been seen in a live game.** Every number below the fold is
unit/fixture/log-replay tested only. First live session: watch the toasts and the NDJSON diag lines.

### Launching
`npm run tauri dev` (hot reload). Release: `npm run tauri build` →
`src-tauri\target\release\abovethem.exe` (standalone; the desktop shortcut
`AboveThem.lnk` points at it) and the MSI under `src-tauri\target\release\bundle\msi\`.

### What changed tonight (by area)

**Chat → evidence (ADR-025, `src/engine/chatNlu/`, `chatProfile.ts`, `src/data/chatLexicon.json`).**
Every chat line becomes `ChatAssertion`s (accuse / clear / withMe / sawTask / sawVent / sawKill /
location / selfReport / voteCall / skipCall / question / defense / noise …) with polarity,
strength (hedges / "100%"), parse confidence, the quoted span and a why-trace. Context across a
meeting: "White and Black" + "was with them" = a clear; answers to "who"/"where"; pronouns and
"u"; later lines supersede earlier stances. Lexicon: colour shorthand (6 languages), room/task
aliases for all 5 maps, OCR digit fixes, run-together words. `chatClaims.ts` is a thin wrapper.
`speakerProfiles(m)`, `voteCalls(m, meeting)`, `meetingTranscript(m, meeting)` for the UI.
`unreadable` lines yield nothing; `xlatGuess` lines get ×0.7 confidence.

**Suspicion engine (ADR-024, `src/engine/suspicion.ts` + `chatEvidence.ts`, `voting.ts`,
`feasibility.ts`, `pairs.ts`, `history.ts`, `marks.ts`).** Whole-game score: social evidence
weighted by speaker credibility (diminishing returns across independent accusers; an
impostor's accusation is a mild clear; eyewitness lies implicate the speaker), voting rules,
kill feasibility over travel times (≥ 30 % slack, unknown rooms never convict), mutual-alibi
pairs, per-category decay with half-lives, impostor-count normalisation, per-meeting `trend` /
`delta`, `summary`, `baseline`, evidence sorted by |weight|. User marks carry a **reason**
(`SUS_REASONS` / `CLEAR_REASONS`, each with its own weight in `weights.json`). Roles:
`LobbySettings.roles` (Engineer ⇒ a seen vent is +2.5 soft, not a hard fact; Shapeshifter ⇒
seen-kill identity shaky). Visual hard clears use `task.visual` from the map JSON (MIRA =
Submit Scan only). Whole-window "with me" is a hard clear only after the toggle was turned off
("left me"); an open toggle is soft −3. Calibration: 4 scripted games + replay of all 77 real
logs (`__fixtures__/replayLogs.test.ts`, skipped without the matches folder; warm `scoreAll`
≈ 38 ms worst case).

**UI (`src/ui/`).** Card menus open in a portal, clamped to the window (bug 1 fixed). SUS/CLR
opens a 3-second "Why?" strip (click or digit 1–9; Enter / timeout = plain mark; Esc cancels;
pure machine in `src/ui/reasonStrip.ts`). Suspicion bar per card with trend arrow, one-tap
"why" list (category icons, 💬 = what others said), sort by suspicion or grid order
(remembered). Situational headline (`src/engine/headline.ts`): Critical Vote (from
`meetingMath`: a wrong eject loses now), "One wrong vote from critical", One/Two/Three Major
Suspects with ordered headshots, Not Enough Info | Skip, Confirmed Impostor, I'm Dead;
`meetingScript.vote` is the headline's vote, so header and vote card never disagree. Vote
folded into the meeting header. Top bar = brand · phase pill · ☠ · ⋯ menu (phases, focus
mode, overlay, rescan/reset, close, tips; red dot when capture/watcher is down). One column at
380 px, two at ≥ 820 px. "What you can check" chips from `map.info` (cams/admin/vitals/door
log). Transcript view (by speaker, assertion badges) in the expanded chat dock. Roles chips in
setup. Engine exceptions no longer blank the window (status line instead).

**Features (`src/engine/features/`, `src/ui/components/features/`, `docs/FEATURES.md`).**
Kill-cooldown clock + per-body kill window (could / could-not lists, vent-aware); meeting
math (plurality, tie ⇒ nobody, win condition); last-seen board; admin / cams / vitals / MIRA
door-log one-tap loggers (`adminRead`, `vitalsRead`, `doorLogRead` observations) with
monitor-vs-claim contradictions; vote tracker (manual, the only source of `Vote`s) + bandwagon
/ voting-pair analysis; task-bar tracker; task-claim verifier against `lieChecks.json`;
meeting timer + prep checklist; round plan (task route). All work with OCR off (task picker,
room chips). `FeatureSlots` mounts once in `MatchScreen.tsx` above the roster (compact under
820 px).

**Maps (`src/data/maps/*.json`, `src/engine/map.ts`, `mapChecks.ts`, `mapQuestions.ts`).**
MIRA HQ, Airship, Fungle are complete (rooms, adjacency with eyeballed seconds, vent networks
with links, tasks with `visual`, `MapInfo`: admin/security/vitals/doorLog/sabotages/features/
spawn/dummyPanels). Helpers: `travelMatrix`, `fastestSeconds`, `couldReach` (fails soft),
`ventShortcutNote`, `walkPath`, `claimedTaskExists`, `commonTaskMismatch`,
`monitorContradiction` (+ `monitorReadFromObs`), `selectMapQuestions` (`questions.json`,
6–8 questions + lie notes per map). **Map detection never worked before tonight**: the Rust
`map_name` rect only covered the "ROOM SETTINGS" label (now reads the map logo through a
tolerant `map_id_of`, UNVERIFIED on all but the Skeld fixture) and the TS side lost the map
on every lobby-code re-subscribe (fixed; also infers the map from room/task labels).

**Research (`docs/GAME_KNOWLEDGE.md`, `src/data/tactics/lieChecks.json`, `gameFacts.json`,
`chatSlang.seed.json`, `IMPOSTOR_PLAYBOOK.md` §7).** Sourced mechanics (F / F1 / H / U tags),
61 lie checks (46 linked to crew.json situations, `wiredIn` names the engine rule), per-map
question guide, slang in 6 languages, settings presets, OCR confusions.

**Bugs / Rust (`docs/notes/bugs-rust.md`).** Russian chat: only `en-US` OCR is installed (Cyrillic
reads as Latin garbage), `translate::detect` returned 3-letter codes so Google failed silently,
`looksEnglish` wasn't script-aware, empty bubbles were dropped. Now: bubbles are found from
pixels, unreadable ones are shown with "⚠ can't read: install the Russian OCR pack" and a
look-alike guess ("≈ guess"), extra installed OCR languages are tried per bubble, ISO codes
fixed, failures write `diag` lines. Also fixed: event listeners re-registered on every lobby
code / name keystroke (lost events, wiped state); watcher panic left it "running" forever;
capture picks the window titled exactly "Among Us" and restarts after 20 s without frames;
hotkeys register one by one (taken keys reported); ejection → round fallback after 5 s
(UNVERIFIED); `gridOrder` match bonus; clock back-dated by detection lag; duplicates merge
instead of delete; reducer `default` + `parseLines` robustness; roles reach auto-created
matches; impostor templates never leak `{A}`.

### Known gaps / next (ordered)
1. **Live verification of everything above** — one game on Skeld, one on MIRA. Watch for:
   "Map: … (auto)" toast; `rosterSize` / `mergePlayers` lines; headline tone changes; the
   reason strip; feature cards folding at 380 px; `diag` lines (`captureStart`, `watcherStalled`,
   `chatUnreadable`, `translateFailed`).
2. **Duplicate cards still happen** in real logs ("cherry e" ×2, "iesusgoat" ×2 in
   `2026-10-22_07-57-38`): evidence and chat split between twins. Fix in `rosterConsolidate`
   (`sameIdentity`), not in the engine.
3. **Weights are hand-set**, calibrated on scripted games + sanity-checked on real logs. Tune from
   real outcomes (ejection results are in the logs).
4. Map logo OCR for MIRA / Polus / Airship / Fungle has no fixture — capture one lobby frame per map.
5. Travel seconds are eyeballed on every map (`_verified.durations=false`; Airship / Fungle
   probably 20–30 % short). Real fix: log room changes with timestamps live, take medians.
6. Victory / defeat screen still never captured (colour fallback UNVERIFIED).
7. Chat parser re-parses the whole meeting on each new line (25–40 ms at 60 lines); make it incremental.
8. Undo also removes automatic OCR events (design call for William).
9. No automatic vote reading — the vote tracker is manual (tap the name, then each voter icon).
10. `roles` has no lobby-OCR source; only the setup chips set it.

## Toolchain (unchanged): Node 24.19, Rust 1.97.1, Tauri 2.12.4, windows 0.62.2,
windows-capture 2.0.1, Vite 8.3.5, Vitest 5.0.5. Among Us v19s 7489, 1920×1080 borderless
on the primary monitor; app on the left monitor. Only `en-US` OCR is installed.

## Open questions for William
- Install the Russian OCR pack (Settings → Time & language → Language & region → Add Russian →
  Optional features: OCR) and capture one Cyrillic chat frame as a fixture?
- Default kill cooldown: the wiki says 45 s, `presets.ts` uses 30 s — which do your lobbies use?
- Should undo skip automatic (OCR) events and only undo your own inputs?
- Did any merge toast ("merged X → Y") name two real people? Did the roster stay at the lobby size?

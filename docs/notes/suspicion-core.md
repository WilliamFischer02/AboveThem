# suspicion-core: notes for the lead

Branch `worktree-agent-a2f688ccde7282462`, worktree `C:\dev\AboveThem\.claude\worktrees\agent-a2f688ccde7282462`.

## TL;DR
The suspicion meter is now a whole-game, credibility-weighted, count-normalised score with decay,
trend/delta, a one-line summary and a sorted "why" list. 118 tests green (72 at baseline), tsc clean,
`npm run build` OK. The model is documented in `docs/DEDUCTION_ENGINE.md`, with an ADR appended to `docs/decisions.md`.

**Branch base:** my worktree was cut from the stale `origin/main` (71c2c1b). I fast-forwarded it to
local `main` (7bf75ba) before any work. I have since **merged `main` twice** (maps ×3, ui-streamline,
bugs-rust, research; three merges in total). Conflicts resolved: `src/engine/marks.ts` = mine (ui-streamline's was a stub; I added
their type re-exports and a string-tolerant `reasonInfo`), and ui-streamline's `src/engine/chatNlu.ts` file stub is
deleted because it shadowed my `src/engine/chatNlu/` folder stub (same `parseMeetingChat` export, which Transcript.tsx uses).

## What I did
- **Marks with reasons (b2)**: `src/engine/marks.ts` exports `SUS_REASONS`, `CLEAR_REASONS`, `markObservation`,
  `markToast`, `markHistory`, `reasonInfo`. `ManualMarkObs.reason?: MarkReason` (additive). Different reasons stack,
  the same reason in one round counts once, a direction switch replaces, neutral wipes. `userMarks` still works
  for Roster.tsx and now also returns `reason`.
- **Every signal**: social (accusations / vouches / eyewitness, credibility-weighted, diminishing), voting (`voting.ts`),
  feasibility (`feasibility.ts`: `killWindow` with cooldown, `killFeasibility`, vent-only / impossible with margin trust),
  unaccounted-in-kill-window, at-body-with-only-reporter, silence, witness contradictions, ejection outcomes
  (pushed vs merely voted), skip-when-impostor-found, critical-vote skip, minority vote blocs, recurrence across rounds,
  mutual alibi pairs, dead accuser, chat-nlu profile tells (location changes, same-meeting flips).
- **Carry-over (c)**: decay per category, trend (one point per completed meeting, via `history.snapshotAtMeeting`,
  memoised), `delta`. Merge invariance tested (`dynamics.test.ts` › "roster merges keep the evidence").
- **Explainability**: evidence sorted by |weight|, `topReasons(score, n)`, `summary`, `baseline`.
- **Calibration**: `__fixtures__/sim.ts` (builder + 3 scripted games with answer keys) + `calibration.test.ts`.
- **Game knowledge** (research relay): first cooldown 10 s, the cooldown restarts at meeting end, 30 % travel slack,
  `two_together_one_dies`, `visual_off_clear` / `visual_wrong_map`, `task_not_on_map`, `fix_is_not_clear`
  (sabotage clear lowered to −0.4), `mutual_pair`, `dead_accuser`, `story_changed`, `flip_when_countered`.

## Merge instructions (important)
1. **chat-nlu**: my branch has STUBS at their paths: `src/engine/chatNlu/index.ts` and `src/engine/chatProfile.ts`.
   On the add/add conflict **take theirs**. Then replace the body of `src/engine/chatNluTypes.ts` with
   `export type { ChatAssertion, ChatAssertionKind, ChatReason, ChatResolution, SpeakerProfile, StanceFlip } from '../types/game';`
   (it compiles either way; the copied shapes are identical to their game.ts block).
   Their `parseAllChat` + `activeAssertions` and `speakerProfiles` are what `suspicion.chatAssertions` and the
   profile rules call. Double counting is handled: Claim records whose `chatLineId` the NLU read are skipped.
   **Check after merge:** chat-nlu's `ChatAssertion.about` is an ARRAY. `repoint` in `src/state/events.ts` only repoints
   arrays named withPlayers / present / fixers, but assertions are derived from chat on demand (never stored), so merges are still safe.
2. **maps**: DONE on this branch. `mapAdapter.ts` re-exports their `hasMapData`; `ventAssistedSeconds` calls their
   `fastestSeconds(..., {vents: true})`. Task rules use `claimedTaskExists` (dummy panels, tasks from another map,
   unknown names fail soft) and `commonTaskMismatch`; `ruleMonitorReads` uses `monitorContradiction` for Admin / Vitals
   reads vs TIMED location / sighting claims (untimed chat claims are never checked: Admin is a snapshot). I kept my own
   interval-based feasibility (several sightings bracket a window) rather than `couldReach` (one point-to-point check).
   I did not mark travel evidence `shaky` for unverified durations: the 30 % slack plus margin trust already absorbs
   eyeballed seconds, and halving on top would make real contradictions nearly worthless.
3. **features**: their `killWindows(m)` (`couldNot` = vent-aware physical clear) overlaps my `killFeasibility`.
   Mine scores (−1.5 × margin trust for "no", +2.0 × trust for vent-only) and is wired into scoreAll; theirs is
   presentation. Do not wire both into the score. Their `voteAnalysis.votingPairs` / `bandwagons` overlap
   `voting.ruleMinorityVoteBloc` and `pairs.impostorPairs`. Mine feed the score; theirs can stay UI-only.
   Their `vitalsRead` observations narrow the kill window (`vitals_timing`: victim OK at t ⇒ window starts at t;
   DED at t ⇒ ends at t), read structurally in `feasibility.vitalsReads` so it compiles before their merge. `adminRead`
   feeds `ruleMonitorReads`.
4. **ui-streamline**: contract in `relay/from-suspicion-core.md`. `meetingScript.ts` untouched. All tests pass with it.
5. `weights.json` was re-serialised (2-space JSON) when I added sections; values of existing keys are unchanged except
   `categoryCap.manual` 2→3 and `sabotage.fixedSabotageWithMe` −0.8→−0.4.

## Unverified / honest caveats
- Weights are hand-set and calibrated only on 3 scripted games I wrote. They are a sanity check, not a measurement.
  Feed real match logs into `sim.ts`-style fixtures (the Phase 5 learning loop) before trusting the decimals.
- The trend re-scores snapshots with *today's* weights and rules: it shows how the evidence built up, not what the
  app displayed at the time.
- Normalisation means a player's probability rises when others are cleared, even with no evidence of their own.
  That is correct, but the UI should show `baseline.label` ("1 impostor left among 3 unresolved") next to the number.
- With 1 impostor, my own with-me toggle through the whole kill window makes a player certain crew. If the user forgets
  to toggle "left", the edge runs to the end of the round. That was already the case for the −3 clear; now it is hard.
  A stale toggle is the main risk.

## Bad ideas I did not implement
- "Bandwagon late votes": the vote screen has no order or timing, so this can't be done without hidden info.
- "Momentum" as an extra weight on a rising score would double-count the same evidence. I implemented it as
  `trend` / `delta` (display), plus a *recurrence* bonus for suspicion in separate rounds (independent signals).

## Research corrections (applied)
- `LobbySettings.roles` (additive). Engineers on ⇒ a seen vent is +2.5 soft, not a hard impostor. Shapeshifter on ⇒ a seen
  kill is still hard but its identity is marked shaky. **Needs a UI control / lobby OCR to set it**; nobody sets it yet.
- Visual hard clears only for tasks with `visual: true` in THIS map's JSON (MIRA asteroids are not); no task id ⇒ hard
  but shaky. A "visual" confirmation of a non-visual task ⇒ −0.3 soft.
- Kill window lower bound = round start + cooldown (10 s at match start), already in `killWindow`.
- Not done: a loader for research's `lieChecks.json`. Its ask/say lines are meeting-script material (ui-streamline owns
  meetingScript.ts / headline.ts); the checks I could ground in logged data are implemented as rules (see knowledge.test.ts).

## Verified against chat-nlu's real parser
I copied chat-nlu's modules into my tree temporarily (not committed) and ran real chat lines through `scoreAll`.
Shapes match, and it found three gaps that I fixed: own-location lines now count as "placed" for the unaccounted rules;
"X was near <body room>" becomes a reasoned accusation; "X self-reported" when I logged X finding the body with
others implicates the speaker. `__fixtures__/nlu_integration.test.ts` skips while the stub is in place and runs
automatically after the merge.

## Next ideas
- Two-bodies-within-cooldown ⇒ two killers (`double_kill_gap`) once vitals give death times.
- Per-reason weights learned from post-match role reveals (Phase 5).

## Round 2 (after chat-nlu merged)
- `chatNluTypes.ts` is now a re-export of chat-nlu's game.ts types. `nlu_integration.test.ts` runs (no longer skipped).
- **Real-log replay** (`__fixtures__/replayLogs.test.ts`): 77 logs, 3,448 events, `scoreAll` after every one. No throws,
  no NaN, probabilities in [0, 1], refs everywhere.
  - Speed: the worst warm call was 213 ms. Cause: every trend snapshot re-parsed its chat (chat-nlu caches by array identity),
    and the snapshot cache key included names, which OCR rewrites constantly.
  - Fix: one per-meeting parse cache on my side; snapshots reuse the full state's reading; the key drops names.
    Worst warm call is now ~38 ms, all of it chat-nlu re-parsing the *current* meeting after a new line or a roster rename
    (62 lines ≈ 25–40 ms). **For chat-nlu:** an incremental per-line parse would get this under 5 ms.
  - Nonsense found and fixed: "said nothing while others talked" fired 221 times, and "nobody vouches for them" fired for
    most of the lobby. OCR misses lines and users log little, so both now need the player to stand out (silence ≤ ⅓ of the
    lobby, unaccounted ≤ ½).
  - **Not mine, for bugs-rust / roster:** duplicate cards in real games ("cherry e" ×2, "iesusgoat" ×2 in 07-57-38). They split
    evidence, and chat gets attributed to the duplicate (the known killer's twin "vouched" for someone).
- **Stale with-me:** in a 1-impostor lobby the kill-window clear is hard ONLY when the user turned the toggle off after the
  window and was alive. A toggle still on at the report gives soft −3, labelled "(toggle still on)". `KillClear.openEnded` is new.
- **Dedupe:** any Claim whose `chatLineId` is a line chat-nlu read (even as a question / superseded) is skipped; hand-typed
  claims still count. Tested with the real parser.

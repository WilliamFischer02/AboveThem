# suspicion-core: notes for the lead

Branch `worktree-agent-a2f688ccde7282462`, worktree `C:\dev\AboveThem\.claude\worktrees\agent-a2f688ccde7282462`.

## TL;DR
The suspicion meter is now a whole-game, credibility-weighted, count-normalised score with decay,
trend/delta, a one-line summary and a sorted "why" list. 118 tests green (72 at baseline), tsc clean,
`npm run build` OK. The model is documented in `docs/DEDUCTION_ENGINE.md`, with an ADR appended to `docs/decisions.md`.

**Branch base:** my worktree was cut from the stale `origin/main` (71c2c1b). I fast-forwarded it to
local `main` (7bf75ba) before any work, so my commits sit on top of 7bf75ba.

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
2. **maps**: `src/engine/mapAdapter.ts` holds a local `hasMapData`; after merge, replace its body with
   `export { hasMapData } from './map';`. I did NOT switch to `couldReach` / `fastestSeconds`: my feasibility needs an
   interval check over several sightings (not one point-to-point reach), and my `ventAssistedSeconds` duplicates their
   `fastestSeconds(map, a, b, {vents: true})`. Dedupe later by swapping the inner call (one line in feasibility.ts).
   I did not mark travel evidence `shaky` for unverified durations: the 30 % slack plus margin trust already absorbs
   eyeballed seconds, and halving on top would make real contradictions nearly worthless.
3. **features**: their `killWindows(m)` (`couldNot` = vent-aware physical clear) overlaps my `killFeasibility`.
   Mine scores (−1.5 × margin trust for "no", +2.0 × trust for vent-only) and is wired into scoreAll; theirs is
   presentation. Do not wire both into the score. Their `voteAnalysis.votingPairs` / `bandwagons` overlap
   `voting.ruleMinorityVoteBloc` and `pairs.impostorPairs`. Mine feed the score; theirs can stay UI-only.
   Their new `adminRead` / `vitalsRead` observations are ignored safely (no exhaustive switches). **Next idea:** a
   vitals read showing V alive at t narrows V's kill window to [t, report] (`vitals_timing`).
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

## Next ideas
- vitals / admin reads to narrow kill windows and clear players (features agent's observations).
- Two-bodies-within-cooldown ⇒ two killers (`double_kill_gap`) once vitals give death times.
- Per-reason weights learned from post-match role reveals (Phase 5).

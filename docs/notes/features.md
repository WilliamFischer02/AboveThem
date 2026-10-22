# features: notes for the lead

Branch: `worktree-agent-a9421cbf3aa9cc879`. Worktree: `C:\dev\AboveThem\.claude\worktrees\agent-a9421cbf3aa9cc879`.
The branch started on stale 71c2c1b. I reset it (empty) to local main 7bf75ba, then merged main at e3da4ca (maps + ui-streamline) in `dda52c3`.

## TL;DR
- 9 pure engine modules in `src/engine/features/`, each with Vitest tests: 6 from the brief, 2 stretch items, and the lie checks I picked from the research catalogue.
- 12 self-contained cards in `src/ui/components/features/`. They mount through one `<FeatureSlots />`, and every style rule lives in `src/ui/features.css`, scoped under `.feat`.
- Tests: 196 passing (72 at baseline, 192 after the main merge). `tsc --noEmit` is clean, `npm run build` is OK.
- I rendered round, discussion and voting at 380 px in headless Edge with a temporary harness that seeds the Skeld fixture (not committed). No feature card overflows horizontally. I did **not** run the real Tauri/WebView2 window.

## Mount (re-apply if MatchScreen changes again)
```tsx
import { FeatureSlots } from '../components/features/FeatureSlots'; // features
{/* features */}<FeatureSlots />     // in .area-main, directly above <Roster scores={scores} />
```
FeatureSlots picks the cards by phase:
- **Round:** KillClock, RoundPlan (crew), TaskBar (bar = Always), Security, LastSeen.
- **Meeting:** MeetingPrep (timer + checklist), Count, KillWindow (+ double kills), AdminCheck, TaskClaims, LastSeen, Votes.
- **Ejection:** Votes.

## Modules
| Module | What it answers | Lie checks / facts |
|---|---|---|
| `killWindow.ts` | When kills become possible this round. Per body: window [lo, hi], and who could or could not have been there | 10 s first cooldown (sourced). lo = max(cooldown, last seen alive incl. vitals OK); hi = report or vitals DED. Impostor travel = walk + vents, times **0.7 slack**. `doubleKills()`: two deaths closer than one cooldown means two killers |
| `meetingMath.ts` | Alive/dead, impostor bounds, crew deaths to loss, critical vote, votes that guarantee an ejection, `tally()` | Plurality: a tie (including with skip), or skip ≥ the top name, ejects nobody. Impostors win at ≥ crew. A running game caps impostors below alive/2 |
| `lastSeen.ts` | Last room, time, kind and company per player; staleness 0–3; their latest location claim kept separate; `byRoom`; `unplacedThisRound` | — |
| `security.ts` | Station availability (`map.info` first, local fallback table second). Builders for adminRead, vitalsRead (DED/D-C) and cams/door-log sightings (real rooms only). `adminChecks()`. `commsDown()` | admin_count_mismatch, monitors off during comms |
| `voteAnalysis.ts` | Vote matrix, bandwagons, same-pair voting, voter records, `makeVote` | bandwagon, pair tell |
| `taskCheck.ts` | Watched player plus a one-tap task-bar observation. Per-claim verdicts | task_not_on_map, task_not_in_room, dummy_panel (from map.info), common_not_dealt, visual_unseen, bar_no_move (multi-stage caveat), bar_moved_alone, visual_off_clear, visual_wrong_map |
| `meetingPrep.ts` | Discussion/voting countdown. Checklist of what the meeting script does not already say (`opts.full` adds the overlapping items) | — |
| `roundPlan.ts` | My tasks as a route: dead-end tasks inside the no-kill window first, visual tasks flagged, bar = Always tip | Research §3.1 "risky tasks right after a meeting" |
| `util.ts` | `impostorTravelSec` (wraps maps' `fastestSeconds` with vents; null means unknown room), `TRAVEL_SLACK`, interval maths, `mapInfo` | — |

## Shared-file changes (all additive)
- `src/types/game.ts`: `| AdminReadObs | VitalsReadObs` appended to the `Observation` union. Both interfaces are at the end of the file. `VitalsReadObs.dc?` is optional. suspicion-core / chat-nlu also append to game.ts; the conflict is textual only, so keep both blocks.
- `src/state/events.ts`: `PLAYER_LIST_KEYS` gained `'dead', 'alive', 'dc'`, so `mergePlayers` repoints vitals reads (tested).
- `src/state/store.ts`: two `describe()` cases for the new observation types.
- `src/ui/screens/MatchScreen.tsx`: the two marked lines above.

## Things the lead must know
- **Two "critical vote" rules exist.** ui-streamline's `headline.ts` uses `crew − impostors ≤ 2`. `meetingMath.wrongVoteLoses` is exact: a wrong ejection loses when `crew − 1 ≤ impostors`. Example: 7 alive with 2 impostors is 5 crew, so headline says critical while meetingMath says one more death of slack. Unify them on `meetingMath` (or at least make the headline say "careful", not "critical").
- **KillWindow `couldNot` is a vent-proof physical clear** for that kill. suspicion-core could turn it into a per-kill clear. It is display-only today, so nothing is double-counted.
- `taskClaimChecks` is also display-only. contradictions.ts already scores task_not_in_room and common claims.
- Votes: OCR never dispatches `vote` events. The VoteTracker is the only source, and it is manual: tap the name once, then tap each icon under it.

## Unverified
- Hallway camera to nearest-room mapping in the fallback table (only used when `map.info` is absent). With `map.info`, camera spots are the maps agent's `covers`.
- Whether admin shows bodies. `AdminReadObs.bodies` exists but no rule uses it.
- Kill-window travel uses eyeballed walk times. The 0.7 slack follows the research advice; tune it once durations are measured.
- The meeting timer depends on phase wall times (OCR or button), so it is about ±2 s.
- Real WebView2 rendering, the same caveat ui-streamline has.

## Next ideas
1. Feed `KillWindow.couldNot` and `doubleKills` into suspicion-core as per-kill clears.
2. `vitals_timing` lie check: a claim of finding the body before a vitals read that showed the victim OK.
3. A door-log sensor-to-room table for MIRA once mira.json pins the sensor corridors.
4. Hotkeys for task bar moved / still (action keys belong to the hotkeys owner).

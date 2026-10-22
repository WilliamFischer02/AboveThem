# Feature cards

## TL;DR

`<FeatureSlots />` (one line in `MatchScreen.tsx`, above the roster) shows a small stack of cards for the current phase. Each card:
- reads the match store itself and renders nothing when it has nothing to say;
- works with **screen reading off**: every input is a tap, and phases come from the manual phase buttons;
- works **without `map.info`**: there is a local fallback table;
- keeps its reasoning in a pure module in `src/engine/features/` (Vitest-covered), with every line traceable to observation/claim ids (hover a line for its refs).

| Phase | Cards (top to bottom) |
|---|---|
| Round (alive) | Kill clock · Route · Task bar (bar = Always) · Security · Last seen |
| Round (ghost) | Security · Last seen |
| Meeting | Before the vote · Count · Kill window · Monitor check · Task claims · Last seen · Votes |
| Ejection | Votes |

Nothing here uses hidden information. Inputs are what you saw (your taps, the hotkeys, screen reading of your own screen), what people typed in chat (logged claims), and lobby settings. Map facts come from `src/data/maps/*.json` and the research catalogue (`docs/GAME_KNOWLEDGE.md`, `src/data/tactics/lieChecks.json`).

---

## ⏱ Kill clock (round)
- **Shows:** when the first kill of this round becomes possible ("in 0:12" / "now, since 0:25"). For each impostor you saw kill, the earliest possible next kill.
- **Reads:** the round clock (`state/clock.ts`), `settings.killCooldownSec`, and `sawKill` observations this round.
- **Taps:** none. It starts when the round starts: the ▶ Round button, or automatically with screen reading.
- **Map facts:** none.
- **Game facts:** the first cooldown of the match is 10 s; every meeting and every kill resets it to the lobby value. The cooldown pauses in vents and on cams, so "next kill" is a lower bound.
- **Engine:** `killWindow.ts` → `killClock`, `cooldownForRound`.
- **Unverified:** round time comes from the phase change. If the round-start detection is late, the clock is late by the same amount.

## 🧭 Route (round, crew, alive)
- **Shows:** your unfinished tasks as a walking route. Dead-end-room tasks go first, inside the no-kill window right after a meeting. Visual tasks are flagged "do it with someone watching". With bar = Always, it suggests a single-stage task to finish in front of someone. ETA per stop.
- **Reads:** `myTasks` (screen reading **or** tapped in), your last `myRoom`, else the spawn / meeting room.
- **Taps:**
  - No tasks yet: open the card, tap your tasks, then **Save my tasks**. "edit my tasks" reopens the picker.
  - No start room: tap a room chip ("Where are you?").
- **Map facts:** rooms, adjacency seconds, `deadEnd`, task rooms / visual / `stageDurationSec`. `map.info.spawn` and `emergencyButton` are optional; without them the start falls back to Cafeteria (Skeld, MIRA), Office (Polus) or Meeting Room (Fungle). Airship has no default (you pick a spawn).
- **Engine:** `roundPlan.ts` → `roundPlan`, `startRoom`.
- **Unverified:** walk and task durations are eyeballed (`_verified.durations: false`). Multi-room tasks with no stage room read from the screen are listed as "Location unknown".

## ▮ Task bar (round, alive, lobby task bar = Always)
- **Shows:** who you are watching (the player you placed most recently, or an open with-me) and two buttons: **moved ✓** / **still ✗**.
- **Reads:** sightings, `sawTask` and `withMe` this round, and your `myRoom`.
- **Taps:**
  - One tap on moved or still as they finish. This logs a `sawTask` with `taskBarMoved`.
  - Tap the name to switch who you are watching.
  - If no room is known, tap a room chip.
- **Map facts:** task `stages`. Multi-stage tasks only move the bar on their last stage, and Task claims takes that into account.
- **Engine:** `taskCheck.ts` → `watchedPlayer`, `taskBarObservation`. The suspicion rule `ruleTaskObservations` scores the observation.
- **Unverified:** two people finishing at the same moment can muddy it. The tooltip says so.

## 🖥 Security (round)
Tabs appear only for stations the map has. With `map.info` they follow it; without it they use `SECURITY_FALLBACK` (sourced from research §1.8, nearest-room mapping ours).

| Map | Admin | Cams | Vitals | Door log |
|---|---|---|---|---|
| Skeld | ✓ | ✓ (4 hall cams) | — | — |
| MIRA HQ | ✓ | — | — | ✓ |
| Polus | ✓ | ✓ (6) | ✓ | — |
| Airship | ✓ (Cockpit, Records) | ✓ (6 views) | ✓ | — |
| Fungle | — | binoculars (Beach, Jungle) | ✓ | — |

- **Admin.** Tap a room for +1, right-click for −1, then **Log admin**. This creates an `adminRead { counts }`.
  - Icons are anonymous, include players inside vents, and do not cover hallways or Polus Outside (`adminCovers`).
  - Whether admin shows bodies is **unverified**; no rule uses `bodies`.
- **Cams.** Tap the spot once (it stays selected), then tap each player you see. Each tap is an ordinary `sighting` with note `cams: <spot>`, and only real map rooms are accepted.
- **Vitals.** Each tap cycles OK → **DED** (killed since the last meeting, body still out) → **D/C** (no body: earlier death, ejected or left). Then **Log vitals**. This creates a `vitalsRead { dead, alive, dc }`, and DED players are marked dead in the roster.
- **Door log (MIRA).** Optionally tap a sensor, tap everyone the log lists, then **Log door log**. This creates a `doorLogRead { entries, from, to }`. An empty log is evidence too.
  - Entry times are the read time, because the log shows order, not exact times.
  - The read covers the time since the previous door-log read this round.
- A red warning shows while a Comms sabotage you logged is running: every station is off except Fungle's binoculars.
- **Engine:** `security.ts`.
- **Unverified:** the hallway-camera → nearest-room mapping in the fallback table. Airship Hall of Portraits is treated as covered by admin.

## 👁 Last seen (round + meeting)
- **Shows:** the summary line groups this round's placements by room ("Storage: Red, White · MedBay: Blue · ?: Purple"). Expanded, it is a table with, per player:
  - last room (and heading) and time / age;
  - how you placed them: seen, with me, task, vented, at report…;
  - company;
  - staleness, shown as fading;
  - their latest *claimed* location, kept apart because it is lower trust.
- **Reads:** sightings, with-me, `sawTask`, `sawVent`, `sawKill`, `bodyFound` and location claims.
- **Taps:** none. It fills from your normal logging (hotkeys, roster card ⋯ menu, cams).
- **Map facts:** room names only.
- **Engine:** `lastSeen.ts` → `lastSeenBoard`, `byRoom`, `unplacedThisRound`.

## 📋 Before the vote (meeting, alive)
- **Shows:**
  - A countdown for discussion, then voting. Under 15 s it shows **VOTE NOW** and only the top two items.
  - A short checklist of what the meeting script does not already say:
    - critical-vote warning;
    - kill-window clears ("Blue could not have killed Yellow");
    - "only X, Y could have reached the body";
    - players nobody placed this round (ask them first);
    - vote bookkeeping.
  - "say ⧉" copies a ≤ 70-char chat line.
- **Reads:** the phase wall time, `discussionTimeSec` / `votingTimeSec`, and the other feature modules.
- **Taps:** none (copy buttons are optional). The timer starts from the manual "Body" / "Meeting" button just as well as from screen reading.
- **Engine:** `meetingPrep.ts` → `meetingTimer`, `prepChecklist` (`{ full: true }` adds the items the meeting script already covers).
- **Unverified:** ±2 s, depending on when the meeting was registered.

## 🧮 Count (meeting)
- **Shows:**
  - alive / dead / impostors left (a range when confirm ejects is off);
  - correct ejections the crew still needs;
  - how many more crew deaths (kills or wrong votes) the crew can absorb;
  - **CRITICAL** when a wrong ejection, or a skip followed by one kill, ends the game;
  - "N votes = out": a strict majority on one name guarantees the ejection.
- **Rules (sourced):**
  - Most votes is ejected.
  - A tie (including a tie with skip), skip ≥ the top name, or no votes ⇒ nobody is ejected.
  - Impostors win when they equal or outnumber the crew.
  - A running game also caps impostors below alive / 2.
- **Reads:** player statuses, ejections (`wasImpostor`, "N remain"), `impostorCount`, phase.
- **Taps:** none (statuses come from the roster).
- **Engine:** `meetingMath.ts` → `meetingMath`, `impostorBounds`, `tally`.

## ☠ Kill window (meeting, one per body this round)
- **Shows:**
  - The window [lo, hi] in which the kill happened. lo = the later of the kill cooldown and the last time you saw the victim alive (sightings, with-me, tasks, vitals OK). hi = the report, or an earlier vitals read showing the victim dead.
  - **Could have killed** and **Could not** (with the reason: "with me since 0:03", "seen in Nav at 0:40, 12 s away even by vent").
  - **⚔ two killers** when two deaths were certainly less than one cooldown apart.
- **Travel model:** walk + vent hops (maps' `fastestSeconds`), then × 0.7 slack because walk times are eyeballed. A "could not" therefore survives both "they vented" and "your timings are off".
- **Reads:** `bodyFound`, sightings, `withMe`, `sawTask`, `vitalsRead`, ejections, cooldown.
- **Taps:** none beyond normal logging. The body is logged via the hotkey or the roster menu.
- **Map facts:** adjacency seconds, vent networks.
- **Engine:** `killWindow.ts` → `killWindows`, `killWindowFor`, `doubleKills`, `summarizeKillWindow`.
- **Unverified:** walk times (hence the slack). Display only: suspicion does not score it yet.

## 🖥 Monitor check (meeting)
- **Shows:** your monitor reads vs this round's chat claims:
  - **admin**: more people claim a room than admin showed, admin showed an empty room someone claims, or icons nobody accounts for;
  - **vitals**: someone "saw" a player alive after vitals showed them DED/D-C;
  - **door log**: a claimed walk across MIRA's Hallway with no log entry. Shaky: vents skip the sensors.
- **Reads:** `adminRead` / `vitalsRead` / `doorLogRead`, plus claims. Claims need a time window; claims logged with a time ("~0:40") get ±10 s.
- **Taps:** log the reads (Security card) and the claims (meeting panel "Log a claim"). Nothing else.
- **Engine:** `security.ts` → `adminChecks` (ours: counts vs claimants) and `monitorChecks` → maps' `mapChecks.monitorContradiction` via `obsToMonitorRead`.
- **Map facts:** admin coverage, vitals / door-log availability. Without `map.info`, maps' check stays silent for the door log (fail soft).

## 🔧 Task claims (meeting)
- **Shows:** one verdict per task claim or visual-task clear, each with the evidence ids, the catalogue check id, and an "ask ⧉" question:
  - FAKE: task not on this map / not in that room / dummy panel / a common task you were not dealt;
  - clear invalid: visual clear with visuals off (scan excepted) / task not visual on this map;
  - doubtful: watched a visual task with no animation; bar did not move on a single-stage task;
  - ask: a visual task nobody watched;
  - confirmed: you saw the visual, or the bar moved;
  - plausible.
- **Reads:** claims (`task`, `clear`), `myTasks` (screen **or** tapped in the Route card), `sawTask` observations, `visualTasksOn`, `taskBarMode`.
- **Taps:** none beyond logging claims.
- **Map facts:** task rooms / kind / `visual` / `stages`; `map.info.dummyPanels` (optional).
- **Engine:** `taskCheck.ts` → `taskClaimChecks`. The check ids are verified against `lieChecks.json` by `lieCheckCoverage.test.ts`.
- **Display only:** suspicion scores task_not_in_room and common claims itself.

## 🗳 Votes (meeting folded; open in voting / ejection)
- **Shows:** a vote tally under the in-game rule, a per-meeting voter × meeting matrix, and notes:
  - "X + Y voted the same name in 3/3 meetings, never each other";
  - "X piled onto Y without saying why — and they were crew".
- **Taps:** match the results screen. Tap the name that got votes (it stays selected), then tap each icon under it: one tap per voter. A re-tap replaces that voter's vote.
- **Off when** the lobby has anonymous votes: the screen hides who voted for whom.
- **Engine:** `voteAnalysis.ts` → `voteMatrix`, `bandwagons`, `votingPairs`, `voterRecords`.

---

## Lie checks implemented by the cards

`src/engine/features/lieCheckMap.ts` maps 16 catalogue ids to the feature functions that implement them:
- visual_unseen, visual_wrong_map, visual_off_clear
- common_not_dealt, task_not_on_map, task_not_in_room, dummy_panel
- bar_no_move, bar_moved_alone
- cooldown_window, double_kill_gap
- admin_count_mismatch, admin_blind_spot, vitals_timing, doorlog_contradiction
- bandwagon

They are deliberately **not** written into `lieChecks.json` `wiredIn`, which means "scored by suspicion". These are display-only.

## Observation types added for the cards
`AdminReadObs`, `VitalsReadObs` (`dc?` optional) and `DoorLogReadObs` sit at the end of the `Observation` union in `src/types/game.ts`. The Timeline shows them as "🖥 admin read: 2 in Electrical (2 icons)", "🖥 vitals: Red DED · 5 OK" and "🖥 door log 0:10–1:05: Blue". Merges repoint every player id inside them.

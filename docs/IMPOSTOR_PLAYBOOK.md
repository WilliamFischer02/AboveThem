# Impostor playbook engine

## TL;DR

Impostor mode is three tools plus a coach:

1. **Lie ledger** — every claim you make (location, companion, task) is recorded.
   The engine checks every new claim against the ledger *and* against what you
   actually observed, and flags anything that could be caught.
2. **Alibi generator** — proposes alibis built **only from things you really saw**
   (real people in real rooms at real times), so they are consistent with what
   other players will say. The best lie is a true sentence with one word changed.
3. **Fake-task planner** — picks what to fake, where, and for how long, using the
   map's task table, durations, and the lobby's task-bar/visual-task settings.
4. **Defense coach** — when you're accused, serves the 1–2 strongest responses for
   that specific accusation type, using your ledger and the room's current
   suspicion landscape.

Nothing here needs hidden info; it's the crew engine inverted.

---

## 1. Lie ledger

```
Claim { t, meetingIndex, type: location|companion|task|sighting|accusation,
        content, basedOn: [observationIds], risk: 0..1, dependsOn: [claimIds] }
```

- Every claim gets a **risk score**: how many alive players could contradict it,
  weighted by whether they're hard-cleared (a cleared player's contradiction is
  fatal) and whether they were plausibly in position to see.
- **Dependency tracking:** if claim B only makes sense if claim A is true, and A
  gets contradicted, the ledger flags B as "now exposed" and suggests a repair
  line or a pivot before the next meeting.
- **Consistency check** runs when you type a draft claim in the overlay (or click
  a template): "Last meeting you said you were in Nav at ~1:00. This claim puts
  you in Storage at 0:55. Travel time Nav→Storage is ~12 s. **Conflict.**"

---

## 2. Alibi generator

Input: your real sighting log for the round (yes, you log as impostor too — it's
the same two keystrokes). Output: ranked alibis.

Ranking criteria (all computed from map data + sightings):
1. **Corroborable:** names a companion who was *actually* there (they'll confirm
   without realising they're clearing you). Highest value.
2. **Unfalsifiable:** names a room you were near with nobody who could say you
   weren't there, and a task that exists in that room on this map and is on
   *your* fake list.
3. **Timing-consistent:** travel time from your alibi room to the kill room is
   ≥ the time between your alibi window and the kill, *or* the alibi window
   ends after the kill window started (so you'd "not have had time").
4. **Low-contradiction:** no hard-cleared player was in the alibi room during the
   window.

Examples the generator should produce:
- *"I was in Weapons doing asteroids — visual, wait no, visuals are on. Skip."*
  (Generator must refuse visual tasks when visuals are on.)
- *"Shields then Comms — passed Blue in the hallway around 0:40."* (Blue really
  was there; you logged it.)
- *"With Cyan in Cafeteria at the start, then I went down to Admin for card
  swipe."* (Cyan was with you; card swipe is a common task you can fake because
  it's on everyone's list; nobody was in Admin.)

Every generated alibi displays its **weak point** ("Only risk: if anyone was in
Admin 0:50–1:05") so you choose with eyes open.

---

## 3. Fake-task planner

Uses `data/maps/<map>.json` + lobby settings:

| Rule | Reason |
|---|---|
| Never fake a **visual** task when visuals are ON | It's the #1 way impostors get hard-caught |
| Prefer faking **common tasks** (they're on everyone's list) and tasks from your own displayed fake list | Faking a task nobody has is near-hard evidence |
| Stand for the task's real **duration** ±15 % (durations in map data) | Too short/long is a tell to anyone watching |
| If task bar = **always**, avoid "finishing" in front of a watcher | Bar won't move; use multi-stage tasks (wires, download/upload) where the bar legitimately wouldn't move yet |
| Fake in **dead-end rooms** sparingly; fake in **through-traffic rooms** for witnesses | You want to be *seen doing nothing suspicious*, not seen alone in corners |
| Route plan: fake-task route that passes near crew clusters, ends near a kill opportunity | The planner proposes a route; you don't have to follow it |

The planner outputs a short ordered route with per-stop durations and a one-line
"story" you can later repeat verbatim as an alibi — the route *is* the ledger
pre-filled.

---

## 4. Kill & sabotage timing (coach)

- **Kill cooldown timer** (manual: tap `k` when you kill; app counts down the
  lobby's cooldown). Shows when the next kill is available.
- **Witness radius check:** before a kill, tap the colors you can see → app tells
  you who could plausibly walk in within ~5 s given room adjacency.
- **Lights kill:** when lights go down, the coach reminds (a) crew vision is
  reduced but yours isn't, (b) kill *away* from Electrical because everyone
  converges there, (c) your alibi becomes "I was going to fix lights".
- **Comms:** hides task bar + cameras + task list. Use to mask a "finished task"
  claim that the bar would contradict.
- **Reactor/O2:** forces a split; the coach suggests which half to be in given
  where your partner is and where the last body was.
- **Vent discipline:** a vent trip is only "safe" if both ends are unobserved; the
  app shows vent endpoints for your current room from map data. Never vent to a
  room with a cleared player in it.
- **Self-report:** coach scores it: good when you'd be found near the body
  anyway, or the body is in a room you'd have a task reason to enter; bad in
  dead-ends with no task reason. The crew engine's `self_report` weight is the
  mirror of this.
- **Double-kill / partner:** if a partner is set, the app tracks their last claimed
  location so your stories don't collide, and warns if you're about to hard-clear
  each other too loudly (pair tells).

---

## 5. Defense coach — accusation taxonomy

Each entry in `data/tactics/impostor.json` has: `trigger` (what they said),
`best_responses` (ranked, templated with ledger data), `avoid` (what sounds
guilty), `followup` (what to do with the room afterwards).

| Accusation type | Core response strategy |
|---|---|
| "Where were you?" | Answer *first*, specific, with a companion from the ledger, then ask the accuser the same. Precision reads as innocence. |
| "You were near the body" | Own it instantly ("yeah, I came from Weapons"), give the task reason that exists on the map, then redirect: "who else was in that hallway?" — pull from your real sightings. |
| "You were alone" | "So were X, Y and Z" — list uncleared players who were actually alone per your log. Never say "so what". |
| "I saw you leave Electrical" | If accuser is uncleared: "I was never in Electrical — were *you*?" and pin them to the kill room. If accuser is hard-cleared: concede the location, not the kill: "I walked past, yes — body wasn't there yet." Then timing. |
| "You faked a task" | Ask which task, exactly. Vague accusations collapse under specificity. If they name one you logged as faked in a watched spot, pivot to "that task has two stages". |
| "You didn't vote with us" | "I skipped because nobody had info, not because of who it was." Then offer a real observation to buy credit. |
| Partner is being voted | Do **not** hard-defend. Mild doubt + alternative ("I'd rather vote Green on the Nav thing") then vote with the majority if it's lost. Pair tells are fatal. |
| 50/50 you vs. crew | Push *information*, not emotion: "If I'm the impostor, who killed in Reactor while I was with Blue?" Use any kill you were provably away from. |

Universal rules the coach always surfaces:
- Say less. Short, specific, calm. Explainers get voted.
- Offer one **true** hard clear of a crewmate early (you know they're crew). It's
  the cheapest trust you'll ever buy and it steers votes away from you.
- Ask questions that make crew suspect each other; never pile on your partner.
- Never contradict the ledger. If a lie is dead, pivot, don't double down.

---

## 6. Ethics / scope note

Among Us is a social deduction game; lying is the mechanic. The coach helps you
lie *well inside the rules*, using only what's on your screen. It does not and
will not use anything hidden.

---

## 7. What strong impostors actually do (research, 2026-10-22)

> Added by the research agent. Sources: [Guide:Impostor](https://among-us.fandom.com/wiki/Guide:Impostor),
> [Guide:Faking tasks](https://among-us.fandom.com/wiki/Guide:Faking_tasks), [Guide:Crewmate](https://among-us.fandom.com/wiki/Guide:Crewmate),
> [marinating](https://www.sportskeeda.com/esports/marinating-friends-among-us), mechanics in `docs/GAME_KNOWLEDGE.md` §1.
> Everything here is public strategy; nothing needs hidden info. Each play lists the **crew-side tell** so the crew
> engine can anticipate it (one table serves both modes).
> Tags: **F** mechanic fact, **H** community heuristic, **⚠** works but is lobby-hostile (kicks/bans): the coach may
> *recognise* it for the crew engine but should never *suggest* it.

### 7.1 Mechanics the impostor coach must respect (F)

| Mechanic | Coach consequence |
|---|---|
| Kill cooldown = 10 s at match start, full value after every kill and every meeting; paused in vents and on cams | Countdown starts at meeting end. The first cooldown only runs once you spawn: dismiss the "SHHHHHH" screen and pick the Airship spawn fast. Show "kill ready at mm:ss". |
| Vitals show DED the moment you kill; Noisemaker alerts everyone; Scientist has portable vitals | Self-report risk goes up on Polus/Airship/Fungle and when Scientist/Noisemaker are enabled. Comms blinds vitals. |
| Admin shows people inside vents; it has no hallways and no Polus Outside | Never sit in a vent in a room someone could be watching on admin (MIRA: no admin blind spot has a vent). |
| Cams blink red while a living player watches | Check a camera's blink before killing near it. Ghost viewers don't blink. |
| MIRA doorlog logs your real identity at the three hallway sensors (even shifted) | Venting across the hallway shows as "entered here, never left there". |
| Report ends critical sabotage, not lights/comms; the button is blocked during any sabotage except doors and Mushroom Mixup | Post-kill sabotage = delayed report + blocked button. |
| Impostors can fix sabotages; ghost impostors can still sabotage | "I fixed lights" is not a clear for anyone. |
| Common tasks appear on your fake list | Only claim commons from the fake list; never claim a visual with visuals on; never fake Submit Scan even with visuals off (the scanner shows "Waiting for <name>" to real crew). |
| Dummy panels (Skeld Reactor divert, Polus Office divert, Airship Armory/Comms/Vault wiring, Lounge bin) | The fake-task planner must never route you to them. |
| Download/Upload ≈ 9–11 s; Inspect Sample needs a 60 s wait | Stand the real duration (existing ±15 % rule). |

### 7.2 Play catalogue → crew-side tell

| Play | What the impostor does | Crew tell / counter (crew engine) | Tag |
|---|---|---|---|
| Kill + far sabotage | Kill, then call a critical sabotage on the opposite side (or shut the body room's doors) and vent away | Critical sabotage after a quiet spell ⇒ sweep the opposite side; who reached the fix late, from where | H |
| Lights kill | Lights, kill a lone crewmate far from Electrical, vent into a group, stay until the report | Who joined the group during lights without being seen arriving; vent animations show outside vision (not Polus) | H |
| Stack kill | Kill inside a 4+ player pile at a fix point or common task | Only players *outside* the stack are cleared; ask each stack member who stood next to the victim | H |
| Self-report | Report own kill with a pre-built route + task reason | `self_report_instant`, `self_report_no_reason`, `report_wrong_direction` (lieChecks) | H |
| Marinate | Stay with one crewmate for rounds to earn a vouch, use it later | A vouch from one long-term companion is a soft clear only (multi-impostor) | H |
| Group with partner | Two impostors alibi each other | `mutual_pair`; ask a third player to confirm | H |
| Bus the partner ⚠ | Vote out / accuse own partner once they're lost | Confirm-eject reveal: who pushed hardest *after* the case was already made | H ⚠ |
| Last-second weak defense | Defend a crewmate weakly so they get ejected, then point at the confirm-eject | Trust gained without evidence; weigh it at most as a soft clear | H |
| Fake role claim | Claim Engineer (excuse a vent), Scientist (excuse a fast report), Tracker/Detective/Noisemaker | Role claims are checkable: is the role enabled, how many slots, counter-claims, a "Noisemaker" whose death never alerted | H |
| Shapeshift frame | Shift into P, kill in front of a witness, then "remind everyone about Shapeshifters" | With Shapeshifter on, kill sightings are not hard; a report made while shifted shows the true skin | H |
| Phantom vanish | Vanish (cloud in own colour) to escape | Cloud colour = impostor; "vanished in a dead-end" may be Phantom, not a vent | F/H |
| Viper acid + far sabotage | Body dissolves (default 15 s) | Missing body + dead on overview ⇒ Viper; time of death bounded by dissolve time | F |
| Doors trap (Skeld) | Shut a room's doors, kill inside, vent out | Who was in that room when doors closed; Skeld doors reopen after 10 s | H |
| Decontamination kill (MIRA/Polus) | Kill a lone crewmate in decon early, exit the other side / vent (MIRA) | Who entered decon right before; early-round decon trips | H |
| AFK kill ⚠ | Fake AFK at spawn, kill the last crewmate to leave | "AFK" players at spawn are not cleared; an AFK that moves is a tell | H ⚠ |
| Kill when caught | A witness runs for the button; impostor sabotages (blocks the button) or shuts doors and chases | A crewmate who dies right after seeing something; their last known path | H |
| Target the info players | Kill hard-cleared crew, cams/admin/vitals users, Detectives, the best talkers first | A hard-cleared crewmate dying is expected, not evidence against anyone | H |
| Keep the scapegoat alive | Never kill the crewmate the lobby already suspects | "Most-suspected player still alive after 3 rounds" is weak evidence *for* them | H |
| Colour confusion | Accuse "green" when Green and Lime are both alive, re-target after the eject | Demand full colour names; confusable pairs: Brown/Maroon, Lime/Green, Rose/Pink, Banana/Yellow, Coral/Orange, Tan/Brown | H |
| Anonymous-vote fishing | Vote a random crewmate, then ask "who voted X?" | Low-value talk; ignore | H |
| Doorlog misdirection (MIRA) | Kill one of two crewmates who crossed a sensor together, so the log implicates the survivor | The log shows crossings, not kills; two names together ≠ guilt | H |
| Task-over-vent kill | Pop out of a vent next to someone doing a task over it, kill the other crewmate, report, accuse the task-doer | Was the accused facing a task screen? Task UIs cover most of the screen | H |
| Endgame count | At 2 crew left: sabotage to block the button, kill when cooldown ends. With 2 impostors: double kill at 4 crew | Crew must meet immediately at 3–4 alive; never skip when one kill ends it | F (win rule) / H |
| Hold at 7 with 2 impostors | Don't kill; build trust; keep 4 crew votes in play | A quiet round at 7 alive is itself information | H |

### 7.3 New coach rules derived from the catalogue

- **Kill-ready clock** (F): `readyAt = meetingEnd + cooldown + timeInVents + timeOnCams`. Crew mirror: the `cooldown_window` lie check.
- **Monitor awareness** (F): before suggesting a kill room, check the map's monitors: cams (Skeld 4 hallways, Polus 6 feeds, Airship 6 views), admin (rooms only), vitals (Polus Office, Airship Medical, Fungle Lab), doorlog (MIRA hallway), binoculars (Fungle Beach + Jungle, not blinded by Comms). If one covers the room or its exit, suggest Comms first.
- **Claim filter** (F): reject any generated alibi or task claim that would trip a `lieChecks.json` check with `confidence: "hard"` (visual with visuals on, common not on the fake list, task not in that room or map, dummy panel, wrong fix location, Airship spawn outside the set, monitor during comms).
- **Map notes** (H): Skeld: Electrical vents to MedBay/Security; Lights pulls everyone to Electrical, so kill elsewhere during lights. MIRA: one vent network, admin has no blind spot with a vent, doorlog in Comms. Polus: silent vents, admin blind Outside, doors need manual switches. Airship: pick the spawn fast; Gap Room vents are a tell if seen; ladders are heard map-wide. Fungle: no admin or cams; binoculars cover Beach + Jungle and survive Comms; Mushroom Mixup hides names from crew for ~10 s and does not block the button.
- **⚠ plays** (bussing, fake AFK, betraying a partner who fails a double kill, flooding chat with irrelevant talk): recognise them for the crew engine; never propose them in impostor mode.

### 7.4 Data mapping

- New accusation templates (`impostor.json` → `accusations`): `saw_you_vent`, `visual_not_seen`, `common_task_callout`, `monitor_callout`, `too_fast_task`, `story_changed`, `stack_kill_blame`. `classifyAccusation` in `src/engine/impostor.ts` does not route to them yet (owner: engine agent). They use `{TASK2}` (a second fake-list task) and `{X}` (a real nearby player) placeholders; lines with unfilled placeholders are skipped by `complete()`.
- New rule lists (`impostor.json` → `deception`): `sabotage_rules`, `monitor_rules`, `kill_window_rules`, `chat_rules`, `endgame_rules`.
- Crew counterparts: `crew.json` situations (`cooldown_window`, `double_kill`, `monitor_during_comms`, `vitals_timing`, `doorlog_check`, `cams_check`, `admin_check`, `two_of_same`, …) and `lieChecks.json`.

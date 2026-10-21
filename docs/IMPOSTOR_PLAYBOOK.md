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

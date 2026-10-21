# Deduction engine (Crewmate)

## TL;DR

The engine is a small **constraint + evidence** system over ≤ 15 players:

1. **Hard constraints** settle players outright (vent seen = impostor; visual task
   seen = crew; ejected impostor; etc.).
2. **Soft evidence** moves a log-odds suspicion score with explicit weights, every
   contribution kept as an `EvidenceItem` so the UI can show *why*.
3. **Alibi graph** (who was with whom, where, when) propagates clears and
   contradictions.
4. **Meeting script generator** turns the top uncertainties into ranked
   *questions to ask*, *statements to make*, and a *vote recommendation* with
   confidence — in under a second, so it's ready when the meeting opens.

Everything below is implementable from `src/types/game.ts`. Nothing requires
hidden information.

---

## 1. Inputs (what we know)

| Source | Event types |
|---|---|
| Your eyes (hotkey/click) | `Sighting` (player, room, t), `WithMe`, `SawTask` (visual/non-visual), `SawVent`, `SawKill`, `BodyFound`, `Followed`, `Left/Entered` |
| OCR | `Roster`, `Phase`, `Chat`, `Ejection`, `Sabotage`, `OwnTasks` |
| Chat (clicked to log) | `Claim` (player claims location/companion/task/accusation), `Accusation`, `Defense`, `Vote` (if votes visible) |
| Lobby settings (entered once, remembered per lobby code) | impostor count, kill cooldown, visual tasks on/off, confirm ejects on/off, anonymous votes, task bar mode, player vision |

---

## 2. Hard constraints (certainties)

Applied first; they short-circuit scoring.

| Constraint | Effect |
|---|---|
| You saw X vent | X = **Impostor** (certain) |
| You saw X kill | X = **Impostor** |
| You saw X complete a **visual** task with animation (MedBay scan, asteroids, shields, garbage chute, submit scan) and visual tasks are ON | X = **Crew** |
| Ejection text "X was The Impostor" (confirm ejects ON) | X = Impostor, impostors-remaining − 1 |
| Ejection text "X was not The Impostor" | X = Crew (and re-weight everyone who pushed that vote: see §4.5) |
| Body found in room R at time t, X was continuously **with you** from before the kill-window until t | X = Crew for that kill (window clear) |
| Kill cooldown math: body freshly found at t, impostor killed at t_k ≥ t − fresh_window; X was in your sight for all of [t_k − ε, t] | X cleared for that kill |
| N impostors remain and N players are already certain impostors | everyone else = Crew |
| N impostors remain, P alive, and (P − certain_crew) == N | all uncertain = Impostor |

"Cleared for that kill" ≠ "cleared" when `impostors ≥ 2` — the engine tracks
clears **per kill event**, then intersects. A player cleared for every kill so
far is a *hard clear*; cleared for some is a *soft clear*.

---

## 3. Soft evidence (weights)

Score is log-odds, `s = Σ w_i`. Prior `w₀ = ln(N_imp / (N_alive − N_imp))`.
Weights are **config, not code** (`src/data/tactics/weights.json`) so they can be
tuned from real match logs later. Starting values (positive = more sus):

### 3.1 Movement / positioning
| Evidence | w | Rationale |
|---|---|---|
| Last seen heading toward the body's room within the kill window, not with anyone | +1.2 | proximity + opportunity |
| Seen leaving body room right before report | +1.5 | |
| Reported the body while alone with no witness of arrival ("self-report" pattern) | +0.8 | classic; stronger if body was in a dead-end room |
| Reported a body in a room they had no task reason to be in (per map task table) | +0.6 | |
| "Stacking" — repeatedly near the same player who later dies | +0.7 per instance | |
| Roamed without stopping at task stations (you watched them for ≥ 8 s) | +0.6 | impostors wander |
| Stood at a task station noticeably longer/shorter than that task's known duration | +0.5 | duration mismatch (see map data `taskDurations`) |
| Was out of sight for the entire round with no one vouching | +0.4 | unverifiable |
| Walked with you toward a group then peeled off when more crew appeared | +0.4 | |

### 3.2 Task behavior
| Evidence | w |
|---|---|
| Claims a task that does not exist at the claimed location on this map | +2.0 (near-hard) |
| Claims a **common task** that *you* don't have (common tasks are identical for all crew) | +2.5 (near-hard; impostors fake common tasks they weren't dealt) |
| Claims "did wires" twice in the same panel, etc. (task-logic impossible) | +2.0 |
| Task bar did not move while they "finished" a task in front of you (task bar = always) | +1.0 |
| Task bar *did* move right as they finished in front of you | −1.0 |
| Doing a visual task without the animation (visuals ON) | +3.0 (hard-ish) |
| Fake-task animation mismatch (e.g. "medbay scan" claimed, no scan beam) | +3.0 |

### 3.3 Meeting behavior
| Evidence | w |
|---|---|
| Accuses someone with no stated evidence ("just vibes") | +0.4 |
| Changes their story between meetings (contradiction engine) | +1.5 per contradiction |
| Contradicted by a *hard-cleared* witness | +2.0 |
| Pushes hard to vote a player who turns out crew (confirm ejects ON) | +0.9 |
| Defends a player who turns out impostor | +0.8 |
| Votes for a player who turns out impostor | −0.6 |
| Immediately echoes the first accusation ("bandwagon") with nothing added | +0.3 |
| Switches vote at the last second to the losing side's target | +0.5 |
| Asks "where was everyone" rather than offering their own location first | +0.2 |
| Gives a precise, falsifiable alibi that nobody disputes | −0.5 |
| Gives a specific location + companion that the companion *confirms* | −1.0 (plus alibi edge) |
| Silent in meetings where they were near the body | +0.5 |
| Skips vote on a 2-impostor-remaining critical vote | +0.4 |

### 3.4 Sabotage behavior
| Evidence | w |
|---|---|
| Lights off → body appears → X arrives at Electrical *after* lights fixed from an odd direction | +0.6 |
| Reactor/O2 called, X did not head to fix and is unaccounted for | +0.5 |
| Comms sabotaged right after a visual task was announced | +0.4 (whoever benefits) |
| X was with you fixing a sabotage the whole time | −0.8 (per sabotage) |

### 3.5 Structural (impostor-pair inference, 2+ impostors)
| Evidence | w |
|---|---|
| Two players never vote for each other across ≥ 3 meetings while voting others | +0.4 each |
| X hard-defended Y; Y later confirmed impostor | +1.2 for X |
| Confirmed impostor's alibi was "with X" and X agreed at the time | +1.5 for X |

Weights are capped per category so one noisy category can't swamp the rest.

---

## 4. Alibi graph

Nodes = players. Edges = `(a, b, room, [t₀, t₁], source)` meaning "a and b were
together". Your own sightings produce edges to **you** (highest trust). Claims
produce *pending* edges that become *confirmed* when the other party agrees and
*contradicted* when they don't.

### 4.1 Propagation rules
- **Kill-window clear:** for each death with estimated window `[t_k⁻, t_k⁺]`, any
  player with a trusted edge to a hard-cleared player covering the window is
  cleared for that kill.
- **Chain of trust:** trust flows along confirmed edges from hard-cleared players,
  decaying by 0.7 per hop and never exceeding 1 hop from an *uncleared* claimant.
- **Contradiction:** `Claim(a: "was with b in R at t")` and `Sighting(b in R' ≠ R at t±ε)` by
  a trusted source → contradiction event, +w to `a` (and a flag on `b` if `b`
  *agreed*).
- **Dead player's last known position** is a strong anchor: whoever you last saw
  near them gets a proximity edge to the death.

### 4.2 Geometry (from map data)
Each map JSON has rooms, adjacency with travel seconds (normal speed), vent
networks, task locations, visual tasks, common tasks, task durations. Used for:
- **Reachability:** could X physically reach the body room from where you saw
  them within the window? If not → cleared for that kill *unless* a vent connects
  the two (then flag "vent-reachable only").
- **Vent-only explanations:** if the *only* way X could have gotten from A to B
  in time is a vent → +2.0 (near-hard).

---

## 5. Meeting script generator

Runs on every state change; cheap. Output structure (`MeetingScript`):

```
{
  headline: "Prime suspect: Red (72%) — alone near Electrical body, contradicted by Blue",
  ask: [
    { to: "Red", q: "Where were you at ~0:50? I saw you leaving Electrical toward Storage.", why: [evidenceIds] },
    { to: "Blue", q: "Can you confirm Green was with you in Nav before the report?", why: [...] },
    { to: "all", q: "Who has Wires in Admin? Yellow claims it — I don't have that common task.", why: [...] }
  ],
  say: [
    "I was in MedBay with Cyan the whole round — Cyan did scan, Cyan is clear.",
    "Body was in Electrical. Last people I saw heading that way: Red (alone), Green (with Blue)."
  ],
  vote: { target: "Red", confidence: 0.72, alternative: "skip", reason: "..." },
  watch: ["If Red claims they were in Storage, that contradicts Blue's sighting at 0:48", "If Purple bandwagons Red with no info, note it"]
}
```

### 5.1 Question selection
Ranked by **expected information gain**: prefer questions whose plausible answers
would most change the top-2 suspects' scores. Concretely, for each candidate
question, enumerate 2–3 likely answers, score the delta each would cause, take
the max-min. Keep it simple; N is tiny.

Templates live in `src/data/tactics/crew.json` keyed by situation
(`body_in_dead_end`, `self_report`, `common_task_claim`, `visual_task_check`,
`lights_kill`, `last_seen_with_victim`, `two_left_endgame`, …).

### 5.2 Statement selection
Always lead with (1) **your own hard clears** — they're the most valuable thing
you can give the lobby, (2) your own precise location+companion (pre-empts being
accused), (3) the single strongest observation. Three lines max. People don't read.

### 5.3 Vote recommendation
- Vote if top suspect's posterior ≥ threshold (default 0.6) *and* margin to #2 ≥ 0.15.
- Otherwise **skip**, unless it's a critical vote (impostors could win next
  round) → then vote the top suspect regardless and the script says so.
- 2-left endgame: switch to "who is *not* cleared" framing and use hard clears
  only.

---

## 6. Rapid-note design (why the UI is what it is)

The engine is only as good as what gets logged in the first 60 s of a round. So:
- **Default sighting hotkey chord:** `[modifier] + color key` then `room key`.
  18 colors map to keys; rooms get 1–2 letter keys per map (`e` Electrical,
  `mb` MedBay). Two keystrokes, no mouse.
- **"With me" toggle per color:** one key.
- **Visual task seen:** color key + `v`.
- **Body found:** `b` (auto-prompts for room; defaults to your last logged room).
- The overlay shows a 10-second ghost of what you just logged so you can undo.

---

## 7. What the engine is honest about

- Ratings are *relative* and *explainable*, not truth. The UI must never show a
  bare percentage without the evidence list one click away.
- With 1 round of data, most players sit near prior. The script generator says
  "insufficient info — skip" rather than inventing a suspect.
- Weights will be wrong at first. Phase 5 adds a post-match review that compares
  predictions to revealed roles and nudges weights.

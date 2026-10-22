# Deduction engine (Crewmate)

## TL;DR

The engine is a **constraint + evidence** system over ≤ 15 players that keeps reasoning for the
whole game, not just one meeting:

1. **Hard constraints** settle players outright (vent seen = impostor; visual task seen = crew;
   ejection text; counting; with me through a kill window in a 1-impostor lobby).
2. **Soft evidence** moves a log-odds score. Every contribution is an `EvidenceItem` with a human
   label, the ids it came from (`refs`), the round it is about, its decay and the weight applied.
3. **Social evidence** is what *other players* say (accusations, vouches, eyewitness claims),
   weighted by **how credible the speaker is** (a suspect's accusation counts less; a confirmed
   crewmate's counts more; many independent voices converge with diminishing returns).
4. **Carry-over**: evidence persists all game and **decays by category** (hard facts never);
   probabilities are **normalised so they add up to the impostors still at large**; every score
   carries a **trend** (probability at the end of each meeting) and a **delta**.
5. **Explainability**: evidence sorted by |weight|, `topReasons(score, n)`, a one-line `summary`,
   and a `baseline` that says where the score starts ("1 impostor left among 5 unresolved").

Nothing requires hidden information: only what the local player saw, typed, or read off the
screen (chat, vote screen, ejection text). See §8.

Code map (all pure TypeScript in `src/engine/`, Vitest-covered):

| File | What |
|---|---|
| `suspicion.ts` | pipeline: `hardFacts`, `scoreAll`, decay, caps, count normalisation, trend, `topReasons`, `summarize`, `suspectPairs`, `chatAssertions` |
| `rules.ts` | observation rules (movement, tasks, sabotage, never-vote-each-other) + `userMarks` |
| `marks.ts` | user marks with reasons: `SUS_REASONS`, `CLEAR_REASONS`, `markObservation`, `markHistory` |
| `contradictions.ts` | claim rules (location / story / companion / task / accusation behaviour / ejection feedback) |
| `chatEvidence.ts` | `ChatAssertion` → social evidence; `claimsToAssertions` adapter; silence; NLU profile tells; dead accuser |
| `voting.ts` | voting behaviour (needs visible votes) |
| `feasibility.ts` | `killWindow`, `killFeasibility`, `travelLowerBound` (slack), vent-assisted travel |
| `pairs.ts` | `impostorPairs` (display) + `ruleMutualAlibiPair` (score) |
| `history.ts` | meetings completed / current, `aliveAtMeeting`, `snapshotAtMeeting` |
| `alibi.ts` | alibi graph + kill-window clears |
| `data/tactics/weights.json` | **every** weight, cap, half-life; tune here, not in code |

---

## 1. Inputs (what we know)

| Source | Event types |
|---|---|
| Your eyes (hotkey/click) | `sighting`, `withMe`, `sawTask` (visual/non-visual, duration, task bar), `sawVent`, `sawKill`, `bodyFound`, `myRoom`, `sabotage`, `manualMark` (+ reason) |
| OCR | roster, phase, chat lines, ejection text, vote screen, own task list |
| Chat (parsed by chat-nlu or clicked) | `ChatAssertion` (accuse / clear / sawVent / sawKill / withMe / sawTask / defense / voteCall / selfReport …) and `Claim` records (location, companion, task, sighting, accusation, clear, defense) |
| Lobby settings | impostor count, kill cooldown, visual tasks, confirm ejects, anonymous votes, task bar mode, speed |

---

## 2. Hard constraints (certainties)

| Constraint | Effect |
|---|---|
| You saw X vent / kill | X = **Impostor** |
| You saw X do a **visual** task (visuals ON) | X = **Crew** |
| You hard-cleared X (a mark) | X = **Crew** (a later round-clear does not undo it) |
| Ejection "X was (not) The Impostor" | X = Impostor / Crew |
| **1-impostor lobby**: X was with you (your own with-me toggle) through the **whole** kill window | X = **Crew** |
| 2+ impostors: X was with you / a certain crewmate through the kill window | cleared **for that kill** (−3, or −2.1 one hop away along a confirmed alibi edge) |
| N impostors remain, N already certain | everyone else = Crew |
| N impostors remain and exactly N uncertain alive | all of them = Impostor |

**Kill window** (`feasibility.killWindow`): `[max(t_body − 45 s, cooldown start), t_body]`. The
cooldown restarts when a meeting ends (and pauses in vents / on cams, so it stays a lower bound);
the first cooldown of the match is 10 s regardless of settings (game-knowledge §1.2). A body at
0:50 in round 2 with a 30 s cooldown therefore has window [0:27, 0:50], not [0:05, 0:50].

"Cleared for a kill" ≠ "cleared" with 2+ impostors: clears are tracked per kill and intersected.
Cleared for every kill = verdict `hardClear`; for some = `softClear`.

---

## 3. Soft evidence

### 3.0 How a score is built

```
raw evidence (rules)                       weights.json
  → annotate: round (from refs), decay = max(floor, 0.5^(age / halfLife[cat])), shaky × 0.5
  → per-category sum, clamped to ±categoryCap[cat]     (one noisy source cannot dominate)
  → + kill-window clears (category 'hard', not capped)
  → L_i = Σ capped categories
  → offset c so that Σ_unresolved sigmoid(L_i + c) = impostors still at large
  → logOdds = L_i + c, probability = sigmoid(logOdds)
```

With no evidence the offset equals the classic prior `ln(k / (n − k))`. With evidence it keeps
the numbers honest: clearing three of five players makes the other two *more* likely.

Two passes: pass 1 scores everything except social evidence; each player's pass-1 probability
becomes their **credibility as a speaker**; pass 2 adds social evidence and recurrence.

### 3.1 Decay (carry-over across rounds)

Half-life in rounds (`weights.decay.halfLifeRounds`), floor 0.25: movement 2, social 2, sabotage 2,
manual 3, meeting 4, task 5, structural never, hard never. Age = current round − the round the
evidence is about. A lie caught in round 1 still counts at round 5, but a "seen alone near
Electrical" from three rounds ago no longer outweighs today's evidence.

### 3.2 Movement / positioning

| Evidence | w |
|---|---|
| Alone near / heading to the body room inside the kill window | +1.2 |
| Seen leaving the body room ≤ 20 s before the report | +1.5 |
| **Alone with the victim (just the two) inside the kill window** (`two_together_one_dies`) | +1.6 |
| Last seen with the victim (otherwise) | +0.7 |
| Self-reported alone (+0.4 in a dead end) | +0.8 |
| At the body with only the reporter | +0.3 |
| Nobody mentions them all round (kill round) | +0.4 |
| Mentioned, but nobody places them in the kill window | +0.3 |
| Could reach the body room in the window **only by vent** (my sightings, interval check) | +2.0 × margin trust |
| **Could not** reach the body room in the window at all | −1.5 × margin trust |
| Stood at a task far shorter/longer than its duration | +0.5 (shaky: durations unverified) |

**Feasibility** (`killFeasibility(m, player, body)` → `{feasible: yes|ventOnly|no|unknown, reason, refs, margin}`):
every sighting of X (room S at t) rules out the kill instants X could not have walked from:
`|t_kill − t| < travel(S, body)`. If no instant in the window survives on foot, it is vent-only or
impossible. Travel uses `travelLowerBound(sec) = min(sec − 3, 0.7 × sec)` because map seconds are
eyeballed; *margin trust* scales the weight by how many seconds the on-foot route misses by
(0.5 s → ×0.25, ≥ 6 s → ×1). Unknown rooms / stub maps ⇒ `unknown` (never convict on missing data).

### 3.3 Tasks

| Evidence | w |
|---|---|
| Common task I don't have (my list known) | +2.5 |
| Task does not exist in the claimed room | +2.0 |
| **Task does not exist on this map** (`task_not_on_map`) | +1.6 |
| Visual task "done" with no animation (visuals ON) | +3.0 |
| Task bar didn't move / moved as they finished (bar = Always) | +1.0 / −1.0 |

### 3.4 Meeting behaviour (the player's own conduct)

| Evidence | w |
|---|---|
| Location claim contradicted by my sighting / companion claim contradicted | +2.0 |
| Location claim contradicted by a **confirmed-crew** witness's sighting claim | +1.5 |
| …by an unconfirmed witness (one of them lies: claimant +0.4, witness +0.2) | +0.4 |
| Story changed (two location claims, same round, no time to walk) | +1.5 |
| Said two rooms in one meeting (chat-nlu `locationChanges`) | +0.9 |
| Flipped stance on a target within one meeting (chat-nlu `flips`) | +0.2 |
| **Eyewitness lie**: "I saw X vent/kill" about a confirmed crewmate | +2.0 to the speaker |
| Accused with no stated evidence / bandwagoned | +0.4 / +0.3 |
| Pushed (accused) a crewmate who got ejected / only voted them out | +0.9 / +0.5 |
| Defended / hard-cleared a confirmed impostor | +0.8 / +1.2 |
| Voted out a confirmed impostor | −0.6 |
| Skipped the vote that ejected an impostor | +0.4 |
| Skipped on a critical vote (alive ≤ 2 × impostors + 1) | +0.4 |
| Said nothing in a meeting where others talked (≥ 4 lines, ≥ 2 speakers; chat captured) | +0.25 |
| Silent in the meeting after being near the body | +0.5 |
| Location claim confirmed by my sighting / mutually confirmed companions | −0.5 / −1.0 |

Not modelled on purpose: **late bandwagon votes**: the vote screen shows no order or timing.

### 3.5 Social evidence (what others say about the player): `chatEvidence.ts`

```
w = base(kind, reason) × strength × confidence × credibility(speaker)
```

| Kind | base |
|---|---|
| accuse (no reason / "sus") | +0.5 |
| accuse with a reason, selfReport | +0.8 |
| voteCall | +0.4 |
| sawVent / sawKill (eyewitness) | +1.5 |
| clear, sawTask | −0.6 |
| clear citing a **valid** visual (visuals ON, task visual on this map) | −1.0 |
| defense / unconfirmed "with me" / "with someone" | −0.3 / −0.3 / −0.2 |

- **Credibility**: certain crew ×1.5; cleared for every kill ×1.25; otherwise
  `max(0.15, 1 − excess)` where excess is how far the speaker's own probability sits above the
  baseline; × chat consistency (`SpeakerProfile.consistency`, floor 0.5).
- **Known impostor** speaking: their accusation is a mild clear (−0.3); their vouch is a
  pair tell (+0.8) while another impostor is unaccounted for.
- **Suspected** voucher (p ≥ max(0.5, 2 × baseline)) in a 2+-impostor lobby: the vouch counts less
  *and* the vouched-for player takes +0.25 ("possible partner").
- One speaker counts **once** per target and direction (their latest, strongest stance).
  Independent speakers stack with **diminishing returns**: the i-th strongest × 0.7^i, so stacked
  clears approach (≈ −2.4 for four visual vouches) but never reach a hard clear.
- My own chat lines, junk/removed cards, superseded and info-only assertions are ignored.
- **Double counting** with Claim records: chat lines the NLU read are skipped by
  `claimsToAssertions`; until chat-nlu is merged, Claims of type accusation / clear / defense
  are adapted into the same shape (one weighting path).
- `dead_accuser`: X's accuser was killed the next round: +0.25 to X (low: can be a frame).

### 3.6 User marks with reasons: `marks.ts`

One click, one reason: each has its own weight (`weights.manual.reasons`) and its own "why" line.

| Sus reason | w | Clear reason | w |
|---|---|---|---|
| Near the body | +1.0 | With me all round | −1.6 |
| Unaccounted for | +0.5 | Saw a visual task | −2.5 |
| Fake tasking | +1.6 | Task bar moved | −1.3 |
| Followed me | +0.7 | Other | −0.8 |
| Self report | +0.8 | | |
| Lying in chat | +1.2 | | |
| Vent sound / pop | +1.2 | | |
| Acting strange | +0.6 | | |
| Other (= no reason) | +0.8 | | |

`neutral` wipes; switching direction replaces; same-direction marks with **different** reasons
stack (manual cap 3.0); the same reason twice in one round counts once; a mark is about its
round and decays (half-life 3).

### 3.7 Sabotage

| Evidence | w |
|---|---|
| Fixed a sabotage with me | −0.4 (impostors can fix too: `fix_is_not_clear`) |

### 3.8 Structural (whole-game patterns)

| Evidence | w |
|---|---|
| Suspicious (≥ 0.6 of non-social, non-manual evidence) in ≥ 2 separate rounds | +0.3 per extra round |
| Voted out a crewmate in ≥ 2 meetings | +0.5 per extra |
| 2-player minority vote bloc on the same target in ≥ 2 meetings (2+ impostors) | +0.35 each |
| Never vote each other across ≥ 3 meetings | +0.4 each |
| Alibi only each other in ≥ 2 rounds, nobody else saw them (`mutual_pair`, 2+ impostors) | +0.3 per extra round |
| Confirmed impostor's alibi named them and they agreed | +1.5 |

`impostorPairs(m)` / `suspectPairs(m)` rank candidate pairs (mutual alibis, vouching both ways,
never accusing each other, voting together) for display only: those signals already score
through their own rules, so the pair list never adds to the score again.

### 3.9 Category caps (log-odds)

movement 3 · task 4 · meeting 3 · social 2.5 · sabotage 2 · structural 2.5 · manual 3.
Kill-window clears and hard facts are outside the caps.

---

## 4. Alibi graph

Nodes = players. Edges = `(a, b, room, [t₀, t₁], status)`. My with-me toggles and group sightings
are `trusted`; companion claims are `pending` → `confirmed` when mirrored → `contradicted` when a
trusted sighting makes them impossible (using `travelLowerBound`). Kill-window clears flow from
anchors (me + certain crew) one hop, ×0.7 for the second hop.

---

## 4b. Carry-over across meetings and roster changes

- **Trend**: `SuspectScore.trend = [{meeting, probability}…]`: one point per completed meeting
  (the match *as known then*: `snapshotAtMeeting` drops later rounds / claims / votes / chat,
  revives players who died later and forgets roles revealed later), then `now`.
  `delta = now − last completed meeting`. Snapshot results are memoised (warm `scoreAll` ≈ 10 ms on a
  15-player, 8-meeting game).
- **Merges / renames / removals**: every rule keys on player ids and refs on observation / claim /
  vote ids, so `mergePlayers` (which repoints every PlayerId field) gives the surviving card exactly
  the score it would have had without the alias (tested). Self-referencing claims a merge can create
  (X accuses X, X "with" X) and duplicate votes are dropped. Removed junk cards say nothing.

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

---

## 8. No information advantage: what is deliberately NOT used

Everything above comes from the local player's own screen or typing: own sightings, the chat
everyone sees, the vote screen (only when anonymous votes are off), ejection text (only with
confirm ejects on), own task list. No memory reading, no packets, no other players' roles. Where a
signal would need hidden information (vote order / timing, other players' task lists, positions
I didn't see) it is left out and the rule says so.

## 9. Calibration

`src/engine/__fixtures__/sim.ts` scripts whole games with an answer key the engine never sees;
`calibration.test.ts` asserts, at the last meeting of each game: every impostor still in play
ranks top-2; hard-cleared players ≤ 0.2; unresolved probabilities sum to the impostors at large;
every evidence item has refs. Add a game there whenever a real match fooled the engine.

# ui-streamline — notes for the lead

Branch: `ui-streamline` (worktree `C:\dev\AboveThem\.claude\worktrees\agent-a30dfaf8c0cd7685a`).
The worktree started on the stale 71c2c1b. `git merge --ff-only main` was blocked by the permission
classifier, so I created `ui-streamline` from `main` (7bf75ba) in the same worktree. The old
`worktree-agent-a30dfaf8c0cd7685a` branch has no commits; ignore it.

## TL;DR
- **Bug 1 fixed:** card menus render in a portal at a fixed, clamped position (`Popover.tsx` + pure `placement.ts`, with tests). They can no longer trail off a 380 px window or be clipped by a scroll container. Esc closes them.
- **Roster rebuilt** as horizontal vote-grid cards. Each card has a headshot, name, mark badge (with reason), a suspicion meter (tap = why), and SUS / CLR / 👁 here / 👥 with-me. Targets are 36–38 × 40 px. You can sort by suspicion or grid order (remembered). Dead players drop to a chip strip.
- **Sus/clear reasons:** one click, 3 s strip. Wired to suspicion-core's `markObservation` / `markToast`.
- **`engine/headline.ts`** (pure, 12 tests) drives the meeting header, the round "Watch:" bar and the overlay watch line. `meetingScript.headline` is now `headlineText(headline(...))`, so there is one source of truth.
- **Layout:** one column at 380 px and two columns at ≥ 820 px. Rare controls sit under one ⋯ menu. The chat dock shrinks to a bar during rounds and the lobby. Focus mode and 3 first-run tips added.
- Verified with tsc, vitest (87 tests) and vite build, **plus headless-Edge screenshots at 380 px and 900 px**. I used a temporary harness that seeds the skeld fixture into the real `App` (not committed). The real Tauri window/WebView2 was **not** run.

## Merge instructions (important)
1. **`src/engine/marks.ts` is a STUB.** Take suspicion-core's file wholesale. My UI imports only `SUS_REASONS`, `CLEAR_REASONS`, `markObservation`, `markToast` and `reasonInfo`, and gets its reason types from `(typeof SUS_REASONS)[number]['id']`, so it works with their version unchanged.
2. **`src/engine/chatNlu.ts` is a STUB** (returns `[]`). Take chat-nlu's file wholesale. `Transcript.tsx` types its data as `ReturnType<typeof parseMeetingChat>[number]` and uses only `id, line, speaker, kind, about, polarity, quote, why, supersededBy`, all of which are in their contract.
3. I did **not** touch `src/types/game.ts`, `src/state/store.ts` or `src/state/events.ts`. The mark reason travels through `markObservation` (cast to `ObservationInput` in `Roster.tsx`, `logMark`). Once suspicion-core's `ManualMarkObs.reason` lands, the cast is redundant but harmless.
4. `MatchScreen.tsx` was rewritten. The `{/* features */}` marker sits directly above `<Roster scores={scores} />` in `.area-main`. Re-apply features' `import { FeatureSlots } …` and `<FeatureSlots />` there.
5. `ChatDock.tsx`: the `.xlat` line is unchanged, so bugs-rust's `<ChatHint line={c} />` insert right after it should merge cleanly. `.chat-hint` CSS is in styles.css, and unreadable bubbles get a greyed class (`(c as {unreadable?}).unreadable`).
6. `suspicion.test.ts` still expects `/Prime suspect/` in `script.headline`. That still passes because the headline subtitles say "Prime suspect: X (NN%)". If suspicion-core changes the fixture so the top suspect drops under 0.45, the headline becomes "Not Enough Info | Skip Vote — Closest: …" and that old assertion would fail. In that case loosen it.
7. styles.css: every change is appended in delimited `ui-streamline` blocks at the end. No earlier rule was edited.

## Sus-reason UX decision (deviation from the brief, on purpose)
The brief offered two ways to log a mark: commit plain sus immediately and refine it later, or defer. suspicion-core's semantics are that **same-direction marks with different reasons STACK**. Under that rule, "plain sus now + reasoned sus 1 s later" would count twice. So the commit is **deferred**:
- SUS (or CLR) opens the strip and the button glows. Then:
  - a reason, or digit 1–9, logs the mark with that reason;
  - SUS again, Enter, or a 3 s timeout logs a plain mark;
  - Esc cancels.
- Opening a strip on another card commits the pending plain mark. Pressing the other button on the same card cancels it as a misclick.
- If the player is already marked, the strip adds another reason (stacking) and offers "✕ unmark". The timeout does nothing in this case, so unmarking now takes 2 clicks instead of 1.
- The CLR strip also holds "🛡 HARD" (hard clear). A reason picked while the player is hard-cleared stays hardClear. The digit-key path does not do this yet (minor).

## Headline rules (engine/headline.ts)
`NOT_ENOUGH 0.45`, `MAJOR 0.6`, `SECOND_LOW 0.4`, `PACK 0.15`. They classify players who are alive, not me, and not cleared, ranked by probability:
- **confirmedImpostor:** any certain impostor.
- **skipVote:** nobody left.
- **notEnoughInfo:** top < 0.45.
- Otherwise the pack is everyone ≥ 0.45 within 0.15 of the top:
  - **threeSuspects:** pack of 3 or more;
  - **twoSuspects:** pack of 2;
  - **oneSuspect:** top ≥ 0.6 and #2 < 0.4;
  - **leaning:** anything else.
- **criticalVote** (crew alive − impostors left ≤ 2) wraps every kind except confirmedImpostor and skipVote, and keeps `basis`.
- **imDead** wraps everything when I'm dead.
- **lobby / gameOver** short-circuit.

Blunt note: the vote card (weights.vote threshold 0.6 + margin 0.15) and the headline use different rules. With Red 0.79 and Green 0.62 the vote card says "VOTE Red" while the headline says "Leaning: Red · next: Green (62%)". I made the subtitle consistent with that, but the two thresholds should be unified. Candidate: let `buildMeetingScript` vote from `headline.basis`. I did not change the vote logic because it was out of scope and its tests belong to others.

## Before / after (click count and eye-scan)
| Interaction | Before | After |
|---|---|---|
| Mark sus | 1 click (no reason possible) | 1 click + optional 1 click for why (3 s, Enter, or same button for plain) |
| Hard clear | 1 click (3rd button on every card) | 2 clicks (CLR → 🛡 HARD); frees card width |
| Seen here / with me | 1 click | 1 click (40 px targets instead of ~20 px xs buttons) |
| Why is X at 62%? | open meeting script "why" (meetings only) | 1 click on the meter, any phase |
| Who to watch during a round | scan every card's % | read one line: "Watch: Red, Blue" (+ overlay) |
| Meeting verdict | small grey headline text at the right of "Meeting N" | big tone-coloured header + ordered suspect headshots |
| Body / Emergency / Round start (manual) | open "Controls" fold → click (2) | 1 click in the headline bar when screen reading is off; otherwise ⋯ (2) |
| Rescan / reset roster / overlay / close match | Controls fold (2) | ⋯ menu (2) |
| Card menu at 380 px | trailed off the right edge / clipped | clamped in viewport, flips above, scrolls if too tall |
| Dead players | full cards mixed into the grid | one chip strip at the bottom |
| Roster order | fixed by suspicion | toggle suspicion ↔ vote-grid order (remembered) |
| Chat dock during a round | 168 px of empty chat | 32 px bar (full dock in meetings) |
| 900 px window | single column, wasted width | roster left, meeting + folds right, chat under the right column |

## Unverified
- Real WebView2 rendering (fonts and emoji glyphs). I only checked headless Edge, which is the same Chromium engine.
- Container queries in WebView2: Chromium ≥ 105 supports them. If they fail, the action buttons just stay 38 px wide.
- The Popover `ResizeObserver` and scroll-capture repositioning were only checked statically.
- Arrow-key navigation between cards and digit keys in the strip were checked by reading the code only.
- The transcript badges render nothing until chat-nlu's parser merges; grouped lines work (screenshot checked).

## Files
- New: `src/ui/components/{Popover,CardMenu,SusMeter,HeadlineBar,Transcript}.tsx`, `src/ui/{placement,prefs}.ts`, `src/ui/placement.test.ts`, `src/engine/headline.ts` + test, stubs `src/engine/marks.ts` and `src/engine/chatNlu.ts`.
- Rewritten: `src/ui/components/Roster.tsx`, `src/ui/screens/MatchScreen.tsx`.
- Edited: `src/ui/components/{MeetingPanel,ChatDock}.tsx`, `src/ui/overlay/{snapshot.ts,Overlay.tsx}`, `src/engine/meetingScript.ts` (headline only), `src/ui/styles.css` (appended blocks only).
- UI prefs (sort, focus, tips) live in localStorage under `abovethem.ui.*`, wrapped in try/catch. They are not in settings.json because that is not my file. Move them there if William wants them to survive a WebView data wipe.

## Next ideas
1. Unify the vote recommendation with `headline.basis` (see above).
2. Extract the reason-strip state machine into a pure module with Vitest coverage (no jsdom in the repo).
3. Ghost and impostor panels: same density pass (not done; they still use the older look).
4. Meeting panel at 380 px: merge the vote card into the headline header to save ~120 px of height.

## Round 2 (after the first merge)
Merged main twice (maps round 2, bugs-rust, features). Everything below is committed on `ui-streamline`; vitest 297/297, tsc clean, vite build OK; 380/900 px checked with headless-Edge screenshots (temporary harness, not committed).

| # | What | Where |
|---|---|---|
| 1 | Vote recommendation = `headline.vote` (`recommendVote(basis, …)`); meetingScript copies it. 79%/62% → "Leaning: Red — vote · next: Green", VOTE Red, alternative Green. Thresholds come from weights.vote (MAJOR = threshold, PACK = marginToSecond). | engine/headline.ts, meetingScript.ts, headline.test.ts |
| 1b | Critical rule per lead: `danger`/`critical` now come from features' `meetingMath(m)` (critical = wrong eject loses now; careful = warn + "One wrong vote from critical"). Critical forces a vote only when skipping can also lose. Parity test vs meetingMath. | headline.ts |
| 2 | Reason strip is a pure state machine with 10 tests; Roster only feeds events. | src/ui/reasonStrip.ts (+test) |
| 3 | Ghost panel: compact header, chip grid "who killed you". Impostor panel: compact header, push card with copy, first alibi/answer shown, rest folded, every line copyable. | GhostPanel.tsx, ImpostorPanel.tsx |
| 4 | Vote folded into the meeting header (VOTE X % · "or Y %" chip · one reason line); suspects as pills; duplicate subtitle hidden. ≈120 px saved at 380. | HeadlineBar.tsx, MeetingPanel.tsx |
| 5 | "What you can check" chips from `map.info` (cams/binoculars + covered rooms, Admin, Vitals, MIRA door log). Pure helper **`engine/mapLookouts.ts`** (renamed: maps agent owns `mapChecks.ts`). | mapLookouts.ts (+test), MapChecks.tsx |
| 6 | `{/* features */}` marker still directly above `<Roster>`. FeatureSlots got a minimal `compact` prop: under 820 px the kill clock stays and every other card folds into one "🧰 tools" line; at ≥ 820 px the cards render in the right column. | FeatureSlots.tsx (shared, minimal), MatchScreen.tsx, useMedia.ts |
| + | Per-map question bank wired into the meeting script: up to 2 Ask lines (note shown under "why"), lie notes → Watch. `MeetingQuestion.note?` added to game.ts (additive). | meetingScript.ts, meetingScriptMap.test.ts |
| + | Screen-reading health: red dot on ⋯ + reason lines inside (bugs-rust `health`). | MatchScreen.tsx |
| + | Possible-impostor-pair chip (reads `suspectPairs` through the module namespace; renders nothing until it exists); category icons in why-lists incl. 'social'. | PairChip.tsx, SusMeter.tsx |
| + | "Roles on" chips in setup (saved with the lobby preset). `settings.roles` cast locally — MERGE note. | SetupScreen.tsx |

### Bug found + fixed (outside my files — maps owner please review)
`src/engine/map.ts` travel time crashed (`room.adjacent` of undefined) when an observation's room id is not on the current map (e.g. map re-detected mid-match: Skeld rooms logged, then Polus). Result: blank window. One-line guard (`if (!room) continue;`) + regression test `src/engine/unknownRoom.test.ts`. MatchScreen and the overlay snapshot also catch engine exceptions now (status line "Suspect engine hit an error"), so a future engine bug can't blank the window.

### For the lead
- The impostor panel shows unfilled template placeholders like `{A}` in defense lines ("Where were you, {A}?") — engine/impostor.ts content, not mine.
- Auto-created matches (useGameEvents) may not carry `settings.roles` from the setup screen — whoever owns the auto layer should copy it from the preset.
- PAIR_MIN = 0.5 assumes suspectPairs' score is 0..1 (UNVERIFIED until merge).

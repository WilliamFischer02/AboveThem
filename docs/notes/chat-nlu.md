# chat-nlu: notes for the lead

Branch `worktree-agent-a2ad06ac7891dcb21`, worktree `C:\dev\AboveThem\.claude\worktrees\agent-a2ad06ac7891dcb21`.

**TL;DR:** chat is now read by a data-driven NLU (`src/engine/chatNlu/`) into `ChatAssertion`s with
polarity, strength, parse confidence, the quoted words and a why-trace. They are computed on demand
from `MatchState.chat`. `chatClaims.ts` keeps its API as a thin wrapper. `main` is merged in (at
701d17e), and after the merge 340 tests are green, about 130 of them NLU tests. tsc and vite build
are clean. ui-streamline's Transcript.tsx already renders the real assertions.

## Merge notes
- My worktree branch was created from the stale commit `71c2c1b` ("Base repo"), not `main`. Before I
  did any work I reset my branch onto `main` (`7bf75ba`).
- I merged `main` (701d17e) and **deleted ui-streamline's stub `src/engine/chatNlu.ts`**. If the stub
  comes back in any merge, TypeScript resolves `chatNlu.ts` before `chatNlu/index.ts`, and the stub
  silently returns `[]`.
- **One edit outside my files:** in `src/input/useGameEvents.ts` (bugs-rust), the Claim base for chat
  lines now carries `chatLineId: lineId` (one additive token). Claims can then be tied to their chat
  line, so suspicion-core's dedupe and ChatDock's claim lookup can stop guessing from text prefixes.
- The research seed `src/data/chatSlang.seed.json` is folded into `chatLexicon.json`. The seed file can
  be deleted. I left it in place because it is the research agent's file.
- Lexicon room ids now match the maps agent's Mira/Airship/Fungle data exactly. Every room and task in
  their five map files resolves; I checked this with a script against their branch. The map index also
  reads the new `MapRoom.aliases` field and "The …" names.

## Files
| File | Status |
|---|---|
| `src/engine/chatNlu/lexicon.ts` | new: loads the lexicon, OSA fuzzy, per-map room/task index, player index, name matching |
| `src/engine/chatNlu/tokenize.ts` | new: tokens with spans, longest phrase match, squash / OCR fix / fuzzy fallbacks |
| `src/engine/chatNlu/parse.ts` | new: clause split + rules (accuse/clear/vent/kill/self report/vote/skip/with/task/location/body/question …) |
| `src/engine/chatNlu/context.ts` | new: meeting context (pronouns, "u", missing subjects, replies, bare mentions, agree lines, supersede) |
| `src/engine/chatNlu/index.ts` | new: public API + `stanceLedger`, `voteCalls`, `meetingTranscript` |
| `src/engine/chatNlu/chatNlu.test.ts` | new: ~120 tests (85+ single-line fixtures, context, maps, names/OCR, foreign words, aggregates) |
| `src/engine/chatProfile.ts` | new: `speakerProfiles(m)` |
| `src/data/chatLexicon.json` | new: the lexicon (structured JSON) |
| `src/engine/chatClaims.ts` | rewritten as a wrapper; same exports |
| `src/engine/chatClaims.test.ts` | one expectation changed: reason `'self reported'` is now the normalised `'self report'` |
| `src/types/game.ts` | additive block at the end: `ChatAssertionKind`, `ChatReason`, `ChatResolution`, `ChatAssertion`, `StanceFlip`, `SpeakerProfile` |
| `docs/decisions.md` | appended `ADR-0xx-chat-nlu` |

## Contract (consumers)
See `scratchpad\relay\from-chat-nlu.md` for the full contract. In short:
- `parseMeetingChat(m, meeting)`, `parseAllChat(m)`, `parseLine(text, speaker, m)`, `activeAssertions(list)`
- `stanceLedger(m, meeting)`, `voteCalls(m, meeting)` (band-wagon signal), `meetingTranscript(m, meeting)` (UI)
- `speakerProfiles(m)` from `src/engine/chatProfile`
- Fields that bugs-rust adds to ChatLine: `unreadable` lines produce nothing, and `xlatGuess` multiplies
  confidence by 0.7. My code reads both through a local widened type, so it compiles with or without
  their game.ts change.

## Design calls (blunt)
- **Derived, not stored.** Storing assertions in `MatchState` would freeze readings that a later line
  should change ("White and Black" → "saw them do wires"). Recomputing an 80-line meeting takes about
  15 ms, and `parseMeetingChat` memoizes on the identity of chat, players, map, phase and observations,
  so repeat calls are free. The returned arrays are shared: callers must not mutate them.
- **'dead' readings change the roster** (useGameEvents marks the player dead). "is red dead?" is
  therefore read as a question, and "red isnt dead" produces nothing.
- **Claims vs assertions double-count.** useGameEvents still writes Claims from each line, through the
  wrapper. Bare mentions and low-confidence readings never become Claims. suspicion-core should take
  accusation/defense/clear from assertions and use Claims only for contradiction checks
  (location/companion/task).
- **Bare mention = weak accusation (confidence 0.45) until context says otherwise.** In real lobbies a
  lone colour is usually "it's X". The context layer removes it when the same speaker's next line refers
  back to it.
- **Mira / Airship / Fungle room ids are guesses.** Rooms attach to map rooms by id OR by name, so if
  the maps agent picks other ids, names still match. If a name is wrong too, the room is unresolved,
  never resolved to the wrong room. Stub maps (no rooms) fall back to the lexicon's own ids.
- **Single-letter colour shorthand ("b", "g", "p") is deliberately not supported.** It is ambiguous, and
  "w" / "l" collide with "with" / "loss".
- **`src/data/glossary.json` is not read by any code** (only TRANSLATION.md mentions it). I left it
  unchanged. Wiring it into translation is a Rust-side job (bugs-rust).

## Unverified / known gaps
- Never run on a real lobby's chat. All fixtures are hand-written from typical public-lobby chat and
  the research relay.
- Hearsay ("blue said red vented") is read as the speaker's own claim.
- "i was in elec then nav" emits two locations. The profile only counts a location change when the two
  rooms come from **different lines** of the same meeting.
- Foreign-language words cover colours, sus/vent/kill/lie/skip/vote, not-me phrases, where/who and
  hedges (es, pt, ru, fil, id). Anything longer still needs translation.
- `confusableColors` (research seed) is in use: an eyewitness claim (vent / kill / sighting / task)
  that names a colour whose look-alike is also alive gets confidence x0.9.
- useGameEvents still builds Claims from `msg.text` (the original) only. A non-English line whose
  translation arrives later never becomes a Claim, but its assertions do appear, because they are
  re-read on demand.

## Next ideas
1. ui-streamline: render `meetingTranscript` badges under each chat bubble. Clicking a badge shows
   `quote` and `why`.
2. suspicion-core: weight = polarity × strength × confidence × credibility(`speakerProfiles`); use
   `voteCalls(...).lateJoiners` as a weak band-wagon signal.
3. Use the NDJSON chat logs from real games as regression fixtures. Every misread becomes a CASES row.

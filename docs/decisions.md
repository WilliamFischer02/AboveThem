# Decision log (ADR, append-only)

## ADR-001 — Stack: Tauri 2 + Rust backend, Vite/React/TS frontend
**Date:** 2026-10-21
**Status:** accepted
**Why:** need an always-on-top transparent overlay with global hotkeys beside a
running game; WinRT OCR and Graphics Capture interop are cleanest from Rust via
the `windows` crate; React/TS is the existing toolchain. Electron rejected for
memory footprint; Python/PySide rejected for overlay + interop friction.
**Consequences:** two languages in repo; engine must stay in pure TS so the
Windows-only Rust layer never blocks testing.

## ADR-002 — Game reading: screen capture + OCR, no memory/injection/network
**Date:** 2026-10-21
**Status:** accepted
**Why:** official-server ban risk; keeps the product honest (only what's on screen);
survives game updates better than memory offsets. Optional BepInEx exporter mod
allowed in `mod/` for custom servers only, with a strict export allow-list.

## ADR-003 — "No information advantage" is a product invariant
**Date:** 2026-10-21
**Status:** accepted
**Why:** the value is better *reasoning* over visible information. Any feature
that requires hidden info is rejected at design time. Code review rule for the
mod: if a crewmate couldn't see it on screen, it doesn't get exported.

## ADR-004 — Engine is pure TypeScript with config-driven weights
**Date:** 2026-10-21
**Status:** accepted
**Why:** testable without the game; weights in `data/tactics/weights.json` so a
post-match learning loop can tune them without code changes.

## ADR-005 — Map data is explicit JSON with `_verified` flags
**Date:** 2026-10-21
**Status:** accepted
**Why:** wrong vent/visual/common-task data produces confidently wrong deductions.
Every map file carries `_verified` per section; the engine lowers weight of any
rule that depends on unverified data.

## ADR-006 — Screen capture via the `windows-capture` crate, not raw `Graphics::Capture`
**Date:** 2026-10-21
**Status:** accepted (Phase 0; implementation lands in Phase 2)
**Why:** both options sit on the same Windows Graphics Capture API. Raw
`windows::Graphics::Capture` needs us to own the D3D11 device, the
`Direct3D11CaptureFramePool`, the `GraphicsCaptureSession`, the interop
`IDirect3DDxgiInterfaceAccess` → `ID3D11Texture2D` → staging-texture → `Map`
copy, and the dispatcher-queue thread — ~300 lines of unsafe ceremony before
the first BGRA byte. `windows-capture` 2.0.1 wraps exactly that and hands a
callback a frame with a width/height/BGRA buffer, supports capture by HWND,
lets us toggle the yellow border and cursor, and depends on `windows =
^0.62.2` — the same copy Tauri 2.12 / wry / webview2-com already pull, so no
duplicate `windows` build. Resolved and checked on 2026-10-21.
**Consequences:** we keep the `windows` crate for `Media.Ocr` /
`Graphics.Imaging` (OCR needs a `SoftwareBitmap`, which `windows-capture`
does not produce; we build it from the BGRA buffer). If `windows-capture`
stalls on a future `windows` bump, fallback is the raw API — the frame type
in `capture.rs` is ours, so callers don't change.

## ADR-007 — Frontend toolchain pinned to Vite 8 / Vitest 5 (not the scaffold's 5 / 2)
**Date:** 2026-10-21
**Status:** accepted
**Why:** the scaffold's `vite@^5` resolved to 5.4.21 → `esbuild 0.21.5`
(GHSA-67mh-4wv8-2f99: any website can hit the dev server), and `vitest@^2`
→ `tinypool` with a prototype-pollution RCE. `tauri dev` runs that dev
server every session. Vite 8.3.5 + Vitest 5.0.5 + `@vitejs/plugin-react`
6.1.2 clear `npm audit` to zero and the 6 engine tests, `tsc --noEmit` and
`vite build` all pass unchanged. React stays on 18.3.1 and TypeScript on
5.9.3 (TS 7 is the native-port rewrite; no reason to be an early adopter in
a build pipeline). All versions are exact-pinned in `package.json`.

## ADR-008 — Undo is an event; the NDJSON log is append-only
**Date:** 2026-10-21
**Status:** accepted
**Why:** `MatchState` is the reduction of the event log (`src/state/events.ts`).
Rewriting the file on undo would let disk and memory drift and lose the
record of what the user retracted. An `undo` line removes the latest
surviving undoable event at replay time, so a crash mid-match loses at most
the last line and a replay reproduces exactly what was shown.
**Consequences:** `init` can't be undone; the store replays from scratch on
undo (N is tiny); `dev:replay` is just "load the file".

## ADR-009 — Hotkey chords via RegisterHotKey with a temporary second layer
**Date:** 2026-10-21
**Status:** accepted (fallback documented)
**Why:** `tauri-plugin-global-shortcut` (RegisterHotKey) already in the tree.
Prefix chords (`Ctrl+Alt+<key>`) are permanent; on a prefix press the bare
second-layer keys (rooms, `.`, `v`, `!`, `k`, `+`, `-`) are registered for
≤ 1.5 s and unregistered on completion/timeout. Verified end to end with
Notepad focused: chords reach the app and land in the NDJSON log. Cost: for
that ≤ 1.5 s window the game does not receive those keys — acceptable, since
the user is mid-chord. UNVERIFIED with Among Us itself in fullscreen-windowed.
**Fallback:** a `WH_KEYBOARD_LL` hook thread in `hotkeys.rs` if the game
swallows RegisterHotKey events; same `hotkey://chord` contract, no frontend
change.
**Consequences:** room keys must be single characters (chord = exactly two
keypresses, per CLAUDE.md §1). `docs/UI_SPEC.md` had `b` (body) and `t`
(translator) colliding with Blue/Tan: body is now `Space`; translator moves
to Phase 3 with its own key.

## ADR-010 — Among Us look without game assets
**Date:** 2026-10-21
**Status:** accepted
**Why:** William wants the companion to look like the game (crewmate heads,
game-like font). We don't ship Innersloth assets. The crewmate is our own SVG
(`src/ui/components/Crewmate.tsx`) coloured from the palette; the font is
Fredoka (SIL OFL, bundled) with an optional git-ignored
`src/assets/fonts/custom/ui.ttf` slot that wins if present.

## ADR-011 — Automatic game reading: pull-based watcher, markers by dhash + OCR
**Date:** 2026-10-21
**Status:** accepted (live-tested once)
**Why:** William wants zero-trigger operation. A background thread polls the
latest captured frame at 5 Hz, hashes five small marker regions and OCRs a
region only when its pixels changed and settled (≈ 40 ms each). Markers drive
the phase state machine with hysteresis; roster/eject/role/lobby are emitted
as `game://*` events the frontend applies to the store. Pull-based + latest-
frame-only means a slow OCR never backs up and the game is never touched.
**Consequences:** the frontend's manual controls become fallbacks; every auto
action shows a toast with "(auto)" so mistakes are visible and undoable.

## ADR-012 — Colour classification is brightness-invariant; names are identity
**Date:** 2026-10-21
**Status:** accepted
**Why:** vote-grid icons are shaded half-bodies behind cosmetics and dead cards
are dimmed; Lab ΔE mislabelled them. Comparing the RGB *direction* (normalised
by max channel) with a saturation term and a "cannot be brighter than the
candidate" penalty gets strong hues right; warm hues stay ambiguous. So the
roster keys on OCR'd names (snapped to known names), colour is a hint the user
can correct with one click, and the engine never depends on colour.

## ADR-013 — Hotkey chords hold the prefix for both keys
**Date:** 2026-10-21
**Status:** accepted (supersedes ADR-009's temporary bare second layer)
**Why:** William plays with WASD; registering bare letters even for 1.5 s was a
risk. Both keys now carry `Ctrl+Alt`; the same physical shortcut is a colour
as first key and a room as second, disambiguated by the pending state.

## ADR-014 — Vote-grid rendering model + diagonal dead-X detector
**Date:** 2026-10-21
**Status:** accepted
**Why:** measured on three real meeting frames: icons render ≈ 0.75·palette + 60,
dead cards ≈ 0.45·that + 20, the X is a dim orange-red band on the icon diagonals.
Classifying body pixels against the *rendered* palette (plain RGB distance) beats
every perceptual-space trick tried earlier; counting X-band pixels near the
diagonals separates the X from red bodies and card art. User colour picks are
stored as calibration samples and matched first.

## ADR-015 — Chat is read into claims; chat bubbles are a roster source
**Date:** 2026-10-21
**Status:** accepted
**Why:** OCR of the open chat panel at 2× gives clean bubbles (name line + text).
`chatClaims.ts` turns the formulaic Among Us phrasing into typed claims (with
colour-word → player resolution and room/task aliases); the contradiction engine
then verifies them like hand-entered claims. The icon beside a bubble gives the
sender's colour (plain palette), so unknown senders become players. Grid reads
are refused while the panel is open (Send button or "N/100" counter visible).

## ADR-016 — Roster slots are a first-class hotkey target
**Date:** 2026-10-21
**Status:** accepted
**Why:** colours from icons are unreliable under cosmetics; the vote-grid order is
what the player sees every meeting. `Ctrl+Alt+<digit>` targets slot N; colour
letters remain. Re-reads match by slot before name.

## ADR-017 — Phases move only on positive evidence
**Date:** 2026-10-21 (session 3)
**Status:** accepted (live-tested in one public lobby)
**Why:** the watcher used to fall back to Lobby whenever no marker was visible,
so the map screen, settings, the task-bar-off setting or an open chat panel (which
covers the meeting header) reset the match mid-game. Now each phase needs its own
marker: room code = lobby, role card = round start, task bar *or* USE/REPORT/KILL/
SABOTAGE buttons = round, header *or* voting timer = meeting (and a meeting stays a
meeting while chat is open), VICTORY/DEFEAT = game over. "Nothing recognisable"
keeps the current phase for up to 120 s before counting as the lobby.
**Consequences:** a role card seen after a played game means "new game" (the lobby
roll-over no longer depends on seeing the lobby). Quitting to the main menu looks like
"round" for two minutes; Close match is the manual exit.

## ADR-018 — Role reveal and end screen are read by colour as well as text
**Date:** 2026-10-21 (session 3)
**Status:** accepted for the role card (fixtures); UNVERIFIED for victory/defeat
**Why:** both screens are large coloured letters on black. `screen_accent` counts
teal / blue / red text pixels on a ≥ 75 % dark region; teal = crewmate, red =
impostor (at game start) or defeat (in game), blue = victory. OCR words win when read;
the colour stands in when they are not. The user's manual role toggle locks the role
for the match so automatic reads cannot flip it back.
**Consequences:** `game://game_over` carries `{outcome, accent}`; the phase pill shows
VICTORY (blue) / DEFEAT (red). The "Fake Tasks" role signal only fires on the real
header during a round (chat about "faking" overlaps the task-list region in meetings).

## ADR-019 — Vote-grid cards are matched by identity, slots are per meeting
**Date:** 2026-10-21 (session 3)
**Status:** accepted (unit-tested on real-frame hashes; live-tested)
**Why:** the meeting grid re-sorts every meeting (alive first, dead last), so slot-based
matching across meetings swapped headshots and death marks between players. Each card
now carries a dHash of its icon (stable across slots, dimming and the fade-in) and a
dim ratio; `src/engine/rosterMatch.ts` scores name × icon × colour × same-meeting slot
and assigns greedily. A greyed plain card counts as dead even without the X. Headshots,
hashes and body samples are cached per match on disk so restarts keep the faces.
**Consequences:** `Player.slotMeeting`; hotkey slot digits always follow the current
grid. A roster-confidence dot replaces the diagnostic status line.

## ADR-020 — User marks are first-class and persistent; hard clear is a hard fact
**Date:** 2026-10-21 (session 3)
**Status:** accepted
**Why:** William wants to see at a glance how he judged each player in earlier
meetings. Every card has sus / round clear / hard clear toggles (latest mark wins,
toggling again unmarks); the card's look changes per mark and stays until the game ends.
`hardClear` joins certain-crew in `hardFacts` (the user saw it themselves); `clear` stays
the soft weight. Say/Ask lines are plain sentences with a copy button so nothing but the
sentence reaches the clipboard.

## ADR-021 — Translation: keyless Google endpoint by default
**Date:** 2026-10-21 (session 3)
**Status:** accepted (works live; unofficial endpoint)
**Why:** LibreTranslate needs a server and DeepL a key; neither was configured, so
translation never ran. `translate_a/single?client=gtx` needs nothing, returns the
detected language (whatlang cannot on 20-character lines) and handles the volume of a
meeting. A quick English-word heuristic keeps most lines local. DeepL / Libre remain
selectable in settings.json (`translate.provider`, `deeplKey`, `libreEndpoint`).
**Consequences:** the endpoint may change without notice; the UI degrades to the
original text.

## ADR-022 — The screen sets the roster size; duplicates fold into the best-evidenced card
**Date:** 2026-10-22 (session 4)
**Status:** accepted (engine unit-tested; fixture-tested OCR; live behaviour to confirm)
**Why:** rosters grew to 30–40 cards: every OCR variant of a name ("BigBihgis"), the host
line's colour suffix ("(Red)"), chat sentences read as senders and UI words all became
players. Two facts on screen bound the real number: the lobby panel's CAPACITY value
("9/15", read from `lobby_capacity`, ±1 while people join and leave) and the vote-grid
card count (exact, trusted once two reads of a meeting agree). `MatchState.rosterSize`
holds it; `src/engine/rosterConsolidate.ts` ranks cards by evidence (me > on this
meeting's grid > headshot hash > user-touched > plausible name > referenced by
observations), merges cards that are the same person (name ≥ 0.6, headshot ≤ 10 bits,
name fragment, colour placeholder of a named card; never two cards that shared a grid)
and drops the weakest until the roster fits. `mergePlayers` re-points every observation,
claim, vote, chat line and ejection to the survivor so no evidence is lost; it is not
undoable (automatic). Names longer than the game's 12-character cap are junk by
construction.
**Consequences:** a wrong merge is recoverable only through Rescan / Reset roster;
removals still consume an undo slot (`removePlayer` is shared with the user path).

## ADR-023 — Every user fix trains the name reader; the roster freezes after the first full grid
**Date:** 2026-10-22 (session 4)
**Status:** accepted (engine unit-tested; live behaviour to confirm)
**Why:** William wants corrections to make detection better, and the roster to stay the
same from meeting to meeting apart from spelling / headshot fixes and new dead X marks.
`src/engine/nameBook.ts` keeps `names.json` (app data): confirmed spellings (user-typed
weigh 3, grid 1), OCR aliases (recorded on every user rename and every automatic merge),
and junk strings (one user "✕ remove" is final; automatic drops need two strikes). It
feeds back three ways: the Rust snap list is the roster + this lobby's known names + their
aliases (so the raw read is already right), every grid / chat / lobby reading is resolved
through the book before matching, and junk never becomes a card again. Within a match,
repeated grid readings vote on a card's spelling (`bestReading`): a better reading seen
twice replaces a first misread unless the user typed the name (`Player.nameLocked`).
Consistency: once a full grid has set `rosterSize`, nothing can add a player, and
`matchGrid` assigns leftover cards to leftover (non-disconnected) players by elimination
instead of creating candidates.
**Consequences:** a wrong user rename is also learned (fix it by renaming again: the
latest typed spelling wins); the book forgets automatic names after 30 days.

## ADR-0xx-chat-nlu — Chat is read by a data-driven NLU into derived, confidence-weighted assertions
**Date:** 2026-10-22 (session 5, chat-nlu agent)
**Status:** accepted (Vitest: ~120 NLU fixtures; not yet watched on a live lobby)
**Why:** the regex list in `chatClaims.ts` only understood clean, formulaic lines. Real
chat is shorthand, misspelt, hedged and context-dependent ("White and Black" + "saw them
do wires" is a clear, not an accusation). The suspicion engine also needs *how hard* and
*how sure* each line is, and the UI must show the exact words behind every score.
**Decision:** `src/engine/chatNlu/` (pure TS): `chatLexicon.json` (colours, per-map room
and task aliases matched by room id OR name, verb classes, hedges/intensifiers, questions,
noise, expansions) → tokenizer (longest phrase match, squashed letters, OCR digit fixes,
capped OSA fuzzy: <=4 letters exact, 5-6 one edit, 7+ two, blocklist) → clause parser →
meeting context (pronouns, "u", missing subjects, replies to who/where, bare mentions
absorbed by later lines, agree lines, stance supersede). Output: `ChatAssertion` (game.ts)
with polarity, strength, parse confidence, span/quote, why-trace and refs. Assertions are
**computed on demand** from `MatchState.chat` (`parseMeetingChat`, `speakerProfiles`), never
stored, so later lines can re-read earlier ambiguous ones and translations that arrive later
are picked up automatically.
`chatClaims.ts` keeps its API as a thin wrapper (claims are written once per line, so it
only turns context-free readings with confidence >= 0.5 into Claims).
**Consequences:** chat-derived Claims and assertions describe the same lines — consumers
must not add both as evidence (see relay note from-chat-nlu.md). Mira/Airship/Fungle room
ids in the lexicon are guesses matched by name; wrong names there make rooms unresolvable,
never wrong.

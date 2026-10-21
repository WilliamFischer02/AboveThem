# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-21, end of session 1, ~10:25)

Phases 0–2 done, Phase 3 core (chat reading + claim parsing) live, parts of
Phase 4/5 UI (ghost mode, overlay) in. Everything below was verified in
William's live public lobbies tonight (Skeld and Polus), from the NDJSON logs.

### What runs automatically now (zero clicks)
| Signal | Source | Event → effect |
|---|---|---|
| Game window | `capture.rs` (Windows Graphics Capture) | auto-start capture + watcher every 8 s |
| Lobby code, map name, lobby settings ("X set to Y") | lobby settings panel + announcements | `game://lobby`, `game://map`, `game://settings` → match settings |
| Lobby roster | floating names over crewmates (`lobby.rs`) | match created in the lobby (needs 2 consecutive sightings of a name) |
| Already in a game | task bar / role card | provisional match with a placeholder "me", filled at the next meeting |
| Role card | "CREWMATE"/"IMPOSTOR" (both layouts) | my role |
| Round / meeting / vote / eject / game over | task bar, header, eject text, VICTORY/DEFEAT | phases with hysteresis |
| Meeting reason | red banner | body vs button |
| Vote grid | `roster.rs` 1.2 s after the meeting opens, every 4 s, never under chat | names, slots, dead, reporter, colours (voted over 3 reads), headshots |
| "DEAD" header | meeting screen when I'm dead | ghost mode |
| Room popup | bottom-centre room name on entry | my room (anchors "with me" and auto-sightings) |
| Nearby names | floating names during the round | sightings in my room, 1 per player per room per 20 s |
| My task list | top-left | enables the common-task rule; "Fake Tasks" → impostor |
| Chat | `chat.rs` whenever the panel is open and changed | chat lines + **claims** via `src/engine/chatClaims.ts` (location, companion, sighting, accusation w/ reason, clear, defense, task, body) |
| Chat sender colour | crewmate icon beside the bubble (plain palette) | new players discovered from chat |

### Detection facts measured on real frames (don't re-derive)
- Vote-grid icons render ≈ 0.75·palette + 60 (25 % white lift); dead cards ≈ 0.45·that + 20
  under a dark overlay. Chat/lobby sprites use the plain palette.
- Dead X: dim orange-red band (R 100–175, G 40–100, B 25–90, R−G ≥ 35) along the icon
  diagonals; score ≥ 700 (1080p-normalised) = dead. Exact on 5/5 dead cards across 3 frames.
- Level badge (teal-green "Lv" circle, top-left of the card) = occupancy; names on busy
  cosmetic cards need the white-text binarisation fallback; 2-letter names may come back
  as "#slot" placeholders.
- Colour: 25/25 alive correct on fixtures except a player holding a sign over the body.
  Warm colours remain the weak spot; the user's colour picks are stored as calibration
  samples (`%APPDATA%\AboveThem\color_calibration.json`) and matched first.
- Chat panel open: "Send" button OR the "N/100" counter. Grid reads under chat are junk —
  both the watcher and `read_roster` refuse when either is visible.
- Room popup OCR region (600,950,720,60); role card (300,60,1320,460) at 1×; task list at 3×.
- Only `en-US` OCR is installed on this PC.

### UI (meeting-tablet look)
Vote card first (big, red when confident), "Room momentum" tally (who pushes whom vs.
the evidence), Say/Ask, chat feed with parsed tags, claim entry, vote result. Roster
cards: in-game headshot (cropped from the vote grid), slot digit, quick `here` /
`with me` / `sus`, menu with room grid, colour picker (locks + calibrates), rename,
remove. Ghost mode when dead (killer pick → certain impostor; signal helper for the
image role, uncalibrated). Overlay window: clock, my room, slot legend with prime/clear
marks. Setup screen leads with auto status; manual setup folded away. "Rescan names".

### Known gaps / next
- Game-over detection relies on VICTORY/DEFEAT text in the role-card region — never
  seen live yet. Matches stay open; a new lobby creates a new match.
- Every Rust rebuild restarts the app and loses the in-memory match (log persists);
  frontend-only edits hot-reload and *also* reset the store when `store.ts`
  dependents change. Don't edit during William's games unless asked.
- Ejection name match still misses sometimes (animated text); loosened to alive
  players ≥ 0.4 similarity. Candidate fix: also read the ejected crewmate's colour
  on the eject screen.
- Chat: OCR drops the last letter under the icon on right bubbles ("hell"); vote-grid
  names bleed through the translucent panel (filtered by line height); names with
  diacritics vary between reads (fuzzy snap handles most).
- Signal helper (ghost image role) and sabotage banner: no frames yet.
- Translation (Phase 3b) not started; `whatlang` + DeepL scaffolding exists in Rust.
- Accessory database idea: every headshot PNG we crop is a labelled sample; not stored
  yet (avatars live in memory only).
- MIRA/Airship/Fungle map data still stubs; Polus wiki-verified (durations guessed).

## Toolchain (unchanged, see git history): Node 24.19, Rust 1.97.1, Tauri 2.12.4,
windows 0.62.2, windows-capture 2.0.1, Vite 8.3.5, Vitest 5.0.5. Among Us v19s 7489,
1920×1080 borderless on the primary monitor; app on the left monitor (−1900,100).
Tests: Vitest 41, Rust 26 (OCR against 20 real frames in `src-tauri/fixtures/`).

## Open questions for William
- Does the overlay show on top of the game? Do chords work in-game? (Both unverified.)
- When dead with the image-sending role, leave that panel open ~5 s so it can be calibrated.
- A victory/defeat screen frame is still missing (stay on it a few seconds once).

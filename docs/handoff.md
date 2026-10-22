# Handoff — current state

> Update this file at the end of **every** session. Future-you (or the next
> Claude Code session) reads this first.

## State (2026-10-21, session 3, evening)

Phases 0–3 core live. Session 3 fixed the things William listed from play: phases no
longer snap back to the lobby, the vote grid is matched by identity (headshots stay with
their player), role reads cannot be flipped by chat, marks persist on the cards, chat is
a game-styled dock with live translation, and the UI lost its diagnostic clutter.
Everything below was verified in William's live public lobbies (Skeld) from the NDJSON
logs unless marked UNVERIFIED.

### What runs automatically now (zero clicks)
| Signal | Source | Event → effect |
|---|---|---|
| Game window | `capture.rs` (Windows Graphics Capture) | auto-start capture + watcher every 8 s |
| Lobby code, map name, lobby settings | lobby panel + announcements | `game://lobby`, `game://map`, `game://settings` |
| Lobby roster | floating names (`lobby.rs`) | match created in the lobby (2 consecutive sightings) |
| Phase | task bar **or** REPORT/KILL/SABOTAGE/VENT = round (USE is in the lobby too); header **or** voting timer = meeting (sticky under chat); eject text; "WAITING FOR HOST" / "START" button **or** room code = lobby (sticky under chat); VICTORY/DEFEAT or coloured text on black = game over | `game://phase` + `game://game_over {outcome, accent}`; unknown keeps the phase ≤ 120 s |
| Role | CREWMATE/IMPOSTOR word, or teal/red letters on the black role screen; KILL/SABOTAGE buttons; red floating names; "Fake Tasks:" header (round only) | `game://role`; user toggle locks it (`myRoleLocked`) |
| Vote grid | `roster.rs` 1.2 s after the meeting opens, every 4 s, never under chat | names, colours (voted), dead (X **or** greyed plain card), headshots, **icon dHash**, dim ratio |
| Grid → roster | `src/engine/rosterMatch.ts` | name × icon hash × colour × same-meeting slot; slots re-read every meeting; roster confidence dot |
| "DEAD" header, room popup, nearby names, my task list, chat → claims | as before | task list not read under meetings / chat |
| Chat translation | `translate/google.rs` (keyless) after an English-word heuristic | `chatPatch {translated, lang}` under the bubble |
| New game | role card after a played match, or the lobby | roll-over keeps names/colours/headshots, wipes the slate |

### Detection facts measured on real frames (don't re-derive)
- Vote-grid icons ≈ 0.75·palette + 60; dead cards ≈ 0.45·that + 20; dead X = dim orange-red
  band on the icon diagonals (score ≥ 700). Plain dead card strip ≈ 0.53 of the brightest
  card (threshold 0.74, only when the strip is neutral: cosmetic nameplates are coloured).
- Icon dHash (cell-local 6..134 × 2..90): same card across the fade-in frames ≤ 12 bits apart
  and always closer than any other card (test on `meeting_vote_grid` / `_2`).
- Role screen: ≥ 75 % black in the role-card region with ≥ 300 sampled teal pixels on both
  role-card fixtures; lobby/round/meeting/eject/vote frames never look dark.
- Chat panel open: "Send" button or the "N/100" counter. The panel covers the meeting header
  but not the voting timer (1300,915,430,60).
- Grid cells fill without gaps: a lone later cell is UI text (the frontend drops it).
- Only `en-US` OCR is installed on this PC.

### UI (meeting-tablet look, thin window)
Top bar: brand, role pill, alive/imp, phase pill (CREWMATE teal / IMPOSTOR red at round
start, VICTORY blue / DEFEAT red at the end). Then: meeting panel (vote card, room
momentum, Say / Ask with a copy button per line, watch-for folded, manual claim/vote
folded), roster (headshot cards with `here` / `with me` and `sus` / `clear` / `hard`
toggles; marks recolour the card and persist until the game ends; confidence dot), then
folded Timeline / Controls / Screen reading / Hotkeys. Chat dock pinned at the bottom
(white outlined bubbles, headshot outside, translation line); click = full window, click
the bar = shrink. Ghost and impostor panels unchanged apart from removed explainer text.

### Known gaps / next
1. **Victory / defeat screen never seen live.** Colour fallback is UNVERIFIED; once a frame
   exists add it to the fixtures and a `screen_accent` test. Impostor-side "Victory" is
   assumed red (mapped to victory when myRole = impostor).
2. Chat dock expanded view not visually checked yet (only the collapsed state was seen live).
3. Translation only exercised on English lines (detected `en`, no change); a non-English
   lobby will show the first real translations — watch for the endpoint rate-limiting.
4. Many lobby-created players show grey/"(Black)" until the grid colour-votes settle;
   consider taking the chat-icon colour on the first read when the card colour is a placeholder.
5. Every Rust rebuild restarts the app (match resumes from the log within 20 min; headshots
   now resume from `avatars_<id>.json`).
6. Signal helper (ghost image role) and sabotage banner: still no frames.
7. "I'm not dead" (ghost panel) marks me alive and ignores death reads for the rest of that
   meeting (`Player.aliveLockMeeting`); the DEAD header now needs a still frame with no banner.
   William was falsely read dead once tonight — if it recurs, log which signal fired.

## Toolchain (unchanged): Node 24.19, Rust 1.97.1, Tauri 2.12.4, windows 0.62.2,
windows-capture 2.0.1, Vite 8.3.5, Vitest 5.0.5. Among Us v19s 7489, 1920×1080 borderless
on the primary monitor; app on the left monitor. Tests: Vitest 53, Rust 28 (OCR against the
20 real frames in `src-tauri/fixtures/`).

## Open questions for William
- Stay on the victory/defeat screen a few seconds once so a frame can be captured.
- Does the copy button paste cleanly into the game chat? (Clipboard via WebView2.)
- Is the collapsed chat dock the right height (168 px) for the thin window?

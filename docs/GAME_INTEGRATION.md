# Game integration — how AboveThem reads Among Us

## TL;DR

- **Primary path (always available): screen capture + OCR + pixel color sampling.**
  Works on official servers, needs no mod, touches nothing in the game process.
- **Secondary path (opt-in, custom servers only): a BepInEx exporter mod** that
  publishes a *strictly allow-listed* subset of game state over localhost.
- We do **not** read process memory, hook the client, or sniff the network.
  Innersloth bans for client tampering on official servers, and any of those
  approaches would also make it trivially easy to drift into actual cheating.

---

## 1. Why not just mod the game?

| Approach | Official servers | Effort | Risk |
|---|---|---|---|
| Screen capture + OCR | ✅ allowed (it's your screen) | medium | zero ban risk |
| BepInEx mod exporting state | ❌ modded clients are expected on custom servers only | medium-high | account risk on official; breaks every game update |
| Memory reading (ReadProcessMemory) | ❌ | high | ban risk + it's cheating-adjacent |
| Packet sniffing | ❌ | high | same |

Decision (see `decisions.md` ADR-002): OCR is the product. The mod is a nice-to-have
for modded lobbies with friends where the exporter can also be *richer* (exact
chat text with sender color, exact task list) without any guessing.

---

## 2. Screen capture

- Use the **Windows Graphics Capture** API (Win10 1903+). Captures the Among Us
  window by HWND even when another window is focused, and handles
  fullscreen-windowed. Candidate crates: `windows-capture`, or raw
  `windows::Graphics::Capture` via the `windows` crate. Evaluate both in Phase 1;
  pick whichever gives a stable BGRA frame callback with the least ceremony.
- Find the window by process name `Among Us.exe` / title `Among Us`.
- Frames are downscaled to a **reference resolution** (1920×1080) before ROI
  cropping so all region definitions are resolution-independent. Among Us scales
  its UI uniformly with aspect-ratio letterboxing, so a single normalised
  coordinate space works. Store per-aspect-ratio ROI sets (16:9, 16:10, 21:9).

### 2.1 Calibration

Ship a **Calibrate** screen: user opens Among Us in a lobby, the app shows the
captured frame with draggable ROI boxes (chat panel, chat input, vote grid, task
list, role reveal card, map/lobby code area). Save per-resolution. This is the
thing that will actually make OCR reliable — hard-coded rects will drift with
updates and aspect ratios.

---

## 3. Regions of interest (ROIs)

All coordinates below are *starting guesses* in 1920×1080 normalised space and
MUST be confirmed with real screenshots in Phase 1. Treat them as placeholders.

| ROI | Purpose | Notes |
|---|---|---|
| `task_list` (top-left) | Read own task list; detects Impostor "Fake Tasks:" header | Also yields task completion ticks |
| `role_card` (center, start of round) | "Crewmate"/"Impostor" + teammate names | Shown ~3 s; capture burst at round start |
| `vote_grid` (meeting panel) | Player name + color swatch + alive/dead X + "I voted" marker | Name text OCR + color sample at fixed offset left of name |
| `chat_panel` | Streaming chat lines: `[color swatch] Name: text` | OCR by line; dedupe by hash; sender color via swatch sampling |
| `chat_input` | Our outgoing message (for translator echo) | optional |
| `meeting_header` | "Who Is The Impostor?" / "Emergency Meeting" / "Dead Body Reported" + who called it | Phase detection |
| `eject_text` | "X was The Impostor" / "X was not The Impostor" / "X was ejected" | Updates known-innocent / known-impostor + counts |
| `map_name` | Lobby screen map name; also detect from room-label OCR during round | Selects `data/maps/<map>.json` |
| `sabotage_banner` | Reactor/O2/Comms/Lights alerts | Timeline events |

### 3.1 OCR engine

- **Windows.Media.Ocr** (WinRT) — built into Windows, supports the game's
  languages via installed language packs, ~20–60 ms per small ROI. Access from Rust
  via the `windows` crate (`Windows.Media.Ocr`, `Windows.Graphics.Imaging`).
- Pre-process: upscale ROI 2×, convert to grayscale, threshold (chat text is
  high-contrast dark-on-light; vote grid is light-on-dark — use per-ROI polarity).
- Fallback: `tesseract` via `rusty-tesseract` if WinRT OCR is missing a language.
- Only OCR an ROI when its perceptual hash changes (cheap `blockhash`/`dhash`).

### 3.2 Player colors (pixel sampling)

Sample the swatch at a fixed offset from each OCR'd name and nearest-neighbour
match against the in-game palette. Approximate sRGB values (verify against
screenshots; lighting/shading on the crewmate sprite varies, so sample the flat
part of the swatch or the name-text color where applicable):

| Color | Hex (approx) |
|---|---|
| Red | #C51111 |
| Blue | #132ED1 |
| Green | #117F2D |
| Pink | #ED54BA |
| Orange | #EF7D0D |
| Yellow | #F5F557 |
| Black | #3F474E |
| White | #D6E0F0 |
| Purple | #6B2FBB |
| Brown | #71491E |
| Cyan | #38FEDC |
| Lime | #50EF39 |
| Maroon | #6B2B3C |
| Rose | #ECC0D3 |
| Banana | #F0E7A8 |
| Gray | #708496 |
| Tan | #928776 |
| Coral | #EC7578 |

Use CIELAB distance, not RGB, for matching. Confidence threshold → otherwise mark
color `unknown` and let the user fix it with one click.

### 3.3 Phase detection

State machine driven by cheap template checks (not OCR):

```
Lobby ──(role_card visible)──▶ RoundStart ──▶ Round
Round ──(meeting_header visible)──▶ Meeting(discussion) ──▶ Meeting(voting)
Meeting ──(eject_text visible)──▶ Ejection ──▶ Round
Any ──(victory/defeat banner)──▶ GameOver ──▶ Lobby
```

Phase changes are the backbone of the timeline: every observation gets stamped
with `round index` + `seconds since round start`, which is what makes
"where were you at ~0:40" questions possible.

---

## 4. Optional exporter mod (`mod/`)

- **Platform:** BepInEx 6 (IL2CPP) C# plugin, same loader every major Among Us
  mod uses. Built against the game's interop assemblies generated by BepInEx.
- **Transport:** local WebSocket on `127.0.0.1:47777`, JSON events.
- **Allow-list — the mod may export ONLY:**
  - Local player's own role, own task list, own color/name
  - Roster: name, color, alive/dead/disconnected (all visible in-game anyway)
  - Chat messages with sender (visible in-game)
  - Meeting events, vote results *as shown to the player* (respects anonymous votes setting)
  - Ejection text, sabotage start/stop, phase changes
  - Map id
- **Deny-list — the mod must never export:** other players' roles, positions,
  vent usage not witnessed, kill cooldowns, impostor list when you're crew, anything
  behind the fog of war. Code review rule: if the field would give a crewmate
  information they don't have on screen, it does not ship.
- When the mod is connected, the app marks OCR-derived events as superseded by
  exact events; the engine does not care which source an event came from.
- `mod/` is a separate build; the main app must never depend on it.

---

## 5. What the user still has to do manually (and why that's fine)

OCR gives us chat, roster, phase, own tasks, ejections. It cannot give us
*who you saw where* — that's your eyes. So the overlay's entire input design is
built around logging that in ≤ 2 keypresses (see `UI_SPEC.md`). The payoff is in
meetings, where the app turns 6–10 half-remembered sightings into a ranked list
of questions.

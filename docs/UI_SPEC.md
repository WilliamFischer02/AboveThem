# UI spec — overlay

## TL;DR

Two layouts: **Overlay** (transparent, always-on-top strip on the edge of the
game) and **Docked** (normal window for a second monitor). Same components.
Input is designed for one hand on the keyboard during rounds and the mouse during
meetings.

## Panels

| Panel | Round | Meeting | Content |
|---|---|---|---|
| **Roster strip** | ✅ compact | ✅ expanded | 1 chip per player: color, name, status (alive/dead/ejected), clear state (hard/soft/none), sus bar, "with me" toggle. Click chip → mini menu (seen in room…, saw task, saw vent, mark sus, mark clear). |
| **Timeline** | ✅ | ✅ | Vertical, newest at top, `0:47 Red → Electrical (alone)`. Undo last with `Ctrl+Z`. |
| **Meeting** | — | ✅ | `MeetingScript`: headline, Ask (3), Say (3), Vote card, Watch-for. Each line has a "why" chevron that expands evidence. Chat lines appear here with one-click **Log claim** buttons (location / companion / task / accusation). |
| **Impostor** (only when role = Impostor) | ✅ | ✅ | Fake-task route, kill cooldown, lie ledger, alibi picks (3), defense coach (search-by-accusation-type). |
| **Translator** | ✅ | ✅ | Incoming lines (translated), outgoing box, target language selector with Auto/Pinned, back-translation. |
| **Settings** | — | — | Capture target, calibration, hotkeys, provider keys, lobby presets (impostor count, cooldown, visuals, confirm ejects, anon votes, task bar). |

## Hotkeys (defaults, all rebindable)

```
Global chord prefix:  Ctrl+Alt       (configurable; must not collide with game)
Color keys:           r red, b blue, g green, p pink, o orange, y yellow,
                      k black, w white, u purple, n brown, c cyan, l lime,
                      m maroon, s rose, a banana, e gray, t tan, x coral
Room keys:            per map, 1–2 chars (see data/maps/*.json "key")

Sighting:        <prefix> + <color> , <room>          "Red in Electrical"
With me:         <prefix> + <color> , .               toggle companion
Saw visual task: <prefix> + <color> , v
Saw vent:        <prefix> + <color> , !
Saw kill:        <prefix> + <color> , k
Body found:      <prefix> + b , <room>
Mark sus:        <prefix> + <color> , +
Mark clear:      <prefix> + <color> , -
My room:         <prefix> + / , <room>                 (where *you* are; anchors "with me")
Undo:            Ctrl+Z (overlay focused)  /  <prefix> + z (global)
Translator focus:<prefix> + t
Paste translated:<prefix> + Enter
Toggle overlay:  <prefix> + `
Impostor: kill done <prefix> + k k ; sabotage start <prefix> + s <l|r|o|c|d>
```

Chord feedback: a 1.5-s toast in the overlay corner shows what was logged.

## Visual rules

- Dark, high-contrast, **no blur**; crisp 1px borders; system font or Inter.
  Nothing that reads as "AI-generated SaaS gradient".
- Player colors use the in-game palette exactly; text on swatches must pass
  contrast (auto black/white).
- Overlay opacity is a slider; panels are individually collapsible; layout is
  saved.
- The meeting panel must be readable from a seated distance in ≤ 2 s. Ask/Say
  lines ≤ 90 chars.

## Accessibility of speed

Everything in the round view must be reachable by keyboard. Mouse is for
meetings (clicking chat lines to log claims) and setup.

# AboveThem.Exporter (optional BepInEx mod)

**Not required.** The main app works entirely from screen capture. This mod exists
for custom/modded servers where you play with friends and want exact data instead
of OCR.

## Rules (enforced in code review)
- Exports ONLY what the local player can already see: own role, own tasks, roster
  (name/color/alive), chat with sender, meeting/vote/eject events as displayed,
  sabotage state, map id, phase.
- NEVER exports other players' roles, positions, vent usage, kill cooldowns, or
  anything behind fog of war. If you're adding a field and a crewmate couldn't
  see it on screen, stop.
- Do not use on official servers.

## Build (Phase 5)
- BepInEx 6 IL2CPP (the loader used by Reactor/Town of Us). Generate interop
  assemblies by running the game once with BepInEx installed.
- Target net6.0; reference `BepInEx.Core`, `BepInEx.Unity.IL2CPP`, interop DLLs.
- Transport: WebSocket server on 127.0.0.1:47777, newline-delimited JSON matching
  the event shapes in `src/types/game.ts`.

See `AboveThem.Exporter/Plugin.cs` for the stub.

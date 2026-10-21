# AboveThem

> A Windows companion app for **Among Us** that turns raw observation into
> meeting-ready arguments as Crewmate, and keeps your story airtight as Impostor.
> Plus live chat translation so language is never the reason you lose a lobby.

A Goob Entertainment Co. project.

---

## TL;DR

- **What it is:** an always-on-top overlay/sidebar that runs next to Among Us.
- **Crewmate mode:** one-click observation logging → automatic alibi graph,
  contradiction detection, suspect ranking, and a generated *meeting script*
  (who to ask, what to ask, what to say, who to vote).
- **Impostor mode:** fake-task planner, lie ledger with consistency checking,
  unfalsifiable-alibi generator (built only from things you actually saw),
  accusation-response playbook, kill/sabotage timing.
- **Translator:** reads the in-game chat via screen OCR, auto-detects the
  language, translates to English, and lets you type replies that get translated
  back to (a) the last detected lobby language or (b) a language you pin.
- **How it reads the game:** screen capture + OCR (no memory reading, no
  injection, no network sniffing). An *optional* BepInEx exporter mod exists for
  custom/modded servers only. See `docs/GAME_INTEGRATION.md` for the reasoning.

## Hard rules (read before contributing)

1. **No information advantage.** AboveThem only ever works with information the
   local player can legitimately see on their own screen. It will never reveal
   roles, positions, or anything hidden. It makes you *better at reasoning*, not
   omniscient.
2. **No game memory reading, no DLL injection into the stock client, no
   packet sniffing.** Screen capture + OCR only. The optional exporter mod is
   opt-in, lives in `mod/`, and is for custom servers where mods are allowed.
3. **Everything the deduction engine says must be traceable to a logged
   observation.** No vibes. Every suspect score shows its evidence.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** (Rust) | Tiny footprint, native always-on-top transparent windows, no Chromium RAM tax while a game is running |
| UI | **Vite + React + TypeScript** | Your existing toolchain |
| State | Zustand (planned) | Simple, fast, serialisable snapshots for match replay |
| Capture | Windows Graphics Capture API (Rust `windows` crate / `windows-capture`) | Official, fast, works with fullscreen-windowed |
| OCR | `Windows.Media.Ocr` (built into Windows 10/11) | Zero-install, fast, multi-language; Tesseract as fallback |
| Translation | Pluggable provider: DeepL / Google / LibreTranslate / local (Argos) | Pick by cost/privacy |
| Lang detect | `whatlang` / `lingua` (Rust) | Offline, instant |
| Optional mod | BepInEx (IL2CPP) C# plugin | Only for custom servers |

## Repo layout

```
AboveThem/
├─ PROMPT.md               ← the startup prompt. Copy it into Claude Code on first run.
├─ CLAUDE.md               ← persistent project context for Claude Code
├─ README.md
├─ docs/
│  ├─ ARCHITECTURE.md      ← system design, data flow, process model
│  ├─ GAME_INTEGRATION.md  ← how we read the game (OCR regions, color sampling, optional mod)
│  ├─ DEDUCTION_ENGINE.md  ← the crewmate reasoning model (alibi graph, scoring, scripts)
│  ├─ IMPOSTOR_PLAYBOOK.md ← deception model (lie ledger, alibi gen, accusation defense)
│  ├─ TRANSLATION.md       ← chat OCR → detect → translate → reply pipeline
│  ├─ UI_SPEC.md           ← overlay layout, hotkeys, one-hand input design
│  ├─ ROADMAP.md           ← phased plan with acceptance criteria
│  ├─ decisions.md         ← ADR log (append-only)
│  └─ handoff.md           ← session handoff protocol + current state
├─ src/                    ← React/TS frontend
│  ├─ types/game.ts        ← canonical domain model
│  ├─ engine/              ← pure TS deduction + deception logic (no UI, fully testable)
│  ├─ data/maps/*.json     ← per-map rooms, vents, visual tasks, common tasks, task durations
│  ├─ data/tactics/*.json  ← structured tactic/playbook content the engine serves up
│  ├─ state/               ← store
│  └─ ui/                  ← components
├─ src-tauri/              ← Rust backend: capture, OCR, hotkeys, translation providers
├─ mod/                    ← OPTIONAL BepInEx exporter (custom servers only)
└─ .claude/                ← Claude Code settings
```

## Quick start (dev)

```powershell
# prerequisites: Node 20+, Rust stable (rustup), Visual Studio Build Tools w/ C++ + Windows 10/11 SDK
npm install
npm run tauri dev
```

The scaffold compiles to an empty window on purpose. Phase 0 in `docs/ROADMAP.md`
is "make the scaffold build on your machine", then the real work starts.

## Status

Scaffold only. See `docs/handoff.md` for the live state of the project.

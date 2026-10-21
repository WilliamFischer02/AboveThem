# Roadmap

Each phase has acceptance criteria. Don't start the next phase until the current
one's criteria pass on William's actual machine.

## Phase 0 — Scaffold builds (≤ 1 session)
- [ ] `npm install && npm run tauri dev` opens an empty always-on-top window on Windows
- [ ] `npm test` runs Vitest; `src/engine/suspicion.test.ts` passes
- [ ] Rust side compiles with the `windows` crate feature set we need (Graphics.Capture, Media.Ocr, Graphics.Imaging)
- [ ] `docs/handoff.md` updated with exact toolchain versions that worked

## Phase 1 — Manual-input companion (the MVP that's already useful)
No OCR yet. Everything typed/clicked/hotkeyed.
- [ ] Lobby preset entry (players, colors, names, impostor count, settings)
- [ ] Hotkey chords log sightings/with-me/visual/vent/kill/body with toast + undo
- [ ] Timeline + roster panels
- [ ] Engine: hard constraints, alibi graph, soft scoring, explanations
- [ ] Meeting panel renders a `MeetingScript` for a hand-logged fixture match
- [ ] Vote outcome entry → impostor count + clears updated
- [ ] NDJSON match log + `dev:replay`
- [ ] Skeld map data verified against the live game (rooms, vents, visuals, commons, durations)
**Acceptance:** play 3 real lobbies with it docked on a second monitor; it should be
*faster* than a notepad and the meeting script should be usable at least once per game.

## Phase 2 — Screen capture + phase detection + roster OCR
- [ ] Capture Among Us window via Windows Graphics Capture; calibration screen with draggable ROIs saved per resolution
- [ ] Phase state machine from UI markers (lobby/round/meeting/voting/eject/end)
- [ ] Vote grid OCR → roster auto-populated (names + colors + alive/dead)
- [ ] Ejection text OCR → engine update
- [ ] Own task list OCR; detects Impostor via "Fake Tasks" header or role card
- [ ] Fixture screenshots in `src-tauri/fixtures/screens/` with an OCR regression test
**Acceptance:** start a lobby, app auto-fills roster and flips to meeting mode by itself ≥ 90 % of meetings.

## Phase 3 — Chat OCR + translator
- [ ] Chat ROI streaming OCR with dedupe
- [ ] Sender color + name fuzzy-match to roster
- [ ] Offline language detect; lobby language histogram
- [ ] Provider trait + DeepL impl (+ LibreTranslate as keyless fallback)
- [ ] Outgoing translate → clipboard → paste hotkey; back-translation preview
- [ ] One-click "log claim" from a chat line → contradiction engine
**Acceptance:** play a non-English lobby and follow the whole meeting from the overlay.

## Phase 4 — Impostor mode
- [ ] Lie ledger with risk scoring and dependency flags
- [ ] Alibi generator from real sightings + map geometry
- [ ] Fake-task planner/route with durations and visual/common rules
- [ ] Kill cooldown + sabotage coach
- [ ] Defense coach keyed by accusation type, templated with ledger data
- [ ] Partner tracking (opt-in)
**Acceptance:** win rate as impostor over 10 games is not worse than without the app, and you never get caught on a ledger contradiction.

## Phase 5 — Learning loop + polish
- [ ] Post-match review: compare suspicion ranking vs revealed roles; nudge weights (simple logistic fit over match logs)
- [ ] Other maps: MIRA HQ, Polus, Airship, The Fungle — data + verification
- [ ] Overlay click-through, opacity, layout persistence
- [ ] Optional BepInEx exporter mod for custom servers (allow-list enforced)
- [ ] Installer (MSI via Tauri bundler), auto-update

## Explicitly out of scope (forever)
- Reading game memory, hooking the client, packet capture
- Revealing roles/positions/anything not on your screen
- Auto-playing: the app never sends inputs to the game except pasting your own chat message on your hotkey

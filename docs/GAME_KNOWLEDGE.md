# GAME_KNOWLEDGE — Among Us rules, lie checks, pro heuristics, chat slang

> Owner: research agent. Audience: every engine / parser / UI agent.
> Game version scope: Among Us 2024–2026 (v17.x, roles incl. Detective/Viper/Judge/Influencer). Maps: Skeld, MIRA HQ, Polus, Airship, Fungle.
> **Rule of use:** anything tagged **U** must not drive a hard (certain) verdict. Map data in `src/data/maps/*.json` wins over this doc for room/vent/task tables once it is `_verified`.

## TL;DR

- **Tags:** **F** = fact, ≥ 2 independent sources (or two separate wiki pages that agree). **F1** = fact from a single source (the community wiki). **H** = community heuristic/strategy. **U** = uncertain/contradicted; never use as hard evidence.
- The most powerful legit checks a crewmate has, in order: **saw a visual task (visuals on)**, **common-task mismatch**, **two-together-one-dies**, **saw vent**, **travel time impossible**, **monitor (admin/cams/vitals/doorlog) contradicts the claim**, **task does not exist in that room / on that map**, **story changed between meetings**.
- Hard timing anchors: kill cooldown starts at **10 s** at game start, resets to the **full lobby value at every meeting end** and after every kill, and **pauses inside vents and while on Security**. So no kill can happen in the first `cooldown` seconds after a meeting.
- Critical sabotage timers: **Skeld 30 s, MIRA 45 s, Polus 60 s, Fungle 60 s, Airship 90 s** (wiki Sabotage page + map pages + gamewith.net/among-us-wiki/article/show/22107). Reporting a body ends critical sabotage, never Lights or Comms.
- Comms sabotage blinds **Admin, Cams, Vitals, Doorlog** (not Fungle binoculars). Any "I saw it on admin/cams" claim made for a comms window is false.
- Visual tasks: **Skeld** = Submit Scan, Clear Asteroids, Prime Shields, Empty Garbage/Chute (Storage stage). **Polus** = Submit Scan, Clear Asteroids. **MIRA** = Submit Scan only. **Airship, Fungle** = none.
- §2 is a catalogue of **61 lie checks**; the machine-readable version is `src/data/tactics/lieChecks.json`.
- Per-map facts the checks need (sabotage fix rooms, door rooms, monitors + camera coverage, dummy panels, Airship spawns, visual/common task pools, rules) are in **`src/data/gameFacts.json`** (tested against the Skeld/Polus map JSON).

### Source key (inline links use these)

| Short | URL |
|---|---|
| W:Options | https://among-us.fandom.com/wiki/Options |
| W:Tasks | https://among-us.fandom.com/wiki/Tasks |
| W:Visual | https://among-us.fandom.com/wiki/Visual_tasks |
| W:Vent | https://among-us.fandom.com/wiki/Vent_(object) and https://among-us.fandom.com/wiki/Vent |
| W:Sabotage | https://among-us.fandom.com/wiki/Sabotage |
| W:Kill | https://among-us.fandom.com/wiki/Kill |
| W:Meeting | https://among-us.fandom.com/wiki/Emergency_meeting |
| W:Report | https://among-us.fandom.com/wiki/Report |
| W:Ejection | https://among-us.fandom.com/wiki/Ejection |
| W:Ghost | https://among-us.fandom.com/wiki/Ghost |
| W:Vitals | https://among-us.fandom.com/wiki/Vitals |
| W:Doorlog | https://among-us.fandom.com/wiki/Doorlog |
| W:Admin | https://among-us.fandom.com/wiki/Admin_(ability) |
| W:Security | https://among-us.fandom.com/wiki/Security_(ability) and https://among-us.fandom.com/wiki/Camera |
| W:Vision | https://among-us.fandom.com/wiki/Vision |
| W:Speed | https://among-us.fandom.com/wiki/Player_speed |
| W:Lights | https://among-us.fandom.com/wiki/Fix_Lights |
| W:Doors | https://among-us.fandom.com/wiki/Doors and https://among-us.fandom.com/wiki/Door_Sabotage |
| W:Button | https://among-us.fandom.com/wiki/Emergency_button |
| W:CrewGuide | https://among-us.fandom.com/wiki/Guide:Crewmate |
| W:ImpGuide | https://among-us.fandom.com/wiki/Guide:Impostor |
| W:Faking | https://among-us.fandom.com/wiki/Guide:Faking_tasks |
| W:Skeld / W:MIRA / W:Polus / W:Airship / W:Fungle | https://among-us.fandom.com/wiki/The_Skeld, /MIRA_HQ, /Polus, /The_Airship, /The_Fungle |
| W:Ladder / W:Zipline / W:Platform / W:Mixup | https://among-us.fandom.com/wiki/Ladder, /Zipline, /Moving_platform, /Mushroom_Mixup |
| W:Roles | https://among-us.fandom.com/wiki/Roles (+ per-role pages: Engineer, Scientist, Noisemaker, Tracker, Detective, Judge, Guardian_Angel, Influencer, Shapeshifter, Phantom, Viper) |
| Glossary | https://eathealthy365.com/a-glossary-for-every-among-us-player/ ; r/AmongUs wiki glossary (mirror) https://pol1.lr.ggtyler.dev/r/AmongUs/wiki/glossary |
| Settings guides | https://www.pcgamesn.com/among-us/settings-best ; https://sportskeeda.com/esports/news-among-us-recommended-settings-streamers-use ; https://gamewith.net/among-us-wiki/article/show/22148 |
| Marinate | https://www.sportskeeda.com/esports/marinating-friends-among-us ; https://inverse.com/gaming/among-us-visual-dictionary-sus-marinate-afk/amp |
| v17 roles | https://nintendoeverything.com/among-us-update-adds-detective-and-viper-roles-17-0-0-patch-notes/ ; https://www.nintendolife.com/news/2025/09/among-us-latest-update-adds-two-new-roles |

Wiki pages were pulled on 2026-10-22 through the MediaWiki API (`api.php?action=parse&prop=wikitext`) because the HTML pages return HTTP 402 to fetchers.

---

## 1. Core mechanics that constrain lies

### 1.1 Lobby settings (ranges + defaults)

| Setting | Range / steps | Default | Tag | Source |
|---|---|---|---|---|
| # Impostors | 1 / 2 / 3 | none (host picks) | F1 | [W:Options](https://among-us.fandom.com/wiki/Options) |
| Max impostors by lobby size | 1 impostor needs ≥ 4 players, 2 need ≥ 7, 3 need ≥ 9 | — | F1 (wiki options screenshot, marked outdated; matches decompiled `GameOptionsData` from memory) | https://among-us.fandom.com/wiki/File:Options_screenshot_outdated.png |
| Kill cooldown | 10 s – 60 s in 2.5 s steps | 45 s on the wiki options table and in a Steam thread (another commenter says 15 s); the `Core Settings` preset value is not documented | F (range) / **U** (default) | [W:Options](https://among-us.fandom.com/wiki/Options), [W:Kill](https://among-us.fandom.com/wiki/Kill), https://steamcommunity.com/app/945360/discussions/0/4246299157464089949 |
| Kill distance | Short / Medium / Long | Medium | F1 | W:Options |
| Kill distance in world units | Short 1.0, Medium 1.8, Long 2.5 | — | **U** (decompiled-code folklore, no fetched source) | — |
| Impostor vision | 0.25×–5× in 0.25 steps | 1.5× | F | W:Options, [W:Vision](https://among-us.fandom.com/wiki/Vision) |
| Crewmate vision | 0.25×–5× | 1× | F | W:Options, W:Vision |
| Player speed | 0.5×–3× in 0.25 steps | 1× | F | W:Options, [W:Speed](https://among-us.fandom.com/wiki/Player_speed) |
| # Emergency meetings (per player) | 0–9 | 1 | F | W:Options, [W:Button](https://among-us.fandom.com/wiki/Emergency_button) |
| Emergency cooldown | 0–60 s (5 s steps) | 15 s | F1 | W:Options |
| Discussion time | 0–120 s (15 s steps) | 15 s | F1 | W:Options |
| Voting time | 0–300 s (15 s steps) | 120 s | F1 | W:Options |
| Anonymous votes | on / off | off | F1 | W:Options |
| Confirm ejects | on / off | on | F | W:Options, [W:Ejection](https://among-us.fandom.com/wiki/Ejection) |
| Task bar updates | Always / Meetings / Never | Always | F | W:Options, [W:Tasks](https://among-us.fandom.com/wiki/Tasks) |
| # Common / Long / Short tasks | 0–2 / 0–3 / 0–5 | 1 / 1 / 2 | F | W:Options, W:Tasks |
| Visual tasks | on / off | on | F | W:Options, [W:Visual](https://among-us.fandom.com/wiki/Visual_tasks) |
| Chat type | Free Chat / Quick Chat (set at lobby creation) | — | F1 | W:Options |
| Lobby capacity | 4–15 | — | F1 | W:Options |

Role settings (defaults): Engineer vent cooldown 30 s, max time in vent 15 s; Scientist battery 5 s, cooldown 15 s; Guardian Angel protect cooldown 60 s, duration 10 s; Tracker cooldown 15 s, duration 30 s, delay 1 s; Noisemaker alert 10 s (impostors get alert: on); Detective 3 suspects per case; Judge unlock at 50 % tasks; Influencer message cooldown 40 s; Shapeshifter duration 30 s, cooldown 10 s, evidence off; Phantom vanish 30 s, cooldown 15 s; Viper dissolve 15 s. **F1** ([W:Options](https://among-us.fandom.com/wiki/Options)).

**Win conditions (F):** crew win when all tasks are done (ghost crew tasks count) or all impostors are ejected; impostors win when alive impostors ≥ alive crew (1v1, 2v2, 3v3 is an instant loss) or a critical sabotage timer runs out ([W:CrewGuide](https://among-us.fandom.com/wiki/Guide:Crewmate), [W:Sabotage](https://among-us.fandom.com/wiki/Sabotage), [W:Tasks](https://among-us.fandom.com/wiki/Tasks)).

### 1.2 Kill and cooldown

| Fact | Tag | Source |
|---|---|---|
| First cooldown of the match is **10 s** regardless of settings; after that, every kill and every meeting end resets it to the lobby value. | F | [W:Kill](https://among-us.fandom.com/wiki/Kill), [W:CrewGuide](https://among-us.fandom.com/wiki/Guide:Crewmate) |
| ⇒ No kill can happen in the first `killCooldown` seconds after a meeting ends (lower bound on time of death). | F (derived) | same |
| Cooldown **pauses while the impostor is in a vent** and **while on Security cameras**. | F | W:Kill, [W:Vent](https://among-us.fandom.com/wiki/Vent), [W:Security](https://among-us.fandom.com/wiki/Security_(ability)) |
| One impostor cannot double kill; two impostors cannot triple kill (cooldown). Two bodies with a gap < cooldown ⇒ two different killers. | F | W:CrewGuide |
| Kill needs line of sight; walls block it, doors and some small props don't. Impostor teleports onto the victim. | F1 | W:Kill |
| Impostors cannot kill each other or ghosts. | F | W:Kill, W:CrewGuide |
| Kill music + animation plays only for the victim; the body (cut in half, bone sticking out) is visible to everyone in vision. A killed player's pet stays at the body. | F1 | W:Kill |
| Viper replaces Kill with Acid: the body dissolves after the Dissolve Time (default 15 s) and can then no longer be found. | F1 | [W:Viper](https://among-us.fandom.com/wiki/Viper), v17 patch notes |

### 1.3 Vision, lights, speed

- Crew vision default 1×, impostor 1.5×; **Lights sabotage shrinks living crew vision (~5× smaller radius); impostors and ghosts unaffected; cameras unaffected** (F: [W:Vision](https://among-us.fandom.com/wiki/Vision), [W:Lights](https://among-us.fandom.com/wiki/Fix_Lights)).
- Vision is blocked by walls and closed doors. **Door state and vent animations are visible even outside vision** (not Polus: its vents are holes with no animation) (F: W:Vision, W:Vent).
- Airship Main Hall photo darkroom shrinks crew vision like lights (impostors unaffected) (F1: W:Vision).
- Speed 0.5×–3×, default 1×. Ghosts move 1.2× (F1: [W:Speed](https://among-us.fandom.com/wiki/Player_speed), [W:Ghost](https://among-us.fandom.com/wiki/Ghost)).
- Room-to-room seconds at 1.0× are in `src/data/maps/<map>.json` (`adjacent[].sec`). They are **eyeballed** (U); scale by `1 / playerSpeed`. Use them only with a slack margin (≥ 30 %) for "impossible travel" verdicts.

### 1.4 Meetings, votes, ejection

| Fact | Tag | Source |
|---|---|---|
| Meeting = button press or body report. Overview → discussion (no voting) → voting → result. | F | [W:Meeting](https://among-us.fandom.com/wiki/Emergency_meeting), [W:Report](https://among-us.fandom.com/wiki/Report) |
| Meeting location: Skeld & MIRA → Cafeteria; Polus → Office; Fungle → Meeting Room; **Airship: players stay where they are, then each picks 1 of 3 offered spawns from {Brig, Cargo Bay, Engine Room, Kitchen, Main Hall, Records} (10 s, random if none)**. | F | W:Meeting, [W:Airship](https://among-us.fandom.com/wiki/The_Airship) |
| Button cannot be used during any sabotage **except doors and Mushroom Mixup** ("EMERGENCY MEETINGS CANNOT BE CALLED DURING CRISES"). Reports always work. | F | W:Meeting, [W:Button](https://among-us.fandom.com/wiki/Emergency_button), [W:Sabotage](https://among-us.fandom.com/wiki/Sabotage) |
| A report **ends critical sabotages** (reactor, O2, seismic, crash course) and Skeld door sabotage; it does **not** fix Lights or Comms. | F | W:Report, W:Sabotage, W:Lights |
| Emergency cooldown (default 15 s) after each meeting before the button works again. Button UI shows "CREWMEMBER <name> HAS 0 EMERGENCY MEETINGS LEFT". | F | W:Button, W:Options |
| **When any meeting starts, every body on the map disappears** and can never be reported. | F | W:Meeting, W:Report |
| The caller gets a megaphone icon on their nameplate. Reporter vs. button caller use different splash screens. | F1 | W:Meeting |
| Most votes is ejected; **skip-plurality, ties (incl. tie with skip) or no votes ⇒ nobody ejected**. | F | W:Meeting, W:Ejection |
| Confirm ejects ON: "`<P>` was (not) An Impostor. `N` Impostor(s) remain(s)." OFF: "`<P>` was ejected." The **role** (Engineer, Shapeshifter …) is never revealed. Skip/tie: "No one was ejected. (Skipped/Tie)". | F | W:Ejection |
| Anonymous votes ON: all vote chips are dark grey (who voted whom is hidden; counts still visible). | F1 | W:Options |
| Meeting kick needs ≥ 3 players' kick votes. Ghosts cannot vote or kick. | F1 | W:Meeting, W:Ghost |
| 37 % of meetings are button calls, 63 % body reports (Innersloth tweet). | F1 | W:Meeting |
| Kill + meeting on the same frame: victim shows alive in the meeting, body appears afterwards near the button / under the killer. | F1 (glitch) | W:Meeting, W:Button |

### 1.5 Tasks

| Fact | Tag | Source |
|---|---|---|
| Three kinds: common, long, short. **Common tasks are identical for every crewmate**: if one crewmate has Swipe Card, all do; if you don't have it, nobody does. Impostor fake lists also show the commons. | F | [W:Tasks](https://among-us.fandom.com/wiki/Tasks), [W:CrewGuide](https://among-us.fandom.com/wiki/Guide:Crewmate), [W:Faking](https://among-us.fandom.com/wiki/Guide:Faking_tasks) |
| Task list order: commons first, then long, then short. | F1 | W:Tasks |
| Multi-stage tasks only move the bar when the **final** stage is done. A yellow arrow points at the next stage (hidden during Comms). | F | W:Tasks, [W:Faking](https://among-us.fandom.com/wiki/Guide:Faking_tasks) |
| Task bar modes: Always (updates on completion), Meetings (updates at meeting start), Never (hidden). Comms removes the bar's progress. | F | W:Tasks, W:Options, W:Sabotage |
| Zero tasks configured ⇒ everyone gets 1 random short task. | F1 | W:Tasks |
| Ghost crewmates keep doing tasks (count toward the win). | F | W:Ghost, W:Tasks |
| Same task can be a different type per map (Fuel Engines long on Skeld/Polus/Airship, short on MIRA). Task type is map-specific. | F | W:Tasks |

**Common tasks per map (F, W:Tasks table + map pages):**

| Map | Possible common tasks |
|---|---|
| Skeld | Fix Wiring, Swipe Card (Admin) |
| MIRA HQ | Fix Wiring, Enter Id Code (Admin) |
| Polus | Fix Wiring, Swipe Card (Office), Insert Keys (Dropship), Scan Boarding Pass (Office) |
| Airship | Fix Wiring, Enter Id Code (Meeting Room) |
| Fungle | Collect Samples (Jungle → Laboratory), Enter Id Code (Lookout), Replace Parts (Reactor/Upper Engine → Communications/Dropship), Roast Marshmallow (Beach sand pile → campfire). **Fix Wiring is SHORT on Fungle.** |

**Visual tasks (F: [W:Visual](https://among-us.fandom.com/wiki/Visual_tasks), W:Tasks, map pages):**

| Task | Skeld | MIRA | Polus | Airship | Fungle |
|---|---|---|---|---|---|
| Submit Scan (MedBay / Polus MedBay in Lab) | ✓ visual | ✓ visual | ✓ visual | — | — |
| Clear Asteroids (Weapons; MIRA Balcony) | ✓ visual | present, **not** visual | ✓ visual | — | — |
| Prime Shields (Shields; MIRA Admin) | ✓ visual | present, **not** visual | — | — | — |
| Empty Garbage / Empty Chute (final stage in Storage) | ✓ visual | not visual | not visual | not visual | not visual |

- Visuals OFF: only the doer sees the effect. Players who forgot the setting wrongly accuse genuine crew (F: W:Visual).
- **Submit Scan works as a clear even with visuals off**: if you try to scan while someone is scanning you get "Waiting for `<name>`" (F1: W:CrewGuide).
- Ghosts doing Asteroids / Shields / Garbage still show the visual; ghost Submit Scan does not (F: W:Visual, W:Ghost). A visual animation with nobody visible there means a ghost — not evidence about any living player.
- Airship effects of Put Away Pistols/Rifles, Pick Up Towels, Decontaminate are only seen by the doer ⇒ **not** visual (F1: W:Visual).

**Stage orders that catch fakers (F: W:Tasks list + W:CrewGuide "Know the order of the tasks"):**

- Skeld Fix Wiring: 3 panels, always in order Electrical → Storage → Admin → Navigation → Cafeteria → Security (some panels sit in the corridor outside the named room). Stage 1 ∈ {Electrical, Storage, Admin, Navigation}; Stage 3 ∈ {Admin, Navigation, Cafeteria, Security}.
- MIRA Fix Wiring order: Storage → Hallway → Locker Room → Greenhouse → Laboratory.
- Polus Fix Wiring order: Electrical → O2 → Office → Decontamination → Laboratory (right) → Laboratory (left).
- Airship Fix Wiring order: Viewing Deck → Engine Room → Main Hall → Showers → Lounge → Cargo Bay → Meeting Room.
- Skeld Download (Cafeteria/Comms/Electrical/Navigation/Weapons) → **Upload always in Admin**. Polus Download (Electrical/O2/Office/Specimen/Weapons) → **Upload in Communications**. Airship Download (various) → Upload outside Security or at Viewing Deck.
- Divert Power: Skeld stage 1 always Electrical → Accept in Comms/Lower Engine/Nav/O2/Security/Shields/Upper Engine/Weapons. MIRA stage 1 Reactor. Airship stage 1 Electrical. **Divert Power does not exist on Polus or Fungle.**
- Skeld Empty Garbage: Cafeteria → Storage; Empty Chute: O2 → Storage. Align Engine: Upper → Lower. Fuel Engines (Skeld): Storage → Upper → Storage → Lower. Polus Fuel: Storage → outside right of Dropship → Storage → outside left.
- Download/Upload/Process Data takes **about 9–11 s** (7–8 s if closed at the end); a 5 s "download" is fake (F1: W:CrewGuide).
- Inspect Sample (Skeld/Polus MedBay): start, ~60 s wait, return (F1: map JSON note + W:Tasks).

**Dummy panels that look like tasks but are impossible to do (F: W:Tasks + W:CrewGuide):** Divert Power panel in Skeld Reactor; Divert Power panel in Polus Office; Fix Wiring panels in Airship Armory, Communications and Vault; Empty Garbage bin in Airship Lounge (near the stalls). **Anyone "doing" these is faking.**

### 1.6 Sabotage

| Fact | Tag | Source |
|---|---|---|
| Sabotage cooldown: 10 s at game start, 30 s after the previous sabotage (cooldown starts when the previous sabotage is **fixed**; door cooldowns start when the door sabotage **starts**). Impostor ghosts can sabotage. Impostors can fix sabotages too. | F (behaviour) / **U** (the 30 s value: some guides say ~17 s) | [W:Sabotage](https://among-us.fandom.com/wiki/Sabotage), [W:Doors](https://among-us.fandom.com/wiki/Door_Sabotage) |
| Skeld: door sabotage and other sabotages are mutually exclusive. Polus/Airship/Fungle: doors can be shut before (and on Polus during) other sabotages, but no door sabotage once another sabotage is running. | F | W:Sabotage, W:Doors |
| Non-door sabotage disables the emergency button. | F | W:Sabotage, W:Button |
| Comms disables task list, task arrows, task-bar progress, Admin, Cams (not Fungle binoculars), Vitals, Doorlog; also disables Engineer vent, Scientist vitals, Tracker, Noisemaker alert, Detective, Guardian Angel protect. **Impostors can still vent during comms.** | F | W:Sabotage, [W:Vent](https://among-us.fandom.com/wiki/Vent), [W:Security](https://among-us.fandom.com/wiki/Security_(ability)) |
| Lights: 1–5 of 5 switches flipped off; everyone shares the same switches (two people can undo each other; impostors can flip switches back off). | F1 | [W:Lights](https://among-us.fandom.com/wiki/Fix_Lights) |

**Per-map sabotage table (F unless tagged):**

| Map | Critical (timer, how fixed) | Lights | Comms | Doors | Other |
|---|---|---|---|---|---|
| Skeld | Reactor 30 s: 2 hand scanners in Reactor, held **simultaneously** · O2 30 s: keypads in **O2 and Admin** (same code) | Electrical | Communications (dial) | Cafeteria, Electrical, Lower Engine, MedBay, Security, Storage, Upper Engine — auto-open after 10 s | — |
| MIRA HQ | Reactor 45 s: 2 scanners in Reactor · O2 45 s: keypads in **Greenhouse** and the **hallway south-west near MedBay / south of Locker Room** | **Office** | Keypads in **Office + Communications** (code resets every ~10 s) | **none** (no door sabotage; Decontamination + Balcony doors are not sabotageable) | — |
| Polus | Seismic Stabilizers 60 s: 2 scanners on opposite sides of Dropship, simultaneously | Electrical | Outside (dial) by Communications | Communications, Electrical, Laboratory, O2, Office, Storage, Weapons — reopen by flipping 4 of 8 switches | no O2 sabotage |
| Airship | Avert Crash Course 90 s: keypads on both sides of **Gap Room**; code resets, both must be entered before reset | Panels in **Gap Room, Viewing Deck, Cargo Bay** (any one fixes it) | Communications (dial) | Brig, Kitchen, Main Hall, Medical, Records, hallway Engine Room↔Cockpit (**U**: the Doors page lists Vault instead of Kitchen) — reopen by swiping a card | — |
| Fungle | Reactor 60 s: 2 scanners in Reactor | **no lights** | Keypads in **Communications + Lookout** | Communications (2), Kitchen, Laboratory, Lookout, Mining Pit, Reactor, Storage (**U**: Greenhouse listed on the Door Sabotage page only) — remove 6 mushrooms | **Mushroom Mixup** (cast on Jungle): ~10 s, unfixable; all living players get random colour + cosmetics, names hidden from crew (impostors and ghosts still see names); button still usable |

Sources: [W:Sabotage](https://among-us.fandom.com/wiki/Sabotage), [W:Lights](https://among-us.fandom.com/wiki/Fix_Lights), [W:Doors](https://among-us.fandom.com/wiki/Doors), [W:Door_Sabotage](https://among-us.fandom.com/wiki/Door_Sabotage), [W:Mixup](https://among-us.fandom.com/wiki/Mushroom_Mixup), map pages.

### 1.7 Vents (exact networks)

General (F: [W:Vent](https://among-us.fandom.com/wiki/Vent), [W:Vent object](https://among-us.fandom.com/wiki/Vent_(object))):
- Impostors (alive) and Engineers vent. **Impostor vent cooldown is 0 s and time in vent is unlimited**; Engineer has a cooldown (default 30 s) and a max time (default 15 s) and **cannot vent during Comms**.
- Vent open/close animation is visible to anyone who can see the vent, **even outside vision** on Skeld, MIRA, Airship, Fungle (different "plant eats you" animation); **Polus vents are silent holes with no animation**.
- People inside a vent are invisible but **still show on Admin**.
- A crewmate starting Clean Vent ejects anyone inside that vent and blocks it.
- Ghost impostors cannot vent.
- **Polus has no Clean Vent task** (its vents are open holes) (F1: W:Polus).

| Map | Networks (each line = one connected system) | Tag |
|---|---|---|
| Skeld | {Admin, Cafeteria, Hallway (the long corridor joining Weapons, O2, Navigation and Shields — W:Skeld)} · {Electrical, MedBay, Security} · {Navigation upper, Weapons} · {Navigation lower, Shields} · {Reactor upper, Upper Engine} · {Reactor lower, Lower Engine}. No vents in Storage, Communications, O2. | F (W:Vent object + skeld.json) |
| MIRA HQ | **One system linking all 11 vents** (Admin, Balcony, Decontamination, Greenhouse, Hallway, Laboratory, Launchpad, Locker Room, MedBay, Office, Reactor). Direct links: Greenhouse–Office–Admin (triangle); Admin–Hallway; Hallway–Balcony; Balcony–MedBay; MedBay–Locker Room; Locker Room–Launchpad; Locker Room–Decontamination (vent page); Launchpad–Reactor; Reactor–Laboratory–Decontamination (triangle); Laboratory–Office. No vents in Cafeteria, Communications, Storage. | F (W:Vent object + W:MIRA; **U** for Locker Room–Decontamination, listed only on the vent page) |
| Polus | {Admin, Outside (by Admin), Outside (lava), Laboratory} · {Electrical, O2, Outside (below Electrical)} · {Office, Storage, Outside (by Communications)} · {Outside (by Laboratory), Outside (above Electrical)}. No vents in Boiler Room, Communications, Dropship, MedBay, Security, Specimen, Weapons, Decontamination. | F (W:Vent object + polus.json) |
| Airship | {Cockpit, Vault, Viewing Deck} (Vault and Viewing Deck only link to Cockpit) · {Engine Room, Kitchen, Main Hall (lower)} · {Gap Room left, Gap Room right, Main Hall (upper)} · {Cargo Bay, Records, Showers}. **Main Hall has two vents in two different systems.** No vents in Armory, Brig, Comms, Electrical, Hall of Portraits, Lounge, Medical, Meeting Room, Outside, Security, Ventilation. | F (W:Vent object + W:Airship) |
| Fungle | {Beach upper, Beach right, Splash Zone, Laboratory} · {Jungle (×3), Kitchen} · {Reactor, Lookout, The Cliffs/Communications vent}. | F for the three systems; **U** for edges: the vent page says "Communications → Lookout, Reactor" while the map page says "The Cliffs"; Jungle internal links differ between the two pages. |

### 1.8 Monitoring stations (what the local player can check)

| Map | Admin | Cameras / Security | Vitals | Doorlog |
|---|---|---|---|---|
| Skeld | Admin room table | Security room: 4 feeds on one screen — hallway Weapons↔Shields incl. O2 accept-power panel and a vent (camera left of Nav); hallway Admin/Cafeteria/Storage (camera left of Admin); hallway MedBay/Cafeteria/Upper Engine (outside MedBay); hallway Security↔Reactor (right of Reactor) | none (Scientist only) | — |
| MIRA HQ | Admin room table | **none** | none | **Communications** (rightmost PC): 3 sensors at the ends of the central Hallway — north (blue), south-west (green), south-east (orange); 5 s per-player re-log cooldown; last 20 entries; logs **original identity even for a shifted Shapeshifter**; Comms wipes the display until fixed |
| Polus | Admin room (does **not** cover Outside or hallways) | Security: 6 feeds, one at a time (arrow, ~1 s static): East (outside Office right / Record Temperature + Upload), Central (Comms fix panel, fake divert panel), North-east (outside Lab, weather node MLG, a vent), South (outside Office/Admin SW entrance, a vent, a wiring panel), South-west (outside O2, part of Boiler, Empty Garbage), North-west (outside Electrical, a Fuel stop, a vent) | **Office** | — |
| Airship | **Cockpit** and **Records** tables | Security room: 6 views (7 cams): Engine Room left entrance, Vault right entrance, Records (2 cams merged), Security left entrance, Cargo Bay left entrance (vent not visible), Meeting Room above the ladder. No vents visible on any camera. | **Medical** | — |
| Fungle | **none** | **Binoculars in Lookout**: scan Beach and Jungle (not The Cliffs); **not disabled by Comms** | **Laboratory** | — |

Sources: [W:Admin](https://among-us.fandom.com/wiki/Admin_(ability)), [W:Security](https://among-us.fandom.com/wiki/Security_(ability)), [W:Camera](https://among-us.fandom.com/wiki/Camera), [W:Vitals](https://among-us.fandom.com/wiki/Vitals), [W:Doorlog](https://among-us.fandom.com/wiki/Doorlog), [W:Binoculars](https://among-us.fandom.com/wiki/Binoculars).

Monitor rules:
- **Admin** shows grey, anonymous icons per room (vent occupants included); no exact positions, no hallways, no Polus Outside. **Dead bodies still show as icons at the place of death until the next meeting** (F: [Dead body](https://among-us.fandom.com/wiki/Dead_body) + [W:Ghost](https://among-us.fandom.com/wiki/Ghost); the Admin page's "victim disappears" line is the minority reading). ⇒ an admin count of N in a room can include bodies. The old "kill flash" (a victim's icon blinking at the moment of the kill) was **removed in the March 2021 update** — a kill no longer changes the icons (F1: https://automaton-media.com/articles/newsjp/20210306-154125/; the Admin wiki page still describes the old blink, treat that as outdated).
- **Cameras**: while a **living** player watches, every camera blinks red (Skeld: light on top; Polus/Airship: inside the dome) — visible to anyone near a camera. Ghost viewers don't trigger it. On Polus/Airship a player can stand in front of a camera to hide the blink. Rapid in/out of Security can avoid the blink; sometimes no blink during lights (F1). Watchers cannot see their own surroundings or report; impostors on cams cannot kill/sabotage and their kill cooldown pauses.
- **Vitals**: OK = alive; **DED = killed since the last meeting and the body is still on the map** (reportable); **D/C = no body: killed before the last meeting, ejected, or disconnected** (a victim who then quits also shows D/C). Listed in join order; the heartbeat speed is meaningless (F: W:Vitals).
- Comms disables all monitors except Fungle binoculars (F).

### 1.9 Movement gadgets (Airship, Fungle)

- **Ladders** (F: [W:Ladder](https://among-us.fandom.com/wiki/Ladder)): Airship 3 (Meeting Room↔Gap Room; Gap Room right side; Main Hall↔Electrical). Fungle 4 (two Jungle↔Cliffs, two Communications↔Upper Engine). 5 s cooldown, no actions while on it, safe from kills while climbing, **ladder sound is heard by everyone on the map** (its length tells which ladder). Sliding down is faster than climbing.
- **Moving platform** (F1: [W:Platform](https://among-us.fandom.com/wiki/Moving_platform)): Airship Gap Room, one rider at a time. Crossing Gap Room without the platform or the long route ⇒ likely vented (Gap Room left↔right vents connect) (F1: W:CrewGuide).
- **Zipline** (F1: [W:Zipline](https://among-us.fandom.com/wiki/Zipline)): Fungle Storage ↔ Communications, 7 s cooldown, unlimited riders, no actions while riding.
- **Airship Electrical** inner doors are randomised at game start and never change (F1: W:Doors).
- **Decontamination** (MIRA, Polus): closed doors, slow pass-through; a crewmate inside cannot be "teleported" around it.

### 1.10 Bodies, reports, ghosts, disconnects

- Report needs proximity; **cannot report through closed doors** (F: W:Report, W:Door_Sabotage). One report wipes all other bodies.
- Ghosts: invisible to the living, through walls, unlimited vision, 1.2× speed; can do tasks, use Admin/Cams (no red blink)/Vitals/Doorlog; **cannot report, press the button, fix sabotage, vote or kick**; chat only with other ghosts (they read living chat). Ghost impostors can sabotage, cannot vent or kill. Crew can become Guardian Angels (protect) or Influencers (send images to living players) as ghosts (F: [W:Ghost](https://among-us.fandom.com/wiki/Ghost), W:Roles).
- ⇒ **A living player who knows something only a ghost could know** is either guessing or being told out-of-game (ghosting/teaming). Not evidence of impostor, but discount it.
- Disconnects: player disappears; vitals D/C. If an impostor disconnects between vote end and the ejection text, the "N impostors remain" line is off by one (bug) (F1: W:Ejection).

### 1.11 Roles that change what counts as proof

| Role (team) | Ability | Effect on evidence | Source |
|---|---|---|---|
| Engineer (crew) | Vents (cooldown, time limit, not during Comms) | "Saw vent" is only hard proof when Engineers are off, **or** the venter re-entered within the Engineer cooldown, **or** vented during Comms, **or** stayed in longer than the max time. | W:Engineer, W:CrewGuide |
| Scientist (crew) | Portable vitals | Vitals info on Skeld/MIRA is possible for a Scientist. | W:Scientist |
| Noisemaker (crew) | Death alert marks the body for everyone (impostors too by default) | Exact time + place of death. | W:Noisemaker |
| Tracker (crew) | Tracks one player on the personal map | Claims "I tracked X" are checkable; disabled during Comms. | W:Tracker |
| Detective (crew, v17) | Notes + Interrogate (touching distance): learn where a player was at the time of the murder | Strong, legit on-screen info for the local Detective. | W:Detective, v17 notes |
| Judge (crew, 2026) | Overrule once (after Task Unlock %): eject a player; if not impostor, the Judge is ejected | A Judge claim is costly, so it's credible. | W:Judge |
| Guardian Angel, Influencer (crew ghosts) | Protect shield / send images | Influencer images are a ghost hint channel visible to the target only. | W:Guardian_Angel, W:Influencer |
| Shapeshifter (imp) | Shifts into another player (cocoon effect in their own colour) | Kill sightings are weaker; **seeing two of the same player** ⇒ one is a Shapeshifter. Reports made while shifted show the original skin. | W:Shapeshifter, W:CrewGuide |
| Phantom (imp) | Vanish (cloud in own colour), can't kill while vanished | Someone "disappearing" may be a Phantom, not a vent. | W:Phantom |
| Viper (imp, v17) | Acid kill; body dissolves after Dissolve Time | Missing victims with no body; Viper and Shapeshifter cannot both be enabled ⇒ an acid kill you saw is a hard catch. | W:Viper, W:CrewGuide |

### 1.12 Hide n Seek (recognise and bail out)

Different mode (out of scope): one Seeker (impostor) with 1 s kill cooldown, crew hides; phases "Hiding time" (default 200 s) then "Final Hide" (default 50 s) with the screen turning red; flashlight mode; vents become "Hide" for crew (limited uses); no meetings (button is broken), no sabotage (Seek button instead) (F: [W:Options](https://among-us.fandom.com/wiki/Options), [W:Hide_n_Seek](https://among-us.fandom.com/wiki/Hide_n_Seek)). **If the role card says Seeker/Hider or the HUD shows a hide timer, the deduction engine should go idle.**

---

## 2. "Catching a lie" catalogue (61 checks)

Columns: **Inputs** (what the app must have logged), **Conf.** (hard = proof, high, med, low), **How to check**, **Ask in chat** (≤ 70 chars, placeholders `{P}` player, `{R}` room, `{R2}`, `{T}` time, `{TASK}`, `{W}` witness, `{V}` victim, `{N}`). Machine-readable: `src/data/tactics/lieChecks.json` (same ids).

### 2a. Task claims

| id | Contradiction | Inputs | Conf. | How to check | Ask |
|---|---|---|---|---|---|
| `visual_unseen` | Claims a visual task while visuals ON, but I watched them at it and saw no effect | settings.visualTasksOn, map task `visual`, my sighting of P at that panel | **hard** if I watched the whole time; med otherwise | Visual list per map (§1.5) | `{P} {TASK} is visual. I watched and saw nothing.` |
| `visual_wrong_map` | "X is clear, did asteroids/shields" on MIRA (not visual there), or any visual claim on Airship/Fungle | map, claim | **hard** (the clear is invalid, not the person guilty) | §1.5 table | `{TASK} is not visual on this map. That clears nobody.` |
| `visual_off_clear` | Clears someone by a visual while visuals are OFF (except scan "Waiting for") | settings | hard (clear invalid) | setting | `Visuals are off. Only scan waiting proves it.` |
| `common_not_dealt` | Claims a common task that is not on my list (or a common that this lobby doesn't have) | my task list, map `kind:"common"` | **hard** (if my list is known; typo risk) | commons per map (§1.5) | `{TASK} is common. I dont have it. Nobody does.` |
| `task_not_on_map` | Claims a task that doesn't exist on this map (scan on Airship/Fungle, divert on Polus/Fungle, card on MIRA/Airship/Fungle) | map tasks | high (alias/name errors) | map JSON | `There is no {TASK} on this map {P}.` |
| `task_not_in_room` | Claims {TASK} in {R} but that task has no stage in {R} | map task rooms | high | map JSON `rooms` | `{TASK} is not in {R}. Which panel {P}?` |
| `dummy_panel` | Seen "doing" a dummy panel (Skeld Reactor divert, Polus Office divert, Airship Armory/Comms/Vault wiring, Lounge garbage bin) | my sighting at panel | **hard** | §1.5 dummy list | `{P} that panel in {R} is fake. Nobody can do it.` |
| `stage_order` | Stage done in the wrong order (Upload not in Skeld Admin, Accept power before Divert, Chute in Storage first) | claim sequence, map stage order | high | §1.5 stage orders | `{P} upload is always in admin. Where did you download?` |
| `wiring_order` | Wiring panels claimed in an order the game never assigns (e.g., Skeld Security then Electrical) | claim sequence | high | fixed panel order per map | `{P} wires go in a fixed order. {R} cant come after {R2}.` |
| `task_too_fast` | Left a task faster than its minimum (download < 8 s, scan < 10 s, inspect sample return < 60 s) | my sighting start/end, task duration | med (durations partly unsourced) | `stageDurationSec` | `{P} you were at {TASK} for 4 seconds. It takes 9.` |
| `bar_no_move` | Task bar = Always, P "finished" a single-stage task in my view, bar didn't move (and nobody else could have) | settings.taskBarMode, my sighting, bar change | med (multi-stage + simultaneous finishes) | task `stages` | `{P} you said done {TASK}. The bar did not move.` |
| `bar_moved_alone` | (clear) Bar moved exactly when P finished a single-stage task with nobody else plausibly finishing | same | med clear | — | `Bar moved when {P} finished {TASK}. Soft clear.` |
| `no_tasks_wander` | P seen in task-free areas for a long time, never doing anything | sightings | low | map rooms with no tasks (Skeld Storage chute aside) | `{P} what tasks did you do this round? Name two.` |
| `task_list_vague` | Can't name a task/room when asked, or names a task with no location | chat | low | — | `{P} which task exactly, and where?` |

### 2b. Movement and timing

| id | Contradiction | Inputs | Conf. | How to check | Ask |
|---|---|---|---|---|---|
| `travel_impossible` | Two placements of P (claims or sightings) closer in time than the walking path allows | timestamps, map `adjacent.sec`, playerSpeed | high if gap < 0.7 × path; else med | shortest path × 1/speed; if both rooms share a vent network ⇒ "vented?" | `{P} you were in {R} at {T}. {R2} is too far for that.` |
| `vanished_dead_end` | P entered a dead-end I was watching the only door of; room empty after / P reappeared elsewhere | my sighting, map `deadEnd`, vents | **hard-ish** (Phantom vanish if enabled) | vent in that room? | `{P} went into {R} and was gone. Theres a vent there.` |
| `appeared_from_vent_room` | P "appears" in a room with no door traffic I watched, room has a vent | my sightings | high | vent networks | `{P} how did you get to {R}? Nobody came through.` |
| `gap_crossed` | Airship: P crossed Gap Room side to side faster than the platform/long route | sightings | high | Gap Room vents left↔right | `{P} you crossed gap without the platform. How?` |
| `ladder_claim` | Claims a ladder trip no one heard (ladder sound is map-wide) | my audio memory | low | §1.9 | `{P} which ladder? Nobody heard one.` |
| `cooldown_window` | Kill time lies inside `[meetingEnd, meetingEnd + cooldown]` ⇒ impossible; alibis for that window are worthless | meeting end time, killCooldownSec | **hard** (constraint) | §1.2 | `First kill cant be before {N}s. Where were you after?` |
| `double_kill_gap` | Two bodies with time-of-death gap < cooldown ⇒ two killers; a player cleared for one kill is still live for the other | vitals/noisemaker/sightings, cooldown | **hard** (constraint) | §1.2 | `Two kills {N}s apart. That is two impostors.` |
| `alibi_partner_denies` | P says "with {W}", {W} says no | chat claims | high (one of them lies) | ledger | `{W} were you with {P}? Yes or no.` |
| `story_changed` | P's location/companion for the same window changed within or across meetings | claims ledger | high | ledger diff | `Last meeting {P} said {R}. Now {R2}. Which?` |
| `late_location` | Answers "where" with a question, or only after hearing others | chat order | low | chat timestamps | `{P} you still havent said where you were.` |
| `mutual_pair` | Two players alibi only each other, every round, never seen by a third | claims across meetings | low–med (pair tell) | ledger | `{P} and {P2} only ever clear each other. Who else saw you?` |

### 2c. Body and report

| id | Contradiction | Inputs | Conf. | How to check | Ask |
|---|---|---|---|---|---|
| `two_together_one_dies` | I saw P and V alone together; V dies shortly after, nobody else around | my sighting, body | **very high** (Shapeshifter caveat) | — | `I left {P} alone with {V} in {R}. Then {V} died.` |
| `left_body_room` | P seen leaving {R} shortly before the body in {R} was found, didn't report | sightings, body | high | — | `{P} you came out of {R} right before. Didnt see {V}?` |
| `near_body_no_report` | P was in vision of the body and walked away | sighting | med (could miss it) | — | `{P} you walked right past the body in {R}.` |
| `self_report_instant` | Report within seconds of time of death (vitals OK→DED, noisemaker alert), no witness | report time, vitals/noise | med | §1.8 vitals | `{P} you found {V} seconds after the kill. Who did you see?` |
| `self_report_no_reason` | Reporter in a dead-end with no claimed task there | report room, map `deadEnd`, claim | med | map tasks | `{P} what task took you to {R}?` |
| `report_wrong_direction` | Reporter's "came from {R2}" can't reach the body room by the report time / passes a watched corridor | travel table | med | path + my sightings | `{P} from {R2} you would pass me. You didnt.` |
| `body_behind_doors` | Claims to have reported/seen a body through closed doors | door sabotage log | high | can't report through doors | `Doors were shut. You couldnt see into {R}.` |
| `knows_too_much` | Mentions body room / victim / number of bodies before anyone said it, or details they couldn't see | chat order | med | — | `{P} how did you know it was in {R}? Nobody said.` |
| `nearest_player_kill` | Killer passed over a closer player to kill a farther one ⇒ the closer one is likely the partner | my sighting | low (rare, ping) | impostors can't kill impostors | `{P2} was closer to {P}. Why was {V} the target?` |
| `dissolved_body` | Victim shows dead but no body anywhere ⇒ Viper in lobby (if enabled) | role settings, vitals | med (constraint) | §1.11 | `No body for {V}. Viper is on. Who was near {R}?` |

### 2d. Monitors, sabotage, map facilities

| id | Contradiction | Inputs | Conf. | How to check | Ask |
|---|---|---|---|---|---|
| `monitor_during_comms` | Claims to have read Admin/Cams/Vitals/Doorlog during Comms (Fungle binoculars excepted) | sabotage log | **hard** | §1.6 | `Comms were down. Cams and admin were off then.` |
| `facility_not_on_map` | Claims cams on MIRA, admin on Fungle, vitals on Skeld/MIRA (no Scientist), doorlog off MIRA | map, roles | high (Scientist/role caveat) | §1.8 | `There are no cams on this map {P}.` |
| `admin_count_mismatch` | Admin showed N in {R} at {T}; claims put a different number there | my admin read, claims | med (admin anonymous, timing) | count claimed occupants | `Admin had {N} in {R} at {T}. Who else was there?` |
| `admin_ghost_icon` | Admin shows someone in a room I can see is empty ⇒ someone in that room's vent | my admin read + my view | high (local only) | §1.8 | — (act, don't ask) |
| `admin_blind_spot` | "Admin showed nobody outside/in the hall" (Polus Outside and hallways not covered) | map | hard (evidence invalid) | §1.8 | `Admin doesnt show {R}. That proves nothing.` |
| `cams_not_seen` | I watched a camera feed covering a corridor P claims to have walked at {T}; P never appeared | my cams log | high | camera coverage §1.8 | `I was on cams. {P} never walked past {R}.` |
| `cams_no_blink` | Claims to have been on cams, but nobody saw the cameras blinking (Skeld/Polus/Airship) | others' sightings of cams | low–med (blink can be hidden) | — | `{P} you were on cams? Nobody saw them blink.` |
| `doorlog_contradiction` | MIRA: doorlog shows P crossing sensor X at {T}, P claims to be elsewhere, or crossing order impossible without venting | my doorlog read | high | §1.8 | `Doorlog has {P} at the {R} sensor at {T}.` |
| `vitals_timing` | Vitals showed V OK at {T}; P claims finding/seeing V dead earlier | my vitals read | high | §1.8 | `{V} was alive on vitals at {T}. Not before.` |
| `wrong_fix_location` | Claims fixing a sabotage where it can't be fixed (O2 in Nav, Skeld lights in Office, Polus comms inside Comms, MIRA lights in Elec) | map sabotage table | **hard** | §1.6 table | `{TASK} isnt fixed in {R} on this map.` |
| `sabotage_no_show` | Critical sabotage, P at neither fix point and not seen travelling there | sightings | low–med | — | `{P} reactor was called. Where were you?` |
| `fix_is_not_clear` | "I fixed lights/reactor so I'm clear" — impostors can fix sabotages | — | hard (clear invalid) | §1.6 | `Impostors can fix too. Who was with you?` |
| `reactor_partner` | "Held reactor with {W}" but {W} was at the other hand reader for a different window or denies | claims | high | 2-person fix | `{W} were you on the other reactor hand with {P}?` |
| `airship_spawn_claim` | Claims to have spawned somewhere not in the Airship spawn set | map | **hard** | §1.4 | `You cant spawn in {R} on Airship.` |
| `mixup_sighting` | Sighting during Mushroom Mixup used as evidence (crew can't see names/colours then) | sabotage log | hard (evidence invalid) | §1.6 | `That was during mixup. Colours were random.` |

### 2e. Hard catches (direct eyewitness)

| id | What | Conf. | Caveat |
|---|---|---|---|
| `saw_vent` | Saw P enter/exit a vent | **hard** if Engineers off; with Engineers on: hard if re-vented within the Engineer cooldown, vented during Comms, or stayed > max time | §1.11 |
| `saw_kill` | Saw P kill | **hard** unless Shapeshifter enabled (then the killer may be wearing P's look); acid kill = hard even then | §1.11 |
| `saw_shift_or_vanish` | Saw a cocoon (shift) or a Phantom cloud | **hard**; the effect is in the impostor's real colour | §1.11 |
| `two_of_same` | Saw two players with the same look at once | hard that one is a Shapeshifter | — |

### 2f. Social tells (low weight, never alone)

| id | Tell | Conf. | Source |
|---|---|---|---|
| `accuse_first_no_info` | First to accuse, no sighting behind it | low | W:CrewGuide, crew.json |
| `flip_when_countered` | Changes target when the accused counters | low | chat-nlu `StanceFlip` |
| `votes_last_majority` | Always votes last, always with the majority (anonymous votes off) | low | H |
| `bandwagon` | "+1"/"same" with no new info | low | H |
| `hard_defends_ejected_imp` | Hard-defended a player later confirmed impostor | med (pair tell) | W:CrewGuide "Examine false alibis" |
| `over_explains` | Long, unprompted alibi | low | W:CrewGuide, impostor.json |
| `dead_accuser` | The player who accused P dies next round | low (can be a frame) | W:CrewGuide |

### 2g. Combining checks: the kill-window model (F mechanics, derived rules)

For a body reported at `tReport` in round `r` (round = time since the last meeting ended):

| Bound | Value | Why |
|---|---|---|
| Earliest kill | `roundStart + killCooldown` (round 0: `+10 s`) | cooldown resets at meeting end; it only pauses (vent/cams), so this is a true lower bound |
| Earliest kill (tighter) | last time the victim was seen alive (my sighting, a vitals OK read, a cleared player's claim) | — |
| Latest kill | `tReport`; or first vitals DED read; or the Noisemaker alert time (exact) | — |
| Viper | if the body was still visible at `tReport`, kill ≥ `tReport − dissolveTime` | body dissolves after `dissolveTime` |
| Second body | if two bodies' windows can't be `killCooldown` apart, they are two killers | one impostor cannot double kill |

A player is **cleared for that kill** when every moment of the window is covered by placements (sightings, cleared companions, monitor reads) whose gaps are shorter than the walk from their location to the body room and back (map `adjacent.sec / playerSpeed`, minus vent shortcuts if their room shares a network with the body room). With ≥ 2 impostors alive this is a **soft clear** (that kill only); with 1 impostor left it is a **hard clear** (W:CrewGuide "Alibis").

---

## 3. Pro / high-level play heuristics (H unless tagged)

### 3.1 How strong crewmates run a round
- **Do risky tasks right after a meeting**: the kill cooldown is guaranteed running then (F: §1.2). Dead-end tasks first, social areas later.
- **Buddy / track**: stay with one player all round ⇒ soft clear (hard clear with 1 impostor). Announce it ("forced alibi"): an impostor you announced you're following can't kill you without being voted (W:CrewGuide).
- **Visual-task clears**: do your visual in front of people early; announce unseen visuals at the meeting and invite people to watch (W:CrewGuide). Beware an impostor "come watch my scan" at 1 kill from winning — it's a lure.
- **Task bar trick**: with bar = Always, do the nearest single-stage task immediately at round start in front of others (nobody else has finished yet) ⇒ clear (W:CrewGuide).
- **Count every meeting**: alive players vs. impostors remaining (confirm ejects on). With 2 impostors, at 7 alive a wrong eject can hand them the game via one double kill ("skip on seven / vote on six" folklore) (https://www.mmogames.com/articles/specials/13-advanced-imposter-strategies-for-among-us).
- **Sabotage reading**: a critical sabotage on one side often means a kill already happened on the other side; after Lights is fixed, sweep isolated rooms (Skeld: Navigation, Reactor, Communications) (W:CrewGuide "Rule of thumb").
- **Monitors**: short stints on cams/admin/vitals, ideally with others near; write down what you see (time + room) — that is your evidence.
- **Skip early**: no evidence ⇒ skip. A wrong eject is worth a free kill to impostors, and early rounds have the most players to absorb a kill (crew.json principles; W:CrewGuide "innocent until proven guilty").
- **Who to clear first**: visual-task doers, people you were with all round, the player who got an impostor ejected by their own accusation (W:CrewGuide "Trustful activity").
- **Late game**: stay in groups, call the meeting as soon as possible at 3–4 alive, never "skip" when one more kill ends the game.
- **Never lie as crew** — it gets crew ejected (W:CrewGuide).

### 3.1b Asking good questions in a 15–120 s meeting (H, distilled from W:CrewGuide + crew.json principles)

1. **Give your own room + companion first** (one line). It anchors the timeline and pre-empts the "you were alone" attack.
2. **Ask the reporter first**: where, which way they came, who they passed. Then the last player seen with the victim. Then whoever was near the body room.
3. **Ask questions someone else can check** ("who was in nav with you?") rather than unfalsifiable ones ("what were you doing?").
4. **One question per line, full colour names** (Lime vs Green, Maroon vs Brown are confusable).
5. **Make people commit early**; a contradiction only exists once two claims are on record. Log claims (the app does this) and bring them back next meeting (`story_changed`).
6. **Only ask about visuals if visual tasks are on**, and only about tasks that are visual on this map.
7. **Use the monitors you read**: "admin had 2 in elec at 1:10", "vitals: green DED at 1:30". Numbers end arguments.
8. **Skip is a valid answer**: no sighting, no contradiction ⇒ skip and pair up — unless the count says skipping loses (see §3.1).

### 3.2 Vocabulary (definitions)

| Term | Meaning | Source |
|---|---|---|
| hard clear | Proven crew for the whole game (visual task, with them every kill when 1 imp, etc.) | W:CrewGuide, glossary |
| soft clear | Cleared for one kill/round only (another impostor could have done it) | W:CrewGuide |
| self report / self | Impostor reports their own kill; "self" in chat = "the reporter did it" | glossary, nerdschalk.com/what-does-self-report-mean-in-among-us/ |
| stack / stack kill | Players piled on one spot (cafeteria button, reactor/O2 fix); impostor kills inside the pile so nobody can tell who | glossary |
| double kill | Two impostors kill at the same moment | mmogames.com guide |
| vent kill | Kill next to a vent, escape through it | mmogames.com guide |
| vent chain | Moving through several vents of one network to get far fast (term not found in a source: **U**) | — |
| marinate | Impostor sticks with one crewmate for rounds to earn a vouch, then uses or kills them | sportskeeda, inverse |
| bus / bussing / throw under the bus | Impostor votes out or accuses their own partner to buy trust (term widely used; no fetched source: **U**) | — |
| third impostor / third imposting / throwing | A crewmate whose play helps the impostors (wrong accusations, defending impostors) | shacknews.com/article/120612, glossary |
| 50/50 | Two suspects, one is the impostor | glossary |
| camping | Staying in one spot (cams, a vent, the body) | glossary |
| body block | Physically blocking someone's path | glossary |
| vouch | Back up someone's alibi | glossary |
| hard / soft accuse | Accusation with proof vs. hunch | glossary |
| cams flashing / cams blinking | Someone is on Security (red light on cameras) | W:Camera |
| lights kill | Kill during the Lights sabotage | H |
| AFK | Away from keyboard; also "fake AFK" crew bait | glossary, W:CrewGuide |
| sheriff, jester, etc. | **Mod roles** (Town of Us etc.); out of scope, but people type them | — |
| forced alibi | Announcing you'll follow someone next round | W:CrewGuide |
| vent fishing | Starting Clean Vent to flush someone out | W:CrewGuide |

### 3.3 Chat slang and abbreviations (for chat-nlu; seed in `src/data/chatSlang.seed.json`)

Verified usage (glossary sources) vs. common-but-unsourced (**U**, from general knowledge of public lobbies) is marked in the seed file. Highlights:

- **Suspicion**: sus, suss, sussy, suspect, sus af, kinda sus, imp, impo, impostor, imposter (misspelling is the norm), "its {colour}", "{colour} 100%", "{colour} hard", "vote {colour}", "{colour} vented", "{colour} self".
- **Clearing**: clear, cleared, clr, safe, "{colour} with me", "{colour} scanned", "{colour} did scan/asteroids/trash", "not {colour}", "{colour} is crew", "vouch".
- **Questions**: where, wya ("where you at"), wh, where body, who, who reported, "body where", "?", "??", "proof?", "how".
- **Location**: "i was {room}", "in {room}", "at {room}", "doing {task}", "{room} → {room}", "elec then nav".
- **Votes**: skip, skp, sk, "dont skip", "vote", "voting {colour}", "everyone vote {colour}", "no skip".
- **Denial**: not me, wasnt me, "i was with {colour}", "why me", "bruh", "?", "lol no", "cap" (= lie), "no cap" (= truth), "fr" (= for real), "ngl" (= not gonna lie), "idk", "idc", "ok", "k".
- **Meta / outcome**: gg, ggs, W (= win, good), L (= loss, bad), ez, ff (= give up), "trust", "trust me", "on god", "stfu", "shut up", "afk", "dc" (disconnected), "brb", "lag", "hacker".
- **Colour shorthand**: r/red, b/blu/blue, g/grn/green, pk/pink, o/ora/orange, y/yel/yellow, bk/blk/black, w/wht/white, p/pur/purp/purple, br/brn/brown, c/cy/cyan, l/lim/lime, m/mar/maroon, rose, ban/banana, gr/grey/gray, tan, cor/coral. Single letters are **ambiguous** (b = blue/black/brown) — weight low.

**Room shorthand per map** (aliases already in `src/engine/chatClaims.ts` for Skeld/Polus; additions in the seed file):
- Skeld: cafe/caf, weps/weapons, o2, nav, shields, comms, storage, admin, elec/electric/lights, lower/le/bottom engine, upper/ue/top engine, sec/security/cams, reactor/react, med/medbay.
- MIRA: launch/launchpad/pad, med/medbay, comms, locker/lockers, decon, reactor, lab, hall/hallway/cross, office, admin, green/greenhouse, cafe, storage, balc/balcony.
- Polus: drop/dropship, elec, o2, comms, weps, office, admin, storage, lab, spec/specimen, boiler, decon, outside, lava, sec, vitals (= Office).
- Airship: cock/cockpit, armory, comms, engine, vault, brig, kitchen, main/main hall, gap/gap room, meeting, records, lounge/toilets, showers, cargo, vent room/ventilation, med/medical/vitals, elec, sec, portraits/hall of portraits, viewing/deck, outside.
- Fungle: beach, drop/dropship, cafe, storage, splash, meeting, dorm, kitchen, dock, jungle, lab, green/greenhouse, reactor, cliffs, mine/mining, lookout/binos, upper engine/engine, comms, zip/zipline.

**Multi-language lobbies** (common words; standard dictionary translations, not lobby-verified: **U** for frequency):

| Meaning | es | pt-BR | ru | fil (Tagalog) | id |
|---|---|---|---|---|---|
| who | quién / quien | quem | кто | sino | siapa |
| where | dónde / donde | onde | где | saan | di mana / dimana |
| not me | yo no / no fui yo | não fui eu / nao fui | не я | hindi ako | bukan aku / bukan gue |
| it's X | es X / fue X | é o X / foi o X | это X | si X | dia X / X itu |
| body | cuerpo | corpo | тело / труп | bangkay / patay | mayat |
| lie / liar | mentira / mentiroso | mentira / mentiroso | врёт / лжец | sinungaling | bohong |
| with me | conmigo | comigo | со мной | kasama ko | sama aku |
| sus | sus | sus | сус / сас / подозрительно | sus | sus |
| skip | skip / saltar | skip / pular | скип | skip | skip |
| vent | venteó / ventilación | ventou / vent | вентанул / в венте | nag-vent | ngevent / vent |
| red / blue / green | rojo / azul / verde | vermelho / azul / verde | красный / синий / зелёный | pula / asul / berde (English colours usual) | merah / biru / hijau |

Rule for chat-nlu: "sus", "skip", "vent", colour names in English and room names in English are used across all these lobbies; translate the rest with `src/data/glossary.json` protections.

---

## 4. Per-map guide for the question asker

Each map: rooms, dead-ends, choke points, kill spots (H), vents (§1.7), visuals/commons (§1.5), sabotage pull (§1.6), local checks (§1.8), and the questions worth asking.

### 4.1 The Skeld
- **Rooms (14):** Cafeteria, Weapons, O2, Navigation, Shields, Communications, Storage, Admin, Electrical, Lower Engine, Upper Engine, Security, Reactor, MedBay (W:Skeld; skeld.json).
- **Dead-ends:** Navigation, Communications, Admin, Electrical, Security, Reactor, MedBay (skeld.json; Electrical is the classic one).
- **Choke points (H):** Storage (hub between Cafe/Admin/Elec/Lower Engine/Shields/Comms); the corridor Weapons–O2–Nav–Shields (on cams); MedBay/Upper Engine corridor (on cams); Security/Reactor corridor (on cams).
- **Kill spots (H):** Electrical (dead-end, vent to MedBay/Security), Navigation (two vents), Reactor/Security, Communications (no vent, no cam), O2/Shields, MedBay.
- **Visuals:** Scan, Asteroids, Shields, Garbage/Chute (Storage stage). **Commons:** Wiring, Card.
- **Sabotage pull:** Reactor (left) vs. O2 (Admin + O2, right/centre) splits the lobby; Lights pulls everyone to Electrical — kill elsewhere (impostor playbook).
- **Local checks:** Admin (Admin room), 4 cams in Security, no vitals (Scientist only).
- **Ask:**
  1. `{P} you said elec. Did you see anyone leave through storage?`
  2. `{P} where did you download? Upload is always admin.`
  3. `Who was on cams? Who walked the medbay hall?`
  4. `{P} which wires? Wires go elec storage admin nav cafe sec.`
  5. `{P} nav has two vents. Who came out of shields or weps?`
  6. `{P} you did card in admin. Card is common. Who else has it?`
  7. `Who fixed O2 in admin and who in O2?`
  8. `{P} reactor to security takes seconds. Where were you?`

### 4.2 MIRA HQ
- **Rooms (14):** Launchpad (spawn), MedBay, Communications, Locker Room, Decontamination, Reactor, Laboratory, Hallway (Y-shaped centre), Office, Admin, Greenhouse, Cafeteria (meetings), Storage, Balcony (W:MIRA).
- **Dead-ends (H, from layout):** Reactor/Laboratory side behind Decontamination, Balcony, Greenhouse, Admin, Office, Communications.
- **Choke points:** the central Hallway (all three ends have **Doorlog sensors**), Decontamination (slow doors), Cafeteria/Balcony glass doors (visible regardless of vision).
- **Vents:** one fully connected network — **"I was far away" is a weak alibi on MIRA**; travel-time checks must assume vent travel is possible from any vent room.
- **Kill spots (H):** Reactor/Laboratory (behind decon), Launchpad, Greenhouse, Balcony, Admin.
- **Visuals:** only Submit Scan (Asteroids/Shields are **not** visual here). **Commons:** Wiring, Enter Id Code.
- **Sabotage pull:** Reactor 45 s (Reactor) vs. O2 45 s (Greenhouse + SW hallway near MedBay); Lights in **Office**; Comms keypads Office + Communications; no doors.
- **Local checks:** Admin (Admin room), **Doorlog** (Communications). No cams, no vitals.
- **Ask:**
  1. `Who checked doorlog? Who crossed the north sensor?`
  2. `{P} you came from launchpad. Doorlog would show you.`
  3. `{P} asteroids is not visual on Mira. That clears nobody.`
  4. `Who fixed O2 in greenhouse and who by medbay?`
  5. `{P} you went through decon. Who was behind you?`
  6. `Lights are fixed in office here. {P} where were you?`
  7. `{P} which admin task? Id code is common.`

### 4.3 Polus
- **Rooms:** Dropship (spawn), Outside (large, several zones), Electrical, O2, Communications, Weapons, Office (meetings, Vitals), Admin, Storage, Laboratory (incl. MedBay section), Specimen Room, Boiler Room, Decontamination (×2), Security (W:Polus; polus.json).
- **Dead-ends (H):** Specimen Room (behind decontamination), Electrical, O2, Boiler Room, Communications, Weapons, Dropship.
- **Choke points:** Office (centre), decontamination corridors to Specimen, outside paths (several on cams).
- **Vents:** four systems (§1.7); vents are silent holes (no animation).
- **Kill spots (H):** Electrical (doors + vent), O2, Specimen Room, Laboratory, Storage, Boiler Room.
- **Visuals:** Submit Scan, Clear Asteroids. **Commons:** Wiring, Card (Office), Insert Keys (Dropship), Boarding Pass (Office).
- **Sabotage pull:** Seismic 60 s (both sides of Dropship); Lights in Electrical; Comms outside by Communications; 7 door rooms (manual switches — doors are a big tool here).
- **Local checks:** Admin (Admin room, no Outside coverage), 6 cams (Security), **Vitals (Office)**.
- **Ask:**
  1. `Who checked vitals? When did {V} go DED?`
  2. `{P} which weather node? Then lab?`
  3. `{P} you were in elec with doors shut. Who let you out?`
  4. `{P} insert keys is in dropship. Everyone has it if it is common.`
  5. `{P} upload on Polus is in comms. Where did you download?`
  6. `Who was on cams? Did anyone pass the lab camera?`
  7. `{P} specimen is behind decon. Who saw you go in?`

### 4.4 The Airship
- **Rooms:** Cockpit, Armory, Communications, Engine Room, Vault, Brig, Kitchen, Main Hall, Gap Room, Meeting Room, Records, Lounge, Showers, Cargo Bay, Ventilation, Medical, Electrical (maze), Security, Hall of Portraits, Viewing Deck, Outside (W:Airship).
- **Spawn after meetings:** pick from 3 of {Brig, Cargo Bay, Engine Room, Kitchen, Main Hall, Records} — first sightings of the round are near those.
- **Dead-ends (H):** Vault, Cockpit (vents though), Viewing Deck, Outside, Showers/Lounge stalls, Electrical inner rooms.
- **Choke points:** Gap Room (platform, ladders), Meeting Room ladder, Main Hall, Hall of Portraits.
- **Vents:** 4 systems (§1.7). Main Hall vents belong to two systems.
- **Kill spots (H):** Electrical maze, Vault, Showers/Lounge, Ventilation, Cargo Bay, Viewing Deck.
- **Visuals:** none. **Commons:** Wiring, Enter Id Code (Meeting Room). **Dummy wiring** in Armory, Communications, Vault.
- **Sabotage pull:** Crash Course 90 s (both sides of Gap Room); Lights at Gap Room / Viewing Deck / Cargo Bay; Comms in Communications; doors need card swipes.
- **Local checks:** Admin (Cockpit, Records), 6 cam views (Security), Vitals (Medical).
- **Ask:**
  1. `{P} where did you spawn? Then where did you go?`
  2. `{P} you crossed gap room. Platform or the long way?`
  3. `Who was on vitals? When did {V} die?`
  4. `{P} wiring in armory is fake. Which panel?`
  5. `{P} which ladder did you take? We heard one.`
  6. `Admin in records or cockpit. Did anyone check it?`
  7. `{P} you said electrical. Which room of the maze?`

### 4.5 The Fungle
- **Rooms:** Beach (spawn, campfire), Dropship, Cafeteria, Storage, Splash Zone, Meeting Room, The Dorm, Kitchen, Dock, Jungle, Laboratory (Vitals), Greenhouse, Reactor, The Cliffs, Mining Pit, Lookout (binoculars), Upper Engine, Communications (W:Fungle).
- **Dead-ends (H):** Mining Pit, Lookout, Dock, Upper Engine, The Dorm.
- **Choke points:** ladders Jungle↔Cliffs and Communications↔Upper Engine, zipline Storage↔Communications (7 s), Jungle paths.
- **Vents:** 3 systems (§1.7; edges partly U).
- **Kill spots (H):** Jungle (dark, mixup), Mining Pit, The Cliffs, Dock, Reactor.
- **Visuals:** none. **Commons:** Collect Samples, Enter Id Code, Replace Parts, Roast Marshmallow.
- **Sabotage pull:** Reactor 60 s; Comms keypads Communications + Lookout; **Mushroom Mixup** (10 s, everyone looks random, button still works); doors are mushrooms (6 hits). **No lights sabotage.**
- **Local checks:** Vitals (Laboratory), binoculars (Lookout; Beach + Jungle; works during comms). **No admin, no cams.**
- **Ask:**
  1. `{P} did you zip or walk from storage?`
  2. `Who was on binoculars? Who was in the jungle?`
  3. `{P} that was during mixup. Are you sure of the colour?`
  4. `Who checked vitals in lab? When did {V} die?`
  5. `{P} marshmallow is common. Did everyone get it?`
  6. `{P} you came down the cliff ladder. Who was up there?`

---

## 5. Open uncertainties (do not hard-code; verify in-game)

1. **Default kill cooldown**: wiki table marks 45 s; `src/state/presets.ts` defaults to 30 s; Core Settings preset value unknown. Read it from the lobby screen.
2. **Max impostors by lobby size** (1/2/3 need 4/7/9 players): only an outdated wiki screenshot + code memory. Read it from the lobby.
3. **Kill distance units** (1.0/1.8/2.5) and walking speed in world units: no fetched source.
4. **Bodies on Admin**: resolved to "bodies show" (2 wiki pages); confirm once in-game since admin counts feed `admin_count_mismatch`.
5. **Fungle vent edges** (Communications vs. The Cliffs; Jungle internal links).
6. **MIRA Locker Room–Decontamination** vent edge (only on the vent page).
7. **Airship / Fungle door rooms** (Kitchen vs. Vault; Greenhouse) — pages disagree.
8. **Clear Asteroids long vs. short on Skeld** (wiki contradicts itself; already in skeld.json).
9. **Fungle task names**: the task table lacks "Catch Fish"/"Prep Vegetables" that the map page mentions (probably stages of Cook Fish / Collect Vegetables).
10. **Room-to-room travel seconds** are eyeballed (map JSON).
11. **Engineer/Impostor vent timing** (enter/exit animation length) — needed to make "vented" travel checks precise.
12. **Chat slang frequency** per region is from general knowledge; tune from real logs (`chatLines`).
13. Terms "vent chain", "bussing", "ACK" not found in a fetched source.

## 6. OCR notes for the Among Us UI (stretch)

From the repo's own 1920×1080 fixtures (`src-tauri/fixtures/screens/1920x1080/meeting_chat.png`, `meeting_vote_grid*.png`) — observed, not sourced elsewhere (**U** until tested against the OCR pipeline):

- **Two fonts matter.** Chat *bodies* are a plain sans (Arial/Liberation-like). *Names* (chat sender, vote grid, lobby) are a bold rounded face with a thick dark outline; the outline merges thin strokes. "SKIP VOTE" and some headers use a condensed font.
- **Sans (chat body) confusions:** `I`↔`l`↔`1`↔`|`, `O`↔`0`, `rn`↔`m`, `vv`↔`w`, `cl`↔`d`, `S`↔`5`, `B`↔`8`, `Z`↔`2`, `.`/`,` lost after `?`.
- **Outlined name font confusions:** `n`↔`h` and `u`↔`i` (the roster's "BigBingus" → "BigBihgis" case in ADR-022), `a`↔`e`, `c`↔`e`, `ii`↔`u`, `l`↔`I`, `B`↔`8`, `g`↔`q`, double letters collapsing (`ll`→`l`). Faded names in the vote grid behind the chat overlay are not readable — never OCR the grid while chat is open.
- **Guest/random names** look like two concatenated English words (Timetrast, Sensepast, Waxscarce, Flushbevy, Bonsainew). A dictionary of these stems would help snapping. Names are ≤ 12 chars (game cap).
- **Chat lines**: each bubble = coloured crewmate head + outlined name on line 1, body on line 2+; your own lines are right-aligned with the head on the right. Max 100 chars per message (`0/100` counter).
- **Colour from the head, not the text:** the bubble's crewmate head carries the colour; Mushroom Mixup (Fungle) randomises it for ~10 s.

## 7. Lobby settings people actually use (notes for `src/state/presets.ts`; not edited)

| Setting | Game default | Common public / guide values | Source |
|---|---|---|---|
| Impostors | host choice | 1 below 8 players, 2 at 8+ (3 is rare) | pcgamesn.com/among-us/settings-best; sportskeeda 10-player article |
| Kill cooldown | 45 s (wiki table) | 22.5–30 s (25 s pcgamesn) | pcgamesn; gamewith.net/among-us-wiki/article/show/22148 |
| Kill distance | Medium | Short (guides), Medium (public) | pcgamesn |
| Player speed | 1.0× | 1.25× | pcgamesn; gameranx community settings |
| Crew / impostor vision | 1.0× / 1.5× | crew 0.5–1.5×, impostor 1.5–1.75× | pcgamesn |
| Emergency meetings / cooldown | 1 / 15 s | 1–2 / 15–20 s | pcgamesn |
| Discussion / voting | 15 s / 120 s | 15–45 s / 30–120 s | pcgamesn |
| Confirm ejects | on | on in public; off for experienced groups | pcgamesn; gamewith |
| Visual tasks | on | on in public; off for experienced groups | pcgamesn |
| Tasks common/long/short | 1/1/2 | 1–2 / 1 / 2–3 | pcgamesn |

`DEFAULT_SETTINGS` in `src/state/presets.ts` (2 imps, 30 s, 1×, visuals on, confirm on, 15/120 s, 1/1/2) is a reasonable public-lobby guess; the only questionable value is kill cooldown (game default 45 s per the wiki). Recommend: keep reading the lobby screen as the source of truth; if a quick preset list is wanted, offer "Public default (2 imp, 30 s, 1×)", "Fast (2 imp, 22.5 s, 1.25×)", "Experienced (confirm ejects off, visuals off, 25 s)".

## Appendix A — Task tables for the maps without JSON yet (from [W:Tasks](https://among-us.fandom.com/wiki/Tasks) + map pages, F1)

For the maps agent. "→" = stage order. Visual: none on Airship/Fungle; on MIRA only Submit Scan.

**MIRA HQ:** Enter Id Code (common, Admin) · Fix Wiring (common, 3 of Storage → Hallway → Locker Room → Greenhouse → Laboratory) · Submit Scan (long, **visual**, MedBay) · Start Reactor (long, Reactor) · Clear Asteroids (long, Balcony, not visual) · Water Plants (long, Storage → Greenhouse) · Divert Power (long, Reactor → Admin/Cafeteria/Communications/Greenhouse/Laboratory/Launchpad/MedBay/Office; wiki: "short if Laboratory") · Assemble Artifact (short, Laboratory) · Buy Beverage (short, Cafeteria) · Chart Course (short, Admin) · Clean O2 Filter (short, Greenhouse) · Clean Vent (short, any vent room) · Empty Garbage (short, Cafeteria) · Fuel Engines (short, Launchpad) · Measure Weather (short, Balcony) · Prime Shields (short, Admin, not visual) · Process Data (short, Office) · Run Diagnostics (short, Launchpad; long timer) · Sort Samples (short, Laboratory) · Unlock Manifolds (short, Reactor).

**The Airship:** Enter Id Code (common, Meeting Room) · Fix Wiring (common, 3 of Viewing Deck → Engine Room → Main Hall → Showers → Lounge → Cargo Bay → Meeting Room) · Develop Photos (long, Main Hall) · Empty Garbage (long, Kitchen/Main Hall/Medical → Meeting Room) · Fuel Engines (long, Cargo Bay → Engine Room) · Reset Breakers (long, Electrical) · Rewind Tapes (long, Security) · Start Fans (long, Ventilation) · Unlock Safe (long, Cargo Bay) · Upload Data (long: Brig/Cargo Bay/Gap Room/Records/Vault → outside Security or Viewing Deck; short: Armory/Cockpit/Communications/Medical/Viewing Deck → same) · Calibrate Distributor (short, Electrical) · Clean Toilet (short, Lounge) · Clean Vent (short) · Decontaminate (short, Main Hall) · Divert Power (short, Electrical → Armory/Cockpit/Engine Room/Gap Room/Main Hall/Meeting Room/Showers) · Dress Mannequin (short, Vault) · Fix Shower (short, Showers) · Make Burger (short, Kitchen) · Pick Up Towels (short, Showers) · Polish Ruby (short, Vault) · Put Away Pistols / Put Away Rifles (short, Armory) · Sort Records (short, Records) · Stabilize Steering (short, Cockpit). Dummies: wiring in Armory, Communications, Vault; garbage bin in Lounge.

**The Fungle:** Collect Samples (common, Jungle → Laboratory) · Enter Id Code (common, Lookout) · Replace Parts (common, Reactor or Upper Engine → Communications or Dropship) · Roast Marshmallow (common, Beach sand pile → campfire) · Collect Vegetables (long, Greenhouse → Kitchen) · Cook Fish (long, Dock → Kitchen; the map page calls stage 1 "Catch Fish") · Extract Fuel (long, Upper Engine → Storage) · Help Critter (long, Jungle → Laboratory) · Hoist Supplies (long, Jungle → The Cliffs) · Mine Ores (long, Mining Pit) · Polish Gem (long, Mining Pit) · Replace Water Jug (long, Storage → Cafeteria) · Water Plants (long, Storage → Greenhouse per the map page; the Tasks table row is incomplete) · Assemble Artifact (short, Laboratory) · Build Sandcastle (short, Splash Zone) · Collect Shells (short, Beach or Splash Zone) · Crank Generator (short, Communications or Kitchen) · Empty Garbage (short, Cafeteria or Splash Zone) · Find Signal (short, Communications) · Fix Antenna (short, Communications) · Fix Wiring (**short** here, Communications or Dropship) · Lift Weights (short, Splash Zone) · Monitor Mushroom (short, Jungle) · Play Video Game (short, The Dorm) · Record Temperature (short, Greenhouse/Laboratory/Reactor) · Throw Frisbee (short, Splash Zone). The map page also names "Prep Vegetables" as Kitchen stage 2 (= Collect Vegetables stage 2).

## 8. Changelog
- 2026-10-22 draft 1 (research agent): §1–§5 from wiki API pulls + community glossaries.
- 2026-10-22 draft 2: bodies-on-admin resolved (show until meeting; kill flash removed 2021), max impostors by lobby size sourced, OCR notes (§6), settings presets (§7), `chatSlang.seed.json`, `lieChecks.json`, crew/impostor JSON additions.

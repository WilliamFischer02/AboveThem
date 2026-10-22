//! Background game watcher — the "automatic" layer.
//!
//! Polls the latest captured frame (~5 Hz). For each marker region it keeps a
//! perceptual hash; when a region's pixels change and then hold still for one
//! poll, it OCRs that region (≈ 10–60 ms) and updates a marker. Markers feed the
//! phase state machine; phase transitions, roster reads (vote grid / lobby),
//! lobby code, ejection text, the room-name popup, nearby names, my task list,
//! "DEAD" (I died) and the meeting banner are pushed to the frontend as
//! `game://*` events. Nothing here is ever triggered by the user.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Runtime};

use crate::capture::{crop_bgra, upscale_bgra, Frame, Latest};
use crate::lobby::read_lobby;
use crate::chat::{read_chat_detailed, ChatMsg};
use crate::ocr::{fuzzy_best, ocr_bgra};
use crate::phase::{Phase, PhaseDetector};
use crate::regions::{dhash, hamming, Rect, Regions};
use crate::roster::{brightness_factor, read_vote_grid, RosterEntry};

pub const EV_PHASE: &str = "game://phase";
pub const EV_ROSTER: &str = "game://roster";
pub const EV_EJECT: &str = "game://eject";
pub const EV_LOBBY: &str = "game://lobby";
pub const EV_ROLE: &str = "game://role";
pub const EV_STATUS: &str = "game://watcher";
pub const EV_ROOM: &str = "game://room";
pub const EV_NEARBY: &str = "game://nearby";
pub const EV_TASKS: &str = "game://tasks";
pub const EV_ME_DEAD: &str = "game://me_dead";
pub const EV_BANNER: &str = "game://meeting_banner";
pub const EV_MAP: &str = "game://map";
pub const EV_SETTINGS: &str = "game://settings";
pub const EV_CHAT: &str = "game://chat";
pub const EV_GAME_OVER: &str = "game://game_over";
pub const EV_CAPACITY: &str = "game://capacity";

#[derive(Clone, Debug, serde::Serialize)]
pub struct PhaseEvent { pub phase: String, pub round: u32, pub meeting: u32 }

#[derive(Clone, Debug, serde::Serialize)]
pub struct RosterEvent { pub source: &'static str, pub entries: Vec<RosterEntry> }

/// End-of-game screen. `outcome` comes from the VICTORY / DEFEAT word when OCR read it; `accent` is the
/// dominant text colour on the black screen (blue = crew victory, red = impostor win / defeat).
#[derive(Clone, Debug, serde::Serialize)]
pub struct GameOverEvent { pub outcome: Option<&'static str>, pub accent: Option<&'static str> }

/// Dominant text colour on a dark screen (role reveal, victory / defeat).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Accent { pub teal: u32, pub blue: u32, pub red: u32, pub dark: f32 }

impl Accent {
    pub fn is_dark_screen(&self) -> bool { self.dark > 0.75 && self.teal + self.blue + self.red >= 300 }
    /// "teal" (crewmate role), "blue" (victory), "red" (impostor role / defeat), or None.
    pub fn dominant(&self) -> Option<&'static str> {
        if !self.is_dark_screen() { return None; }
        if self.teal >= self.blue && self.teal >= self.red { Some("teal") } else if self.red >= self.blue { Some("red") } else { Some("blue") }
    }
}

/// Count teal / blue / red text pixels and the dark share in a region, sampling every 3rd pixel.
pub fn screen_accent(f: &Frame, r: Rect) -> Accent {
    let mut a = Accent::default();
    let mut n = 0u32; let mut dark = 0u32;
    let x1 = (r.x + r.w).min(f.width); let y1 = (r.y + r.h).min(f.height);
    let mut y = r.y;
    while y < y1 {
        let mut x = r.x;
        while x < x1 {
            let i = ((y * f.width + x) * 4) as usize;
            let (b, g, rr) = (f.bgra[i] as i32, f.bgra[i + 1] as i32, f.bgra[i + 2] as i32);
            n += 1;
            if rr.max(g).max(b) < 40 { dark += 1; }
            else if g > rr + 60 && b > rr + 40 && g >= b - 30 && g > 140 { a.teal += 1; }
            else if b > rr + 40 && b > g + 10 && b > 120 { a.blue += 1; }
            else if rr > 150 && g < 90 && b < 90 { a.red += 1; }
            x += 3;
        }
        y += 3;
    }
    a.dark = if n > 0 { dark as f32 / n as f32 } else { 0.0 };
    a
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct EjectEvent { pub raw: String, pub name: Option<String>, pub was_impostor: Option<bool>, pub skipped: bool }

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct WatcherStatus {
    pub running: bool,
    pub phase: Option<String>,
    pub round: u32,
    pub meeting: u32,
    pub markers: Markers,
    pub last_ocr_ms: u64,
    pub ocr_calls: u64,
    pub frame_seq: u64,
    pub lobby_code: Option<String>,
    pub room: Option<String>,
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct Markers {
    pub task_bar: bool,
    pub role_card: bool,
    pub meeting_header: bool,
    pub eject_text: bool,
    pub lobby_code: bool,
    pub chat_open: bool,
    pub banner: bool,
}

#[derive(Default)]
pub struct Shared {
    pub status: WatcherStatus,
    /// Names from the current lobby/roster; OCR output snaps to these.
    pub known_names: Vec<String>,
}

pub struct WatcherState {
    pub running: Arc<AtomicBool>,
    pub shared: Arc<Mutex<Shared>>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl Default for WatcherState {
    fn default() -> Self {
        Self { running: Arc::new(AtomicBool::new(false)), shared: Arc::new(Mutex::new(Shared::default())), handle: Mutex::new(None) }
    }
}

const MARKER_REGIONS: &[&str] = &["task_bar", "role_card", "meeting_header", "eject_text", "lobby_code", "room_label", "chat_send", "meeting_banner", "task_list", "map_name", "settings_feed", "chat_panel", "action_buttons", "voting_timer", "chat_counter", "lobby_button", "lobby_capacity"];

/// Nothing recognisable for this long (main menu, alt-tabbed, map open for ages) => treat as the lobby.
const UNKNOWN_TO_LOBBY: Duration = Duration::from_secs(120);

struct RegionTrack { hash: u64, stable: u32, text: String, dirty: bool }

fn ocr_rect(f: &Frame, r: Rect, scale: u32) -> String {
    let (c, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let (u, uw, uh) = upscale_bgra(&c, w, h, scale);
    match ocr_bgra(&u, uw, uh, None) {
        Ok(res) => res.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join("\n"),
        Err(_) => String::new(),
    }
}

pub fn parse_eject(text: &str) -> Option<EjectEvent> {
    let t = text.trim().replace('\n', " ");
    if t.is_empty() { return None; }
    let lower = t.to_lowercase();
    if lower.contains("no one was ejected") || lower.contains("skipped") || lower.contains("tie") {
        return Some(EjectEvent { raw: t.to_string(), name: None, was_impostor: None, skipped: true });
    }
    let idx = lower.find(" was ")?;
    let name = t[..idx].trim().to_string();
    if name.is_empty() { return None; }
    let rest = &lower[idx + 5..];
    let was_impostor = if rest.contains("not") { Some(false) }
        else if fuzzy_best(rest, ["an impostor", "the impostor", "an im"]).map(|b| b.1 > 0.6).unwrap_or(false) { Some(true) }
        else if rest.contains("eject") { None }
        else { return None };
    Some(EjectEvent { raw: t.to_string(), name: Some(name), was_impostor, skipped: false })
}

/// A 6-letter code, only when the panel title ("ROOM CODE") is in the same text.
/// The lobby panel's CAPACITY value: "10/10", "9/15". OCR sometimes renders the slash as I, l or |.
pub fn capacity_of(text: &str) -> Option<(u32, u32)> {
    for line in text.lines() {
        let t: String = line.chars().map(|c| if matches!(c, 'I' | 'l' | '|' | '\\') { '/' } else if matches!(c, 'O' | 'o') { '0' } else { c }).collect();
        let Some(slash) = t.find('/') else { continue };
        let left: String = t[..slash].trim_end().chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
        let right: String = t[slash + 1..].chars().skip_while(|c| *c == ' ').take_while(|c| c.is_ascii_digit()).collect();
        let (Ok(cur), Ok(max)) = (left.parse::<u32>(), right.parse::<u32>()) else { continue };
        if (4..=15).contains(&max) && cur >= 1 && cur <= max { return Some((cur, max)); }
    }
    None
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct CapacityEvent { pub current: u32, pub max: u32 }

pub fn lobby_code_of(text: &str) -> Option<String> {
    let up = text.to_uppercase();
    if !up.contains("CODE") { return None; }
    up.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric()).to_string())
        .find(|w| w.len() == 6 && w.chars().all(|c| c.is_ascii_uppercase()) && w != "CODE")
}

fn room_label_of(text: &str) -> Option<String> {
    let t = text.trim();
    let n = t.chars().count();
    if !(2..=20).contains(&n) || t.to_uppercase().contains("PING") { return None; }
    if t.chars().filter(|c| c.is_alphabetic() || *c == ' ').count() * 10 < n * 8 { return None; }
    Some(t.to_string())
}

pub fn start<R: Runtime>(app: AppHandle<R>, state: &WatcherState, latest: Latest) {
    if state.running.swap(true, Ordering::SeqCst) { return; }
    let running = state.running.clone();
    let shared = state.shared.clone();
    let handle = std::thread::spawn(move || run_loop(app, running, shared, latest));
    *state.handle.lock().unwrap() = Some(handle);
}

pub fn stop(state: &WatcherState) {
    state.running.store(false, Ordering::SeqCst);
    if let Some(h) = state.handle.lock().unwrap().take() { let _ = h.join(); }
    let mut s = state.shared.lock().unwrap();
    s.status.running = false;
}

fn run_loop<R: Runtime>(app: AppHandle<R>, running: Arc<AtomicBool>, shared: Arc<Mutex<Shared>>, latest: Latest) {
    let mut tracks: Vec<(String, RegionTrack)> = MARKER_REGIONS.iter().map(|n| (n.to_string(), RegionTrack { hash: 0, stable: 0, text: String::new(), dirty: true })).collect();
    let mut detector = PhaseDetector::default();
    let mut last_seq = 0u64;
    let mut candidate: Option<Phase> = None;
    let mut candidate_count = 0u32;
    let mut last_roster: Vec<RosterEntry> = Vec::new();
    let mut last_roster_read = Instant::now() - Duration::from_secs(60);
    let mut last_lobby: Vec<RosterEntry> = Vec::new();
    let mut last_lobby_read = Instant::now() - Duration::from_secs(60);
    let mut last_nearby_read = Instant::now() - Duration::from_secs(60);
    let mut last_nearby: Vec<String> = Vec::new();
    let mut meeting_since: Option<Instant> = None;
    let mut last_eject_raw = String::new();
    let mut last_role_text = String::new();
    let mut last_room = String::new();
    let mut last_tasks = String::new();
    let mut last_banner = String::new();
    let mut last_map = String::new();
    let mut last_capacity: Option<(u32, u32)> = None;
    let mut last_settings = String::new();
    let mut impostor_buttons_seen = false;
    let mut chat_seen: std::collections::VecDeque<String> = std::collections::VecDeque::new();
    let mut last_chat_read = Instant::now() - Duration::from_secs(60);
    // Unreadable bubbles have no text to dedupe on: (sender, bubble pixel hash), confirmed by two reads.
    let mut unreadable_seen: std::collections::VecDeque<(String, u64)> = std::collections::VecDeque::new();
    let mut unreadable_pending: Vec<(String, u64)> = Vec::new();
    let mut me_dead_meeting: Option<u32> = None;
    let mut unknown_since: Option<Instant> = None;
    let mut ocr_calls = 0u64;
    let mut last_status_emit = Instant::now();
    { shared.lock().unwrap().status.running = true; }

    while running.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(200));
        let Some(frame) = latest.lock().unwrap().clone() else { continue };
        if frame.seq == last_seq { continue; }
        last_seq = frame.seq;
        let regions = Regions::default().for_frame(frame.width, frame.height);

        // 1. Change detection per marker region (OCR only when changed and settled).
        let mut ocr_ms = 0u64;
        for (name, tr) in tracks.iter_mut() {
            let r = regions.get(name).unwrap();
            if r.x + r.w > frame.width || r.y + r.h > frame.height { continue; }
            let h = dhash(&frame.bgra, frame.width, r);
            if hamming(h, tr.hash) > 4 { tr.hash = h; tr.stable = 0; tr.dirty = true; } else { tr.stable += 1; }
            if name == "chat_panel" { continue; } // read by the chat step below (needs structure, not text)
            if tr.dirty && tr.stable >= 1 {
                let t0 = Instant::now();
                // Role card / banner text is huge (1× keeps us under the OCR size limit); task list is small (3×).
                let scale = match name.as_str() { "role_card" | "meeting_banner" => 1, "task_list" => 3, _ => 2 };
                tr.text = ocr_rect(&frame, r, scale);
                ocr_ms += t0.elapsed().as_millis() as u64;
                ocr_calls += 1;
                tr.dirty = false;
            }
        }
        let text = |n: &str| tracks.iter().find(|(k, _)| k == n).map(|(_, t)| t.text.clone()).unwrap_or_default();
        let stable = |n: &str, k: u32| tracks.iter().find(|(key, _)| key == n).map(|(_, t)| t.stable >= k).unwrap_or(false);

        // 2. Markers from text.
        let task_bar = fuzzy_best(&text("task_bar"), ["TOTAL TASKS COMPLETED"]).map(|b| b.1 > 0.6).unwrap_or(false);
        let counter = text("chat_counter");
        let chat_open = fuzzy_best(text("chat_send").trim(), ["Send"]).map(|b| b.1 > 0.7).unwrap_or(false)
            || counter.contains("/100") || counter.contains("/ 100") || counter.contains("I100");
        let header = text("meeting_header");
        let meeting_header = fuzzy_best(&header, ["Who Is The Impostor?", "Emergency Meeting", "Dead Body Reported"]).map(|b| b.1 > 0.65).unwrap_or(false);
        let me_dead_header = header.trim().to_uppercase() == "DEAD" || (header.trim().len() <= 5 && fuzzy_best(header.trim(), ["DEAD"]).map(|b| b.1 > 0.85).unwrap_or(false));
        // The voting timer ("Voting Ends In: 119s" / "Voting Begins In: 3s") stays visible under the chat panel.
        let timer_text = text("voting_timer").to_lowercase();
        let voting_timer = timer_text.contains("ends in") || timer_text.contains("begins in") || fuzzy_best(&timer_text, ["voting ends in", "voting begins in"]).map(|b| b.1 > 0.6).unwrap_or(false);
        let in_meeting_now = matches!(detector.current, Some(Phase::MeetingDiscussion) | Some(Phase::MeetingVoting));
        // An open chat panel covers the header: a meeting stays a meeting while chat is open.
        let meeting = meeting_header || voting_timer || me_dead_header || (chat_open && in_meeting_now);
        let eject = parse_eject(&text("eject_text"));
        // Lobby: the room code panel, or the bottom-centre "WAITING FOR HOST" / "START" button (always there),
        // and it stays the lobby while the chat panel covers that button.
        let lobby_code = lobby_code_of(&text("lobby_code"));
        let lb = text("lobby_button").to_uppercase();
        let lobby_button = lb.contains("WAITING") || lb.contains("START") || fuzzy_best(lb.trim(), ["WAITING FOR HOST", "START", "STARTING IN"]).map(|b| b.1 > 0.6).unwrap_or(false);
        let in_lobby = lobby_code.is_some() || lobby_button || (chat_open && detector.current == Some(Phase::Lobby));
        // Round: the task bar, or the REPORT / KILL / SABOTAGE / VENT buttons (visible whatever the task-bar
        // setting). USE is not enough: the lobby has one too.
        let ab = text("action_buttons").to_uppercase();
        let action_words = ab.split_whitespace().any(|w| w.len() >= 4 && fuzzy_best(w, ["REPORT", "KILL", "SABOTAGE", "VENT"]).map(|b| b.1 > 0.8).unwrap_or(false));
        let in_round = task_bar || (action_words && !meeting && !chat_open && !in_lobby);
        let role_text = text("role_card").to_uppercase();
        let role_word = role_text.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphabetic()))
            .find(|w| w.len() >= 6 && fuzzy_best(w, ["CREWMATE", "IMPOSTOR"]).map(|b| b.1 > 0.85).unwrap_or(false))
            .map(|w| if fuzzy_best(w, ["IMPOSTOR"]).unwrap().1 > fuzzy_best(w, ["CREWMATE"]).unwrap().1 { "impostor" } else { "crew" });
        let over_word = role_text.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphabetic()))
            .find(|w| w.len() >= 5 && fuzzy_best(w, ["VICTORY", "DEFEAT"]).map(|b| b.1 > 0.85).unwrap_or(false))
            .map(|w| if fuzzy_best(w, ["VICTORY"]).unwrap().1 > fuzzy_best(w, ["DEFEAT"]).unwrap().1 { "victory" } else { "defeat" });
        // Role reveal and victory / defeat are big coloured letters on a black screen: the text colour
        // (teal = crewmate, red = impostor / defeat, blue = victory) backs up OCR, and stands in for it.
        let accent = screen_accent(&frame, regions.role_card);
        let dark_screen = accent.is_dark_screen() && !chat_open;
        let in_game = matches!(detector.current, Some(Phase::Round) | Some(Phase::MeetingDiscussion) | Some(Phase::MeetingVoting) | Some(Phase::Ejection));
        let ocr_role = dark_screen && role_word.is_some() && !role_text.contains("WHO IS");
        let ocr_over = dark_screen && over_word.is_some();
        let role_card = !meeting && eject.is_none() && (ocr_role || (dark_screen && !ocr_over && !in_game && accent.dominant().is_some()));
        let game_over = ocr_over || (dark_screen && !ocr_role && in_game && eject.is_none() && accent.dominant().is_some());
        let banner_text = text("meeting_banner").to_uppercase();
        let banner = if banner_text.contains("DEAD") || banner_text.contains("BODY") { Some("body") } else if banner_text.contains("EMERGENCY") { Some("button") } else { None };

        // 3. Role (once per card appearance): the OCR word when read, else the text colour.
        if role_card && !game_over {
            let role = role_word.or_else(|| match accent.dominant() { Some("red") => Some("impostor"), Some("teal") => Some("crew"), _ => None });
            if let Some(role) = role {
                let key = if role_text.is_empty() { format!("<{role}>") } else { role_text.clone() };
                if key != last_role_text {
                    last_role_text = key;
                    let _ = app.emit(EV_ROLE, role);
                }
            }
        }
        if !role_card { last_role_text.clear(); }

        // 3b. Impostor buttons (KILL / SABOTAGE) -- visible all round, so this catches a missed role card.
        if in_round && !meeting {
            let imp = ab.split_whitespace().any(|w| w.len() >= 4 && fuzzy_best(w, ["KILL", "SABOTAGE"]).map(|b| b.1 > 0.8).unwrap_or(false));
            if imp && !impostor_buttons_seen { impostor_buttons_seen = true; let _ = app.emit(EV_ROLE, "impostor"); }
        }
        if game_over || role_card || in_lobby { impostor_buttons_seen = false; }

        // 4. Phase with hysteresis. Only positive evidence moves the phase; "nothing recognisable"
        //    (map open, settings, a missed frame) keeps the current one for up to UNKNOWN_TO_LOBBY.
        let next = if game_over { Some(Phase::GameOver) }
            else if eject.is_some() { Some(Phase::Ejection) }
            else if meeting { Some(Phase::MeetingDiscussion) }
            else if role_card { Some(Phase::RoundStart) }
            else if in_lobby { Some(Phase::Lobby) }
            else if in_round { Some(Phase::Round) }
            else { None };
        match next {
            Some(_) => unknown_since = None,
            None => { if unknown_since.is_none() { unknown_since = Some(Instant::now()); } }
        }
        let next = next.or_else(|| if unknown_since.map(|t| t.elapsed() > UNKNOWN_TO_LOBBY).unwrap_or(false) && detector.current != Some(Phase::Lobby) { Some(Phase::Lobby) } else { None });
        if let Some(next) = next {
            if candidate == Some(next) { candidate_count += 1; } else { candidate = Some(next); candidate_count = 0; }
            // Leaving a meeting, the task bar shows for a moment before the ejection text: a round
            // straight after a meeting needs ~2.5 s of evidence so the vote → eject → round sequence
            // is not counted as two rounds.
            let needed = match next {
                Phase::Lobby => 4,
                Phase::Round if matches!(detector.current, Some(Phase::MeetingDiscussion) | Some(Phase::MeetingVoting)) => 12,
                Phase::Round => 2,
                Phase::GameOver => 2,
                _ => 1,
            };
            if candidate_count >= needed {
                if let Some(p) = detector.step(matches!(next, Phase::RoundStart), matches!(next, Phase::MeetingDiscussion), matches!(next, Phase::Ejection), matches!(next, Phase::GameOver), matches!(next, Phase::Round)) {
                    let name = phase_name(p);
                    let _ = app.emit(EV_PHASE, PhaseEvent { phase: name.to_string(), round: detector.round, meeting: detector.meeting });
                    if p == Phase::GameOver {
                        let outcome = over_word.or_else(|| match accent.dominant() { Some("blue") => Some("victory"), _ => None });
                        let _ = app.emit(EV_GAME_OVER, GameOverEvent { outcome, accent: accent.dominant() });
                    }
                    if p == Phase::MeetingDiscussion { meeting_since = Some(Instant::now()); last_roster.clear(); } else { meeting_since = None; }
                }
            }
        }

        // 4b. Meeting banner (reason) and "DEAD" header (I died) — once each.
        if let Some(reason) = banner {
            if banner_text != last_banner { last_banner = banner_text.clone(); let _ = app.emit(EV_BANNER, reason); }
        } else { last_banner.clear(); }
        // "DEAD" must sit still (the sliding "DEAD BODY REPORTED" banner can read as "DEAD" for a frame).
        if me_dead_header && banner.is_none() && stable("meeting_header", 2) && me_dead_meeting != Some(detector.meeting) {
            me_dead_meeting = Some(detector.meeting);
            let _ = app.emit(EV_ME_DEAD, detector.meeting);
        }

        // 5. Ejection text (emit once per distinct text, only when it stopped animating).
        if let Some(e) = &eject {
            if stable("eject_text", 3) && e.raw != last_eject_raw {
                last_eject_raw = e.raw.clone();
                let _ = app.emit(EV_EJECT, e.clone());
            }
        } else if !last_eject_raw.is_empty() && !text("eject_text").to_lowercase().contains(" was ") {
            last_eject_raw.clear();
        }

        // 6. Lobby code.
        if let Some(code) = &lobby_code {
            let mut s = shared.lock().unwrap();
            if s.status.lobby_code.as_deref() != Some(code) {
                s.status.lobby_code = Some(code.clone());
                drop(s);
                let _ = app.emit(EV_LOBBY, code.clone());
            }
        }

        // 6a. Map name from the lobby settings panel (needs the room code title nearby, i.e. the panel is open).
        if lobby_code.is_some() {
            let mt = text("map_name");
            if let Some((map, score)) = fuzzy_best(&mt, ["The Skeld", "MIRA HQ", "Polus", "The Airship", "The Fungle"]) {
                if score > 0.55 && map != last_map {
                    last_map = map.to_string();
                    let id = match map { "The Skeld" => "skeld", "MIRA HQ" => "mira", "Polus" => "polus", "The Airship" => "airship", _ => "fungle" };
                    let _ = app.emit(EV_MAP, id);
                }
            }
        }

        // 6a''. Lobby CAPACITY "N/MAX": how many people are in the room (the roster size).
        if in_lobby && !chat_open {
            if let Some(cap) = capacity_of(&text("lobby_capacity")) {
                if Some(cap) != last_capacity && stable("lobby_capacity", 1) {
                    last_capacity = Some(cap);
                    let _ = app.emit(EV_CAPACITY, CapacityEvent { current: cap.0, max: cap.1 });
                }
            }
        }

        // 6a'. Lobby settings announcements ("X set to Y"), lobby only.
        if matches!(detector.current, None | Some(Phase::Lobby) | Some(Phase::GameOver)) && !meeting {
            let t = text("settings_feed");
            if t != last_settings && stable("settings_feed", 1) {
                last_settings = t.clone();
                let lines: Vec<String> = t.lines().map(|l| l.trim().trim_start_matches(|c: char| !c.is_alphanumeric() && c != '#').to_string()).filter(|l| l.to_lowercase().contains("set to")).collect();
                if !lines.is_empty() { let _ = app.emit(EV_SETTINGS, lines); }
            }
        }

        // 6b. Room-name popup (transient, on entering a room) → my room.
        if let Some(room) = room_label_of(&text("room_label")) {
            if room != last_room && stable("room_label", 1) {
                last_room = room.clone();
                shared.lock().unwrap().status.room = Some(room.clone());
                let _ = app.emit(EV_ROOM, room);
            }
        } else { last_room.clear(); }

        // 6c. My task list (top-left) when it changes. Not under the meeting screen or an open chat
        //     panel: both overlap the region and chat about "faking" would read as "Fake Tasks".
        if task_bar && !meeting && !chat_open {
            let t = text("task_list");
            if !t.trim().is_empty() && t != last_tasks && stable("task_list", 2) {
                last_tasks = t.clone();
                let lines: Vec<String> = t.lines().map(|l| l.trim().to_string()).filter(|l| l.len() >= 4).collect();
                let _ = app.emit(EV_TASKS, lines);
            }
        }

        // 7. Roster from the vote grid: 1.2 s after the meeting opened (fade-in), then every 4 s; never with chat open.
        if let Some(since) = meeting_since {
            if !chat_open && since.elapsed() > Duration::from_millis(1200) && last_roster_read.elapsed() > Duration::from_secs(4)
                && (last_roster.len() > 0 || brightness_factor(&frame) < 1.12 || since.elapsed() > Duration::from_secs(6)) {
                last_roster_read = Instant::now();
                let known = shared.lock().unwrap().known_names.clone();
                if let Ok(r) = read_vote_grid(&frame, &known) {
                    ocr_calls += r.entries.len() as u64;
                    if r.entries.len() >= 3 && r.entries != last_roster {
                        last_roster = r.entries.clone();
                        let _ = app.emit(EV_ROSTER, RosterEvent { source: "grid", entries: r.entries });
                    }
                }
            }
        }

        // 7b. Lobby roster from floating names: only on the lobby screen (room code visible), every 5 s, chat closed.
        if in_lobby && !chat_open && matches!(detector.current, None | Some(Phase::Lobby) | Some(Phase::GameOver)) && !meeting
            && last_lobby_read.elapsed() > Duration::from_secs(5) {
            last_lobby_read = Instant::now();
            if let Ok(r) = read_lobby(&frame) {
                ocr_calls += 1;
                if r.entries.len() >= 2 && r.entries != last_lobby {
                    last_lobby = r.entries.clone();
                    let _ = app.emit(EV_ROSTER, RosterEvent { source: "lobby", entries: r.entries });
                }
            }
        }

        // 7c. Nearby names during a round (who is on screen with me), every 3 s.
        if matches!(detector.current, Some(Phase::Round)) && !chat_open && last_nearby_read.elapsed() > Duration::from_secs(3) {
            last_nearby_read = Instant::now();
            if let Ok(r) = read_lobby(&frame) {
                ocr_calls += 1;
                let names: Vec<String> = r.entries.iter().map(|e| format!("{}{}", if e.red_name { "!" } else { "" }, e.name)).collect();
                if names != last_nearby {
                    last_nearby = names.clone();
                    let _ = app.emit(EV_NEARBY, names);
                }
            }
        }

        // 7d. Chat: whenever the panel is open and its pixels changed (≥ 700 ms apart), read bubbles and emit new ones.
        if chat_open && last_chat_read.elapsed() > Duration::from_millis(700) {
            let changed = tracks.iter().find(|(k, _)| k == "chat_panel").map(|(_, t)| t.dirty).unwrap_or(false);
            if changed {
                last_chat_read = Instant::now();
                if let Some((_, t)) = tracks.iter_mut().find(|(k, _)| k == "chat_panel") { t.dirty = false; }
                let known = shared.lock().unwrap().known_names.clone();
                let t0 = Instant::now();
                if let Ok(read) = read_chat_detailed(&frame, &known) {
                    ocr_calls += 1;
                    ocr_ms += t0.elapsed().as_millis() as u64;
                    let mut next_pending: Vec<(String, u64)> = Vec::new();
                    let mut fresh: Vec<ChatMsg> = Vec::new();
                    for m in read.msgs {
                        if m.unreadable && m.text.is_empty() {
                            let same = |(s, h): &(String, u64)| *s == m.sender && hamming(*h, m.bubble_hash) <= 10;
                            if unreadable_seen.iter().any(same) { continue; }
                            let confirmed = unreadable_pending.iter().any(same);
                            next_pending.push((m.sender.clone(), m.bubble_hash));
                            if !confirmed { continue; } // a bubble mid-scroll / mid-fade can look empty for one frame
                            unreadable_seen.push_back((m.sender.clone(), m.bubble_hash));
                            if unreadable_seen.len() > 30 { unreadable_seen.pop_front(); }
                            fresh.push(m);
                            continue;
                        }
                        let key = format!("{}|{}|{}", m.sender, m.text.to_lowercase(), m.system);
                        if chat_seen.contains(&key) { continue; }
                        chat_seen.push_back(key);
                        if chat_seen.len() > 60 { chat_seen.pop_front(); }
                        fresh.push(m);
                    }
                    unreadable_pending = next_pending;
                    if !fresh.is_empty() { let _ = app.emit(EV_CHAT, fresh); }
                }
            }
        }

        // 8. Status for the UI.
        {
            let mut s = shared.lock().unwrap();
            s.status.phase = detector.current.map(|p| phase_name(p).to_string());
            s.status.round = detector.round;
            s.status.meeting = detector.meeting;
            s.status.markers = Markers { task_bar: in_round, role_card, meeting_header: meeting, eject_text: eject.is_some(), lobby_code: lobby_code.is_some(), chat_open, banner: banner.is_some() };
            if ocr_ms > 0 { s.status.last_ocr_ms = ocr_ms; }
            s.status.ocr_calls = ocr_calls;
            s.status.frame_seq = frame.seq;
            if last_status_emit.elapsed() > Duration::from_millis(1000) {
                last_status_emit = Instant::now();
                let _ = app.emit(EV_STATUS, s.status.clone());
            }
        }
    }
    shared.lock().unwrap().status.running = false;
}

fn phase_name(p: Phase) -> &'static str {
    match p {
        Phase::Lobby => "lobby", Phase::RoundStart => "roundStart", Phase::Round => "round",
        Phase::MeetingDiscussion => "meetingDiscussion", Phase::MeetingVoting => "meetingVoting",
        Phase::Ejection => "ejection", Phase::GameOver => "gameOver",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_eject_variants() {
        let e = parse_eject("Flushbevy was An Im").unwrap();
        assert_eq!(e.name.as_deref(), Some("Flushbevy"));
        assert_eq!(e.was_impostor, Some(true));
        let e = parse_eject("Red was not An Impostor.").unwrap();
        assert_eq!(e.was_impostor, Some(false));
        let e = parse_eject("Blue was ejected.").unwrap();
        assert_eq!(e.was_impostor, None);
        assert!(parse_eject("No one was ejected. (Skipped)").unwrap().skipped);
        assert!(parse_eject("PING: 65 ms").is_none());
    }

    #[test]
    fn finds_lobby_code_only_with_its_title() {
        assert_eq!(lobby_code_of("ROOM CODE\nPFRXRG").as_deref(), Some("PFRXRG"));
        assert_eq!(lobby_code_of("ROOM CODE"), None);
        assert_eq!(lobby_code_of("BRATZY"), None, "a six-capital player name is not a code");
    }

    #[cfg(windows)]
    fn load_fixture(name: &str) -> Frame {
        let path = format!("{}/fixtures/screens/1920x1080/{name}.png", env!("CARGO_MANIFEST_DIR"));
        let img = image::open(&path).expect("fixture png").to_rgba8();
        let (w, h) = img.dimensions();
        let mut bgra = img.into_raw();
        for px in bgra.chunks_exact_mut(4) { px.swap(0, 2); }
        Frame { width: w, height: h, bgra, t_wall_ms: 0, seq: 1 }
    }

    #[cfg(windows)]
    #[test]
    fn role_cards_read_as_teal_on_black_and_game_screens_do_not() {
        let r = Regions::default();
        for name in ["role_card", "role_card_v2"] {
            let a = screen_accent(&load_fixture(name), r.role_card);
            assert!(a.is_dark_screen(), "{name}: {a:?}");
            assert_eq!(a.dominant(), Some("teal"), "{name}: {a:?}");
        }
        for name in ["lobby", "round_cafeteria", "meeting_vote_grid", "meeting_chat", "eject_text", "voting_results"] {
            let a = screen_accent(&load_fixture(name), r.role_card);
            assert!(!a.is_dark_screen(), "{name} must not look like a role/end screen: {a:?}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn lobby_button_reads_on_both_lobby_fixtures() {
        let r = Regions::default();
        for name in ["lobby", "lobby_v2"] {
            let f = load_fixture(name);
            let t = ocr_rect(&f, r.lobby_button, 2).to_uppercase();
            assert!(t.contains("WAITING") || t.contains("START"), "{name}: {t:?}");
        }
        let f = load_fixture("round_cafeteria");
        let t = ocr_rect(&f, r.lobby_button, 2).to_uppercase();
        assert!(!(t.contains("WAITING") || t.contains("START")), "round frame must not look like the lobby: {t:?}");
    }

    #[test]
    fn capacity_parse() {
        assert_eq!(capacity_of("15/15"), Some((15, 15)));
        assert_eq!(capacity_of("9I10"), Some((9, 10)));
        assert_eq!(capacity_of("CAPACITY\n 7 / 15"), Some((7, 15)));
        assert_eq!(capacity_of("0/100"), None, "chat counter");
        assert_eq!(capacity_of("PING: 64 ms"), None);
    }

    #[cfg(windows)]
    #[test]
    fn lobby_capacity_reads_on_both_lobby_fixtures() {
        let r = Regions::default();
        for (name, want) in [("lobby", (10, 10)), ("lobby_v2", (15, 15))] {
            let f = load_fixture(name);
            let t = ocr_rect(&f, r.lobby_capacity, 2);
            assert_eq!(capacity_of(&t), Some(want), "{name}: {t:?}");
        }
    }

    #[test]
    fn room_label_filter() {
        assert_eq!(room_label_of("Electrical").as_deref(), Some("Electrical"));
        assert_eq!(room_label_of("Upper Engine").as_deref(), Some("Upper Engine"));
        assert_eq!(room_label_of("PING: 69 ms"), None);
        assert_eq!(room_label_of("0/8"), None);
    }
}

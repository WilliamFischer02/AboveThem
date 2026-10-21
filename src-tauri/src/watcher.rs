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
use crate::ocr::{fuzzy_best, ocr_bgra};
use crate::phase::{Phase, PhaseDetector};
use crate::regions::{dhash, hamming, Rect, Regions};
use crate::roster::{read_vote_grid, RosterEntry};

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

#[derive(Clone, Debug, serde::Serialize)]
pub struct PhaseEvent { pub phase: String, pub round: u32, pub meeting: u32 }

#[derive(Clone, Debug, serde::Serialize)]
pub struct RosterEvent { pub source: &'static str, pub entries: Vec<RosterEntry> }

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

const MARKER_REGIONS: &[&str] = &["task_bar", "role_card", "meeting_header", "eject_text", "lobby_code", "room_label", "chat_send", "meeting_banner", "task_list", "map_name"];

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
    let mut me_dead_meeting: Option<u32> = None;
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
        let chat_open = fuzzy_best(text("chat_send").trim(), ["Send"]).map(|b| b.1 > 0.7).unwrap_or(false);
        let header = text("meeting_header");
        let meeting = fuzzy_best(&header, ["Who Is The Impostor?", "Emergency Meeting", "Dead Body Reported"]).map(|b| b.1 > 0.65).unwrap_or(false);
        let me_dead_header = header.trim().to_uppercase() == "DEAD" || (header.trim().len() <= 5 && fuzzy_best(header.trim(), ["DEAD"]).map(|b| b.1 > 0.85).unwrap_or(false));
        let eject = parse_eject(&text("eject_text"));
        let role_text = text("role_card").to_uppercase();
        let role_word = role_text.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphabetic()))
            .find(|w| w.len() >= 6 && fuzzy_best(w, ["CREWMATE", "IMPOSTOR"]).map(|b| b.1 > 0.85).unwrap_or(false))
            .map(|w| if fuzzy_best(w, ["IMPOSTOR"]).unwrap().1 > fuzzy_best(w, ["CREWMATE"]).unwrap().1 { "impostor" } else { "crew" });
        let at_game_start = matches!(detector.current, None | Some(Phase::Lobby) | Some(Phase::GameOver));
        let role_card = !meeting && at_game_start && eject.is_none() && role_word.is_some() && !role_text.contains("WHO IS");
        let game_over = role_text.split_whitespace().any(|w| fuzzy_best(w, ["VICTORY", "DEFEAT"]).map(|b| b.1 > 0.85).unwrap_or(false));
        let banner_text = text("meeting_banner").to_uppercase();
        let banner = if banner_text.contains("DEAD") || banner_text.contains("BODY") { Some("body") } else if banner_text.contains("EMERGENCY") { Some("button") } else { None };
        let lobby_code = lobby_code_of(&text("lobby_code"));

        // 3. Role (once per card appearance).
        if role_card && role_text != last_role_text {
            last_role_text = role_text.clone();
            let _ = app.emit(EV_ROLE, role_word.unwrap_or("crew"));
        }
        if !role_card { last_role_text.clear(); }

        // 4. Phase with hysteresis.
        let next = if game_over { Phase::GameOver }
            else if eject.is_some() { Phase::Ejection }
            else if meeting || me_dead_header { Phase::MeetingDiscussion }
            else if role_card { Phase::RoundStart }
            else if task_bar { Phase::Round }
            else { Phase::Lobby };
        if candidate == Some(next) { candidate_count += 1; } else { candidate = Some(next); candidate_count = 0; }
        let needed = match next { Phase::Lobby => 6, Phase::Round => 2, Phase::GameOver => 2, _ => 1 };
        if candidate_count >= needed {
            if let Some(p) = detector.step(matches!(next, Phase::RoundStart), matches!(next, Phase::MeetingDiscussion), matches!(next, Phase::Ejection), matches!(next, Phase::GameOver), matches!(next, Phase::Round)) {
                let name = phase_name(p);
                let _ = app.emit(EV_PHASE, PhaseEvent { phase: name.to_string(), round: detector.round, meeting: detector.meeting });
                if p == Phase::MeetingDiscussion { meeting_since = Some(Instant::now()); last_roster.clear(); } else { meeting_since = None; }
            }
        }

        // 4b. Meeting banner (reason) and "DEAD" header (I died) — once each.
        if let Some(reason) = banner {
            if banner_text != last_banner { last_banner = banner_text.clone(); let _ = app.emit(EV_BANNER, reason); }
        } else { last_banner.clear(); }
        if me_dead_header && me_dead_meeting != Some(detector.meeting) {
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

        // 6b. Room-name popup (transient, on entering a room) → my room.
        if let Some(room) = room_label_of(&text("room_label")) {
            if room != last_room && stable("room_label", 1) {
                last_room = room.clone();
                shared.lock().unwrap().status.room = Some(room.clone());
                let _ = app.emit(EV_ROOM, room);
            }
        } else { last_room.clear(); }

        // 6c. My task list (top-left) when it changes.
        if task_bar {
            let t = text("task_list");
            if !t.trim().is_empty() && t != last_tasks && stable("task_list", 2) {
                last_tasks = t.clone();
                let lines: Vec<String> = t.lines().map(|l| l.trim().to_string()).filter(|l| l.len() >= 4).collect();
                let _ = app.emit(EV_TASKS, lines);
            }
        }

        // 7. Roster from the vote grid: 1.2 s after the meeting opened (fade-in), then every 4 s; never with chat open.
        if let Some(since) = meeting_since {
            if !chat_open && since.elapsed() > Duration::from_millis(1200) && last_roster_read.elapsed() > Duration::from_secs(4) {
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
        if lobby_code.is_some() && !chat_open && matches!(detector.current, None | Some(Phase::Lobby) | Some(Phase::GameOver)) && !meeting
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
                let names: Vec<String> = r.entries.into_iter().map(|e| e.name).collect();
                if names != last_nearby {
                    last_nearby = names.clone();
                    let _ = app.emit(EV_NEARBY, names);
                }
            }
        }

        // 8. Status for the UI.
        {
            let mut s = shared.lock().unwrap();
            s.status.phase = detector.current.map(|p| phase_name(p).to_string());
            s.status.round = detector.round;
            s.status.meeting = detector.meeting;
            s.status.markers = Markers { task_bar, role_card, meeting_header: meeting, eject_text: eject.is_some(), lobby_code: lobby_code.is_some(), chat_open, banner: banner.is_some() };
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

    #[test]
    fn room_label_filter() {
        assert_eq!(room_label_of("Electrical").as_deref(), Some("Electrical"));
        assert_eq!(room_label_of("Upper Engine").as_deref(), Some("Upper Engine"));
        assert_eq!(room_label_of("PING: 69 ms"), None);
        assert_eq!(room_label_of("0/8"), None);
    }
}

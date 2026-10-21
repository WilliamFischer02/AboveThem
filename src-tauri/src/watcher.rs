//! Background game watcher — the "automatic" layer.
//!
//! Polls the latest captured frame (~5 Hz). For each marker region it keeps a
//! perceptual hash; when a region's pixels change and then hold still for two
//! polls, it OCRs that region (≈ 40 ms) and updates a marker. Markers feed the
//! phase state machine; phase transitions, roster reads (vote grid), lobby code
//! and ejection text are pushed to the frontend as `game://*` events. Nothing
//! here is ever triggered by the user.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Runtime};

use crate::capture::{crop_bgra, upscale_bgra, Frame, Latest};
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

#[derive(Clone, Debug, serde::Serialize)]
pub struct PhaseEvent { pub phase: String, pub round: u32, pub meeting: u32 }

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
}

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct Markers {
    pub task_bar: bool,
    pub role_card: bool,
    pub meeting_header: bool,
    pub eject_text: bool,
    pub lobby_code: bool,
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

const MARKER_REGIONS: &[&str] = &["task_bar", "role_card", "meeting_header", "eject_text", "lobby_code"];

struct RegionTrack { hash: u64, stable: u32, text: String, dirty: bool }

fn ocr_rect(f: &Frame, r: Rect, scale: u32) -> String {
    let (c, w, h) = crop_bgra(f, r.x, r.y, r.w, r.h);
    let (u, uw, uh) = upscale_bgra(&c, w, h, scale);
    match ocr_bgra(&u, uw, uh, None) {
        Ok(res) => res.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" "),
        Err(_) => String::new(),
    }
}

fn parse_eject(text: &str) -> Option<EjectEvent> {
    let t = text.trim();
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

fn lobby_code_of(text: &str) -> Option<String> {
    text.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphanumeric()).to_uppercase())
        .find(|w| w.len() == 6 && w.chars().all(|c| c.is_ascii_uppercase()))
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
    let mut meeting_since: Option<Instant> = None;
    let mut last_eject_raw = String::new();
    let mut last_role_text = String::new();
    let mut ocr_calls = 0u64;
    let mut last_status_emit = Instant::now();
    { shared.lock().unwrap().status.running = true; }

    while running.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(200));
        let Some(frame) = latest.lock().unwrap().clone() else { continue };
        if frame.seq == last_seq { continue; }
        last_seq = frame.seq;
        let regions = Regions::default().for_frame(frame.width, frame.height);

        // 1. Change detection per marker region.
        let mut ocr_ms = 0u64;
        for (name, tr) in tracks.iter_mut() {
            let r = regions.get(name).unwrap();
            if r.x + r.w > frame.width || r.y + r.h > frame.height { continue; }
            let h = dhash(&frame.bgra, frame.width, r);
            if hamming(h, tr.hash) > 4 { tr.hash = h; tr.stable = 0; tr.dirty = true; } else { tr.stable += 1; }
            if tr.dirty && tr.stable >= 1 {
                let t0 = Instant::now();
                // Role card text is huge; 1× keeps the upscaled image under the OCR size limit.
                tr.text = ocr_rect(&frame, r, if name == "role_card" { 1 } else { 2 });
                ocr_ms += t0.elapsed().as_millis() as u64;
                ocr_calls += 1;
                tr.dirty = false;
            }
        }
        let text = |n: &str| tracks.iter().find(|(k, _)| k == n).map(|(_, t)| t.text.clone()).unwrap_or_default();

        // 2. Markers from text.
        let task_bar = fuzzy_best(&text("task_bar"), ["TOTAL TASKS COMPLETED"]).map(|b| b.1 > 0.6).unwrap_or(false);
        let header = text("meeting_header");
        let meeting = fuzzy_best(&header, ["Who Is The Impostor?", "Emergency Meeting", "Dead Body Reported"]).map(|b| b.1 > 0.65).unwrap_or(false);
        // Role card: a standalone CREWMATE / IMPOSTOR word (either layout), never while the meeting
        // header is up ("Who Is The Impostor?" sits inside the role-card region).
        let role_text = text("role_card").to_uppercase();
        let role_word = role_text.split_whitespace().map(|w| w.trim_matches(|c: char| !c.is_ascii_alphabetic()))
            .find(|w| w.len() >= 6 && fuzzy_best(w, ["CREWMATE", "IMPOSTOR"]).map(|b| b.1 > 0.85).unwrap_or(false))
            .map(|w| if fuzzy_best(w, ["IMPOSTOR"]).unwrap().1 > fuzzy_best(w, ["CREWMATE"]).unwrap().1 { "impostor" } else { "crew" });
        // A role card can only appear coming out of the lobby or an ejection, never mid-round.
        let in_round = matches!(detector.current, Some(Phase::Round));
        let role_card = !meeting && !in_round && role_word.is_some() && !role_text.contains("WHO IS");
        let eject = parse_eject(&text("eject_text"));
        let lobby_code = lobby_code_of(&text("lobby_code"));

        // 3. Role (once per card appearance).
        if role_card && role_text != last_role_text {
            last_role_text = role_text.clone();
            let _ = app.emit(EV_ROLE, role_word.unwrap_or("crew"));
        }
        if !role_card { last_role_text.clear(); }

        // 4. Phase with hysteresis (2 consecutive agreeing polls before a transition is accepted).
        let next = if eject.is_some() { Phase::Ejection }
            else if meeting { Phase::MeetingDiscussion }
            else if role_card { Phase::RoundStart }
            else if task_bar { Phase::Round }
            else { Phase::Lobby };
        if candidate == Some(next) { candidate_count += 1; } else { candidate = Some(next); candidate_count = 0; }
        let needed = match next { Phase::Lobby => 6, Phase::Round => 2, _ => 1 }; // Lobby needs ~1.5 s of nothing
        if candidate_count >= needed {
            if let Some(p) = detector.step(matches!(next, Phase::RoundStart), matches!(next, Phase::MeetingDiscussion), matches!(next, Phase::Ejection), false, matches!(next, Phase::Round)) {
                let name = phase_name(p);
                let _ = app.emit(EV_PHASE, PhaseEvent { phase: name.to_string(), round: detector.round, meeting: detector.meeting });
                if p == Phase::MeetingDiscussion { meeting_since = Some(Instant::now()); last_roster.clear(); } else { meeting_since = None; }
            }
        }

        // 5. Ejection text (emit once per distinct text, only when it stopped animating).
        if let Some(e) = &eject {
            let stable = tracks.iter().find(|(k, _)| k == "eject_text").map(|(_, t)| t.stable >= 3).unwrap_or(false);
            if stable && e.raw != last_eject_raw {
                last_eject_raw = e.raw.clone();
                let _ = app.emit(EV_EJECT, e.clone());
            }
        } else if !last_eject_raw.is_empty() && !text("eject_text").to_lowercase().contains(" was ") {
            last_eject_raw.clear();
        }

        // 6. Lobby code.
        if let Some(code) = lobby_code {
            let mut s = shared.lock().unwrap();
            if s.status.lobby_code.as_deref() != Some(&code) {
                s.status.lobby_code = Some(code.clone());
                drop(s);
                let _ = app.emit(EV_LOBBY, code);
            }
        }

        // 7. Roster from the vote grid: 1.2 s after the meeting opened (fade-in), then every 4 s.
        if let Some(since) = meeting_since {
            if since.elapsed() > Duration::from_millis(1200) && last_roster_read.elapsed() > Duration::from_secs(4) {
                last_roster_read = Instant::now();
                let known = shared.lock().unwrap().known_names.clone();
                if let Ok(r) = read_vote_grid(&frame, &known) {
                    ocr_calls += r.entries.len() as u64;
                    if r.entries.len() >= 3 && r.entries != last_roster {
                        last_roster = r.entries.clone();
                        let _ = app.emit(EV_ROSTER, r.entries);
                    }
                }
            }
        }

        // 8. Status for the UI.
        {
            let mut s = shared.lock().unwrap();
            s.status.phase = detector.current.map(|p| phase_name(p).to_string());
            s.status.round = detector.round;
            s.status.meeting = detector.meeting;
            s.status.markers = Markers { task_bar, role_card, meeting_header: meeting, eject_text: eject.is_some(), lobby_code: lobby_code_of(&text("lobby_code")).is_some() };
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
    fn finds_lobby_code() {
        assert_eq!(lobby_code_of("ROOM CODE PFRXRG").as_deref(), Some("PFRXRG"));
        assert_eq!(lobby_code_of("ROOM CODE"), None);
    }
}

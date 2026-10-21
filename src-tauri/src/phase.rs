//! Game phase state machine from UI markers. Phase 2.
//! Inputs are cheap template/colour checks on specific ROIs, not OCR.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase { Lobby, RoundStart, Round, MeetingDiscussion, MeetingVoting, Ejection, GameOver }

#[derive(Debug, Default)]
pub struct PhaseDetector {
    pub current: Option<Phase>,
    pub round: u32,
    pub meeting: u32,
}

impl PhaseDetector {
    /// Feed marker booleans for one frame; returns Some(new_phase) on transition.
    pub fn step(&mut self, role_card: bool, meeting_header: bool, eject_text: bool, end_banner: bool, task_list: bool) -> Option<Phase> {
        let next = if end_banner { Phase::GameOver }
            else if eject_text { Phase::Ejection }
            else if meeting_header { Phase::MeetingDiscussion }
            else if role_card { Phase::RoundStart }
            else if task_list { Phase::Round }
            else { Phase::Lobby };
        if Some(next) != self.current {
            match (self.current, next) {
                (Some(Phase::Ejection) | Some(Phase::RoundStart), Phase::Round) => self.round += 1,
                (_, Phase::MeetingDiscussion) => self.meeting += 1,
                _ => {}
            }
            self.current = Some(next);
            return Some(next);
        }
        None
    }
}

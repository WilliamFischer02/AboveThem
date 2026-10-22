/**
 * Per-speaker chat aggregates for the suspicion engine's credibility weighting.
 * Pure: computed from MatchState.chat through the NLU on demand.
 *
 * What it measures (it does NOT judge): how often a speaker accuses / clears, who, whether they
 * open accusations or pile on, whether they reversed a stance (same meeting = story change,
 * across meetings = may be new info; counted half), and whether they gave two different own
 * locations in one meeting.
 */
import type { ChatAssertion, MatchState, PlayerId, SpeakerProfile, StanceFlip } from '../types/game';
import { parseAllChat } from './chatNlu';

const ACCUSE_KINDS = new Set(['accuse', 'voteCall', 'sawVent', 'sawKill', 'selfReport']);

const empty = (player: PlayerId): SpeakerProfile => ({
  player, lines: 0, assertions: 0, accusations: 0, accused: [], clears: 0, cleared: [], selfDefenses: 0, questions: 0,
  voteCalls: 0, skipCalls: 0, accusedBy: [], clearedBy: [], firstAccusations: 0, bandwagons: 0, flips: [], locationChanges: [],
  consistency: 1, refs: [],
});

export function speakerProfiles(m: MatchState, list: ChatAssertion[] = parseAllChat(m)): Record<PlayerId, SpeakerProfile> {
  const out: Record<PlayerId, SpeakerProfile> = {};
  const get = (id: PlayerId) => (out[id] ??= empty(id));
  const push = (arr: PlayerId[], id: PlayerId) => { if (!arr.includes(id)) arr.push(id); };
  for (const l of m.chat) if (l.sender !== 'unknown') get(l.sender).lines++;

  // who pushed whom first, per meeting
  const pushers = new Map<string, PlayerId[]>(); // `${meeting}|${target}` → speakers in order
  // last polar stance per speaker/target across the whole game (for flips)
  const lastStance = new Map<string, ChatAssertion>();
  // own locations per meeting
  const ownLoc = new Map<string, ChatAssertion[]>();

  for (const a of list) {
    if (a.speaker === 'unknown') continue;
    const p = get(a.speaker);
    p.assertions++; p.refs.push(a.id);
    if (a.kind === 'question') p.questions++;
    if (a.kind === 'voteCall') p.voteCalls++;
    if (a.kind === 'skipCall' && !a.negated) p.skipCalls++;
    if (a.kind === 'defense' && a.about.length === 1 && a.about[0] === a.speaker) p.selfDefenses++;
    if (a.kind === 'location') {
      const k = `${a.meeting}|${a.speaker}`;
      ownLoc.set(k, [...(ownLoc.get(k) ?? []), a]);
    }
    const others = a.about.filter(id => id !== a.speaker);
    if (!others.length || a.polarity === 0) continue;
    const counts = a.confidence >= 0.5 && !a.supersededBy;
    if (a.polarity === 1 && ACCUSE_KINDS.has(a.kind)) {
      if (counts) p.accusations++;
      for (const t of others) {
        if (counts) { push(p.accused, t); push(get(t).accusedBy, a.speaker); }
        const k = `${a.meeting}|${t}`;
        const list2 = pushers.get(k) ?? [];
        if (counts && !list2.includes(a.speaker)) {
          if (list2.length === 0) p.firstAccusations++;
          else if (list2.length >= 2) p.bandwagons++;
          list2.push(a.speaker);
          pushers.set(k, list2);
        }
      }
    } else if (a.polarity === -1) {
      if (counts) p.clears++;
      for (const t of others) if (counts) { push(p.cleared, t); push(get(t).clearedBy, a.speaker); }
    }
    // flips: only between confident, non-provisional readings
    if (a.confidence < 0.5 || a.reason === 'bare') continue;
    for (const t of others) {
      const k = `${a.speaker}|${t}`;
      const prev = lastStance.get(k);
      if (prev && prev.polarity !== a.polarity && prev.line !== a.line) {
        const flip: StanceFlip = {
          target: t, from: prev.polarity as 1 | -1, to: a.polarity as 1 | -1, fromAssertion: prev.id, toAssertion: a.id,
          fromMeeting: prev.meeting, toMeeting: a.meeting, sameMeeting: prev.meeting === a.meeting,
        };
        p.flips.push(flip);
      }
      lastStance.set(k, a);
    }
  }

  for (const [k, locs] of ownLoc) {
    const rooms = [...new Set(locs.filter(a => a.confidence >= 0.5 && a.room).map(a => a.room!))];
    const lines = new Set(locs.map(a => a.line));
    if (rooms.length >= 2 && lines.size >= 2) {
      const [meeting, speaker] = k.split('|');
      get(speaker).locationChanges.push({ meeting: Number(meeting), rooms, assertions: locs.map(a => a.id) });
    }
  }
  for (const p of Object.values(out)) {
    const penalty = p.flips.reduce((s, f) => s + (f.sameMeeting ? 0.2 : 0.1), 0) + p.locationChanges.length * 0.2;
    p.consistency = Math.round(Math.max(0, 1 - penalty) * 100) / 100;
  }
  return out;
}

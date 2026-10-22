/**
 * Chat NLU public API. Pure functions over MatchState; nothing is cached in the state.
 *
 *   parseMeetingChat(m, meeting) → ChatAssertion[]   context-resolved, chat order
 *   parseAllChat(m)                                   every meeting
 *   parseLine(text, speaker, m)                       one line, no cross-line context
 *   activeAssertions(list)                            evidence-bearing, not superseded
 *   stanceLedger(m, meeting)                          speaker → target → running stance
 *   voteCalls(m, meeting)                             "vote red" × N speakers (band-wagon signal)
 *   meetingTranscript(m, meeting)                     per-speaker blocks with assertion badges (UI)
 */
import type { ChatAssertion, ChatAssertionKind, ChatLine, MatchState, PlayerId } from '../../types/game';
import { lineText, parseLines } from './context';

export { lineText } from './context';
export { tagLine, rawTokens } from './tokenize';
export { LEX, osa, fuzzyCap } from './lexicon';

export function parseMeetingChat(m: MatchState, meeting: number): ChatAssertion[] {
  return parseLines(m.chat.filter(l => l.meeting === meeting), m);
}

export function parseAllChat(m: MatchState): ChatAssertion[] {
  const meetings = [...new Set(m.chat.map(l => l.meeting))].sort((a, b) => a - b);
  return meetings.flatMap(k => parseMeetingChat(m, k));
}

/** Parse a single line with no surrounding chat (pronouns resolve only inside the line). */
export function parseLine(text: string, speaker: PlayerId, m: MatchState, meeting = m.phase.meeting ?? 0): ChatAssertion[] {
  const line: ChatLine = { id: 'adhoc', meeting, stamp: { round: Math.max(0, m.phase.round), t: 0, wall: 0 }, sender: speaker, original: text, source: 'manual' };
  return parseLines([line], m);
}

const INFO_ONLY = new Set<ChatAssertionKind>(['question', 'noise', 'myColor']);
/** Assertions that should feed evidence: not superseded, not questions / noise / colour statements. */
export function activeAssertions(list: ChatAssertion[]): ChatAssertion[] {
  return list.filter(a => !a.supersededBy && !INFO_ONLY.has(a.kind));
}

export interface Stance { score: number; n: number; last: string }
/**
 * speaker → target → stance for one meeting. score = Σ polarity·strength·confidence in chat
 * order, but an assertion that reverses the previous sign resets the score (the speaker changed
 * their mind; their latest word counts).
 */
export function stanceLedger(m: MatchState, meeting: number, list = parseMeetingChat(m, meeting)): Record<PlayerId, Record<PlayerId, Stance>> {
  const out: Record<PlayerId, Record<PlayerId, Stance>> = {};
  for (const a of list) {
    if (a.polarity === 0) continue;
    for (const t of a.about) {
      if (t === a.speaker) continue;
      const row = (out[a.speaker] ??= {});
      const cur = row[t] ?? { score: 0, n: 0, last: a.id };
      const v = a.polarity * a.strength * a.confidence;
      const flipped = cur.n > 0 && Math.sign(cur.score) !== 0 && Math.sign(cur.score) !== a.polarity;
      row[t] = { score: Math.round(((flipped ? 0 : cur.score) + v) * 100) / 100, n: cur.n + 1, last: a.id };
    }
  }
  return out;
}

export interface VoteCallSignal {
  meeting: number;
  target: PlayerId;
  /** Speakers pushing the target (vote calls + accusations), in the order they joined. */
  callers: PlayerId[];
  firstCaller: PlayerId;
  /** Only explicit "vote X" / "X out" calls. */
  voteCallers: PlayerId[];
  /** >= 3 distinct callers: a band-wagon is forming. */
  bandwagon: boolean;
  /** Callers who joined after two others had already pushed the target. */
  lateJoiners: PlayerId[];
  assertions: string[];
}

/** Who is being pushed this meeting, how many joined, and in what order (band-wagon detection). */
export function voteCalls(m: MatchState, meeting: number, list = parseMeetingChat(m, meeting)): VoteCallSignal[] {
  const map = new Map<PlayerId, VoteCallSignal>();
  for (const a of activeAssertions(list)) {
    if (a.polarity !== 1 || a.confidence < 0.5) continue;
    for (const t of a.about) {
      if (t === a.speaker) continue;
      const s = map.get(t) ?? { meeting, target: t, callers: [], firstCaller: a.speaker, voteCallers: [], bandwagon: false, lateJoiners: [], assertions: [] };
      if (!s.callers.includes(a.speaker)) {
        if (s.callers.length >= 2) s.lateJoiners.push(a.speaker);
        s.callers.push(a.speaker);
      }
      if (a.kind === 'voteCall' && !s.voteCallers.includes(a.speaker)) s.voteCallers.push(a.speaker);
      s.assertions.push(a.id);
      map.set(t, s);
    }
  }
  return [...map.values()].map(s => ({ ...s, bandwagon: s.callers.length >= 3 })).sort((a, b) => b.callers.length - a.callers.length);
}

export type BadgeTone = 'sus' | 'clear' | 'info' | 'question';
export interface TranscriptBadge { assertion: string; kind: ChatAssertionKind; tone: BadgeTone; label: string; about: PlayerId[]; superseded: boolean; confidence: number }
export interface TranscriptLine { lineId: string; text: string; original: string; translated?: string; badges: TranscriptBadge[]; noise: boolean }
export interface TranscriptBlock { speaker: PlayerId; lines: TranscriptLine[] }

const KIND_LABEL: Record<ChatAssertionKind, string> = {
  accuse: 'sus', clear: 'clear', withMe: 'with', sawTask: 'task', sawVent: 'vent', sawKill: 'kill', location: 'at', selfReport: 'self',
  bodyLocation: 'body', voteCall: 'vote', skipCall: 'skip', question: '?', defense: 'not', noise: '', sighting: 'saw', withOther: 'pair',
  task: 'did', dead: 'dead', myColor: 'is',
};

/** Per meeting: consecutive lines of one speaker grouped, each with assertion badges ("sus Red", "at Elec"). */
export function meetingTranscript(m: MatchState, meeting: number, list = parseMeetingChat(m, meeting)): TranscriptBlock[] {
  const byLine = new Map<string, ChatAssertion[]>();
  for (const a of list) byLine.set(a.line, [...(byLine.get(a.line) ?? []), a]);
  const blocks: TranscriptBlock[] = [];
  for (const l of m.chat.filter(x => x.meeting === meeting)) {
    const as = byLine.get(l.id) ?? [];
    const badges = as.map(a => ({
      assertion: a.id, kind: a.kind, about: a.about, superseded: !!a.supersededBy, confidence: a.confidence,
      tone: (a.kind === 'question' ? 'question' : a.polarity === 1 ? 'sus' : a.polarity === -1 ? 'clear' : 'info') as BadgeTone,
      label: badgeLabel(a, m),
    }));
    const tl: TranscriptLine = { lineId: l.id, text: lineText(l), original: l.original, translated: l.translated, badges, noise: !as.length };
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === l.sender) last.lines.push(tl);
    else blocks.push({ speaker: l.sender, lines: [tl] });
  }
  return blocks;
}

function badgeLabel(a: ChatAssertion, m: MatchState): string {
  const names = a.about.filter(id => id !== a.speaker || a.kind === 'defense').map(id => (id === a.speaker ? 'self' : m.players[id]?.name ?? id)).join(', ');
  const room = a.room ? m.map.rooms.find(r => r.id === a.room)?.name ?? a.room : '';
  const task = a.taskId ? m.map.tasks.find(t => t.id === a.taskId)?.name ?? a.taskId : '';
  switch (a.kind) {
    case 'location': return `at ${room}`;
    case 'task': return `did ${task}${room ? ' · ' + room : ''}`;
    case 'bodyLocation': return `body ${room}`;
    case 'skipCall': return a.negated ? 'no skip' : 'skip';
    case 'question': return `${a.question ?? '?'}?${names ? ' → ' + names : ''}`;
    case 'myColor': return `is ${a.color}`;
    case 'sawKill': return `kill ${names}${a.victim ? ' → ' + (m.players[a.victim]?.name ?? a.victim) : ''}`;
    case 'sighting': return `saw ${names} ${room}`.trim();
    default: return `${KIND_LABEL[a.kind]} ${names}${room && a.kind !== 'accuse' ? ' · ' + room : ''}`.trim();
  }
}

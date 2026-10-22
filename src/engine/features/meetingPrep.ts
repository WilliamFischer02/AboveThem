/**
 * Meeting timer + prep checklist (stretch #2). Composes the other feature modules into the
 * 3–5 things worth saying or doing before the vote closes, each traceable to logged evidence.
 *
 * Timer: discussion ends `discussionTimeSec` after the meeting opens, voting ends `votingTimeSec`
 * later (lobby settings). Phase walls come from OCR or the user's button, so this is ± a second
 * or two; if the voting phase was detected separately its own wall is used.
 */
import type { MatchState, PlayerId } from '../../types/game';
import { fmt } from '../evidence';
import { killWindows } from './killWindow';
import { meetingMath } from './meetingMath';
import { lastSeenBoard, unplacedThisRound } from './lastSeen';
import { taskClaimChecks } from './taskCheck';
import { meetingVotes } from './voteAnalysis';
import { pname, roomName } from './util';

export interface MeetingTimer {
  stage: 'discussion' | 'voting' | 'over';
  /** Seconds left in the current stage. */
  stageLeft: number;
  /** Seconds until voting closes. */
  votingLeft: number;
}

export function meetingTimer(m: MatchState, nowWall: number): MeetingTimer | null {
  const p = m.phase;
  if (p.phase !== 'meetingDiscussion' && p.phase !== 'meetingVoting') return null;
  const disc = m.settings.discussionTimeSec, vote = m.settings.votingTimeSec;
  const el = (nowWall - p.wall) / 1000;
  if (p.phase === 'meetingDiscussion') {
    if (el < disc) return { stage: 'discussion', stageLeft: disc - el, votingLeft: disc + vote - el };
    const left = Math.max(0, disc + vote - el);
    return { stage: left > 0 ? 'voting' : 'over', stageLeft: left, votingLeft: left };
  }
  const left = Math.max(0, vote - el);
  return { stage: left > 0 ? 'voting' : 'over', stageLeft: left, votingLeft: left };
}

export interface PrepItem {
  id: string;
  /** Lower = more important. */
  priority: number;
  text: string;
  refs: string[];
  /** Copyable chat line (≤ 70 chars) when the item is something to say. */
  say?: string;
}

export function prepChecklist(m: MatchState): PrepItem[] {
  const items: PrepItem[] = [];
  const round = Math.max(0, m.phase.round);
  const meeting = m.phase.meeting ?? 0;
  const ghost = m.players[m.me]?.status !== 'alive';
  if (ghost) return items; // ghosts cannot talk to the living or vote
  const crew = m.myRole !== 'impostor';
  const math = meetingMath(m);

  if (math.danger === 'critical') items.push({ id: 'critical', priority: 0, text: `CRITICAL vote: ${math.lines[1] ?? 'a wrong vote loses'} — no guessing, no lazy skip`, refs: [] });

  // 1. My own location + companion (pre-empts being accused). Crew only: impostors use the ledger.
  if (crew) {
    const obs = m.observations.filter(o => o.stamp.round === round);
    const rooms = obs.filter(o => o.type === 'myRoom');
    const last = rooms[rooms.length - 1];
    const on = new Map<PlayerId, boolean>();
    for (const o of obs) if (o.type === 'withMe') on.set(o.player, o.on);
    const companions = [...on.entries()].filter(([, x]) => x).map(([p]) => pname(m, p));
    if (last && last.type === 'myRoom') {
      const path = rooms.map(r => (r.type === 'myRoom' ? roomName(m, r.room) : '')).filter((x, i, a) => x && x !== a[i - 1]).slice(-3).join(' > ');
      const say = `i was ${path}${companions.length ? ` with ${companions.join(' ')}` : ''}`.slice(0, 70);
      items.push({ id: 'where', priority: 2, text: `Say where you were first: ${path}${companions.length ? ` with ${companions.join(', ')}` : ''}`, refs: rooms.map(r => r.id), say });
    } else {
      items.push({ id: 'where', priority: 3, text: 'You logged no room this round — say where you were before you are asked', refs: [] });
    }
  }

  // 2. Hard information I hold: visual tasks I saw, kill-window "could not".
  const visuals = m.observations.filter(o => o.type === 'sawTask' && o.visualConfirmed && o.stamp.round === round && m.settings.visualTasksOn);
  for (const v of visuals) if (v.type === 'sawTask') items.push({ id: `vis_${v.id}`, priority: 1, text: `Vouch: you saw ${pname(m, v.player)} do a visual task in ${roomName(m, v.room)}`, refs: [v.id], say: `${pname(m, v.player)} did visual in ${roomName(m, v.room)}, clear`.slice(0, 70) });
  for (const w of killWindows(m, round)) {
    if (w.couldNot.length) {
      const names = w.couldNot.map(p => pname(m, p.player));
      items.push({ id: `kw_${w.bodyId}`, priority: 1, text: `Kill window ${fmt(w.lo)}–${fmt(w.hi)}: ${names.join(', ')} could not have killed ${pname(m, w.victim)}`, refs: [w.bodyId, ...w.couldNot.flatMap(p => p.reasons.flatMap(r => r.refs))] });
    }
    if (w.could.length > 0 && w.could.length <= 3) items.push({ id: `kwc_${w.bodyId}`, priority: 1, text: `Only ${w.could.map(p => pname(m, p.player)).join(', ')} could have reached ${roomName(m, w.room)} in the window`, refs: [w.bodyId] });
  }

  // 3. Who to ask first: alive players nobody (including me) placed this round.
  const now = { round, t: Infinity, wall: 0 };
  const unplaced = unplacedThisRound(lastSeenBoard(m, now), round);
  if (unplaced.length) items.push({ id: 'unplaced', priority: 3, text: `Ask first (nobody placed them): ${unplaced.map(p => pname(m, p)).join(', ')}`, refs: [], say: `${unplaced.slice(0, 3).map(p => pname(m, p)).join(' ')} where were u`.slice(0, 70) });

  // 4. Task claims that do not add up this meeting.
  for (const c of taskClaimChecks(m)) {
    const cl = m.claims.find(x => x.id === c.claimId);
    if (cl?.meeting !== meeting || (c.verdict !== 'fake' && c.verdict !== 'clearInvalid')) continue;
    items.push({ id: `task_${c.claimId}`, priority: 1, text: c.line, refs: c.refs, say: c.ask });
  }

  // 5. Vote bookkeeping.
  if (!m.settings.anonymousVotes) {
    const recorded = meetingVotes(m, meeting).size;
    if (recorded < math.alive) items.push({ id: 'votes', priority: 4, text: `When results show, tap the votes (${recorded}/${math.alive} recorded) — feeds the pair/bandwagon checks`, refs: [] });
  }
  return items.sort((a, b) => a.priority - b.priority);
}

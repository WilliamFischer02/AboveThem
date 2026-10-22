/**
 * Impostor mode advice (Phase 4 core, pure). The crew engine inverted:
 *   - alibis built only from what I really logged this round (rooms, companions, nearby players),
 *   - a push target: ride the room's momentum onto someone who isn't me or my partner,
 *   - defense lines for whatever I'm being accused of right now, filled from the ledger,
 *   - a partner warning when the room is turning on my partner.
 * Templates come from data/tactics/impostor.json.
 */
import type { Claim, MatchState, PlayerId, SuspectScore } from '../types/game';
import impostorJson from '../data/tactics/impostor.json';
import { pushTally } from './chatClaims';
import { fmt } from './evidence';

type AccusationEntry = { best?: string[]; uncleared_accuser?: string[]; cleared_accuser?: string[]; avoid: string[]; followup: string };
const ACC = impostorJson.accusations as Record<string, AccusationEntry>;
const DECEPTION = impostorJson.deception as Record<string, string[]>;

export type AccusationType = keyof typeof ACC;

export interface Vars { [k: string]: string }

const fill = (tpl: string, v: Vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
const complete = (tpl: string, v: Vars) => [...tpl.matchAll(/\{(\w+)\}/g)].every(x => x[1] in v && v[x[1]] !== '');

/**
 * Render template lines: a line is used only when every placeholder has a real value (from the ledger);
 * otherwise it is skipped — a raw "{A}" must never reach the screen, and inventing a room / name would be a lie
 * built on nothing. Exported for the impostor.json coverage test.
 */
export function renderLines(tpls: readonly string[] | undefined, v: Vars): string[] {
  return (tpls ?? []).filter(t => complete(t, v)).map(t => fill(t, v));
}

/** One line or null (same rule as renderLines). */
export function renderLine(tpl: string | undefined, v: Vars): string | null {
  return tpl && complete(tpl, v) ? fill(tpl, v) : null;
}

/** Used when no template of an accusation type can be filled from what was logged (no placeholders). */
export const GENERIC_DEFENSE = [
  'What exactly did you see, and when? Walk me through it.',
  'I was doing my tasks — ask me anything about my route.',
];

export function impostorVars(m: MatchState, meeting: number): Vars {
  const v: Vars = {};
  const round = Math.max(0, m.phase.round);
  const roomName = (id: string) => m.map.rooms.find(r => r.id === id)?.name ?? id;
  const pname = (id: string) => m.players[id]?.name ?? id;
  const obs = m.observations.filter(o => o.stamp.round === round);
  const myRooms = obs.filter(o => o.type === 'myRoom');
  const last = myRooms[myRooms.length - 1];
  const prev = myRooms[myRooms.length - 2];
  if (last && last.type === 'myRoom') { v.R = roomName(last.room); v.T = fmt(last.stamp.t); }
  if (prev && prev.type === 'myRoom') v.R2 = roomName(prev.room);
  // companion: last "with me" that is still on, else the latest nearby sighting in my room
  const on = new Map<PlayerId, boolean>();
  for (const o of obs) if (o.type === 'withMe') on.set(o.player, o.on);
  const companion = [...on.entries()].filter(([, x]) => x).map(([p]) => p).pop();
  const nearby = obs.filter(o => o.type === 'sighting' && last && last.type === 'myRoom' && o.room === last.room && o.player !== m.me).pop();
  if (companion) v.W = pname(companion); else if (nearby && nearby.type === 'sighting') v.W = pname(nearby.player);
  // body / victim this round
  const body = obs.filter(o => o.type === 'bodyFound').pop();
  if (body && body.type === 'bodyFound') { v.K = roomName(body.room); if (body.victim !== 'unknown') v.V = pname(body.victim); }
  // players seen alone this round (not me, not partner)
  const partner = Object.values(m.players).find(p => p.isPartner);
  const alone = [...new Set(obs.filter(o => o.type === 'sighting' && (o.alone ?? !(o.withPlayers?.length))).map(o => (o as { player: PlayerId }).player))]
    .filter(p => p !== m.me && p !== partner?.id && m.players[p]?.status === 'alive');
  if (alone[0]) v.X = pname(alone[0]); if (alone[1]) v.Y = pname(alone[1]); if (alone[2]) v.Z = pname(alone[2]);
  // a fakeable task in my room: on my (fake) list and in R; never visual when visuals are on; never a common I wasn't dealt
  const mine = new Set((m.myTasks ?? []).filter(t => t.matched).map(t => t.id));
  const inRoom = last && last.type === 'myRoom' ? m.map.tasks.filter(t => t.rooms.includes(last.room)) : [];
  const safe = inRoom.filter(t => !(t.visual && m.settings.visualTasksOn) && (t.kind !== 'common' || mine.has(t.id)));
  const pick = safe.find(t => mine.has(t.id)) ?? safe.find(t => t.kind !== 'common') ?? safe[0];
  if (pick) v.TASK = pick.name;
  // accuser: the latest accusation about me this meeting
  const acc = m.claims.filter(c => c.meeting === meeting && c.type === 'accusation' && c.about === m.me).pop();
  if (acc) v.A = pname(acc.by);
  if (partner) v.P2 = partner.name;
  // a kill I was provably away from: a body found while someone was "with me"
  for (const b of m.observations.filter(o => o.type === 'bodyFound')) {
    const r = b.stamp.round;
    const withMe = m.observations.some(o => o.type === 'withMe' && o.on && o.stamp.round === r && o.stamp.t <= b.stamp.t);
    if (withMe && b.type === 'bodyFound') { v.K2 = roomName(b.room); break; }
  }
  return v;
}

/** What kind of accusation a chat claim against me is. */
export function classifyAccusation(c: Claim, m: MatchState): AccusationType {
  const t = (c.text ?? '').toLowerCase();
  if (/self report|second report|your .*report/.test(t)) return 'you_reported';
  if (/left body|near body|leave|leaving/.test(t)) return 'saw_you_leave_kill_room';
  if (/vent/.test(t)) return 'saw_you_leave_kill_room';
  if (/fake|faking/.test(t)) return 'faked_task';
  if (/alone/.test(t)) return 'you_were_alone';
  if (/vote|skip/.test(t)) return 'didnt_vote_with_us';
  const alive = Object.values(m.players).filter(p => p.status === 'alive').length;
  if (alive <= 3) return 'fifty_fifty';
  return 'where_were_you';
}

export interface Defense { type: AccusationType; accuser: string | null; lines: string[]; avoid: string[]; followup: string }

export interface ImpostorAdvice {
  alibis: { text: string; basedOn: string[]; weakPoint: string }[];
  push: { target: PlayerId; line: string; why: string } | null;
  defenses: Defense[];
  partnerWarning: string[] | null;
  rules: string[];
  vars: Vars;
}

export function impostorAdvice(m: MatchState, scores: SuspectScore[], meeting: number): ImpostorAdvice {
  const v = impostorVars(m, meeting);
  const pname = (id: string) => m.players[id]?.name ?? id;
  const partner = Object.values(m.players).find(p => p.isPartner);
  const round = Math.max(0, m.phase.round);
  const obs = m.observations.filter(o => o.stamp.round === round);

  // Alibis from real data: companion first (corroborable), then room + task (unfalsifiable), then route.
  const alibis: ImpostorAdvice['alibis'] = [];
  if (v.R && v.W) alibis.push({ text: `I was in ${v.R} with ${v.W}${v.T ? ` around ${v.T}` : ''}.`, basedOn: obs.filter(o => o.type === 'withMe' || o.type === 'myRoom').map(o => o.id), weakPoint: `${v.W} must agree they were there; say it before they do.` });
  if (v.R && v.TASK) alibis.push({ text: `${v.R} — ${v.TASK}.`, basedOn: obs.filter(o => o.type === 'myRoom').map(o => o.id), weakPoint: `Only a risk if someone was in ${v.R} and didn't see you at the panel.` });
  if (v.R2 && v.R) alibis.push({ text: `${v.R2} then ${v.R}${v.TASK ? ` for ${v.TASK}` : ''}.`, basedOn: obs.filter(o => o.type === 'myRoom').map(o => o.id), weakPoint: `Travel ${v.R2}→${v.R} has to fit the kill timing.` });
  if (alibis.length === 0) alibis.push({ text: 'Log your room (room popup or prefix+/) and who you passed — alibis are built from real sightings only.', basedOn: [], weakPoint: 'Nothing logged this round.' });

  // Push target: the room's momentum, excluding me and my partner; else the crew engine's top suspect.
  const tally = pushTally(m, meeting).filter(t => t.target !== m.me && t.target !== partner?.id && m.players[t.target]?.status === 'alive');
  const prime = scores.find(s => (s.verdict === 'unknown' || s.verdict === 'softClear') && s.player !== m.me && s.player !== partner?.id);
  let push: ImpostorAdvice['push'] = null;
  if (tally[0]) {
    const t = tally[0];
    push = { target: t.target, line: `I'm with ${t.accusers.map(pname)[0] ?? 'them'} on ${pname(t.target)}${v.R ? `, I was ${v.R} and didn't see ${pname(t.target)} anywhere` : ''}.`, why: `Already pushed by ${t.accusers.map(pname).join(', ')}; riding momentum doesn't look like leading.` };
  } else if (prime) {
    const e = prime.evidence.filter(x => x.weight > 0)[0];
    push = { target: prime.player, line: e ? `${pname(prime.player)} — ${e.label.toLowerCase()}. Where were you, ${pname(prime.player)}?` : `${pname(prime.player)}, where were you and with who?`, why: e ? `Crew will believe it: ${e.label}` : 'Nobody has evidence; a calm question steers the room.' };
  }

  // Defenses for accusations against me this meeting (latest first), default "where were you".
  const against = m.claims.filter(c => c.meeting === meeting && c.type === 'accusation' && c.about === m.me).reverse();
  const types: { type: AccusationType; accuser: string | null }[] = against.length ? against.map(c => ({ type: classifyAccusation(c, m), accuser: pname(c.by) })) : [{ type: 'where_were_you', accuser: null }];
  const seen = new Set<string>();
  const defenses: Defense[] = [];
  for (const { type, accuser } of types) {
    if (seen.has(type)) continue; seen.add(type);
    const entry = ACC[type];
    const vars = { ...v, ...(accuser ? { A: accuser } : {}) };
    const pool = entry.best ?? [...(entry.uncleared_accuser ?? []), ...(entry.cleared_accuser ?? [])];
    // {A} is only the addressee, not a fact: with no accuser yet, address the room. Facts (R, W, TASK…) are never softened.
    const soft = accuser ? vars : { A: 'everyone', ...vars };
    const lines = renderLines(pool, vars).length ? renderLines(pool, vars) : renderLines(pool, soft);
    defenses.push({ type, accuser, lines: lines.length ? lines : [...GENERIC_DEFENSE], avoid: renderLines(entry.avoid, soft), followup: renderLine(entry.followup, vars) ?? renderLine(entry.followup, soft) ?? '' });
  }

  // Partner being pushed?
  let partnerWarning: string[] | null = null;
  if (partner) {
    const pt = pushTally(m, meeting).find(t => t.target === partner.id);
    if (pt && pt.accusers.length) {
      const vars = { ...v, P2: partner.name, P: push ? pname(push.target) : (v.X ?? 'someone else'), R: v.R ?? 'the other side' };
      const fu = renderLine(ACC.partner_being_voted.followup, vars);
      partnerWarning = renderLines(ACC.partner_being_voted.best, vars).concat(fu ? [fu] : []);
    }
  }

  const rules = renderLines([...DECEPTION.alibi_rules.slice(0, 2), DECEPTION.kill_rules[0]].filter(Boolean), v);
  return { alibis, push, defenses, partnerWarning, rules, vars: v };
}

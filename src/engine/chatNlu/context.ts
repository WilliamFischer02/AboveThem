/**
 * Meeting-level reading: the same words mean different things depending on what the speaker
 * said just before / after and on the question being answered.
 *
 *  - Pronouns ("them", "him", "that guy") → most recent players in this line, then the speaker's
 *    own previous lines, then the line being replied to.
 *  - "u" / "you" → the player named in the line, else the previous other speaker.
 *  - Missing subjects ("vent", "sus", "clear", "cap") → same line, the speaker's previous line,
 *    the replied line (for "cap": its speaker).
 *  - Bare mentions ("White and Black") are provisional accusations; a later line by the same
 *    speaker that refers back to them ("saw them do wires", "clear, was with them") replaces
 *    the provisional reading. A pending predicate ("saw them do wires" with no names yet) is
 *    bound by the next bare mention.
 *  - Replies: a bare name after "who" = accusation, a bare room after "where" = my location.
 *  - Stance: a later line by the same speaker that reverses polarity on a target marks the
 *    earlier assertion `supersededBy`.
 */
import type { ChatAssertion, ChatLine, MatchState, PlayerId } from '../../types/game';
import { interpretClause, isAgreeLine, isNoiseLine, splitClauses, type Clause, type Draft, type Env, type QuestionMeta, type Ref } from './parse';
import { tagLine, type Unit } from './tokenize';
import { LEX } from './lexicon';

/** Fields other branches add to ChatLine (bugs-rust): read defensively. */
type ChatLineX = ChatLine & { unreadable?: boolean; xlatGuess?: boolean };

const NEEDS_ABOUT = new Set(['accuse', 'clear', 'withMe', 'sawTask', 'sawVent', 'sawKill', 'selfReport', 'voteCall', 'defense', 'sighting', 'withOther', 'dead']);

interface LineState {
  line: ChatLineX;
  text: string;
  units: Unit[];
  clauses: Clause[];
  drafts: (Draft & { key: string; removed?: boolean })[];
  /** last players (others) mentioned or referred to in this line */
  lastRef?: { ids: PlayerId[]; bareKey?: string };
  question?: QuestionMeta;
}

const nameList = (m: MatchState, ids: PlayerId[]) => ids.map(id => m.players[id]?.name ?? id).join(', ');

/** Text the parser reads: the translation when there is one. */
export const lineText = (l: ChatLine) => (l.translated && l.translated.trim() ? l.translated : l.original);

/**
 * Tagging is the expensive step and depends only on the text, the sender, the roster and the map,
 * so each line's units are cached on the ChatLine object (cache entries carry a roster/map signature;
 * a rename or colour change re-tags). The context pass always re-runs over the whole meeting.
 * Cached units are never mutated downstream (splitClauses / interpretClause copy before merging).
 */
const tagCache = new WeakMap<ChatLine, { text: string; sender: PlayerId; sig: string; units: Unit[] }>();
const sigCache = new WeakMap<object, string>();
function rosterSig(m: MatchState): string {
  const key = m.players as object;
  const hit = sigCache.get(key);
  const mapPart = `#${m.map.id}:${m.map.rooms?.length ?? 0}:${m.map.tasks?.length ?? 0}`;
  if (hit) return hit + mapPart;
  const s = Object.values(m.players).map(p => `${p.id}:${p.name}:${p.color}`).join('|');
  sigCache.set(key, s);
  return s + mapPart;
}
function cachedTag(l: ChatLine, text: string, m: MatchState, sig: string): Unit[] {
  const c = tagCache.get(l);
  if (c && c.text === text && c.sender === l.sender && c.sig === sig) return c.units;
  const units = tagLine(text, m, l.sender);
  tagCache.set(l, { text, sender: l.sender, sig, units });
  return units;
}

export function parseLines(lines: ChatLine[], m: MatchState): ChatAssertion[] {
  const sig = rosterSig(m);
  const st: LineState[] = lines.map(l => {
    const line = l as ChatLineX;
    const text = lineText(l);
    const units = line.unreadable ? [] : cachedTag(l, text, m, sig);
    return { line, text, units, clauses: [], drafts: [] };
  });
  const lastRefBySpeaker = new Map<PlayerId, { ids: PlayerId[]; li: number; lineId: string; bareKey?: string }>();
  const pending = new Map<PlayerId, { li: number; d: Draft & { key: string } }[]>();
  const draftByKey = new Map<string, Draft & { key: string; removed?: boolean; li: number }>();

  for (let li = 0; li < st.length; li++) {
    const S = st[li];
    const L = S.line;
    const speaker = L.sender;
    if (L.unreadable || !S.units.length) continue;
    // OCR re-read of an earlier bubble (often with a name label glued on: "liamnotkiTl Theres a cooldown")
    const key = normKey(S.text);
    // (same sender + same text, or 12+ characters of identical text from anyone: short "skip" / "where" repeats are real)
    if (st.slice(Math.max(0, li - 10), li).some(o => {
      const k = normKey(o.text);
      if (!k) return false;
      if (o.line.sender === speaker && (k === key || key.endsWith(' ' + k))) return true;
      return k.length >= 12 && (k === key || key.endsWith(' ' + k));
    })) continue;
    // A line that is only player names is a name label the OCR picked up, not a message
    if (S.units.every(u => (u.k === 'P' && u.byName) || u.k === 'PUNCT' || u.k === 'W' || u.k === 'noise' || u.k === 'filler') && S.units.some(u => u.k === 'P' && u.byName)) continue;
    // "Raggedport yellow": a name label right before another player mention
    if (S.units[0]?.k === 'P' && S.units[0].byName && S.units[1]?.k === 'P') S.units = S.units.slice(1);

    const prevOther = (() => { for (let j = li - 1; j >= Math.max(0, li - 3); j--) if (st[j].line.sender !== speaker) return j; return -1; })();

    // "same" / "agreed" / "true": repeat the previous other speaker's stance, weakly.
    if (isAgreeLine(S.units) && prevOther >= 0 && prevOther === li - 1) {
      let n = 0;
      for (const d of st[prevOther].drafts) {
        if (d.removed || d.polarity === 0 || !d.about.length || d.about.includes(speaker)) continue;
        const nd = { ...d, key: `${li}:${n++}`, strength: d.strength * 0.6, confidence: Math.min(d.confidence, 0.5), resolvedVia: 'reply' as const, refs: [L.id, st[prevOther].line.id], why: [`agrees with ${m.players[st[prevOther].line.sender]?.name ?? st[prevOther].line.sender}: "${st[prevOther].text}"`], span: [0, S.text.length] as [number, number], bare: false, pending: false, absorbed: undefined };
        S.drafts.push(nd); draftByKey.set(nd.key, { ...nd, li });
      }
      continue;
    }
    if (isNoiseLine(S.units)) continue;

    S.clauses = splitClauses(S.units);
    // Named player in the line = who "you" means ("purp where were u").
    const named = S.clauses.flatMap(c => c.units.filter(u => u.k === 'P' && !u.self && u.ids?.length)).map(u => u.ids!)[0];
    // Vocative: a bare name clause followed by a question clause in the same line ("white, where were u").
    const vocative = new Set<number>();
    S.clauses.forEach((c, ci) => {
      const next = S.clauses[ci + 1];
      if (next && c.units.every(u => u.k === 'P') && next.units.some(u => u.k === 'Q' || u.k === 'YOU')) vocative.add(ci);
    });

    let sameLine: { ids: PlayerId[]; bareKey?: string } | undefined;
    let n = 0;
    S.clauses.forEach((cl, ci) => {
      if (vocative.has(ci)) { sameLine = { ids: cl.units.flatMap(u => u.ids ?? []) }; return; }
      const ownPrev = lastRefBySpeaker.get(speaker);
      const ownPrevOk = ownPrev && li - ownPrev.li <= 6;
      const otherRef = prevOther >= 0 ? st[prevOther].lastRef : undefined;
      const env: Env = {
        speaker, m, lineId: L.id,
        pron: plural => {
          if (sameLine?.ids.length) return { ids: sameLine.ids, via: 'pronoun', refs: [], conf: 0.9, label: nameList(m, sameLine.ids) + ' (same line)', absorbs: sameLine.bareKey };
          if (ownPrevOk && ownPrev!.ids.length) return { ids: ownPrev!.ids, via: 'pronoun', refs: [ownPrev!.lineId], conf: 0.85, label: nameList(m, ownPrev!.ids) + ' (own earlier line)', absorbs: ownPrev!.bareKey };
          if (otherRef?.ids.length) return { ids: otherRef.ids, via: 'pronoun', refs: [st[prevOther].line.id], conf: 0.7, label: nameList(m, otherRef.ids) + ' (line replied to)' };
          void plural;
          return undefined;
        },
        you: () => {
          if (named?.length) return { ids: named, via: 'addressee', refs: [], conf: 0.9, label: nameList(m, named) + ' (named)' };
          if (prevOther >= 0 && st[prevOther].line.sender !== 'unknown') { const by = st[prevOther].line.sender; return { ids: [by], via: 'addressee', refs: [st[prevOther].line.id], conf: 0.75, label: nameList(m, [by]) + ' (previous speaker)' }; }
          return undefined;
        },
        zero: (kind, scope) => {
          if (sameLine?.ids.length) return { ids: sameLine.ids, via: 'context', refs: [], conf: 0.85, label: nameList(m, sameLine.ids) + ' (same line)', absorbs: sameLine.bareKey };
          if (scope === 'line') return undefined;
          if (kind === 'lying' && prevOther >= 0 && st[prevOther].line.sender !== 'unknown') { const by = st[prevOther].line.sender; return { ids: [by], via: 'reply', refs: [st[prevOther].line.id], conf: 0.7, label: nameList(m, [by]) + ' (previous speaker)' }; }
          if (ownPrev && li - ownPrev.li <= 2 && ownPrev.ids.length) return { ids: ownPrev.ids, via: 'context', refs: [ownPrev.lineId], conf: 0.75, label: nameList(m, ownPrev.ids) + ' (own previous line)', absorbs: ownPrev.bareKey };
          if (otherRef?.ids.length && prevOther === li - 1) return { ids: otherRef.ids, via: 'reply', refs: [st[prevOther].line.id], conf: 0.55, label: nameList(m, otherRef.ids) + ' (line replied to)' };
          if (kind === 'accuse' && prevOther >= 0 && prevOther === li - 1 && st[prevOther].line.sender !== 'unknown') { const by = st[prevOther].line.sender; return { ids: [by], via: 'reply', refs: [st[prevOther].line.id], conf: 0.5, label: nameList(m, [by]) + ' (previous speaker)' }; }
          return undefined;
        },
        reporter: () => reporterFor(m, L),
        replyQ: () => {
          for (let j = li - 1; j >= Math.max(0, li - 4); j--) {
            if (st[j].line.sender === speaker) return undefined;
            if (st[j].question) return { ...st[j].question!, line: st[j].line.id, by: st[j].line.sender };
          }
          return undefined;
        },
      };
      const drafts = interpretClause(cl, env);
      for (const d of drafts) {
        const kd = { ...d, key: `${li}:${n++}` };
        if (L.xlatGuess) { kd.confidence *= 0.7; kd.why = [...kd.why, 'translation from a guessed language: confidence x0.7']; }
        S.drafts.push(kd);
        draftByKey.set(kd.key, { ...kd, li });
        if (kd.kind === 'question' && !S.question) S.question = { q: kd.question!, withQ: cl.units.some(u => u.k === 'with'), about: kd.about, body: /\bbod/.test(S.text.toLowerCase()) || undefined };
        // absorbed bare mentions (same speaker) disappear; their line becomes a ref
        for (const key of kd.absorbed ?? []) {
          const b = draftByKey.get(key);
          if (!b || st[b.li].line.sender !== speaker) continue;
          const bs = st[b.li].drafts.find(x => x.key === key);
          if (bs) bs.removed = true;
          if (!kd.refs.includes(st[b.li].line.id)) kd.refs.push(st[b.li].line.id);
          kd.why.push(`"${st[b.li].text.slice(b.span[0], b.span[1])}" read through this line`);
        }
        if (kd.pending && !kd.about.length) pending.set(speaker, [...(pending.get(speaker) ?? []), { li, d: kd }]);
        // a bare mention binds this speaker's pending predicates ("saw them do wires" … "white and black")
        if (kd.bare) {
          const pend = (pending.get(speaker) ?? []).filter(p => li - p.li <= 3 && !p.d.about.length);
          if (pend.length) {
            for (const p of pend) {
              p.d.about = [...kd.about];
              p.d.resolvedVia = 'context';
              p.d.confidence = Math.min(p.d.confidence > 0.3 ? p.d.confidence : 0.65, 0.65);
              p.d.pending = false;
              p.d.refs.push(L.id);
              p.d.why.push(`subject named later: ${nameList(m, kd.about)}`);
            }
            pending.set(speaker, (pending.get(speaker) ?? []).filter(p => !pend.includes(p)));
            (kd as { removed?: boolean }).removed = true;
          }
        }
      }
      // referent for later clauses / lines
      const live = drafts.filter(d => d.about.length && !d.about.every(id => id === speaker));
      const lastP = [...cl.units].reverse().find(u => u.k === 'P' && u.ids?.some(id => id !== speaker));
      const ids = live.length ? live[live.length - 1].about.filter(id => id !== speaker) : lastP ? lastP.ids!.filter(id => id !== speaker) : [];
      if (ids.length) {
        const bareD = S.drafts.find(d => d.bare && !d.removed && d.about.join() === ids.join());
        sameLine = { ids, bareKey: bareD?.key };
        S.lastRef = sameLine;
        lastRefBySpeaker.set(speaker, { ids, li, lineId: L.id, bareKey: bareD?.key });
      }
    });
  }

  // --- assemble ---------------------------------------------------------------------------
  const out: ChatAssertion[] = [];
  st.forEach(S => {
    let n = 0;
    const seen = new Set<string>();
    for (const d of S.drafts) {
      if (d.removed) continue;
      const dk = [d.kind, d.about.join('+'), d.room, d.reason, d.taskId].join('|');
      if (seen.has(dk)) continue;
      seen.add(dk);
      if (NEEDS_ABOUT.has(d.kind) && !d.about.length) continue;
      if (d.kind === 'selfReport' && d.about.includes(S.line.sender)) continue;
      const span: [number, number] = [Math.max(0, d.span[0]), Math.min(S.text.length, d.span[1])];
      out.push({
        id: `${S.line.id}:${n++}`, line: S.line.id, meeting: S.line.meeting, speaker: S.line.sender,
        kind: d.kind, about: d.about, room: d.room, taskId: d.taskId, victim: d.victim, reason: d.reason,
        polarity: d.polarity, strength: round(d.strength), confidence: round(d.confidence), negated: d.negated,
        question: d.question, color: d.color, text: S.text, span, quote: S.text.slice(span[0], span[1]),
        resolvedVia: d.resolvedVia, refs: [...new Set(d.refs)], why: d.why, hearsayFrom: d.hearsayFrom,
      });
    }
  });
  confusableColors(out, m);
  markSuperseded(out);
  // drop undefined optional fields for clean equality in tests / NDJSON
  for (const a of out) for (const k of Object.keys(a) as (keyof ChatAssertion)[]) if (a[k] === undefined) delete a[k];
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;
/** Comparable form of a chat line for re-read detection. */
const normKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Within a meeting, a later assertion by the same speaker with the opposite polarity on a target supersedes the earlier one. */
export function markSuperseded(list: ChatAssertion[]) {
  const last = new Map<string, ChatAssertion>();
  for (const a of list) {
    if (a.polarity === 0) continue;
    for (const t of a.about) {
      const k = `${a.meeting}|${a.speaker}|${t}`;
      const prev = last.get(k);
      if (prev && prev.polarity !== a.polarity && prev.line !== a.line) prev.supersededBy = a.id;
      last.set(k, a);
    }
  }
}

const EYEWITNESS = new Set(['sawVent', 'sawKill', 'sighting', 'sawTask']);
/** "brown vented" while maroon is also alive: an easy colour to mix up on screen → confidence x0.9. */
function confusableColors(list: ChatAssertion[], m: MatchState) {
  const pairs = LEX.confusableColors?.pairs ?? [];
  const alive = new Set(Object.values(m.players).filter(p => p.status === 'alive').map(p => p.color));
  for (const a of list) {
    if (!EYEWITNESS.has(a.kind)) continue;
    for (const id of a.about) {
      const c = m.players[id]?.color;
      const other = pairs.find(([x, y]) => (x === c && alive.has(y as never)) || (y === c && alive.has(x as never)));
      if (!c || !other) continue;
      const partner = other[0] === c ? other[1] : other[0];
      a.confidence = Math.round(a.confidence * 0.9 * 100) / 100;
      a.why = [...a.why, `${c} and ${partner} are both alive and easy to mix up: confidence x0.9`];
      break;
    }
  }
}

/** Who reported the body that opened the meeting of this line, when we know it. */
export function reporterFor(m: MatchState, line: ChatLine): PlayerId | undefined {
  if (m.phase.meeting === line.meeting && m.phase.reason === 'body' && m.phase.calledBy) return m.phase.calledBy;
  const body = m.observations.find(o => o.type === 'bodyFound' && o.stamp.round === line.stamp.round && o.reporter);
  return body && body.type === 'bodyFound' ? body.reporter : undefined;
}

export type { Ref };

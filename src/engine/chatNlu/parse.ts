/**
 * Tagged units → clauses → draft assertions. Context-free except for the `env` callbacks
 * (pronouns, "you", missing subjects, the question being answered), which context.ts supplies.
 */
import type { ChatAssertionKind, ChatReason, ChatResolution, MatchState, PlayerColor, PlayerId, RoomId } from '../../types/game';
import { SOCIAL, isVisualTask, type QuestionType } from './lexicon';
import type { Unit } from './tokenize';

export interface Ref {
  ids: PlayerId[];
  via: ChatResolution;
  refs: string[];
  conf: number;
  label: string;
  /** Draft key of a provisional bare mention this reading absorbs (same speaker). */
  absorbs?: string;
}

export interface Draft {
  kind: ChatAssertionKind;
  about: PlayerId[];
  room?: RoomId;
  taskId?: string;
  victim?: PlayerId;
  reason?: ChatReason;
  polarity: 1 | -1 | 0;
  strength: number;
  confidence: number;
  negated?: boolean;
  question?: QuestionType;
  color?: PlayerColor;
  span: [number, number];
  resolvedVia: ChatResolution;
  refs: string[];
  why: string[];
  /** Subject still missing (pronoun with no antecedent yet / zero subject): context may bind it later. */
  pending?: boolean;
  /** Provisional reading of a bare mention ("White and Black"): later lines may absorb it. */
  bare?: boolean;
  /** Bare mention keys this draft absorbed. */
  absorbed?: string[];
  /** "blue said red vented": the claim is blue's, reported by the speaker. */
  hearsayFrom?: PlayerId;
}

export interface QuestionMeta { q: QuestionType; withQ: boolean; about: PlayerId[]; /** "where body?" */ body?: boolean }

export interface Env {
  speaker: PlayerId;
  m: MatchState;
  lineId: string;
  /** Pronoun antecedent ("them" / "him"): same line earlier, own earlier lines, the line replied to. */
  pron(plural: boolean): Ref | undefined;
  /** "you": named player in this line, else the last other speaker. */
  you(): Ref | undefined;
  /** Missing subject of "vented" / "sus" / "clear" / "cap": same line, own previous line, replied line. */
  zero(kind: 'accuse' | 'clear' | 'lying', scope?: 'line'): Ref | undefined;
  /** Reporter of the body for this meeting, if known. */
  reporter(): PlayerId | undefined;
  /** Question this line answers (previous other speaker asked "where" / "who"). */
  replyQ(): (QuestionMeta & { line: string; by: PlayerId }) | undefined;
}

export interface Clause {
  units: Unit[]; qmark: boolean; excl: number; verdict: boolean; s: number; e: number;
  /** After "if" / "unless": hypothetical, says nothing. */
  hypo?: boolean;
  /** A greeting / reaction word sat in the clause ("bye yellow"): a lone colour is an address. */
  social?: boolean;
  /** The line has words the lexicon does not know: a lone colour may be part of a sentence we can't read. */
  lineW?: boolean;
}

const DROP = new Set(['filler', 'noise', 'report', 'agree']);
/** Predicate classes: a clause that has one is "complete"; a new subject after it starts a new clause. */
const PREDICATE = new Set(['sus', 'vent', 'kill', 'lying', 'clear', 'followed', 'fake', 'stack', 'selfReport', 'vote', 'dead', 'scan']);
const SUBJECT_FOLLOW = new Set(['be', 'neg', 'move', 'see', 'do']);

/** True when every word of the line is noise / filler / hedge / punctuation ("lol", "gg", "?", "idk"). */
export function isNoiseLine(units: Unit[]): boolean {
  return units.every(u => u.k === 'PUNCT' || u.k === 'noise' || u.k === 'filler' || u.k === 'hedge' || u.k === 'intens' || u.k === 'W' || u.k === 'agree')
    && !units.some(u => u.k === 'agree' && !u.cls.has('noise'));
}
export const isAgreeLine = (units: Unit[]) => units.some(u => u.k === 'agree' || u.cls.has('agree')) && units.every(u => u.k === 'PUNCT' || u.cls.has('agree') || u.k === 'agree' || u.k === 'filler' || u.k === 'intens');

/** Merge player mentions joined by and / n / & / , / nothing into groups; split the rest into clauses. */
export function splitClauses(units: Unit[]): Clause[] {
  const lineW = units.some(u => u.k === 'W');
  // greetings are dropped as noise but remembered on the clause
  const socialAt = new Set(units.filter(u => DROP.has(u.k) && SOCIAL.has(u.w)).map(u => u.s));
  const kept = units.filter(u => !DROP.has(u.k) || socialAt.has(u.s)).map(u => (socialAt.has(u.s) ? { ...u, k: 'social' as never } : u));
  const merged: Unit[] = [];
  for (let i = 0; i < kept.length; i++) {
    const u = kept[i];
    const last = merged[merged.length - 1];
    const prev2 = merged[merged.length - 2];
    // "blk grn sus" merges; "blue i barely see him" does not (no connector next to "i")
    if (u.k === 'P' && last?.k === 'P' && !u.self && !last.self) { mergeInto(last, u); continue; }
    if (u.k === 'P' && prev2?.k === 'P' && (last.k === 'and' || (last.k === 'PUNCT' && last.w === ',') || last.k === 'or')) {
      if (last.k === 'or') prev2.cls.add('or');
      merged.pop(); mergeInto(prev2, u); continue;
    }
    merged.push({ ...u, ids: u.ids ? [...u.ids] : undefined, cls: new Set(u.cls) });
  }
  const clauses: Clause[] = [];
  let cur: Unit[] = [];
  let verdict = false;
  let hypo = false;
  const flush = (qmark = false, excl = 0) => {
    const social = cur.some(x => (x.k as string) === 'social');
    cur = cur.filter(x => (x.k as string) !== 'social');
    if (cur.length) clauses.push({ units: cur, qmark, excl, verdict, s: cur[0].s, e: cur[cur.length - 1].e, hypo: hypo || undefined, social: social || undefined, lineW: lineW || undefined });
    else if (qmark && clauses.length) clauses[clauses.length - 1].qmark = true;
    else if (excl && clauses.length) clauses[clauses.length - 1].excl += excl;
    cur = []; verdict = false;
    if (qmark || excl || sentenceEnd) hypo = false;
    sentenceEnd = false;
  };
  let sentenceEnd = false;
  for (let i = 0; i < merged.length; i++) {
    const u = merged[i];
    if (u.k === 'PUNCT') { sentenceEnd = u.w !== ','; flush(u.w === '?', u.w === '!' ? 1 : 0); continue; }
    // "green is lying | he wasnt in admin": a new subject after a complete predicate
    if ((u.k === 'P' || u.k === 'PRON') && cur.some(x => PREDICATE.has(x.k)) && cur.some(x => x.k === 'P' && x.ids?.length) && merged[i + 1] && SUBJECT_FOLLOW.has(merged[i + 1].k)) flush();
    // "wtf blue | i was in storage": me + be/move after another player starts a new clause
    if (u.k === 'P' && u.self && cur.length && cur[cur.length - 1].k === 'P' && !cur[cur.length - 1].self && merged[i + 1] && SUBJECT_FOLLOW.has(merged[i + 1].k)) flush();
    // "if X then Y" stays hypothetical; "... if you want but not me" ends it at the "but"
    if (u.k === 'bound' || u.k === 'and') { flush(); if (u.k === 'bound' && u.w !== 'then') hypo = false; continue; }
    // "skip unless someone saw", "if not me then cyan": the rest is hypothetical
    if (u.k === 'cond') { flush(); hypo = true; continue; }
    if (u.k === 'so') { flush(); verdict = true; continue; }
    cur.push(u);
  }
  flush();
  return clauses;
}

function mergeInto(a: Unit, b: Unit) {
  a.ids = [...new Set([...(a.ids ?? []), ...(b.ids ?? [])])];
  a.self = !!(a.self || b.self);
  a.e = b.e; a.w = a.w + ' ' + b.w;
  a.conf = Math.min(a.conf, b.conf);
  if (b.via === 'fuzzy') a.via = 'fuzzy';
  if (b.unresolved) a.unresolved = b.unresolved;
  if (a.color && b.color) a.color = undefined; // group: no single colour
}

const BASE: Partial<Record<ChatReason | ChatAssertionKind, number>> = {
  sus: 0.55, its: 0.6, either: 0.4, bare: 0.35, vent: 0.95, kill: 0.95, selfReport: 0.6, followed: 0.45, fakeTask: 0.7,
  lying: 0.6, nearBody: 0.5, leftBody: 0.65, stack: 0.3, voteCall: 0.6, notClear: 0.35, safe: 0.6, clear: 0.6,
  sawTask: 0.55, visual: 0.85, withMe: 0.5, withOther: 0.4, notSus: 0.45, didnt: 0.45, defense: 0.45,
};

const clamp = (x: number, lo = 0.05, hi = 1) => Math.max(lo, Math.min(hi, x));

/** Interpret one clause. `lineUnits` is the whole line (for hedges/intensifiers that sit outside the clause words). */
export function interpretClause(clause: Clause, env: Env): Draft[] {
  let cl = clause;
  const { speaker, m } = env;
  const why: string[] = [];
  if (cl.hypo) return [];
  // "yellow said it was maroon": the rest is yellow's claim, reported by the speaker
  let hearsayFrom: PlayerId | undefined;
  {
    const si = cl.units.findIndex(x => x.k === 'said');
    if (si >= 0) {
      const src = cl.units.slice(0, si).reverse().find(x => x.k === 'P');
      if (src && src.ids?.length && !src.self) { hearsayFrom = src.ids[0]; why.push(`hearsay: ${m.players[hearsayFrom]?.name ?? hearsayFrom} said it (confidence x0.5)`); }
      cl = { ...cl, units: cl.units.slice(si + 1) };
      if (!cl.units.length) return [];
    }
  }
  // --- modifiers -----------------------------------------------------------
  let hedge = 1, bonus = 0;
  for (const u of cl.units) {
    if (u.k === 'hedge' && u.f) { hedge *= u.f; why.push(`"${u.w}": strength x${u.f}`); }
    if (u.k === 'intens' && u.f) { bonus += u.f; why.push(`"${u.w}": strength +${u.f}`); }
  }
  if (cl.qmark) { hedge *= 0.7; why.push('"?": strength x0.7'); }
  if (cl.units.some(u => u.caps)) { bonus += 0.1; why.push('CAPS: strength +0.1'); }
  if (cl.excl) bonus += Math.min(0.15, 0.05 * cl.excl);
  const strengthOf = (base: number) => clamp(base * hedge + Math.min(0.4, bonus));

  // --- resolve pronouns / you into P units -----------------------------------
  const u: Unit[] = [];
  const refLines: string[] = [];
  const absorbed: string[] = [];
  let viaCtx: ChatResolution | undefined;
  let ctxConf = 1;
  let pendingPron = false;
  for (const x of cl.units) {
    if (x.k === 'PRON' || x.k === 'YOU') {
      const r = x.k === 'PRON' ? env.pron(!!x.plural) : env.you();
      if (r && r.ids.length) {
        u.push({ ...x, k: 'P', ids: r.ids.filter(id => id !== speaker), self: r.ids.includes(speaker), via: r.via === 'addressee' ? 'addressee' : 'pronoun', conf: Math.min(x.conf, r.conf) });
        refLines.push(...r.refs); why.push(`"${x.w}" = ${r.label}`);
        viaCtx = r.via; ctxConf = Math.min(ctxConf, r.conf);
        if (r.absorbs) absorbed.push(r.absorbs);
      } else { u.push({ ...x, k: 'P', ids: [], self: false, conf: 0.5 }); pendingPron = true; }
      continue;
    }
    u.push(x);
  }
  // re-merge groups that a pronoun created ("him and blue")
  for (let i = 1; i < u.length; i++) if (u[i].k === 'P' && u[i - 1].k === 'P' && !u[i].self && !u[i - 1].self) { mergeInto(u[i - 1], u[i]); u.splice(i, 1); i--; }

  const has = (k: string) => u.some(x => x.k === k || x.cls.has(k as never));
  const idx = (k: string, from = 0) => u.findIndex((x, i) => i >= from && (x.k === k || x.cls.has(k as never)));
  const Ps = u.filter(x => x.k === 'P');
  const othersOf = (x?: Unit) => (x?.ids ?? []).filter(id => id !== speaker);
  const allOthers = () => [...new Set(Ps.flatMap(othersOf))];
  const roomU = u.find(x => x.k === 'ROOM' || (x.room && !x.cls.has('with')));
  const taskU = u.find(x => x.task);
  const span: [number, number] = [cl.s, cl.e];
  const minConf = Math.min(1, ...u.filter(x => (x.k === 'P' && (x.ids?.length || x.self)) || x.k === 'ROOM' || x.k === 'TASK').map(x => x.conf));
  for (const x of u) if (x.via === 'fuzzy' && x.k === 'P') why.push(`"${x.w}" read as ${(x.ids ?? []).map(id => m.players[id]?.name ?? id).join(', ') || (x.self ? 'me' : '?')}`);

  const out: Draft[] = [];
  const emit = (d: Omit<Draft, 'span' | 'resolvedVia' | 'refs' | 'why' | 'confidence' | 'strength'> & { strength?: number; base?: number; conf?: number; via?: ChatResolution; extraWhy?: string[]; extraRefs?: string[] }) => {
    const { base, conf, via, extraWhy, extraRefs, strength, ...rest } = d;
    const resolvedVia: ChatResolution = via ?? viaCtx ?? (minConf < 0.95 ? 'fuzzy' : 'direct');
    const c = clamp((conf ?? 0.9) * minConf * (viaCtx && !via ? ctxConf : 1) * (hearsayFrom ? 0.5 : 1), 0.05, 1);
    out.push({ ...rest, hearsayFrom, strength: strength ?? strengthOf(base ?? 0.5), confidence: c, span, resolvedVia, refs: [env.lineId, ...refLines, ...(extraRefs ?? [])], why: [...why, ...(extraWhy ?? [])], absorbed: absorbed.length ? [...absorbed] : undefined, pending: rest.pending || (pendingPron && !rest.about.length) || undefined });
  };
  const namedUnknown = u.some(x => x.k === 'P' && !!x.unresolved);
  const hasW = u.some(x => x.k === 'W');
  const zeroSubject = (kind: 'accuse' | 'clear' | 'lying'): { ids: PlayerId[]; via?: ChatResolution; conf: number; why?: string; refs?: string[]; pending: boolean } => {
    // "sus of black" with no black on the roster / "Batti is impostor": the subject was named, we just can't place it
    if (namedUnknown) return { ids: [], conf: 0.5, pending: false };
    const r = env.zero(kind, hasW ? 'line' : undefined);
    if (r && r.ids.length) {
      if (r.absorbs) absorbed.push(r.absorbs);
      return { ids: r.ids.filter(id => id !== speaker), via: r.via, conf: r.conf, why: `subject = ${r.label}`, refs: r.refs, pending: false };
    }
    return { ids: [], conf: 0.5, pending: true };
  };

  // Negation right before a player: "not red", "wasnt me", "its not blue" → defense; those players are used up.
  const negUsed = new Set<number>();
  for (let i = 0; i < u.length - 1; i++) {
    if (u[i].k !== 'neg') continue;
    // "not red", "wasnt me", "não fui eu" (one be-word may sit between)
    const j = u[i + 1].k === 'P' ? i + 1 : u[i + 1].k === 'be' && u[i + 2]?.k === 'P' ? i + 2 : -1;
    if (j < 0) continue;
    const p = u[j];
    negUsed.add(i); negUsed.add(j);
    if (p.self) emit({ kind: 'defense', about: [speaker], polarity: -1, base: BASE.didnt, reason: 'didnt' });
    const o = othersOf(p);
    if (o.length) emit({ kind: 'defense', about: o, polarity: -1, base: BASE.notSus, reason: 'notSus' });
  }
  const negLeft = u.some((x, i) => x.k === 'neg' && !negUsed.has(i));
  /** an unused negation within 3 units before position vi ("red is not sus", "dont vote red") */
  const negNear = (vi: number) => u.some((x, i) => x.k === 'neg' && !negUsed.has(i) && i < vi && vi - i <= 3);
  const freeP = Ps.filter(x => !negUsed.has(u.indexOf(x)));
  const freeOthers = [...new Set(freeP.flatMap(othersOf))];
  const freeSelf = freeP.some(x => x.self);

  // --- questions --------------------------------------------------------------
  const qi = u.findIndex(x => x.k === 'Q');
  const proofOnly = qi >= 0 && u[qi].q === 'proof' && !cl.qmark && u.length > 1; // "skip no proof" is not a question
  const leads = qi >= 0 && u.slice(0, qi).every(x => x.k === 'P' || x.k === 'YOU');
  if (qi >= 0 && !proofOnly && (leads || cl.qmark) && !(qi > 0 && ['prepIn', 'prepNear', 'prepFrom', 'prepTo'].includes(u[qi - 1].k))) {
    const q = u[qi].q!;
    out.length = 0;
    // "why me" / "why would i" = denial, not a question
    if (q === 'why' && freeSelf && !freeOthers.length) { emit({ kind: 'defense', about: [speaker], polarity: -1, base: 0.35, reason: 'didnt' }); return out; }
    let about = allOthers();
    // "where were u" is one lexicon phrase: the "u" inside it still names the addressee
    if (!about.length && /\b(u|you|ya|ur)\b/.test(u[qi].w)) {
      const r = env.you();
      if (r?.ids.length) { about = r.ids.filter(id => id !== speaker); why.push(`"you" = ${r.label}`); refLines.push(...r.refs); }
    }
    emit({ kind: 'question', about, polarity: 0, question: q, base: 0.5, conf: 0.85 });
    return out;
  }

  // --- my colour: "im cyan" ---------------------------------------------------
  if (u.length === 3 && u[0].k === 'P' && u[0].self && u[1].k === 'be' && u[2].k === 'P' && u[2].color && u[2].w.split(' ').length <= 2) {
    emit({ kind: 'myColor', about: [speaker], polarity: 0, color: u[2].color, base: 0.5, conf: 0.85 });
    return out;
  }

  // --- body ---------------------------------------------------------------------
  const bi = idx('body');
  if (bi >= 0) {
    const before = u.slice(0, bi);
    const moveFrom = before.some(x => x.k === 'move') && before.some(x => x.k === 'prepFrom');
    const near = bi > 0 && u[bi - 1].k === 'prepNear' || before.some(x => x.k === 'prepNear');
    const subj = before.filter(x => x.k === 'P').flatMap(othersOf);
    const after = u.slice(bi + 1);
    const ai = after.findIndex(x => x.k === 'ROOM' || x.room);
    const r = moveFrom ? undefined : (ai >= 0 && after.slice(0, ai).every(x => ['be', 'prepIn', 'prepNear', 'dead'].includes(x.k)) ? after[ai] : undefined)
      ?? (before.length && before[before.length - 1].k === 'ROOM' ? before[before.length - 1] : undefined);
    if (subj.length && moveFrom) emit({ kind: 'accuse', about: subj, polarity: 1, reason: 'leftBody', base: BASE.leftBody });
    else if (subj.length && near && !negLeft) emit({ kind: 'accuse', about: subj, polarity: 1, reason: 'nearBody', base: BASE.nearBody });
    else if (subj.length && bi > 0 && u[bi - 1].k === 'P') emit({ kind: 'dead', about: subj, polarity: 0, base: 0.6, conf: 0.75 });
    if (r?.room) emit({ kind: 'bodyLocation', about: [], room: r.room, polarity: 0, base: 0.6, conf: 0.85 });
    if (out.length) return out;
  }

  // --- self report ----------------------------------------------------------------
  if (has('selfReport')) {
    const solo = u.length === 1 && u[0].w === 'self';
    if (negLeft) { if (freeOthers.length) emit({ kind: 'defense', about: freeOthers, polarity: -1, reason: 'notSus', base: BASE.notSus }); return out; }
    if (freeOthers.length) { emit({ kind: 'selfReport', about: freeOthers, polarity: 1, reason: 'selfReport', base: BASE.selfReport, conf: solo ? 0.7 : 0.9 }); return out; }
    const lineRef = !freeSelf ? env.zero('accuse', 'line') : undefined;
    if (lineRef?.ids.length) {
      emit({ kind: 'selfReport', about: lineRef.ids.filter(id => id !== speaker), polarity: 1, reason: 'selfReport', base: BASE.selfReport, conf: 0.8, via: 'context', extraWhy: [`subject = ${lineRef.label}`] });
      return out;
    }
    if (!freeSelf) {
      const rep = env.reporter();
      if (rep && rep !== speaker) emit({ kind: 'selfReport', about: [rep], polarity: 1, reason: 'selfReport', base: BASE.selfReport, conf: solo ? 0.55 : 0.65, via: 'implicit', extraWhy: [`reporter = ${m.players[rep]?.name ?? rep}`] });
      else {
        const z = zeroSubject('accuse');
        emit({ kind: 'selfReport', about: z.ids, polarity: 1, reason: 'selfReport', base: BASE.selfReport, conf: z.conf * 0.8, via: z.via, pending: z.pending, extraWhy: z.why ? [z.why] : [], extraRefs: z.refs });
      }
    }
    return out;
  }

  // --- kill: "black killed yellow", "saw red kill blue" -------------------------------
  const ki = idx('kill');
  if (ki >= 0 && !has('dead')) {
    const seeNeg = negLeft && idx('neg') < Math.max(0, idx('see'));
    if (seeNeg) return out;
    const before = u.slice(0, ki).filter(x => x.k === 'P' && !x.self);
    const selfBefore = u.slice(0, ki).some(x => x.k === 'P' && x.self);
    if (!before.length && selfBefore) {
      // "i didnt kill anyone" → self defense; "i killed" (joke / confession) → nothing
      if (negLeft) emit({ kind: 'defense', about: [speaker], polarity: -1, reason: 'didnt', base: BASE.didnt });
      return out;
    }
    const after = u.slice(ki + 1).filter(x => x.k === 'P');
    // killer = the player right before the verb ("black killed", "saw him kill"); "Shortflux killed bobross" names nobody we know
    let kj = ki - 1;
    while (kj >= 0 && ['be', 'intens', 'hedge', 'neg'].includes(u[kj].k)) kj--;
    let killers = kj >= 0 && u[kj].k === 'P' ? othersOf(u[kj]) : [];
    let z: ReturnType<typeof zeroSubject> | undefined;
    if (!killers.length && !before.length && u.length <= 2) { z = zeroSubject('accuse'); killers = z.ids; }
    if (!killers.length && !z) return out;
    const negK = negNear(ki);
    const victim = after.length ? othersOf(after[0])[0] : undefined;
    if (negK) { if (killers.length) emit({ kind: 'defense', about: killers, polarity: -1, reason: 'didnt', base: BASE.didnt }); return out; }
    if (killers.length || z?.pending) emit({ kind: 'sawKill', about: killers, victim, room: roomU?.room, polarity: 1, reason: 'kill', base: BASE.kill, conf: has('see') ? 0.9 : 0.85, via: z?.via, pending: z?.pending, extraWhy: z?.why ? [z.why] : [], extraRefs: z?.refs });
    return out;
  }

  // --- dead: "yellow is dead" ---------------------------------------------------------------
  if (has('dead')) {
    // "is red dead?" asks; it must not mark red dead (the app acts on 'dead' readings)
    if (freeOthers.length && !negLeft && !cl.qmark) emit({ kind: 'dead', about: freeOthers, polarity: 0, base: 0.6, conf: 0.85 });
    else if (freeOthers.length && cl.qmark) emit({ kind: 'question', about: freeOthers, polarity: 0, question: 'what', base: 0.5, conf: 0.6 });
    return out;
  }

  // --- vent ---------------------------------------------------------------------------
  if (has('vent')) {
    const seeIdx = idx('see');
    if (negLeft && seeIdx >= 0 && idx('neg') < seeIdx) return out; // "i didnt see anyone vent"
    let about = freeOthers;
    let z: ReturnType<typeof zeroSubject> | undefined;
    // "i saw them vent": the speaker is the witness, not the subject
    const selfIsSubject = freeSelf && !(seeIdx >= 0 && !u.slice(seeIdx + 1).some(x => x.k === 'P' && x.self));
    if (!about.length && !selfIsSubject) { z = zeroSubject('accuse'); about = z.ids; }
    if (negNear(idx('vent'))) { if (about.length) emit({ kind: 'defense', about, polarity: -1, reason: 'didnt', base: BASE.didnt }); return out; }
    if (about.length || z?.pending) emit({ kind: 'sawVent', about, room: roomU?.room, polarity: 1, reason: 'vent', base: BASE.vent, conf: seeIdx >= 0 ? 0.9 : 0.85, via: z?.via, pending: z?.pending, extraWhy: z?.why ? [z.why] : [], extraRefs: z?.refs });
    return out;
  }

  // --- skip / vote ------------------------------------------------------------------------
  if (has('skip')) {
    emit({ kind: 'skipCall', about: [], polarity: 0, negated: negLeft || undefined, base: 0.5, conf: 0.9 });
    return out;
  }
  const outAtEnd = u.length >= 2 && u[u.length - 1].k === 'out' && u[u.length - 2].k === 'P';
  if (has('vote') || outAtEnd) {
    const vi = has('vote') ? idx('vote') : u.length - 1;
    const targetsP = outAtEnd && !has('vote') ? [u[u.length - 2]] : freeP.filter(x => u.indexOf(x) > vi);
    const tOthers = [...new Set(targetsP.flatMap(othersOf))];
    const tSelf = targetsP.some(x => x.self);
    if (negNear(vi) || (negLeft && targetsP.length)) {
      if (tSelf) emit({ kind: 'defense', about: [speaker], polarity: -1, reason: 'didnt', base: 0.4 });
      if (tOthers.length) emit({ kind: 'defense', about: tOthers, polarity: -1, reason: 'notSus', base: BASE.notSus });
      return out;
    }
    if (tOthers.length) { emit({ kind: 'voteCall', about: tOthers, polarity: 1, base: BASE.voteCall }); return out; }
    if (has('vote')) return out;
  }

  // --- verdicts: "its blue", "its yellow or white", "so yellow" -----------------------------
  const itsAt = idx('its');
  const verdictP = freeP.filter(x => itsAt < 0 || u.indexOf(x) > itsAt);
  // "its blue", "its def purple", "it is 100% blue" — not "it was good playing Evil"
  let firstAfter = itsAt + 1;
  while (firstAfter < u.length && ['hedge', 'intens', 'neg', 'be'].includes(u[firstAfter].k)) firstAfter++;
  const itsDirect = itsAt >= 0 && firstAfter < u.length && u[firstAfter].k === 'P';
  const PRED = ['sus', 'vent', 'kill', 'lying', 'clear', 'followed', 'fake', 'selfReport', 'dead', 'scan', 'do', 'see'];
  const verdictOk = cl.verdict && itsAt < 0 && u.findIndex(x => x.k === 'P') <= 1 && !u.some(x => PRED.includes(x.k));
  if ((itsDirect || verdictOk) && verdictP.length && !has('with') && !roomU) {
    const either = verdictP.some(x => x.cls.has('or')) || has('or');
    const vOthers = [...new Set(verdictP.flatMap(othersOf))];
    // "i dont think its blue" negates; "no we didnt | its green" does not (no hedge between)
    const negIts = itsAt >= 0 ? u.some((x, i) => x.k === 'neg' && !negUsed.has(i) && i < itsAt && u.slice(i + 1, itsAt).some(y => y.k === 'hedge')) : negLeft;
    if (negIts) {
      if (vOthers.length) emit({ kind: 'defense', about: vOthers, polarity: -1, reason: 'notSus', base: BASE.notSus });
      return out;
    }
    if (vOthers.length) emit({ kind: 'accuse', about: vOthers, polarity: 1, reason: either ? 'either' : 'its', base: either ? BASE.either : BASE.its });
    return out;
  }
  if (!has('its') && freeP.some(x => x.cls.has('or')) && freeOthers.length >= 2 && u.every(x => x.k === 'P' || x.k === 'hedge' || x.k === 'intens' || x.k === 'or' || x.k === 'sus' || x.k === 'be')) {
    emit({ kind: 'accuse', about: freeOthers, polarity: 1, reason: 'either', base: BASE.either });
    return out;
  }

  // --- accusations with a reason: sus / followed / fake / lying / stack -------------------
  const accCls = (['followed', 'fake', 'lying', 'stack', 'sus'] as const).find(c => has(c));
  if (accCls) {
    const reason: ChatReason = accCls === 'fake' ? 'fakeTask' : accCls === 'followed' ? 'followed' : accCls === 'lying' ? 'lying' : accCls === 'stack' ? 'stack' : 'sus';
    const vi = idx(accCls);
    // "i followed red" — the speaker did the following: no accusation.
    if (accCls === 'followed' && u.slice(0, vi).some(x => x.k === 'P' && x.self) && !u.slice(0, vi).some(x => x.k === 'P' && othersOf(x).length)) return out;
    let about = freeOthers;
    // "blue lying", "red faked": the liar comes before the verb; "i didnt threaten u … i lied" accuses nobody
    if ((accCls === 'lying' || accCls === 'fake') && freeP.some(x => u.indexOf(x) < vi)) {
      const before = freeP.filter(x => u.indexOf(x) < vi);
      const last = before[before.length - 1];
      about = last.self ? [] : othersOf(last);
      if (last.self) {
        if (negNear(vi)) emit({ kind: 'defense', about: [speaker], polarity: -1, reason: 'didnt', base: BASE.didnt }); // "im not lying"
        return out;
      }
    }
    let z: ReturnType<typeof zeroSubject> | undefined;
    if (!about.length && !freeSelf) { z = zeroSubject(accCls === 'lying' ? 'lying' : 'accuse'); about = z.ids; }
    if (negNear(vi)) {
      if (freeSelf && !freeOthers.length) emit({ kind: 'defense', about: [speaker], polarity: -1, reason: 'didnt', base: BASE.didnt });
      if (about.length) emit({ kind: 'defense', about, polarity: -1, reason: 'notSus', base: BASE.notSus, via: z?.via, extraWhy: z?.why ? [z.why] : [], extraRefs: z?.refs });
      return out;
    }
    if (about.length || z?.pending) emit({ kind: 'accuse', about, polarity: 1, reason, base: BASE[reason] ?? 0.5, conf: z ? z.conf * 0.9 : 0.9, via: z?.via, pending: z?.pending, extraWhy: z?.why ? [z.why] : [], extraRefs: z?.refs });
    return out;
  }

  // --- clears: "green clear", "im crew", "trust me", "red not clear" -------------------------
  if (has('clear')) {
    let about = freeOthers;
    let z: ReturnType<typeof zeroSubject> | undefined;
    const ci = idx('clear');
    if (!about.length && freeSelf) {
      if (negLeft || namedUnknown) return out;
      emit({ kind: 'defense', about: [speaker], polarity: -1, reason: 'didnt', base: 0.4 });
      return out;
    }
    // "orange can clear me", "white can clear me": the speaker's alibi, not a clear of orange
    if (about.length && u[ci + 1]?.k === 'P' && u[ci + 1].self && !negLeft) {
      emit({ kind: 'defense', about: [speaker], polarity: -1, reason: 'didnt', base: 0.4 });
      emit({ kind: 'withMe', about, polarity: -1, reason: 'withThem', base: BASE.withMe, conf: 0.6 });
      return out;
    }
    if (!about.length) { z = zeroSubject('clear'); about = z.ids; }
    const hard = u.some(x => x.k === 'intens' && /hard|100|confirmed/.test(x.w)) || u.some(x => /hard/.test(x.w));
    const zx = { via: z?.via, pending: z?.pending, extraWhy: z?.why ? [z.why] : [], extraRefs: z?.refs };
    if (negNear(ci)) { if (about.length) emit({ kind: 'accuse', about, polarity: 1, reason: 'notClear', base: BASE.notClear, ...zx }); return out; }
    if (hard) zx.extraWhy.push('"hard" clear: strength up');
    if (about.length || z?.pending) emit({ kind: 'clear', about, polarity: -1, reason: 'safe', base: hard ? 0.75 : BASE.safe, conf: z ? z.conf * 0.9 : 0.9, ...zx });
    // "green is clear, scanned" style continues in its own clause; "blk n grn clear, was w them" too.
    if (!has('with') && !roomU) return out;
  }

  // --- tasks: "saw lime do wires", "red scanned", "i did wires in elec" -----------------------
  const doing = has('do') || has('scan') || has('visual') || has('taskWord');
  if (doing && (taskU || has('scan') || has('visual') || has('taskWord'))) {
    const seeIdx = idx('see');
    const taskId = taskU?.task ?? (has('scan') ? findTaskId(m, 'submitScan') : undefined);
    const room = u.find(x => x.k === 'ROOM' && x !== taskU)?.room;
    const visual = has('visual') || has('scan') || isVisualTask(m.map, taskId);
    // "i saw them do wires": players after "saw" did the task; the speaker only watched
    const doIdx = u.findIndex(x => ['do', 'scan', 'visual', 'taskWord'].includes(x.k) || x.cls.has('do') || x.cls.has('scan'));
    const subjP = seeIdx >= 0 ? freeP.filter(x => u.indexOf(x) > seeIdx) : freeP.filter(x => doIdx < 0 || u.indexOf(x) < doIdx);
    const subjOthers = [...new Set(subjP.flatMap(othersOf))];
    const freeSelf = subjP.some(x => x.self) || (seeIdx < 0 && freeP.some(x => x.self));
    if (subjOthers.length && !negLeft) {
      const reason: ChatReason = has('scan') ? 'scan' : visual ? 'visual' : 'task';
      emit({ kind: 'sawTask', about: subjOthers, taskId, room, polarity: -1, reason, base: visual ? BASE.visual : BASE.sawTask, conf: seeIdx >= 0 ? 0.9 : 0.75 });
      if (seeIdx < 0 && subjP.some(x => x.self)) {
        if (taskId) emit({ kind: 'task', about: [speaker], taskId, room, polarity: 0, base: 0.5, conf: 0.85 });
        emit({ kind: 'withMe', about: subjOthers, polarity: -1, reason: 'withThem', base: BASE.withMe, conf: 0.8 });
      }
      return out;
    }
    if (subjOthers.length && negLeft) { emit({ kind: 'accuse', about: subjOthers, polarity: 1, reason: 'fakeTask', base: 0.4, conf: 0.7 }); return out; }
    const sameLine = !subjOthers.length && !freeSelf ? env.zero('clear', 'line') : undefined;
    if (sameLine?.ids.length && !negLeft) {
      // "green is clear, scanned": the subject is the player named earlier in the line
      if (sameLine.absorbs) absorbed.push(sameLine.absorbs);
      const reason: ChatReason = has('scan') ? 'scan' : visual ? 'visual' : 'task';
      emit({ kind: 'sawTask', about: sameLine.ids.filter(id => id !== speaker), taskId, room, polarity: -1, reason, base: visual ? BASE.visual : BASE.sawTask, conf: 0.75, via: 'context', extraWhy: [`subject = ${sameLine.label}`] });
      return out;
    }
    if (!subjOthers.length && (seeIdx >= 0 || pendingPron) && !freeSelf) {
      // "saw them do wires" before the names are given: wait for context
      const z = zeroSubject('clear');
      const reason: ChatReason = has('scan') ? 'scan' : visual ? 'visual' : 'task';
      emit({ kind: 'sawTask', about: z.ids, taskId, room, polarity: -1, reason, base: visual ? BASE.visual : BASE.sawTask, conf: z.conf * 0.9, via: z.via, pending: z.pending, extraWhy: z.why ? [z.why] : [], extraRefs: z.refs });
      return out;
    }
    if (taskId && !negLeft) {
      emit({ kind: 'task', about: [speaker], taskId, room, polarity: 0, base: 0.5, conf: 0.85 });
      if (!has('with')) return out;
    }
  }

  // --- companions: "with red", "red was with me", "red with blue", "me and red" ----------------
  const wi = idx('with');
  const together = has('together');
  if ((wi >= 0 || together) && !negLeft) {
    const before = wi >= 0 ? u.slice(0, wi) : u;
    const after = wi >= 0 ? u.slice(wi + 1) : [];
    const bP = before.filter(x => x.k === 'P');
    const aP = after.filter(x => x.k === 'P');
    const bOthers = [...new Set(bP.flatMap(othersOf))];
    const aOthers = [...new Set(aP.flatMap(othersOf))];
    const aSelf = aP.some(x => x.self), bSelf = bP.some(x => x.self);
    if (aSelf && bOthers.length) emit({ kind: 'withMe', about: bOthers, polarity: -1, reason: 'withThem', base: BASE.withMe });
    else if (aOthers.length && (bSelf || !bOthers.length)) emit({ kind: 'withMe', about: aOthers, polarity: -1, reason: 'withThem', base: BASE.withMe });
    else if (aOthers.length && bOthers.length) emit({ kind: 'withOther', about: [...new Set([...bOthers, ...aOthers])], polarity: 0, base: BASE.withOther });
    else if (together && bSelf && bOthers.length) emit({ kind: 'withMe', about: bOthers, polarity: -1, reason: 'withThem', base: BASE.withMe });
    else if (together && bOthers.length >= 2) emit({ kind: 'withOther', about: bOthers, polarity: 0, base: BASE.withOther });
    else if (wi >= 0 && !aP.length && pendingPron) emit({ kind: 'withMe', about: [], polarity: -1, reason: 'withThem', base: BASE.withMe, pending: true });
    // the room in the same clause is still my location ("was w them in elec")
    const withSubjectIsMe = bSelf || !bOthers.length || aSelf;
    if (roomU?.room && withSubjectIsMe) emit({ kind: 'location', about: [speaker], room: roomU.room, polarity: 0, base: 0.5, conf: 0.85 });
    else if (roomU?.room && bOthers.length) emit({ kind: 'sighting', about: bOthers, room: roomU.room, polarity: 0, base: 0.5, conf: 0.8 });
    return out;
  }
  // "me and red in elec" (group with me, no "with")
  if (freeSelf && freeOthers.length && !negLeft && u.filter(x => x.k === 'P').length === 1) {
    emit({ kind: 'withMe', about: freeOthers, polarity: -1, reason: 'withThem', base: BASE.withMe, conf: 0.8 });
    if (roomU?.room) emit({ kind: 'location', about: [speaker], room: roomU.room, polarity: 0, base: 0.5, conf: 0.85 });
    return out;
  }

  // --- rooms: sightings and my location ----------------------------------------------------
  if (roomU?.room && !negLeft) {
    const ri = u.indexOf(roomU);
    const subj = u.slice(0, ri).filter(x => x.k === 'P');
    const subjOthers = [...new Set(subj.flatMap(othersOf))];
    const onlyRoom = u.every(x => x === roomU || x.k === 'hedge' || x.k === 'intens' || x.k === 'prepIn');
    if (!subjOthers.length && subj.some(x => !x.self && !x.ids?.length)) return out;
    if (onlyRoomWord(roomU) && !(has('be') || has('move') || has('prepIn') || Ps.some(x => x.self))) return out;
    if (subjOthers.length) {
      emit({ kind: 'sighting', about: subjOthers, room: roomU.room, polarity: 0, base: 0.5, conf: subj.some(x => x.k === 'P') && (has('be') || has('move') || has('see') || has('prepIn')) ? 0.85 : 0.6 });
      return out;
    }
    if (onlyRoom) {
      const rq = env.replyQ();
      if (rq?.q === 'where' && rq.body) emit({ kind: 'bodyLocation', about: [], room: roomU.room, polarity: 0, base: 0.6, conf: 0.7, via: 'reply', extraRefs: [rq.line], extraWhy: [`answers "where body" from ${m.players[rq.by]?.name ?? rq.by}`] });
      else if (rq?.q === 'where') emit({ kind: 'location', about: [speaker], room: roomU.room, polarity: 0, base: 0.5, conf: 0.8, via: 'reply', extraRefs: [rq.line], extraWhy: [`answers "${rq.q}" from ${m.players[rq.by]?.name ?? rq.by}`] });
      else emit({ kind: 'location', about: [speaker], room: roomU.room, polarity: 0, base: 0.5, conf: 0.55 });
      return out;
    }
    // "i was in nav" / "went to nav" / "at nav": stated; a room among unknown words ("ask about nav") is weak
    const stated = has('be') || has('move') || has('prepIn') || has('prepFrom') || has('prepTo') || Ps.some(x => x.self);
    emit({ kind: 'location', about: [speaker], room: roomU.room, polarity: 0, base: 0.5, conf: stated ? 0.85 : 0.45 });
    return out;
  }

  // --- bare mention: "White and Black", "its blu" (handled above), "red?" -----------------------
  const bareOnly = freeP.length > 0 && u.every(x => x.k === 'P' || x.k === 'hedge' || x.k === 'intens' || x.k === 'be');
  if (bareOnly && freeOthers.length && !negLeft) {
    const rq = env.replyQ();
    if (cl.social || freeP.every(x => x.ambiguous) || (cl.lineW && !rq)) return out;
    if (rq?.q === 'who' && !rq.withQ) { emit({ kind: 'accuse', about: freeOthers, polarity: 1, reason: 'bare', base: 0.55, conf: 0.7, via: 'reply', extraRefs: [rq.line], extraWhy: [`answers "who" from ${m.players[rq.by]?.name ?? rq.by}`] }); return out; }
    if (rq && (rq.withQ || rq.q === 'where')) { emit({ kind: 'withMe', about: freeOthers, polarity: -1, reason: 'withThem', base: BASE.withMe, conf: 0.5, via: 'reply', bare: true, extraRefs: [rq.line], extraWhy: [`answers "${rq.q}" from ${m.players[rq.by]?.name ?? rq.by}`] }); return out; }
    emit({ kind: 'accuse', about: freeOthers, polarity: 1, reason: 'bare', base: BASE.bare, conf: 0.45, bare: true, extraWhy: ['bare mention: read as an accusation until the speaker says more'] });
    return out;
  }
  return out;
}

function findTaskId(m: MatchState, id: string): string | undefined {
  if (!m.map.tasks?.length) return id;
  return m.map.tasks.find(t => t.id === id)?.id;
}

/** "lights" on its own is the sabotage, not a place. */
function onlyRoomWord(u: Unit): boolean {
  return u.w === 'lights';
}

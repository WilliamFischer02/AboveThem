import { describe, it, expect } from 'vitest';
import type { ChatAssertion, ChatLine, MapData, MatchState, Player, PlayerColor } from '../../types/game';
import { activeAssertions, meetingTranscript, parseLine, parseMeetingChat, stanceLedger, voteCalls } from '.';
import { speakerProfiles } from '../chatProfile';
import { fixture2 } from '../__fixtures__/skeld_match_02_two_imp';
import polus from '../../data/maps/polus.json';
import mira from '../../data/maps/mira.json';

// Fixture 2 (Skeld) plus extra colours so every shorthand has someone to point at.
const extra: PlayerColor[] = ['lime', 'pink', 'brown', 'maroon', 'banana', 'coral', 'rose', 'tan'];
const players: Record<string, Player> = { ...fixture2.players };
for (const c of extra) players[c] = { id: c, name: c[0].toUpperCase() + c.slice(1), color: c, isMe: false, status: 'alive', knownRole: 'unknown' };
const m: MatchState = { ...fixture2, players, chat: [], phase: { ...fixture2.phase, meeting: 1, calledBy: 'white', reason: 'body' } };
const onPolus: MatchState = { ...m, map: polus as unknown as MapData };
const onMira: MatchState = { ...m, map: mira as unknown as MapData };

/** Compact signature: kind:about(+)@room#task */
const sig = (a: ChatAssertion) => `${a.kind}${a.about.length ? ':' + a.about.join('+') : ''}${a.room ? '@' + a.room : ''}${a.taskId ? '#' + a.taskId : ''}`;
const p = (text: string, speaker = 'white', mm: MatchState = m) => parseLine(text, speaker, mm).map(sig);

// [line, speaker, expected signatures]
const CASES: [string, string, string[]][] = [
  ['red sus', 'white', ['accuse:red']],
  ['wht vented', 'blue', ['sawVent:white']],
  ['blk n grn clear, was w them in elec', 'yellow', ['clear:black+green', 'withMe:black+green', 'location:yellow@electrical']],
  ['its blu', 'white', ['accuse:blue']],
  ['self report', 'black', ['selfReport:white']],
  ['where', 'white', ['question']],
  ['skip', 'white', ['skipCall']],
  ['vote red', 'white', ['voteCall:red']],
  ['red followed me', 'white', ['accuse:red']],
  ['i saw lime do wires', 'white', ['sawTask:lime#fixWiring']],
  ['not red, was with him', 'green', ['defense:red', 'withMe:red']],
  ['orng kinda sus ngl', 'white', ['accuse:orange']],
  ['purp where were u', 'white', ['question:purple']],
  ['yellow stack', 'white', ['accuse:yellow']],
  ['idk', 'white', []],
  ['who', 'white', ['question']],
  ['vent', 'white', []],
  ['dont skip', 'white', ['skipCall']],
  ['its not me', 'white', ['defense:white']],
  ['lol', 'white', []],
  ['gg', 'white', []],
  ['?', 'white', []],
  ['??', 'white', []],
  ['gg ez', 'white', []],
  ['puprle is sus', 'white', ['accuse:purple']],
  ['yelow vented in nav', 'white', ['sawVent:yellow@navigation']],
  ['greeen hard clear', 'white', ['clear:green']],
  ['b1ue sus', 'white', ['accuse:blue']],
  ['read the chat', 'white', []],
  ['100% black vented', 'white', ['sawVent:black']],
  ['maybe pink?', 'white', ['accuse:pink']],
  ['i was in admin with brown', 'pink', ['withMe:brown', 'location:pink@admin']],
  ['brown and i were in cafe', 'pink', ['withMe:brown', 'location:pink@cafeteria']],
  ['saw maroon in nav', 'white', ['sighting:maroon@navigation']],
  ['banana was in sec', 'white', ['sighting:banana@security']],
  ['coral killed tan', 'white', ['sawKill:coral']],
  ['i saw red kill orange in elec', 'white', ['sawKill:red@electrical']],
  ['black self reported', 'white', ['selfReport:black']],
  ['green scanned', 'white', ['sawTask:green#submitScan']],
  ['white did asteroids', 'green', ['sawTask:white#clearAsteroids']],
  ['i did wires in elec', 'green', ['task:green@electrical#fixWiring']],
  ['body in reac', 'white', ['bodyLocation@reactor']],
  ['found body in o2', 'white', ['bodyLocation@o2']],
  ['blue is dead', 'white', ['dead:blue']],
  ['im cyan', 'white', ['myColor:white']],
  ['vote blue and black', 'white', ['voteCall:blue+black']],
  ['red or blue', 'white', ['accuse:red+blue']],
  ['its red or blue', 'white', ['accuse:red+blue']],
  ['blue isnt sus', 'white', ['defense:blue']],
  ['i dont think its green', 'white', ['defense:green']],
  ['dont vote me', 'white', ['defense:white']],
  ['trust me im crew', 'white', ['defense:white']],
  ['red was near the body', 'white', ['accuse:red']],
  ['saw yellow run from body', 'white', ['accuse:yellow']],
  ['lime and pink were together', 'white', ['withOther:lime+pink']],
  ['red was with blue', 'white', ['withOther:red+blue']],
  ['where were you red', 'white', ['question:red']],
  ['who reported', 'white', ['question']],
  ['red faked tasks', 'white', ['accuse:red']],
  ['blue lying', 'white', ['accuse:blue']],
  ['i followed red', 'white', []],
  ['i didnt see anyone vent', 'white', []],
  ['red out', 'white', ['voteCall:red']],
  ['was in med', 'white', ['location:white@medbay']],
  ['elec', 'white', ['location:white@electrical']],
  ['RED VENTED', 'white', ['sawVent:red']],
  ['purpleeee is susss', 'white', ['accuse:purple']],
  ['red sus, blue clear', 'white', ['accuse:red', 'clear:blue']],
  ['w red', 'white', ['withMe:red']],
  ['w/ red n blue', 'white', ['withMe:red+blue']],
  ["red's lying", 'white', ['accuse:red']],
  ['wasnt me i was in nav', 'white', ['defense:white', 'location:white@navigation']],
  ['light blue sus', 'white', ['accuse:cyan']],
  ['blue and black sus', 'white', ['accuse:blue+black']],
  // regressions found by probing
  ['ask blue', 'white', []],
  ['green is lying he wasnt in admin', 'white', ['accuse:green']],
  ['skip no proof', 'white', ['skipCall']],
  ['why me', 'white', ['defense:white']],
  ['i didnt kill anyone', 'white', ['defense:white']],
  ['i saw blue go into a vent in nav', 'white', ['sawVent:blue@navigation']],
  ['orange came out of vent in reactor', 'white', ['sawVent:orange@reactor']],
  ['red sus cuz he was near body', 'white', ['accuse:red', 'accuse:red']],
  ['black did it', 'white', ['sawKill:black']],
  ['blue vouch', 'white', ['clear:blue']],
  ['everyone vote black', 'white', ['voteCall:black']],
  ['i sus blue i barely see him', 'white', ['accuse:blue']],
];

describe('chat NLU: single lines', () => {
  it(`has >= 60 realistic fixture lines (${CASES.length})`, () => expect(CASES.length).toBeGreaterThanOrEqual(60));
  for (const [text, speaker, want] of CASES) {
    it(`"${text}" (${speaker})`, () => expect(p(text, speaker)).toEqual(want));
  }

  it('hedges lower strength, intensifiers raise it; fuzzy / OCR readings lower confidence', () => {
    const plain = parseLine('orange sus', 'white', m)[0];
    const hedged = parseLine('orng kinda sus ngl', 'white', m)[0];
    const hard = parseLine('orange 100% sus', 'white', m)[0];
    expect(hedged.strength).toBeLessThan(plain.strength);
    expect(hard.strength).toBeGreaterThan(plain.strength);
    expect(parseLine('puprle is sus', 'white', m)[0].confidence).toBeLessThan(parseLine('purple is sus', 'white', m)[0].confidence);
    expect(parseLine('b1ue sus', 'white', m)[0].confidence).toBeLessThan(0.8);
    expect(parseLine('greeen hard clear', 'white', m)[0].strength).toBeGreaterThan(parseLine('green clear', 'white', m)[0].strength);
    expect(parseLine('RED VENTED', 'white', m)[0].strength).toBe(1);
  });

  it('polarity: accusations +1, clears / defenses / alibis -1, info 0', () => {
    expect(parseLine('red sus', 'white', m)[0].polarity).toBe(1);
    expect(parseLine('blue isnt sus', 'white', m)[0].polarity).toBe(-1);
    expect(parseLine('w red', 'white', m)[0].polarity).toBe(-1);
    expect(parseLine('saw maroon in nav', 'white', m)[0].polarity).toBe(0);
  });

  it('every assertion quotes the words it came from', () => {
    const a = parseLine('lol ok so I saw Purple vent in nav', 'white', m)[0];
    expect(a.kind).toBe('sawVent');
    expect(a.quote).toBe('I saw Purple vent in nav');
    expect(a.text.slice(a.span[0], a.span[1])).toBe(a.quote);
    const c = parseLine('greeen hard clear', 'white', m)[0];
    expect(c.why.some(w => w.includes('hard'))).toBe(true);
  });

  it('dont skip is a negated skip call; bare mention is a low-confidence provisional accusation', () => {
    expect(parseLine('dont skip', 'white', m)[0].negated).toBe(true);
    const bare = parseLine('pink', 'white', m)[0];
    expect(bare).toMatchObject({ kind: 'accuse', reason: 'bare' });
    expect(bare.confidence).toBeLessThan(0.5);
  });

  it('self report with nobody named points at the reporter (implicit)', () => {
    const a = parseLine('self report', 'black', m)[0];
    expect(a).toMatchObject({ kind: 'selfReport', about: ['white'], resolvedVia: 'implicit' });
    expect(parseLine('self', 'white', m)).toEqual([]); // the reporter can't self-accuse
  });

  it('sawKill keeps the victim', () => {
    expect(parseLine('coral killed tan', 'white', m)[0].victim).toBe('tan');
  });
});

describe('chat NLU: player names and OCR noise (roster = snap list)', () => {
  const named: MatchState = {
    ...m,
    players: {
      ...m.players,
      red: { ...m.players.red, name: 'BigBingus', status: 'alive' },
      blue: { ...m.players.blue, name: 'xXSlayerXx' },
      green: { ...m.players.green, name: 'potato' },
    },
  };
  it('exact, OCR-confused, misspelled and prefix name mentions resolve to the roster', () => {
    expect(p('bigbingus sus', 'white', named)).toEqual(['accuse:red']);
    expect(p('b1gbingus vented', 'white', named)).toEqual(['sawVent:red']);
    expect(p('bigbngus clear', 'white', named)).toEqual(['clear:red']);
    expect(p('potat0 was with me', 'white', named)).toEqual(['withMe:green']);
    expect(p('slayer sus', 'white', named)).toEqual(['accuse:blue']);
    expect(parseLine('bigbngus clear', 'white', named)[0].confidence).toBeLessThan(parseLine('bigbingus clear', 'white', named)[0].confidence);
  });
  it('short common words never snap to names or colours', () => {
    expect(p('read it', 'white', named)).toEqual([]);
    expect(p('pot', 'white', named)).toEqual(['accuse:green']); // 3-letter unique prefix of a name: weak bare mention
    expect(parseLine('pot', 'white', named)[0].confidence).toBeLessThan(0.5);
    expect(p('hello fellow', 'white', named)).toEqual([]);
    expect(p('we range far', 'white', named)).toEqual([]);
  });
});

describe('chat NLU: untranslated non-English lines (colours, sus/vent, not-me)', () => {
  it('reads the common words even when translation did not run', () => {
    expect(p('rojo sus', 'white')).toEqual(['accuse:red']);
    expect(p('azul ventou', 'white')).toEqual(['sawVent:blue']);
    expect(p('красный вентанул', 'white')).toEqual(['sawVent:red']);
    expect(p('не я', 'white')).toEqual(['defense:white']);
    expect(p('não fui eu', 'white')).toEqual(['defense:white']);
    expect(p('verde conmigo', 'white')).toEqual(['withMe:green']);
    expect(p('kkkk', 'white')).toEqual([]);
    expect(p('wya purple', 'white')).toEqual(['question:purple']);
  });
  it('"com" still means comms, not "with"', () => {
    expect(p('i was in com', 'white')).toEqual(['location:white@communications']);
  });
});

describe('chat NLU: other maps', () => {
  it('Polus rooms', () => {
    expect(p('i was in specimen', 'white', onPolus)).toEqual(['location:white@specimen']);
    expect(p('red vented in lab', 'white', onPolus)).toEqual(['sawVent:red@laboratory']);
    expect(p('boiler', 'white', onPolus)).toEqual(['location:white@boilerRoom']);
    expect(p('saw blue in decon', 'white', onPolus)).toEqual(['sighting:blue@upperDecon']);
    expect(p('i was at drop', 'white', onPolus)).toEqual(['location:white@dropship']);
  });
  it('Mira (stub map: lexicon ids) — "green house" is a room, not the green player', () => {
    expect(p('i was in launchpad', 'white', onMira)).toEqual(['location:white@launchpad']);
    expect(p('saw blue in green house', 'white', onMira)).toEqual(['sighting:blue@greenhouse']);
    expect(p('red in balc', 'white', onMira)).toEqual(['sighting:red@balcony']);
    expect(p('lockers', 'white', onMira)).toEqual(['location:white@lockerRoom']);
  });
  it('Skeld-only aliases do not leak: "specimen" means nothing on Skeld', () => {
    expect(p('i was in specimen', 'white', m)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Conversation context
// ---------------------------------------------------------------------------

let seq = 0;
const line = (sender: string, original: string, extra: Partial<ChatLine> = {}): ChatLine =>
  ({ id: `L${++seq}`, meeting: 1, stamp: { round: 1, t: 50 + seq, wall: seq }, sender, original, source: 'ocr', ...extra });
const withChat = (...chat: ChatLine[]): MatchState => ({ ...m, chat });
const meet = (...chat: ChatLine[]) => parseMeetingChat(withChat(...chat), 1);
const sigs = (list: ChatAssertion[]) => list.map(a => `${a.speaker}>${sig(a)}`);

describe('chat NLU: conversation context', () => {
  it('"White and Black" followed by "saw them do wires" is a clear, not an accusation', () => {
    const l1 = line('green', 'White and Black'); const l2 = line('green', 'saw them do wires');
    const out = meet(l1, l2);
    expect(sigs(out)).toEqual(['green>sawTask:white+black#fixWiring']);
    expect(out[0].refs).toEqual([l2.id, l1.id]);
    expect(out[0].polarity).toBe(-1);
  });

  it('"White and Black" followed by "clear, was with them"', () => {
    const out = meet(line('green', 'white n black'), line('green', 'clear, was with them'));
    expect(sigs(out)).toEqual(['green>clear:white+black', 'green>withMe:white+black']);
  });

  it('preceded: "i saw them do wires" then "white and black"', () => {
    const out = meet(line('green', 'i saw them do wires'), line('green', 'white and black'));
    expect(sigs(out)).toEqual(['green>sawTask:white+black#fixWiring']);
    expect(out[0].resolvedVia).toBe('context');
  });

  it('a bare mention with no context stays a weak accusation', () => {
    const out = meet(line('green', 'white and black'));
    expect(sigs(out)).toEqual(['green>accuse:white+black']);
    expect(out[0].confidence).toBeLessThan(0.5);
  });

  it('another speaker\'s line does not absorb my bare mention', () => {
    const out = meet(line('green', 'white'), line('blue', 'they were with me'));
    expect(sigs(out)).toEqual(['green>accuse:white', 'blue>withMe:white']);
  });

  it('reply to "who" = accusation; reply to "where" = location', () => {
    const who = meet(line('blue', 'who'), line('yellow', 'red'));
    expect(sigs(who)).toEqual(['blue>question', 'yellow>accuse:red']);
    expect(who[1].resolvedVia).toBe('reply');
    expect(who[1].confidence).toBeGreaterThanOrEqual(0.5);
    const where = meet(line('blue', 'where was everyone'), line('yellow', 'elec'), line('green', 'admin'));
    expect(sigs(where)).toEqual(['blue>question', 'yellow>location:yellow@electrical', 'green>location:green@admin']);
    expect(where[1].confidence).toBeGreaterThan(0.7);
  });

  it('missing subject: "red" then "vent" from the same speaker', () => {
    const out = meet(line('green', 'red'), line('green', 'vent'));
    expect(sigs(out)).toEqual(['green>sawVent:red']);
  });

  it('pronoun from the replied line; "u" = previous speaker', () => {
    expect(sigs(meet(line('blue', 'red vented'), line('yellow', 'he was with me')))).toEqual(['blue>sawVent:red', 'yellow>withMe:red']);
    expect(sigs(meet(line('blue', 'red vented'), line('red', 'u vented')))).toEqual(['blue>sawVent:red', 'red>sawVent:blue']);
  });

  it('"cap" accuses the previous speaker of lying', () => {
    expect(sigs(meet(line('blue', 'i was in admin'), line('yellow', 'cap')))).toEqual(['blue>location:blue@admin', 'yellow>accuse:blue']);
  });

  it('"same" repeats the previous speaker\'s stance weakly', () => {
    const out = meet(line('blue', 'red vented'), line('yellow', 'same'));
    expect(sigs(out)).toEqual(['blue>sawVent:red', 'yellow>sawVent:red']);
    expect(out[1].confidence).toBeLessThanOrEqual(0.5);
  });

  it('a later reversal supersedes the earlier stance', () => {
    const out = meet(line('green', 'red sus'), line('blue', 'skip'), line('green', 'nvm red clear, was with me'));
    expect(out[0].supersededBy).toBe(out.find(a => a.kind === 'clear')!.id);
    expect(activeAssertions(out).map(a => a.kind)).not.toContain('accuse');
  });

  it('vocative name before a question is not an accusation', () => {
    expect(sigs(meet(line('green', 'white, where were u')))).toEqual(['green>question:white']);
  });

  it('parses the translation when present', () => {
    const out = meet(line('blue', 'rojo es sus', { translated: 'red is sus', lang: 'es' }));
    expect(sigs(out)).toEqual(['blue>accuse:red']);
    expect(out[0].text).toBe('red is sus');
  });

  it('unreadable lines yield nothing; a guessed-language translation lowers confidence', () => {
    const bad = { ...line('blue', 'xq#red sus'), unreadable: true } as ChatLine;
    expect(meet(bad)).toEqual([]);
    const sure = meet(line('blue', 'rojo sus', { translated: 'red sus' }))[0];
    const guess = meet({ ...line('blue', 'rojo sus', { translated: 'red sus' }), xlatGuess: true } as ChatLine)[0];
    expect(guess.confidence).toBeLessThan(sure.confidence);
    expect(guess.why.join(' ')).toContain('guessed');
  });

  it('a realistic meeting reads end to end', () => {
    const ls = ([
      ['blue', 'where was everyone'], ['yellow', 'reac'], ['yellow', 'w purple'], ['purple', 'yeah with yellow'], ['green', 'black'],
      ['green', 'he vented'], ['black', 'what'], ['black', 'i was in elec'], ['black', 'doing wires'], ['green', 'liar'],
      ['white', 'black u sure?'], ['blue', 'white where were u'], ['white', 'cafe'], ['white', 'with nobody'], ['blue', 'sus'],
      ['green', 'trust me black vented'], ['black', 'green is the imp, self report'], ['purple', 'blue and i did wires'], ['blue', 'ya i was w white'],
    ] as [string, string][]).map(([s, t]) => line(s, t));
    const out = meet(...ls);
    const at = (i: number) => out.filter(a => a.line === ls[i].id).map(sig);
    expect(at(1)).toEqual(['location:yellow@reactor']);
    expect(at(2)).toEqual(['withMe:purple']);
    expect(at(4)).toEqual([]);                       // bare "black" absorbed by "he vented"
    expect(at(5)).toEqual(['sawVent:black']);
    expect(at(6)).toEqual(['question']);
    expect(at(8)).toEqual(['task:black#fixWiring']);
    expect(at(9)).toEqual(['accuse:black']);         // "liar" → previous speaker
    expect(at(10)).toEqual(['question:black']);      // "u sure?" is a challenge, not an accusation
    expect(at(12)).toEqual(['location:white@cafeteria']);
    expect(at(14)).toEqual(['accuse:white']);        // lone "sus" right after white's alibi
    expect(at(16)).toEqual(['accuse:green', 'selfReport:green']);
    expect(at(17)).toEqual(['sawTask:blue#fixWiring', 'task:purple#fixWiring', 'withMe:blue']);
    expect(at(18)).toEqual(['withMe:white']);        // "ya" = yeah, not "you"
  });

  it('lines from other meetings are not mixed in', () => {
    const mm = withChat(line('green', 'white'), { ...line('green', 'saw them do wires'), meeting: 2 });
    expect(sigs(parseMeetingChat(mm, 1))).toEqual(['green>accuse:white']);
  });
});

describe('chat NLU: aggregates', () => {
  const chat = [
    line('green', 'vote red'), line('blue', 'red sus'), line('yellow', 'yeah vote red'), line('black', 'red out'),
    line('red', 'its not me, i was in elec'), line('red', 'i was in nav'), line('white', 'red clear'), line('white', 'nah red sus'),
  ];
  const mm = withChat(...chat);

  it('voteCalls: band-wagon on red, in join order', () => {
    const v = voteCalls(mm, 1)[0];
    expect(v.target).toBe('red');
    expect(v.callers).toEqual(['green', 'blue', 'yellow', 'black', 'white']);
    expect(v.firstCaller).toBe('green');
    expect(v.voteCallers).toEqual(['green', 'yellow', 'black']);
    expect(v.bandwagon).toBe(true);
    expect(v.lateJoiners).toEqual(['yellow', 'black', 'white']);
  });

  it('stanceLedger: latest word counts after a flip', () => {
    const s = stanceLedger(mm, 1);
    expect(s.green.red.score).toBeGreaterThan(0);
    expect(s.white.red.score).toBeGreaterThan(0);
    expect(s.white.red.n).toBe(2);
  });

  it('speakerProfiles: accusations, accusedBy, first/bandwagon, flips, location changes', () => {
    const pr = speakerProfiles(mm);
    expect(pr.green).toMatchObject({ accusations: 1, accused: ['red'], firstAccusations: 1, bandwagons: 0, voteCalls: 1 });
    expect(pr.black.bandwagons).toBe(1);
    expect(pr.red.accusedBy.sort()).toEqual(['black', 'blue', 'green', 'white', 'yellow']);
    expect(pr.red.selfDefenses).toBe(1);
    expect(pr.red.locationChanges).toEqual([{ meeting: 1, rooms: ['electrical', 'navigation'], assertions: expect.any(Array) }]);
    expect(pr.red.consistency).toBeLessThan(1);
    expect(pr.white.flips).toHaveLength(1);
    expect(pr.white.flips[0]).toMatchObject({ target: 'red', from: -1, to: 1, sameMeeting: true });
    expect(pr.white.clearedBy).toEqual([]);
    expect(pr.green.consistency).toBe(1);
  });

  it('meetingTranscript groups consecutive lines per speaker with badges', () => {
    const t = meetingTranscript(mm, 1);
    const red = t.find(b => b.speaker === 'red')!;
    expect(red.lines).toHaveLength(2);
    expect(red.lines[0].badges.map(b => b.label)).toEqual(['not self', 'at Electrical']);
    expect(t[0].lines[0].badges[0]).toMatchObject({ kind: 'voteCall', tone: 'sus', label: 'vote Red' });
    const white = t.find(b => b.speaker === 'white')!;
    expect(white.lines[0].badges[0].superseded).toBe(true);
  });

  it('noise lines show up in the transcript flagged as noise', () => {
    const t = meetingTranscript(withChat(line('blue', 'lol'), line('blue', 'gg')), 1);
    expect(t[0].lines.every(l => l.noise)).toBe(true);
  });
});

/**
 * Chat → claims (pure, testable). Among Us chat is short and formulaic:
 *   "i was in elec"                  → location claim by the sender
 *   "with red the whole time"        → companion claim (red = the red player)
 *   "red and blue were together"     → companion claim between two others (as reported by the sender)
 *   "blue is sus" / "vote blue"      → accusation; "blue vented/killed/self reported" → accusation with a reason
 *   "green is clear" / "saw green scan" → clear claim
 *   "red was in nav" / "saw red in nav" → sighting claim (sender saw red in Navigation)
 *   "i did wires in elec"            → task claim (checked against the map and my own task list)
 *   "body in elec" / "found body in storage" → body location (becomes an observation)
 *   "not blue" / "blue is not sus" / "blue is fine" → defense
 * Players are referred to by colour far more often than by name, so colour words
 * resolve to the player wearing that colour. Matched spans are consumed so a sentence
 * is interpreted once ("white was in admin" is a sighting, not the sender's location).
 */
import type { Claim, ClaimType, MatchState, PlayerId, RoomId } from '../types/game';

const ROOM_ALIASES: Record<string, string[]> = {
  electrical: ['elec', 'electric', 'electrical', 'lights', 'elect'],
  cafeteria: ['cafe', 'caf', 'cafeteria', 'cafet'],
  navigation: ['nav', 'navi', 'navigation'],
  medbay: ['med', 'medbay', 'medical', 'scan room'],
  security: ['sec', 'security', 'cams', 'cameras', 'cam'],
  communications: ['comms', 'coms', 'communications', 'com', 'comm'],
  o2: ['o2', 'oxygen', '02', 'o 2', 'oz'],
  storage: ['storage', 'store'],
  shields: ['shields', 'shield'],
  weapons: ['weapons', 'weps', 'weapon'],
  admin: ['admin'],
  reactor: ['reactor', 'react'],
  upperEngine: ['upper', 'upper engine', 'up eng', 'ue', 'top engine'],
  lowerEngine: ['lower', 'lower engine', 'low eng', 'le', 'bottom engine'],
  laboratory: ['lab', 'laboratory'],
  specimen: ['specimen', 'spec', 'specimens'],
  office: ['office'],
  dropship: ['dropship', 'ship', 'drop'],
  boilerRoom: ['boiler', 'boiler room'],
  lava: ['lava'],
  outsideLeft: ['outside', 'left outside', 'left'],
  outsideRight: ['right outside', 'right'],
  upperDecon: ['decon', 'upper decon'],
  lowerDecon: ['lower decon'],
};

const TASK_ALIASES: Record<string, string[]> = {
  fixWiring: ['wires', 'wire', 'wiring'],
  swipeCard: ['card', 'swipe', 'card swipe'],
  downloadUpload: ['download', 'upload', 'data'],
  submitScan: ['scan', 'medscan', 'med scan'],
  clearAsteroids: ['asteroids', 'asteroid'],
  primeShields: ['shields', 'prime'],
  emptyGarbage: ['garbage', 'trash'],
  emptyChute: ['chute'],
  fuelEngines: ['fuel', 'gas'],
  alignEngine: ['align', 'engines'],
  startReactor: ['reactor', 'simon', 'simon says'],
  unlockManifolds: ['manifolds', 'manifold', 'numbers'],
  inspectSample: ['sample', 'samples'],
  divertPower: ['divert', 'power', 'divert power'],
  chartCourse: ['chart', 'course'],
  stabilizeSteering: ['steering', 'stabilize'],
  cleanO2Filter: ['filter', 'leaves', 'o2 filter'],
  calibrateDistributor: ['distributor', 'calibrate'],
  cleanVent: ['clean vent'],
  insertKeys: ['keys', 'key'],
  scanBoardingPass: ['boarding pass', 'boarding'],
  rebootWifi: ['wifi', 'reboot'],
  recordTemperature: ['temperature', 'temp'],
  fixWeatherNode: ['weather', 'node'],
  openWaterways: ['waterways', 'valves', 'water'],
  replaceWaterJug: ['water jug', 'jug'],
  monitorTree: ['tree'],
  fillCanisters: ['canisters', 'canister'],
  storeArtifacts: ['artifacts', 'artifact'],
  repairDrill: ['drill'],
  alignTelescope: ['telescope'],
};

const COLOR_WORDS = ['red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black', 'white', 'purple', 'brown', 'cyan', 'lime', 'maroon', 'rose', 'banana', 'gray', 'grey', 'tan', 'coral'];

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
/** "limeeee" → "lime", "reddd" → "red": collapse letters repeated 3+ times. */
const squash = (w: string) => w.replace(/(.)\1{2,}/g, '$1');

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    let diag = prev[0]; prev[0] = i + 1;
    for (let j = 0; j < b.length; j++) { const tmp = prev[j + 1]; prev[j + 1] = Math.min(prev[j + 1] + 1, prev[j] + 1, diag + (a[i] === b[j] ? 0 : 1)); diag = tmp; }
  }
  return prev[b.length];
}

export type ParsedKind = ClaimType | 'body';
export interface ParsedClaim { type: ParsedKind; room?: RoomId; about?: PlayerId; about2?: PlayerId; taskId?: string; reason?: string }

/** Resolve a word (colour or name fragment) to a player. */
export function resolvePlayer(word: string, m: MatchState, exclude?: PlayerId): PlayerId | undefined {
  const w = norm(word);
  if (!w || w === 'me' || w === 'i' || w === 'you' || w === 'u') return undefined;
  const players = Object.values(m.players).filter(p => p.id !== exclude);
  const cw = squash(w === 'grey' ? 'gray' : w);
  if (COLOR_WORDS.includes(cw)) return players.find(p => p.color === cw)?.id;
  if (cw === 'purp') return players.find(p => p.color === 'purple')?.id;
  if (cw === 'yel' || cw === 'yellw') return players.find(p => p.color === 'yellow')?.id;
  if (cw === 'blu') return players.find(p => p.color === 'blue')?.id;
  if (cw === 'org' || cw === 'orng') return players.find(p => p.color === 'orange')?.id;
  let best: { id: PlayerId; score: number } | null = null;
  for (const p of players) {
    const n = norm(p.name);
    if (!n) continue;
    const score = n === w ? 1 : n.startsWith(w) && w.length >= 3 ? 0.85 : 1 - levenshtein(w, n) / Math.max(w.length, n.length);
    if (!best || score > best.score) best = { id: p.id, score };
  }
  return best && best.score >= 0.7 ? best.id : undefined;
}

/** The captured phrase may be "blue is" or "saw purple": try the words from the end. */
function resolveAny(phrase: string, m: MatchState, exclude?: PlayerId): PlayerId | undefined {
  const words = phrase.trim().split(' ').filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) { const p = resolvePlayer(words[i], m, exclude); if (p) return p; }
  return undefined;
}

export function resolveRoom(phrase: string, m: MatchState): RoomId | undefined {
  const p = norm(phrase);
  if (!p) return undefined;
  for (const r of m.map.rooms) {
    const aliases = [norm(r.name), ...(ROOM_ALIASES[r.id] ?? [])].sort((a, b) => b.length - a.length);
    for (const a of aliases) if (p === a || p.startsWith(a + ' ') || p.split(' ')[0] === a) return r.id;
  }
  const first = p.split(' ')[0];
  let best: { id: RoomId; score: number } | null = null;
  for (const r of m.map.rooms) {
    const n = norm(r.name);
    const score = 1 - levenshtein(first, n) / Math.max(first.length, n.length);
    if (!best || score > best.score) best = { id: r.id, score };
  }
  return best && best.score >= 0.75 ? best.id : undefined;
}

export function resolveTask(phrase: string, m: MatchState): string | undefined {
  const p = norm(phrase);
  if (!p) return undefined;
  for (const t of m.map.tasks) {
    const aliases = [norm(t.name), ...(TASK_ALIASES[t.id] ?? [])].sort((a, b) => b.length - a.length);
    for (const a of aliases) if (p === a || p.startsWith(a + ' ') || p.split(' ')[0] === a || p.includes(' ' + a)) return t.id;
  }
  return undefined;
}

const P = '([a-z0-9_]+(?: [a-z0-9_]+)?)';
const ROOM = '([a-z0-9 ]{2,20})';

export function parseChatClaims(text: string, sender: PlayerId, m: MatchState): ParsedClaim[] {
  let t = ' ' + norm(text) + ' ';
  const out: ParsedClaim[] = [];
  const add = (c: ParsedClaim) => { if (!out.some(o => o.type === c.type && o.room === c.room && o.about === c.about && o.taskId === c.taskId)) out.push(c); };
  // Run a pattern, call `f` on each match, and blank the matched span so later patterns don't reuse it.
  const run = (re: RegExp, f: (mm: RegExpMatchArray) => boolean) => {
    for (const mm of [...t.matchAll(re)]) {
      if (f(mm) && mm.index !== undefined) t = t.slice(0, mm.index) + ' '.repeat(mm[0].length) + t.slice(mm.index + mm[0].length);
    }
  };

  // 0. Questions are not claims.
  if (/\b(where|who|why|what|anyone|any1|did anyone)\b/.test(t) && !/\b(i was|im |i m |i am|with|sus|vent|kill|clear|safe|body)\b/.test(t)) return out;

  // 1. Body location: "body in elec", "found/reported (the) body in storage", "dead body (in|at) X".
  run(new RegExp(`\\b(?:found |reported |saw |the )?(?:dead )?body (?:was |is )?(?:in|at|near) ${ROOM}`, 'g'), mm => {
    const room = resolveRoom(mm[1], m); if (room) { add({ type: 'body', room }); return true; } return false;
  });

  // 2. Reasons that name a victim: "X killed Y", "X did it".
  run(new RegExp(`\\b${P} (?:killed|murdered) ${P}\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); const victim = resolveAny(mm[2], m);
    if (about) { add({ type: 'accusation', about, about2: victim, reason: 'kill' }); return true; } return false;
  });

  // 2b. Near the body: "saw X (walk|run|come) (away )?from (the )?body", "X was (near|next to|by|with) (the )?body", "X ran from body".
  run(new RegExp(`\\b(?:i )?(?:saw|seen) ${P} (?:walk|walking|run|running|come|coming|leave|leaving|go|going)(?: away| out| straight)? from (?:the )?body`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'accusation', about, reason: 'left body' }); return true; } return false;
  });
  run(new RegExp(`\\b${P} (?:was |is )?(?:around|near|next to|by|with|on|over|standing on|at|close to) (?:where )?(?:the )?body`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'accusation', about, reason: 'near body' }); return true; } return false;
  });

  // 3. Defenses / negations: "not blue", "blue is not sus", "blue is fine/innocent", "wasnt blue", "its not blue".
  run(new RegExp(`\\b(?:its |it s |it is )?(?:not|wasnt|wasn t|isnt|isn t) ${P}\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'defense', about }); return true; } return false;
  });
  run(new RegExp(`\\b${P} (?:is |was )?(?:not sus|not the imp|not impostor|not imp|fine|innocent|not it)\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'defense', about }); return true; } return false;
  });

  // 4. Clears: "X is clear/safe/scanned", "saw X scan/do task/do visual", "X did asteroids", "X was with me the whole time".
  run(new RegExp(`\\b${P} (?:is |was )?(?:clear|safe|cleared|scanned|hard clear|hard cleared|did (?:a )?visual|did visual|100 clear)\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'clear', about }); return true; } return false;
  });
  run(new RegExp(`\\b(?:i )?(?:saw|watched|seen) ${P} (?:scan|do |did |doing |finish|complete|shoot|clear)`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'clear', about }); return true; } return false;
  });

  // 5. Accusations: "X vented / killed / faked / self reported / is sus / imp / lying", "vote X", "its X", "X 100", "X sus".
  run(new RegExp(`\\b${P} (?:is |was |100 |definitely |def |prob |probably )?(sus|the imp|the impostor|imp|impostor|imposter|vented|vent|killed|kill|faked|faking|fake tasking|self report|self reported|lying|lied|is lying|followed me|following me|chased me|100)\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); const verb = mm[2];
    if (!about) return false;
    add({ type: 'accusation', about, reason: /vent|kill|fake|self|follow|chas|lying|lied/.test(verb) ? verb : undefined }); return true;
  });
  run(new RegExp(`\\b(?:i )?(?:dont|don t|do not) think (?:its |it s )?${P}\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'defense', about }); return true; } return false;
  });
  run(new RegExp(`\\b(?:vote|voting|vote out|eject|its|it s|it is|kick|im voting|i m voting) ${P}\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'accusation', about }); return true; } return false;
  });
  run(new RegExp(`\\b(?:i )?(?:saw|seen|watched) ${P} (?:vent|venting|kill|killing|fake|faking)`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'accusation', about, reason: 'vent' }); return true; } return false;
  });

  // 6. Sightings about others: "X was/is in Y", "saw X in Y", "X went to Y", "X came from Y".
  run(new RegExp(`\\b(?:i )?(?:saw|seen) ${P} (?:in|at|near|by) ${ROOM}`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); const room = resolveRoom(mm[2], m);
    if (about && room) { add({ type: 'sighting', about, room }); return true; } return false;
  });
  run(new RegExp(`\\b${P} (?:was|is|went|came|were|ran|walked) (?:in|at|to|from|into|near|by) ${ROOM}`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); const room = resolveRoom(mm[2], m);
    if (about && room) { add({ type: 'sighting', about, room }); return true; } return false;
  });

  // 7. Companions between others: "X and Y were together", "X was with Y", "X with Y".
  run(new RegExp(`\\b${P} (?:and|n|&) ${P} (?:were|was|are) (?:together|with each other)`, 'g'), mm => {
    const a = resolveAny(mm[1], m); const b = resolveAny(mm[2], m);
    if (a && b && a !== b) { add({ type: 'companion', about: a, about2: b }); return true; } return false;
  });
  run(new RegExp(`\\b${P} (?:was|is|were) with ${P}\\b`, 'g'), mm => {
    const a = resolveAny(mm[1], m); const b = resolveAny(mm[2], m);
    if (a && b && a !== b) { add({ type: 'companion', about: a, about2: b }); return true; }
    return false;
  });

  // 8. My task: "i did wires in elec", "did my card", "doing download in weapons".
  run(new RegExp(`\\b(?:i )?(?:did|doing|was doing|finished|done|completed) (?:my |the )?([a-z0-9 ]{3,24}?)(?: (?:in|at) ${ROOM})?(?=\\s*$|\\s(?:and|then|with|so|but|lol|$))`, 'g'), mm => {
    const taskId = resolveTask(mm[1], m); const room = mm[2] ? resolveRoom(mm[2], m) : undefined;
    if (taskId) { add({ type: 'task', taskId, room }); return true; } return false;
  });

  // 9. My companions: "with X", "X was with me", "me and X".
  run(new RegExp(`\\b${P} (?:was|is|were) with me\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'companion', about }); return true; } return false;
  });
  run(new RegExp(`\\b(?:with|me and|me n) ${P}\\b`, 'g'), mm => {
    const about = resolveAny(mm[1], m, sender); if (about) { add({ type: 'companion', about }); return true; } return false;
  });

  // 10. My location (subject must be me): "i was in X", "im in X", "i went to X", "was in X" at sentence start, "in X the whole time".
  run(new RegExp(`(?:^|\\s)(?:i was heading to|i was going to|heading to|going to|on my way to|headed to|i was walking to) ${ROOM}`, 'g'), mm => {
    const room = resolveRoom(mm[1], m); if (room) { add({ type: 'location', room }); return true; } return false;
  });
  run(new RegExp(`(?:^|\\s)(?:i was coming out from|i was coming from|i came from|coming from|came from|i just left|i left|leaving) ${ROOM}`, 'g'), mm => {
    const room = resolveRoom(mm[1], m); if (room) { add({ type: 'location', room }); return true; } return false;
  });
  run(new RegExp(`(?:^|\\s)(?:i was|i m|im|i am|i went|i have been|ive been|i stayed|was|went|been|i) (?:in|at|to|near|by) ${ROOM}`, 'g'), mm => {
    const room = resolveRoom(mm[1], m); if (room) { add({ type: 'location', room }); return true; } return false;
  });
  run(new RegExp(`\\b(?:in|at) ${ROOM} (?:the whole time|whole time|all round|all game|entire time)`, 'g'), mm => {
    const room = resolveRoom(mm[1], m); if (room) { add({ type: 'location', room }); return true; } return false;
  });
  return out;
}

/** Turn parsed claims into Claim records (body locations are observations, handled by the caller). */
export function toClaims(parsed: ParsedClaim[], base: Omit<Claim, 'type' | 'room' | 'about' | 'text' | 'id'>, text: string, idGen: () => string): Claim[] {
  return parsed.filter(p => p.type !== 'body').map(p => ({
    ...base, id: idGen(), type: p.type as ClaimType, room: p.room, about: p.about, taskId: p.taskId,
    text: p.reason ? `${text} [${p.reason}]` : p.about2 ? `${text} [+${p.about2}]` : undefined, verification: 'pending',
  }));
}

/** Who is being pushed this meeting, by whom. */
export function pushTally(m: MatchState, meeting: number): { target: PlayerId; accusers: PlayerId[]; defenders: PlayerId[] }[] {
  const map = new Map<PlayerId, { accusers: Set<PlayerId>; defenders: Set<PlayerId> }>();
  for (const c of m.claims) {
    if (c.meeting !== meeting || !c.about) continue;
    const e = map.get(c.about) ?? { accusers: new Set(), defenders: new Set() };
    if (c.type === 'accusation') e.accusers.add(c.by);
    if (c.type === 'defense' || c.type === 'clear') e.defenders.add(c.by);
    map.set(c.about, e);
  }
  return [...map.entries()].map(([target, e]) => ({ target, accusers: [...e.accusers], defenders: [...e.defenders] }))
    .filter(x => x.accusers.length + x.defenders.length > 0)
    .sort((a, b) => b.accusers.length - a.accusers.length);
}

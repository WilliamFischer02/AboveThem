/** No unfilled "{X}" may ever reach the impostor panel (bugs-rust): every impostor.json line, every var subset. */
import { describe, expect, it } from 'vitest';
import impostorJson from '../data/tactics/impostor.json';
import type { MatchState, Player } from '../types/game';
import { renderLines, renderLine, impostorAdvice, GENERIC_DEFENSE, type Vars } from './impostor';
import { fixture } from './__fixtures__/skeld_match_01';

const FULL: Vars = { R: 'Admin', W: 'Red', A: 'Blue', K: 'Electrical', T: '0:42', TASK: 'Swipe Card', X: 'Green', Y: 'Pink', Z: 'Lime', R2: 'Cafeteria', P: 'Yellow', P2: 'Black', K2: 'Storage', V: 'White', TASK2: 'Fix Wiring' };
const keys = Object.keys(FULL);
/** Every template string in the file, wherever it sits (accusations + deception + universal). */
function allStrings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) x.forEach(y => allStrings(y, out));
  else if (x && typeof x === 'object') Object.entries(x).forEach(([k, y]) => { if (k !== '_doc') allStrings(y, out); });
  return out;
}

describe('impostor.json templates render without placeholders', () => {
  const lines = allStrings(impostorJson);
  it('the file has templates with placeholders (the test is not vacuous)', () => {
    expect(lines.some(l => /\{\w+\}/.test(l))).toBe(true);
  });
  it('no var set — empty, each single var missing, full — leaves a "{" in rendered output', () => {
    const sets: Vars[] = [{}, FULL, ...keys.map(k => { const v = { ...FULL }; delete v[k]; return v; }), { R: 'Admin' }, { A: 'Blue' }, { R: '', A: 'Blue' }];
    for (const v of sets) {
      for (const out of renderLines(lines, v)) expect(out, JSON.stringify(v)).not.toMatch(/[{}]/);
      for (const l of lines) { const one = renderLine(l, v); if (one !== null) expect(one).not.toMatch(/[{}]/); }
    }
    // with every var known, every line renders
    expect(renderLines(lines, FULL)).toHaveLength(lines.length);
  });
  it('impostorAdvice over accusations of every kind keeps the output placeholder-free', () => {
    const ids = ['me', 'red', 'blue', 'green', 'pink'];
    const players: Record<string, Player> = {};
    for (const id of ids) players[id] = { id, name: id, color: id === 'me' ? 'cyan' : (id as Player['color']), isMe: id === 'me', status: 'alive', knownRole: 'unknown', ...(id === 'pink' ? { isPartner: true } : {}) };
    const texts = ['you self reported', 'you left the body', 'i saw you vent', 'you were faking', 'you were alone', 'you didnt vote with us', 'where were you', 'sus'];
    const m: MatchState = {
      ...fixture, me: 'me', myRole: 'impostor', players, phase: { phase: 'meetingDiscussion', wall: 0, round: 0, meeting: 0 },
      observations: [], chat: [], votes: [], ejections: [], ledger: [],
      claims: [
        ...texts.map((text, i) => ({ id: `c${i}`, meeting: 0, stamp: { round: 0, t: 0, wall: 0 }, by: 'blue', type: 'accusation' as const, about: 'me', text })),
        { id: 'p', meeting: 0, stamp: { round: 0, t: 0, wall: 0 }, by: 'red', type: 'accusation' as const, about: 'pink', text: 'pink sus' },
      ],
    };
    const adv = impostorAdvice(m, [], 0);
    expect(JSON.stringify({ d: adv.defenses, w: adv.partnerWarning, r: adv.rules, a: adv.alibis, p: adv.push })).not.toMatch(/\{[A-Z0-9]+\}/);
    for (const d of adv.defenses) expect(d.lines.length).toBeGreaterThan(0);
    expect(GENERIC_DEFENSE.join(' ')).not.toMatch(/[{}]/);
  });
});

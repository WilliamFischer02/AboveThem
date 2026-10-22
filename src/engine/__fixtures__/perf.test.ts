import { it, expect } from 'vitest';
import { scoreAll } from '../suspicion';
import { Sim } from './sim';

it('perf: 15 players, 8 meetings, ~400 events', () => {
  const colors = ['cyan', 'red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black', 'white', 'purple', 'brown', 'lime', 'maroon', 'rose', 'tan'];
  const rooms = ['cafeteria', 'weapons', 'o2', 'navigation', 'shields', 'communications', 'storage', 'admin', 'electrical', 'lowerEngine', 'upperEngine', 'security', 'reactor', 'medbay'];
  const s = new Sim('P', colors, 'cyan', { impostorCount: 3 });
  for (let r = 0; r < 8; r++) {
    s.round(r);
    for (let i = 0; i < 30; i++) s.see(5 + i * 2, colors[1 + ((i * 7 + r) % 14)], rooms[(i * 3 + r) % 14], i % 3 ? {} : { with: [colors[1 + ((i + 5) % 14)]] });
    s.body(70, colors[2 + r], rooms[r], colors[3 + r]);
    for (let i = 0; i < 12; i++) s.claim(r, colors[1 + ((i + r) % 14)], i % 3 === 0 ? 'accusation' : i % 3 === 1 ? 'location' : 'companion', { about: colors[1 + ((i * 5 + r) % 14)], room: rooms[i % 14] });
    for (let i = 0; i < 8; i++) s.say(r, colors[1 + ((i + r) % 14)], 'blah');
    const ballots: Record<string, string> = {};
    for (let i = 1; i < 15; i++) ballots[colors[i]] = i % 4 === 0 ? 'skip' : colors[1 + ((i * 3 + r) % 14)];
    s.vote(r, ballots).eject(r, null, null);
  }
  const m = s.build({ meeting: 8, round: 8 });
  const t0 = performance.now();
  const scores = scoreAll(m);
  const ms = performance.now() - t0;
  // Next state change: one more sighting in the current round — past snapshots come from the cache.
  const m2 = { ...m, observations: [...m.observations, { ...m.observations[m.observations.length - 1], id: 'new1', stamp: { round: 8, t: 3, wall: 1 } }] };
  const t1 = performance.now();
  const again = scoreAll(m2);
  const warm = performance.now() - t1;
  console.log(`scoreAll: cold ${ms.toFixed(1)} ms, warm ${warm.toFixed(1)} ms for ${m.observations.length} obs, ${m.claims.length} claims, ${m.votes.length} votes`);
  expect(scores.length).toBeGreaterThan(0);
  expect(again.map(s => s.trend!.length)).toEqual(scores.map(s => s.trend!.length));
  expect(ms).toBeLessThan(1000);
  expect(warm).toBeLessThan(ms);
});

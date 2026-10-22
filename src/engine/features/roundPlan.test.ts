import { describe, it, expect } from 'vitest';
import { roundPlan, startRoom } from './roundPlan';
import { build, o } from './__fixtures__/build';
import { MAPS } from '../../data/maps';

describe('round plan', () => {
  it('starts in the meeting room and puts reachable dead-end tasks inside the safe window', () => {
    const m = build({ settings: { killCooldownSec: 45 } });
    m.myTasks = [
      { id: 'swipeCard', name: 'Swipe Card', matched: true },
      { id: 'submitScan', name: 'Submit Scan', matched: true },
      { id: 'clearAsteroids', name: 'Clear Asteroids', matched: true }, // Weapons: not a dead end
      { id: 'fixWiring', name: 'Fix Wiring', matched: true }, // multi-room, no stage room read
    ];
    expect(startRoom(m, 1)).toBe('cafeteria');
    const p = roundPlan(m, 1);
    expect(p.safeUntil).toBe(45);
    expect(p.unplaced).toEqual(['Fix Wiring']);
    expect(p.stops).toHaveLength(3);
    const dead = p.stops.filter(s => s.deadEnd);
    // every dead-end stop that is safe comes before every non-dead-end stop
    const firstOpen = p.stops.findIndex(s => !s.deadEnd);
    for (const d of dead.filter(s => s.safe)) expect(p.stops.indexOf(d)).toBeLessThan(firstOpen);
    expect(p.stops.find(s => s.taskId === 'submitScan')!.note).toMatch(/visual/);
    for (let i = 1; i < p.stops.length; i++) expect(p.stops[i].arrive).toBeGreaterThanOrEqual(p.stops[i - 1].finish);
  });
  it('uses my logged room, skips finished tasks, and needs a room on Airship (edge)', () => {
    const m = build({ obs: [o(1, { type: 'myRoom', room: 'reactor' }, 2)] });
    m.myTasks = [{ id: 'unlockManifolds', name: 'Unlock Manifolds', matched: true, progress: '1/1' }, { id: 'startReactor', name: 'Start Reactor', matched: true }];
    const p = roundPlan(m, 2);
    expect(p.start).toBe('reactor');
    expect(p.stops.map(s => s.taskId)).toEqual(['startReactor']);
    expect(p.stops[0].arrive).toBe(0);
    const a = build();
    a.map = MAPS.airship; // spawn: pick one of six rooms ⇒ no default start
    expect(startRoom(a, 1)).toBeNull();
    a.myTasks = [{ id: 'chartCourse', name: 'Chart Course', matched: true }];
    expect(roundPlan(a, 1).tips[0]).toMatch(/Log your room/);
  });
});

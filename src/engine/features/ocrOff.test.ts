/**
 * "Screen reading off" walkthrough: a match built only from things the user can tap (manual
 * observations, hand-typed task list, hand-logged claims / votes, phases set by button), on a map
 * WITHOUT `map.info`. Every feature engine must still produce its output.
 */
import { describe, it, expect } from 'vitest';
import { build, o, st } from './__fixtures__/build';
import { killClock, killWindows } from './killWindow';
import { meetingMath } from './meetingMath';
import { lastSeenBoard } from './lastSeen';
import { securityFor, adminChecks, monitorChecks } from './security';
import { voteMatrix } from './voteAnalysis';
import { taskClaimChecks, watchedPlayer } from './taskCheck';
import { meetingTimer, prepChecklist } from './meetingPrep';
import { roundPlan, startRoom } from './roundPlan';

function manualMatch() {
  const m = build({ dead: ['yellow'],
    obs: [
      o(3, { type: 'myRoom', room: 'admin' }),
      o(12, { type: 'sighting', player: 'red', room: 'storage', alone: true }),
      o(5, { type: 'withMe', player: 'blue', room: 'admin', on: true }),
      o(25, { type: 'adminRead', counts: { storage: 1, electrical: 0 } }),
      o(40, { type: 'bodyFound', victim: 'yellow', room: 'electrical', reporter: 'green' }),
    ],
  });
  for (const ob of m.observations) (ob as { source: string }).source = 'manual';
  m.map = { ...m.map, info: undefined };                                  // no map.info
  m.myTasks = [{ id: 'swipeCard', name: 'Swipe Card', matched: true, room: 'admin' }, { id: 'chartCourse', name: 'Chart Course', matched: true, room: 'navigation' }]; // tapped in
  m.claims.push(
    { id: 'c1', meeting: 0, stamp: st(40), by: 'green', type: 'location', room: 'electrical', timeWindow: [15, 35] },
    { id: 'c2', meeting: 0, stamp: st(40), by: 'red', type: 'task', taskId: 'fixWiring', room: 'medbay' },
  );
  m.votes.push({ meeting: 0, voter: 'blue', target: 'red', known: true });
  m.phase = { phase: 'meetingDiscussion', wall: 1_000, round: 0, meeting: 0, reason: 'body' }; // set by the "Body" button
  return m;
}

describe('features with screen reading off and no map.info', () => {
  it('every engine produces output from tapped input only', () => {
    const m = manualMatch();
    expect(killClock(m, st(5)).readyIn).toBe(5);
    const [w] = killWindows(m);
    expect(w.couldNot.map(p => p.player)).toContain('blue');
    expect(meetingMath(m).alive).toBe(7);
    expect(lastSeenBoard(m, st(40)).find(e => e.player === 'red')?.room).toBe('storage');
    expect(securityFor(m)._verified).toBe(false);                         // fallback table
    expect(adminChecks(m).some(c => c.room === 'electrical' && c.verdict === 'tooManyClaims')).toBe(true); // Green claims Elec 0:15–0:35, admin showed 0 there at 0:25
    expect(monitorChecks(m).some(f => f.player === 'green' && f.kind === 'admin')).toBe(true);
    expect(voteMatrix(m, 0).rows).toHaveLength(1);
    expect(taskClaimChecks(m).find(c => c.claimId === 'c2')?.verdict).toBe('fake');
    expect(meetingTimer(m, 6_000)?.stage).toBe('discussion');
    expect(prepChecklist(m).length).toBeGreaterThan(0);
    expect(startRoom(m, 1)).toBe('cafeteria');                            // name fallback, no spawn data
    expect(roundPlan(m, 1).stops.map(s => s.taskId)).toEqual(expect.arrayContaining(['swipeCard', 'chartCourse']));
  });
  it('round helpers need only a tapped room (edge: no placement at all)', () => {
    const m = manualMatch();
    m.observations = [];
    expect(watchedPlayer(m, st(10))).toBeNull();
    m.observations.push(o(8, { type: 'sighting', player: 'red', room: 'weapons' }));
    expect(watchedPlayer(m, st(10))).toEqual({ player: 'red', room: 'weapons' });
  });
});

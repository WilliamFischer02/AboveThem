import { describe, it, expect } from 'vitest';
import { watchedPlayer, taskBarObservation, taskClaimChecks, myCommons } from './taskCheck';
import { build, o, st } from './__fixtures__/build';
import type { Claim } from '../../types/game';

const claim = (id: string, by: string, taskId: string, room?: string, type: Claim['type'] = 'task', about?: string): Claim =>
  ({ id, meeting: 0, stamp: st(70), by, type, taskId, room, about });

describe('task-bar tracker', () => {
  it('picks the latest player I placed, else an open with-me', () => {
    const m = build({ obs: [o(5, { type: 'withMe', player: 'blue', room: 'medbay', on: true }), o(30, { type: 'sighting', player: 'red', room: 'admin' })] });
    expect(watchedPlayer(m, st(40))).toEqual({ player: 'red', room: 'admin' });
    expect(watchedPlayer(m, st(80))).toEqual({ player: 'blue', room: 'medbay' }); // sighting too old (edge)
    expect(taskBarObservation('red', 'admin', true)).toEqual({ type: 'sawTask', player: 'red', room: 'admin', visualConfirmed: false, taskBarMoved: true });
  });
});

describe('task claim verifier', () => {
  it('catches a task in the wrong room and a common task I was not dealt', () => {
    const m = build();
    m.myTasks = [{ id: 'fixWiring', name: 'Fix Wiring', matched: true }];
    m.claims.push(claim('c1', 'red', 'chartCourse', 'electrical'), claim('c2', 'green', 'swipeCard', 'admin'), claim('c3', 'blue', 'chartCourse', 'navigation'));
    const r = Object.fromEntries(taskClaimChecks(m).map(x => [x.claimId, x]));
    expect(r.c1).toMatchObject({ verdict: 'fake', check: 'task_not_in_room' });
    expect(r.c2).toMatchObject({ verdict: 'fake', check: 'common_not_dealt' });
    expect(r.c3.verdict).toBe('plausible');
    expect(r.c2.ask!.length).toBeLessThanOrEqual(70);
  });
  it('unknown task list ⇒ no common verdict (edge)', () => {
    const m = build();
    expect(myCommons(m)).toBeNull();
    m.claims.push(claim('c1', 'green', 'swipeCard', 'admin'));
    expect(taskClaimChecks(m)[0].verdict).toBe('plausible');
  });
  it('visual tasks: confirmed when I saw it, suspect when I watched and saw nothing', () => {
    const m = build({ obs: [o(20, { type: 'sawTask', player: 'blue', room: 'medbay', taskId: 'submitScan', visualConfirmed: true }), o(30, { type: 'sawTask', player: 'red', room: 'weapons', visualConfirmed: false })] });
    m.claims.push(claim('c1', 'blue', 'submitScan'), claim('c2', 'red', 'clearAsteroids', 'weapons'), claim('c3', 'green', 'primeShields'));
    const r = Object.fromEntries(taskClaimChecks(m).map(x => [x.claimId, x]));
    expect(r.c1.verdict).toBe('confirmed');
    expect(r.c2).toMatchObject({ verdict: 'suspect', refs: expect.arrayContaining(['c2']) });
    expect(r.c3.verdict).toBe('checkable');
  });
  it('task bar: multi-stage tasks are not caught by a still bar', () => {
    const m = build({ obs: [o(20, { type: 'sawTask', player: 'red', room: 'admin', visualConfirmed: false, taskBarMoved: false }), o(25, { type: 'sawTask', player: 'green', room: 'navigation', visualConfirmed: false, taskBarMoved: false })] });
    m.claims.push(claim('c1', 'red', 'downloadUpload', 'admin'), claim('c2', 'green', 'chartCourse', 'navigation'));
    const r = Object.fromEntries(taskClaimChecks(m).map(x => [x.claimId, x]));
    expect(r.c1.verdict).toBe('plausible');
    expect(r.c2).toMatchObject({ verdict: 'suspect', check: 'bar_no_move' });
  });
  it('a visual clear is invalid with visuals off (scan excepted) or for a non-visual task', () => {
    const m = build({ settings: { visualTasksOn: false } });
    m.claims.push(claim('c1', 'red', 'clearAsteroids', undefined, 'clear', 'green'), claim('c2', 'red', 'submitScan', undefined, 'clear', 'blue'), claim('c3', 'red', 'chartCourse', undefined, 'clear', 'blue'));
    const r = Object.fromEntries(taskClaimChecks(m).map(x => [x.claimId, x]));
    expect(r.c1).toMatchObject({ verdict: 'clearInvalid', check: 'visual_off_clear' });
    expect(r.c2).toBeUndefined();
    expect(r.c3).toMatchObject({ verdict: 'clearInvalid', check: 'visual_wrong_map' });
  });
});

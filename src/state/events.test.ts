import { describe, it, expect } from 'vitest';
import { replay, effective, parseLines, toLine, lastUndoable, type MatchEvent, type InitPayload } from './events';
import { clockOnPhase, initialClock, stampAt } from './clock';
import { fixture } from '../engine/__fixtures__/skeld_match_01';

const init: InitPayload = {
  id: 'm1', startedAt: 1000, settings: fixture.settings, map: 'skeld', me: 'cyan', myRole: 'crew',
  players: Object.values(fixture.players).map(p => ({ ...p, status: 'alive', knownRole: p.isMe ? 'crew' : 'unknown' })),
};
const st = (t: number) => ({ round: 0, t, wall: 1000 + t * 1000 });

describe('event log reducer', () => {
  it('replays init + observations into a MatchState', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'observation', wall: 2000, payload: { id: 'o1', type: 'myRoom', stamp: st(1), source: 'me', confidence: 1, room: 'medbay' } },
      { kind: 'observation', wall: 3000, payload: { id: 'o2', type: 'bodyFound', stamp: st(50), source: 'me', confidence: 0.95, victim: 'yellow', room: 'electrical', reporter: 'green' } },
    ];
    const m = replay(log)!;
    expect(m.observations).toHaveLength(2);
    expect(m.players.yellow.status).toBe('dead');
    expect(m.map.id).toBe('skeld');
  });

  it('undo removes the latest undoable event and never the init', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'observation', wall: 2000, payload: { id: 'o1', type: 'myRoom', stamp: st(1), source: 'me', confidence: 1, room: 'medbay' } },
      { kind: 'observation', wall: 3000, payload: { id: 'o2', type: 'sawVent', stamp: st(20), source: 'me', confidence: 0.95, player: 'red', room: 'admin' } },
      { kind: 'undo', wall: 4000 },
    ];
    expect(effective(log).map(e => e.kind)).toEqual(['init', 'observation']);
    expect(replay(log)!.observations.map(o => o.id)).toEqual(['o1']);
    const twice = [...log, { kind: 'undo', wall: 5000 } as MatchEvent, { kind: 'undo', wall: 6000 } as MatchEvent];
    expect(replay(twice)!.observations).toHaveLength(0);
    expect(lastUndoable(twice)).toBeNull();
  });

  it('ejection with confirm-ejects sets status and known role', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'ejection', wall: 2000, payload: { meeting: 0, player: 'red', wasImpostor: true } },
    ];
    const m = replay(log)!;
    expect(m.players.red.status).toBe('ejected');
    expect(m.players.red.knownRole).toBe('impostor');
  });

  it('round-trips through NDJSON and skips corrupt lines', () => {
    const log: MatchEvent[] = [{ kind: 'init', wall: 1000, payload: init }, { kind: 'undo', wall: 2 }];
    const text = log.map(toLine).join('\n') + '\n{not json\n';
    expect(parseLines(text)).toEqual(log);
  });

  it('returns null without an init', () => {
    expect(replay([{ kind: 'undo', wall: 1 }])).toBeNull();
  });
});

describe('round clock', () => {
  it('counts rounds and freezes t during meetings', () => {
    let c = initialClock;
    c = clockOnPhase(c, { phase: 'round', wall: 10_000, round: 0 });
    expect(stampAt(c, 25_000)).toMatchObject({ round: 0, t: 15 });
    c = clockOnPhase(c, { phase: 'meetingDiscussion', wall: 60_000, round: 0 });
    expect(stampAt(c, 90_000)).toMatchObject({ round: 0, t: 50 });
    c = clockOnPhase(c, { phase: 'ejection', wall: 95_000, round: 0 });
    c = clockOnPhase(c, { phase: 'round', wall: 100_000, round: 1 });
    expect(stampAt(c, 103_000)).toMatchObject({ round: 1, t: 3 });
    // A duplicate "round" press mid-round must not start a new round.
    c = clockOnPhase(c, { phase: 'round', wall: 110_000, round: 1 });
    expect(stampAt(c, 112_000)).toMatchObject({ round: 1, t: 12 });
  });

  it('switching myself to crew drops partner flags from a wrong red-name read', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'myRole', wall: 2000, payload: { role: 'impostor', auto: true } },
      { kind: 'player', wall: 2001, payload: { id: 'red', isPartner: true, knownRole: 'impostor' } },
      { kind: 'myRole', wall: 3000, payload: { role: 'crew', locked: true } },
      { kind: 'myRole', wall: 4000, payload: { role: 'impostor', auto: true } },
    ];
    const m = replay(log)!;
    expect(m.myRole).toBe('crew');
    expect(m.myRoleLocked).toBe(true);
    expect(m.players.red.isPartner).toBe(false);
    expect(m.players.red.knownRole).toBe('unknown');
  });
});

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

describe('roster consolidation events', () => {
  it('mergePlayers folds a duplicate card and re-points every reference to it', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'addPlayer', wall: 1500, payload: { id: 'chat7', name: 'Reddd', color: 'gray', isMe: false, status: 'alive', knownRole: 'unknown' } },
      { kind: 'observation', wall: 2000, payload: { id: 'o1', type: 'sighting', stamp: st(5), source: 'me', confidence: 0.9, player: 'chat7', room: 'admin', withPlayers: ['chat7', 'blue'] } },
      { kind: 'claim', wall: 2500, payload: { id: 'c1', meeting: 0, stamp: st(60), by: 'chat7', type: 'location', room: 'admin', text: 'admin', about: 'chat7' } },
      { kind: 'chat', wall: 2600, payload: { id: 'ch1', meeting: 0, stamp: st(61), sender: 'chat7', original: 'admin', source: 'ocr' } },
      { kind: 'player', wall: 2700, payload: { id: 'chat7', status: 'dead' } },
      { kind: 'mergePlayers', wall: 3000, payload: { from: 'chat7', into: 'red', why: 'name' } },
    ];
    const m = replay(log)!;
    expect(m.players.chat7).toBeUndefined();
    expect(m.players.red.name).toBe(fixture.players.red.name);
    expect(m.players.red.status).toBe('dead');
    expect(m.observations[0]).toMatchObject({ player: 'red', withPlayers: ['red', 'blue'] });
    expect(m.claims[0]).toMatchObject({ by: 'red', about: 'red' });
    expect(m.chat[0].sender).toBe('red');
    // an undo removes the user's last action, never an automatic merge
    const undone = effective([...log, { kind: 'undo', wall: 3100 }]);
    expect(undone.some(e => e.kind === 'mergePlayers')).toBe(true);
    expect(undone.some(e => e.kind === 'player')).toBe(false);
  });

  it('mergePlayers keeps the survivor alive when the grid read it alive this meeting, and names a placeholder', () => {
    const log: MatchEvent[] = [
      { kind: 'init', wall: 1000, payload: init },
      { kind: 'addPlayer', wall: 1500, payload: { id: 'slot4', name: '#4', color: 'black', isMe: false, status: 'alive', knownRole: 'unknown', slot: 4, slotMeeting: 0 } },
      { kind: 'addPlayer', wall: 1600, payload: { id: 'black', name: '(Black)', color: 'black', isMe: false, status: 'dead', knownRole: 'unknown' } },
      { kind: 'addPlayer', wall: 1700, payload: { id: 'chat2', name: 'straykids', color: 'gray', isMe: false, status: 'alive', knownRole: 'unknown' } },
      { kind: 'mergePlayers', wall: 3000, payload: { from: 'black', into: 'slot4' } },
      { kind: 'mergePlayers', wall: 3100, payload: { from: 'chat2', into: 'slot4' } },
      { kind: 'rosterSize', wall: 3200, payload: { size: 10, source: 'grid' } },
    ];
    const m = replay(log)!;
    expect(m.players.slot4).toMatchObject({ name: 'straykids', color: 'black', status: 'alive', slot: 4 });
    expect(m.rosterSize).toBe(10);
    expect(m.rosterSizeSource).toBe('grid');
  });
});

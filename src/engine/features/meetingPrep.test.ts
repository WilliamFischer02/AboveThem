import { describe, it, expect } from 'vitest';
import { meetingTimer, prepChecklist } from './meetingPrep';
import { fixture } from '../__fixtures__/skeld_match_01';
import { build, o } from './__fixtures__/build';

describe('meeting timer', () => {
  it('counts discussion then voting from the meeting wall', () => {
    const m = build({ settings: { discussionTimeSec: 15, votingTimeSec: 120 } });
    m.phase = { phase: 'meetingDiscussion', wall: 1000, round: 0, meeting: 0 };
    expect(meetingTimer(m, 1000 + 5000)).toMatchObject({ stage: 'discussion', stageLeft: 10, votingLeft: 130 });
    expect(meetingTimer(m, 1000 + 30000)).toMatchObject({ stage: 'voting', votingLeft: 105 });
    expect(meetingTimer(m, 1000 + 200000)).toMatchObject({ stage: 'over', votingLeft: 0 });
  });
  it('null outside meetings; a detected voting phase uses its own wall (edge)', () => {
    const m = build();
    expect(meetingTimer(m, 0)).toBeNull();
    m.phase = { phase: 'meetingVoting', wall: 50_000, round: 0, meeting: 0 };
    expect(meetingTimer(m, 60_000)).toMatchObject({ stage: 'voting', votingLeft: 110 });
  });
});

describe('prep checklist', () => {
  it('fixture: location, vouch, kill-window clears, ordered by priority, all traceable', () => {
    const items = prepChecklist(fixture);
    const ids = items.map(i => i.id);
    expect(ids).toContain('where');
    expect(ids).toContain('vis_o3');
    expect(ids).toContain('kw_o6');
    const where = items.find(i => i.id === 'where')!;
    expect(where.say).toMatch(/^i was MedBay with Blue/);
    expect(items.find(i => i.id === 'kw_o6')!.text).toMatch(/Blue could not/);
    for (let i = 1; i < items.length; i++) expect(items[i].priority).toBeGreaterThanOrEqual(items[i - 1].priority);
  });
  it('ghosts get nothing; critical votes go first (edge)', () => {
    const g = build({ dead: ['cyan'] });
    g.phase = { phase: 'meetingDiscussion', wall: 0, round: 0, meeting: 0 };
    expect(prepChecklist(g)).toEqual([]);
    const c = build({ players: 5, settings: { impostorCount: 1 }, dead: ['purple', 'green'], obs: [o(5, { type: 'myRoom', room: 'admin' })] });
    c.phase = { phase: 'meetingDiscussion', wall: 0, round: 0, meeting: 0 };
    expect(prepChecklist(c)[0].id).toBe('critical');
  });
});

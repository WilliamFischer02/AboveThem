import { describe, expect, it } from 'vitest';
import { fixture } from './__fixtures__/skeld_match_01';
import { MAPS } from '../data/maps';
import { scoreAll } from './suspicion';
import { headline } from './headline';
import { buildMeetingScript } from './meetingScript';

// Regression (found by ui-streamline's screenshot harness): observations logged with Skeld room ids,
// then the map is re-detected as Polus. The engine threw in map.ts travel time and the window went blank.
describe('fail soft: observations whose rooms are not on the current map', () => {
  it('scores, headlines and scripts without throwing', () => {
    const m = { ...fixture, map: MAPS.polus };
    expect(() => {
      const s = scoreAll(m);
      headline(m, s);
      buildMeetingScript(m, s, 0);
    }).not.toThrow();
  });
});

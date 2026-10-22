/** The Timeline renders observations via store.describe(): monitor reads must produce readable lines. */
import { describe as suite, it, expect } from 'vitest';
import { describe } from '../../state/store';
import { o } from './__fixtures__/build';

const line = (payload: ReturnType<typeof o>) => describe({ kind: 'observation', wall: 0, payload });

suite('timeline lines for monitor reads', () => {
  it('admin / vitals / door log', () => {
    expect(line(o(40, { type: 'adminRead', counts: { electrical: 2, storage: 1 } }))).toBe('admin read: 2 in electrical, 1 in storage (3 icons)');
    expect(line(o(40, { type: 'vitalsRead', dead: ['red'], alive: ['blue', 'green'], dc: ['white'] }))).toBe('vitals: red DED, white D/C · 2 OK');
    expect(line(o(65, { type: 'doorLogRead', entries: [{ player: 'blue', t: 65 }], from: 10, to: 65 }))).toBe('door log 0:10–1:05: blue');
  });
  it('empty reads still say something (edge)', () => {
    expect(line(o(40, { type: 'adminRead', counts: {} }))).toBe('admin read: nobody in any room (0 icons)');
    expect(line(o(40, { type: 'vitalsRead', dead: [], alive: ['blue'] }))).toBe('vitals: nobody dead · 1 OK');
    expect(line(o(40, { type: 'doorLogRead', entries: [], from: 0, to: 40 }))).toBe('door log 0:00–0:40: nobody crossed');
  });
});

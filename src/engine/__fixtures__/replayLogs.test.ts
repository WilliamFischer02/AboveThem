/**
 * Replays every REAL match log in %APPDATA%\AboveThem\matches\*.ndjson through the engine, scoring after
 * every event. Skipped when the folder is not there (CI / other machines). Reads files with node fs inside
 * the test only (the engine stays fs-free). Set REPLAY_DUMP=1 to print the final rankings for eyeballing.
 */
import { describe, it, expect } from 'vitest';
import { parseLines, reduce, replay, type MatchEvent } from '../../state/events';
import { scoreAll } from '../suspicion';
import type { MatchState } from '../../types/game';

type Fs = { existsSync(p: string): boolean; readdirSync(p: string): string[]; readFileSync(p: string, enc: string): string };
const env = ((globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env) ?? {};
const dir = env.APPDATA ? `${env.APPDATA}\\AboveThem\\matches` : '';
const fs: Fs | null = await import(/* @vite-ignore */ 'node:' + 'fs').then(m => m as unknown as Fs).catch(() => null);
const present = !!fs && !!dir && fs.existsSync(dir);
const files = present ? fs!.readdirSync(dir).filter(f => f.endsWith('.ndjson')).sort() : [];

describe.skipIf(!present || files.length === 0)('replay real match logs', () => {
  it(`scores every event of ${files.length} logs without throwing, NaN or out-of-range probabilities`, () => {
    let events = 0, scored = 0, worstWarm = 0, worstFile = '';
    const slow = new Map<string, number>();
    for (const f of files) {
      const log = parseLines(fs!.readFileSync(`${dir}\\${f}`, 'utf8'));
      if (!log.some(e => e.kind === 'init')) continue;
      let m: MatchState | null = null;
      const seen: MatchEvent[] = [];
      for (const e of log) {
        seen.push(e);
        events++;
        if (e.kind === 'init') m = replay(seen);
        else if (!m) continue;
        else if (e.kind === 'undo') m = replay(seen);
        else m = reduce(m, e);
        if (!m) continue;
        const t0 = performance.now();
        let scores;
        try { scores = scoreAll(m); } catch (err) { throw new Error(`${f} event #${seen.length} (${e.kind}): ${(err as Error).stack}`); }
        const ms = performance.now() - t0;
        if (seen.length > 5 && ms > worstWarm) { worstWarm = ms; worstFile = `${f} #${seen.length} (${e.kind})`; }
        if (ms > 15) slow.set(e.kind, (slow.get(e.kind) ?? 0) + 1);
        scored++;
        for (const s of scores) {
          expect(Number.isFinite(s.probability), `${f} ${s.player} p`).toBe(true);
          expect(s.probability).toBeGreaterThanOrEqual(0);
          expect(s.probability).toBeLessThanOrEqual(1);
          expect(Number.isNaN(s.logOdds), `${f} ${s.player} L`).toBe(false);
          for (const p of s.trend ?? []) expect(Number.isFinite(p.probability)).toBe(true);
          for (const x of s.evidence) {
            expect(Number.isFinite(x.weight), `${f} ${x.label}`).toBe(true);
            expect(x.refs.length, `${f} ${x.label}`).toBeGreaterThan(0);
            expect(x.label).not.toMatch(/undefined|NaN|\{[A-Z0-9]+\}/);
          }
        }
      }
      if (env.REPLAY_DUMP && m) {
        console.log(`\n== ${f} map=${m.map.id} me=${m.me} role=${m.myRole} phase=${m.phase.phase} players=${Object.keys(m.players).length} obs=${m.observations.length} claims=${m.claims.length} chat=${m.chat.length} ej=${m.ejections.length}`);
        for (const s of scoreAll(m)) {
          console.log(`  ${(m.players[s.player]?.name ?? s.player).padEnd(13)} ${s.verdict.padEnd(15)} p=${s.probability.toFixed(2)} d=${(s.delta ?? 0).toFixed(2)} | ${s.summary}`);
          for (const x of s.evidence.slice(0, 4)) console.log(`      ${x.weight.toFixed(2).padStart(6)} ${x.category.padEnd(10)} ${x.label}`);
        }
      }
    }
    console.log(`replayed ${events} events, ${scored} scorings; slowest warm scoreAll ${worstWarm.toFixed(1)} ms at ${worstFile}; >15 ms by event kind: ${JSON.stringify([...slow])}`);
    // ~38 ms worst case on an idle machine; a loaded machine (release build running alongside) measured 107 ms.
    // This is a regression gate, not a benchmark: anything under a quarter second keeps the UI responsive.
    expect(worstWarm).toBeLessThan(250);
  }, 300_000);
});

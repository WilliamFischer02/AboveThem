/**
 * Coverage between the lie-check catalogue and the code:
 *  1. every lieChecks.json `wiredIn` names an export that really exists in src/engine/**;
 *  2. every `check: '<id>'` the feature modules emit exists in the catalogue;
 *  3. every FEATURE_LIE_CHECKS entry names a real catalogue id and a real export.
 */
import { describe, it, expect } from 'vitest';
import lie from '../../data/tactics/lieChecks.json';
import { FEATURE_LIE_CHECKS } from './lieCheckMap';

const SOURCES = import.meta.glob('/src/engine/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const IDS = new Set(lie.checks.map(c => c.id));

/** 'src/engine/x.ts#fn' → null when OK, else a reason. */
function resolve(pointer: string): string | null {
  const [file, fn] = pointer.split('#');
  const src = SOURCES['/' + file];
  if (src === undefined) return `no file ${file}`;
  if (!fn) return `no function in ${pointer}`;
  const re = new RegExp(`export\\s+(async\\s+)?(function\\s+${fn}\\b|const\\s+${fn}\\b)`);
  return re.test(src) ? null : `${file} has no export ${fn}`;
}

describe('lie-check coverage', () => {
  it('every wiredIn pointer names a grep-able export in src/engine/**', () => {
    const bad = lie.checks.filter(c => c.wiredIn).map(c => [c.id, resolve(c.wiredIn as string)] as const).filter(([, r]) => r);
    expect(bad).toEqual([]);
  });

  it("every check id emitted by the feature modules exists in lieChecks.json", () => {
    const emitted = new Map<string, string>();
    for (const [file, src] of Object.entries(SOURCES)) {
      if (!file.startsWith('/src/engine/features/') || file.endsWith('.test.ts')) continue;
      for (const mm of src.matchAll(/\bcheck:\s*'([a-z_]+)'/g)) emitted.set(mm[1], file);
    }
    expect(emitted.size).toBeGreaterThanOrEqual(9); // taskCheck emits at least these
    const missing = [...emitted].filter(([id]) => !IDS.has(id));
    expect(missing).toEqual([]);
  });

  it('FEATURE_LIE_CHECKS points at real catalogue ids and real exports', () => {
    for (const [id, ptr] of Object.entries(FEATURE_LIE_CHECKS)) {
      expect(IDS.has(id), id).toBe(true);
      expect(resolve(ptr), `${id} -> ${ptr}`).toBeNull();
    }
  });

  it('the resolver rejects a pointer to a missing export (edge)', () => {
    expect(resolve('src/engine/features/taskCheck.ts#noSuchFunction')).toMatch(/no export/);
    expect(resolve('src/engine/nope.ts#x')).toMatch(/no file/);
  });
});

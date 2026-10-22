import { describe, expect, it } from 'vitest';
import { bestReading, emptyBook, isJunk, learnAlias, learnJunk, learnName, prune, resolve, snapList } from './nameBook';

const T = 1_700_000_000_000;

describe('name book', () => {
  it('a user rename teaches the spelling and the misread as its alias', () => {
    let b = emptyBook();
    b = learnAlias(b, 'BigBihgis', 'BigBingus', T, 'user');
    expect(resolve(b, 'BigBihgis')).toMatchObject({ name: 'BigBingus', via: 'alias' });
    expect(resolve(b, 'bigbingus')).toMatchObject({ name: 'BigBingus', via: 'exact' });
    expect(b.names.bigbingus.user).toBe(true);
    expect(b.names.bigbihgis).toBeUndefined();
  });

  it('fuzzy resolution needs a well-confirmed name and never fires on short strings', () => {
    let b = emptyBook();
    b = learnName(b, 'Neataunty', 'grid', T);
    expect(resolve(b, 'NealAunty')).toMatchObject({ name: 'Neataunty', via: 'fuzzy' });   // one letter off: always close enough
    expect(resolve(b, 'Nea7aumty').via).toBe('none');      // two letters off, seen once: not trusted yet
    b = learnName(b, 'Neataunty', 'grid', T);
    b = learnName(b, 'Neataunty', 'grid', T);
    expect(resolve(b, 'Nea7aumty')).toMatchObject({ name: 'Neataunty', via: 'fuzzy' });
    b = learnName(b, 'Tim', 'user', T);
    expect(resolve(b, 'Tom').via).toBe('none');
  });

  it('junk: one user strike is final, automatic drops need two', () => {
    let b = emptyBook();
    b = learnJunk(b, 'told u 4 times', T, false);
    expect(isJunk(b, 'told u 4 times')).toBe(false);
    b = learnJunk(b, 'told u 4 times', T, false);
    expect(isJunk(b, 'told u 4 times')).toBe(true);
    b = learnJunk(b, '(Red)', T, true);
    expect(isJunk(b, '(red)')).toBe(true);
    // a later confirmation as a real name clears junk; a user-typed name cannot be junked
    b = learnName(b, 'told u 4 times', 'user', T);
    expect(isJunk(b, 'told u 4 times')).toBe(true);        // too long to be a name: not learned
    b = learnName(b, 'Kayleyy', 'user', T);
    b = learnJunk(b, 'Kayleyy', T, false);
    expect(b.names.kayleyy).toBeDefined();
  });

  it('snap list puts the roster first, then this lobby, then recent names and aliases', () => {
    let b = emptyBook();
    b = learnName(b, 'Oldname', 'grid', T - 5000, 'AAAAAA');
    b = learnAlias(b, 'Kaylee', 'Kayleyy', T, 'user');
    b = learnName(b, 'Kayleyy', 'grid', T, 'PFRXRG');
    const list = snapList(b, ['BigBingus', '#3'], 'PFRXRG');
    expect(list.slice(0, 3)).toEqual(['BigBingus', 'Kayleyy', 'Kaylee']);
    expect(list).toContain('Oldname');
    expect(list).not.toContain('#3');
  });

  it('prune forgets stale automatic names but keeps user ones', () => {
    let b = emptyBook();
    b = learnName(b, 'Gone', 'grid', T - 40 * 24 * 3600_000);
    b = learnName(b, 'Kept', 'user', T - 40 * 24 * 3600_000);
    b = prune(b, T);
    expect(b.names.gone).toBeUndefined();
    expect(b.names.kept).toBeDefined();
  });

  it('bestReading corrects a first misread once a better reading repeats', () => {
    expect(bestReading({ BigBihgis: 1, BigBingus: 1 }, 'BigBihgis', false)).toBe('BigBihgis');
    expect(bestReading({ BigBihgis: 1, BigBingus: 2 }, 'BigBihgis', false)).toBe('BigBingus');
    expect(bestReading({ BigBihgis: 1, BigBingus: 2 }, 'Typed', true)).toBe('Typed');
    expect(bestReading({ 'eobältfÖ*': 3, Cobaltfox: 2 }, 'eobältfÖ*', false)).toBe('Cobaltfox');
  });
});

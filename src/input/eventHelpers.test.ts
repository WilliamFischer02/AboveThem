import { describe, it, expect } from 'vitest';
import { looksEnglish, translationRequest, unreadableHint, senderByIconColor, captureVerdict, watcherStalled, autoMatchSettings } from './eventHelpers';
import { DEFAULT_SETTINGS } from '../state/presets';
import { reduce, initState } from '../state/events';

describe('special roles in auto-created matches', () => {
  const presets = {
    ABCDEF: { savedAt: 10, settings: { ...DEFAULT_SETTINGS, roles: { engineer: true } } },
    ZZZZZZ: { savedAt: 20, settings: { ...DEFAULT_SETTINGS, roles: { shapeshifter: true, scientist: true } } },
  };
  it("uses this lobby code's preset roles, else the newest preset with roles", () => {
    expect(autoMatchSettings(DEFAULT_SETTINGS, {}, 'polus', presets, 'ABCDEF').roles).toEqual({ engineer: true });
    expect(autoMatchSettings(DEFAULT_SETTINGS, {}, 'polus', presets, 'NEWONE').roles).toEqual({ shapeshifter: true, scientist: true });
    expect(autoMatchSettings(DEFAULT_SETTINGS, {}, 'polus', {}, null).roles).toBeUndefined();
  });
  it('screen-read settings override the base but never the roles; the map is the detected one', () => {
    const s = autoMatchSettings(DEFAULT_SETTINGS, { impostorCount: 3, roles: undefined }, 'mira', presets, 'ABCDEF');
    expect(s.impostorCount).toBe(3);
    expect(s.map).toBe('mira');
    expect(s.roles).toEqual({ engineer: true });
  });
  it('a later game://settings patch keeps the roles', () => {
    const m0 = initState({ id: 'x', startedAt: 0, settings: autoMatchSettings(DEFAULT_SETTINGS, {}, 'skeld', presets, 'ABCDEF'), map: 'skeld', me: 'me', myRole: 'crew', players: [{ id: 'me', name: 'me', color: 'cyan', isMe: true, status: 'alive', knownRole: 'crew' }] });
    const m1 = reduce(m0, { kind: 'settings', wall: 1, payload: { killCooldownSec: 20 } });
    expect(m1.settings.roles).toEqual({ engineer: true });
    expect(m1.settings.killCooldownSec).toBe(20);
  });
});

describe('capture / watcher health', () => {
  const now = 1_000_000;
  it('a running session without frames for 20 s is stale; a fresh one is ok', () => {
    expect(captureVerdict({ running: true, seq: 50, age_ms: 300 }, now)).toBe('ok');
    expect(captureVerdict({ running: true, seq: 50, age_ms: 25_000 }, now)).toBe('stale');
    expect(captureVerdict({ running: true, seq: 0, age_ms: 0, started_ms: now - 30_000 }, now)).toBe('stale');
    expect(captureVerdict({ running: true, seq: 0, age_ms: 0, started_ms: now - 2_000 }, now)).toBe('ok');
    expect(captureVerdict({ running: true, seq: 0, age_ms: 0 }, now)).toBe('ok'); // old build: no started_ms
    expect(captureVerdict({ running: false, seq: 9, age_ms: 0 }, now)).toBe('stopped');
  });
  it('the watcher is stalled only when capture is fresh and it stopped consuming frames', () => {
    expect(watcherStalled({ running: true, last_frame_ms: now - 30_000 }, true, now)).toBe(true);
    expect(watcherStalled({ running: true, last_frame_ms: now - 30_000 }, false, now)).toBe(false);
    expect(watcherStalled({ running: true, last_frame_ms: now - 1_000 }, true, now)).toBe(false);
    expect(watcherStalled({ running: false }, true, now)).toBe(false);
  });
});

describe('looksEnglish (script-aware)', () => {
  it('keeps everyday English local', () => {
    expect(looksEnglish('i saw red vent in elec')).toBe(true);
    expect(looksEnglish('skip')).toBe(true);
    expect(looksEnglish('')).toBe(true);
  });
  it('sends pure Cyrillic to translation (it used to count as English: zero ASCII words)', () => {
    expect(looksEnglish('привет всем')).toBe(false);
    expect(looksEnglish('кто')).toBe(false);
  });
  it('sends other scripts and accented text to translation', () => {
    expect(looksEnglish('こんにちは')).toBe(false);
    expect(looksEnglish('où est le corps')).toBe(false);
    expect(looksEnglish('donde estas amigo')).toBe(false);
  });
});

describe('translationRequest', () => {
  it('translates a Cyrillic look-alike guess from Russian, flagged as a guess', () => {
    expect(translationRequest({ text: 'KTO y6mn', unreadable: true, script_hint: 'cyrillic', cyrillic_guess: 'кто убмп' }))
      .toEqual({ text: 'кто убмп', from: 'ru', guess: true });
  });
  it('never translates garbage or empty unreadable lines', () => {
    expect(translationRequest({ text: '', unreadable: true })).toBeNull();
    expect(translationRequest({ text: 'Céralflyhlé,ftlthæ', unreadable: true, script_hint: null })).toBeNull();
  });
  it('plain lines: English stays local, the rest is translated', () => {
    expect(translationRequest({ text: 'red sus' })).toBeNull();
    expect(translationRequest({ text: 'привет' })).toEqual({ text: 'привет', guess: false });
  });
});

describe('unreadableHint', () => {
  it('asks for the Russian OCR pack only when it is missing', () => {
    expect(unreadableHint({ unreadable: true, scriptHint: 'cyrillic', original: 'KTO' }, ['en-US'])).toMatch(/Russian OCR pack/);
    expect(unreadableHint({ unreadable: true, scriptHint: 'cyrillic', original: 'KTO' }, ['en-US', 'ru'])).not.toMatch(/install/);
    expect(unreadableHint({ unreadable: true, original: '' }, null)).toMatch(/OCR pack/);
    expect(unreadableHint({ unreadable: false, original: 'hi' }, [])).toBeNull();
  });
});

describe('senderByIconColor', () => {
  const others = [{ id: 'a', color: 'red' }, { id: 'b', color: 'blue' }, { id: 'c', color: 'blue' }];
  it('names the sender only when the colour is unique', () => {
    expect(senderByIconColor('red', others)).toBe('a');
    expect(senderByIconColor('blue', others)).toBeNull();
    expect(senderByIconColor('unknown', others)).toBeNull();
    expect(senderByIconColor(undefined, others)).toBeNull();
  });
});

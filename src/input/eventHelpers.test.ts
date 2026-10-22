import { describe, it, expect } from 'vitest';
import { looksEnglish, translationRequest, unreadableHint, senderByIconColor } from './eventHelpers';

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

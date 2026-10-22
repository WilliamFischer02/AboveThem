/**
 * Shape checks for the tactics data (research agent). The engine selects entries
 * by key, so a typo or a missing field fails silently at runtime — catch it here.
 */
import { describe, it, expect } from 'vitest';
import lie from './lieChecks.json';
import crew from './crew.json';
import impostor from './impostor.json';
import slang from '../chatSlang.seed.json';
import skeld from '../maps/skeld.json';
import polus from '../maps/polus.json';

const CONFIDENCE = ['hard', 'high', 'med', 'low'];
const EFFECT = ['suspect', 'clear', 'invalidateClear', 'constraint'];
// EvidenceItem['category'] in src/types/game.ts plus 'social' (suspicion-core branch).
const CATEGORY = ['movement', 'task', 'meeting', 'sabotage', 'structural', 'manual', 'hard', 'social'];
const GROUP = ['task', 'movement', 'body', 'monitor', 'sabotage', 'eyewitness', 'social'];
const PLACEHOLDERS = new Set(['P', 'P2', 'P3', 'R', 'R2', 'T', 'TASK', 'W', 'V', 'N', 'N2']);

type Check = (typeof lie.checks)[number];
const situations = crew.situations as Record<string, { say?: string[]; ask?: string[]; watch?: string[] }>;
// Engine files that exist (Vite glob, no node:fs needed): keys look like '/src/engine/rules.ts'.
const ENGINE_FILES = new Set(Object.keys(import.meta.glob('/src/engine/*.ts')));
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(x => x[1]);

describe('lieChecks.json', () => {
  const checks: Check[] = lie.checks;

  it('has at least 30 checks with unique ids', () => {
    expect(checks.length).toBeGreaterThanOrEqual(30);
    expect(new Set(checks.map(c => c.id)).size).toBe(checks.length);
  });

  it('every check uses the fixed enums and has a usable question', () => {
    for (const c of checks) {
      expect(CONFIDENCE, c.id).toContain(c.confidence);
      expect(EFFECT, c.id).toContain(c.effect);
      expect(CATEGORY, c.id).toContain(c.category);
      expect(GROUP, c.id).toContain(c.group);
      expect(c.inputs.length, c.id).toBeGreaterThan(0);
      expect(c.check.length, c.id).toBeGreaterThan(10);
      expect(c.ask.length, c.id).toBeLessThanOrEqual(70);
      for (const p of placeholders(c.ask)) expect(PLACEHOLDERS.has(p), `${c.id}: {${p}}`).toBe(true);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
    }
  });

  it('every input is declared in inputVocabulary', () => {
    const vocab = lie.inputVocabulary as Record<string, string>;
    for (const c of checks) for (const i of c.inputs) expect(vocab[i], `${c.id}: ${i}`).toBeTruthy();
  });

  it('linked situations exist in crew.json and wiredIn points at a real file', () => {
    for (const c of checks) {
      const sit = (c as { situation?: string }).situation;
      if (sit) expect(situations[sit], `${c.id} -> ${sit}`).toBeTruthy();
      if (c.wiredIn) expect(ENGINE_FILES.has('/' + c.wiredIn.split('#')[0]), `${c.id} -> ${c.wiredIn}`).toBe(true);
    }
  });

  it('confidence maps to a positive log-odds weight, hard strongest', () => {
    const w = lie.confidenceLogOdds;
    expect(w.hard).toBeGreaterThan(w.high);
    expect(w.high).toBeGreaterThan(w.med);
    expect(w.med).toBeGreaterThan(w.low);
    expect(w.low).toBeGreaterThan(0);
  });
});

describe('crew.json situations', () => {
  it('every situation has at least one say or ask line, all chat-sized', () => {
    for (const [k, s] of Object.entries(situations)) {
      expect((s.say?.length ?? 0) + (s.ask?.length ?? 0), k).toBeGreaterThan(0);
      for (const line of [...(s.say ?? []), ...(s.ask ?? [])]) expect(line.length, `${k}: ${line}`).toBeLessThanOrEqual(70);
    }
  });

  it('mapQuestions covers all five maps with short lines (edge: no empty map)', () => {
    const mq = crew.mapQuestions as Record<string, string | string[]>;
    for (const map of ['skeld', 'mira', 'polus', 'airship', 'fungle']) {
      const lines = mq[map] as string[];
      expect(Array.isArray(lines) && lines.length >= 5, map).toBe(true);
      for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(70);
    }
  });
});

describe('chatSlang.seed.json', () => {
  const COLORS = ['red', 'blue', 'green', 'pink', 'orange', 'yellow', 'black', 'white', 'purple', 'brown', 'cyan', 'lime', 'maroon', 'rose', 'banana', 'gray', 'tan', 'coral'];
  const LANGS = ['en', 'es', 'pt', 'ru', 'fil', 'id'];

  it('covers all 18 colours in every language', () => {
    const colors = slang.colors as unknown as Record<string, Record<string, string[]>>;
    for (const c of COLORS) for (const l of LANGS) expect(colors[c]?.[l]?.length, `${c}/${l}`).toBeGreaterThan(0);
  });

  it('skeld/polus room ids exist in the map data (edge: unknown id would never resolve)', () => {
    const rooms = slang.rooms as unknown as Record<string, Record<string, string[]>>;
    for (const [mapId, map] of [['skeld', skeld], ['polus', polus]] as const) {
      const ids = new Set(map.rooms.map(r => r.id));
      for (const id of Object.keys(rooms[mapId])) expect(ids.has(id), `${mapId}.${id}`).toBe(true);
    }
  });

  it('every intent has an English list and lower-case surface forms', () => {
    for (const [k, v] of Object.entries(slang.intents as Record<string, Record<string, string | string[]>>)) {
      expect(Array.isArray(v.en) && v.en.length > 0, k).toBe(true);
      for (const [lang, list] of Object.entries(v)) {
        if (lang === 'src') continue;
        for (const s of list as string[]) expect(s, `${k}/${lang}`).toBe(s.toLowerCase());
      }
    }
  });
});

describe('impostor.json', () => {
  it('every accusation entry has lines, avoid[] and a followup', () => {
    const acc = impostor.accusations as Record<string, { best?: string[]; uncleared_accuser?: string[]; cleared_accuser?: string[]; avoid: string[]; followup: string }>;
    for (const [k, a] of Object.entries(acc)) {
      const lines = [...(a.best ?? []), ...(a.uncleared_accuser ?? []), ...(a.cleared_accuser ?? [])];
      expect(lines.length, k).toBeGreaterThan(0);
      expect(Array.isArray(a.avoid), k).toBe(true);
      expect(typeof a.followup, k).toBe('string');
    }
  });

  it('deception sections are non-empty string lists', () => {
    for (const [k, list] of Object.entries(impostor.deception as Record<string, string[]>)) {
      expect(list.length, k).toBeGreaterThan(0);
      for (const s of list) expect(typeof s, k).toBe('string');
    }
  });
});

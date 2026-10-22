import { describe, it, expect } from 'vitest';
import { MAPS, MAP_IDS } from './index';
import questions from './questions.json';
import { validateQuestions, type MapQuestionsFile } from '../../engine/mapQuestions';

const data = questions as unknown as MapQuestionsFile;

describe('questions.json', () => {
  it('references only real rooms, tasks, sabotages and known placeholders', () => {
    expect(validateQuestions(data, MAPS)).toEqual([]);
  });

  it('has questions for every map', () => {
    for (const id of MAP_IDS) expect(data.maps[id]?.questions.length ?? 0).toBeGreaterThanOrEqual(5);
  });

  it('the validator catches a bad room id and a lie without a condition', () => {
    const bad: MapQuestionsFile = { maps: { mira: { questions: [{ id: 'x', when: { claimRoom: 'electrical' }, text: '{P} ?', weight: 0.5 }], lies: [{ id: 'y', when: {}, text: 'no', weight: 0.5 }] } } };
    const errs = validateQuestions(bad, MAPS);
    expect(errs.some(e => e.includes('room electrical not on mira'))).toBe(true);
    expect(errs.some(e => e.includes('needs a condition'))).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { pluralizeTurns, pluralizeWins, pluralizeSeconds } from '../src/utils/pluralize.js';

describe('Pluralize Helpers', () => {
  it('correctly pluralizes Russian turns (хода / ходов)', () => {
    expect(pluralizeTurns(1)).toBe('1 ход');
    expect(pluralizeTurns(2)).toBe('2 хода');
    expect(pluralizeTurns(4)).toBe('4 хода');
    expect(pluralizeTurns(5)).toBe('5 ходов');
    expect(pluralizeTurns(11)).toBe('11 ходов');
    expect(pluralizeTurns(21)).toBe('21 ход');
    expect(pluralizeTurns(22)).toBe('22 хода');
    expect(pluralizeTurns(25)).toBe('25 ходов');
  });

  it('correctly pluralizes Russian wins (победа / победы / побед)', () => {
    expect(pluralizeWins(1)).toBe('1 победа');
    expect(pluralizeWins(2)).toBe('2 победы');
    expect(pluralizeWins(4)).toBe('4 победы');
    expect(pluralizeWins(5)).toBe('5 побед');
    expect(pluralizeWins(11)).toBe('11 побед');
    expect(pluralizeWins(21)).toBe('21 победа');
    expect(pluralizeWins(22)).toBe('22 победы');
    expect(pluralizeWins(30)).toBe('30 побед');
  });

  it('correctly pluralizes Russian seconds (секунда / секунды / секунд)', () => {
    expect(pluralizeSeconds(1)).toBe('1 секунду');
    expect(pluralizeSeconds(2)).toBe('2 секунды');
    expect(pluralizeSeconds(4)).toBe('4 секунды');
    expect(pluralizeSeconds(5)).toBe('5 секунд');
    expect(pluralizeSeconds(11)).toBe('11 секунд');
    expect(pluralizeSeconds(15)).toBe('15 секунд');
    expect(pluralizeSeconds(21)).toBe('21 секунду');
    expect(pluralizeSeconds(22)).toBe('22 секунды');
    expect(pluralizeSeconds(30)).toBe('30 секунд');
  });
});

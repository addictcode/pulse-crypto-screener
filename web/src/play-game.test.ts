import { describe, expect, it } from 'vitest';

import { answerOf, coinToss, markPlayed, nextPack, priceRange, score, verdict, type Bar, type Round } from './play-game';

const round = (hour: number): Round => ({ id: String(hour), coin: 'XYZ', day: '2026-10-09', type: 'PUMP', at: 1, price: 1, hour, candles: [] });

describe('the game', () => {
  it('counts the answer by the sign of the hour', () => {
    expect(answerOf(round(2.1))).toBe('up');
    expect(answerOf(round(-1.4))).toBe('down');
  });

  it('scores the player and the coin on the same rounds', () => {
    const rounds = [round(2), round(-3), round(1.5)];
    expect(score(rounds, { pack: 1, picks: ['up', 'up', 'up'], coins: ['down', 'down', 'up'] })).toEqual({ you: 2, coin: 2 });
    expect(score(rounds, { pack: 1, picks: ['up'], coins: ['down'] })).toEqual({ you: 1, coin: 0 });
  });

  it('tosses a fair coin', () => {
    expect(coinToss(() => 0.2)).toBe('up');
    expect(coinToss(() => 0.7)).toBe('down');
  });

  it('never tells a winner they have a talent for trading', () => {
    for (const [you, coin] of [[9, 4], [5, 5], [2, 7]]) {
      const text = verdict(you, coin).toLowerCase();
      expect(text).not.toMatch(/talent|natural|trader|profit|predict/);
    }
    expect(verdict(8, 5)).toContain('luck');
  });

  it('deals packs not played yet, then the one played longest ago', () => {
    expect(nextPack(3, [])).toBe(1);
    expect(nextPack(3, [1, 3])).toBe(2);
    expect(nextPack(3, [2, 1, 3])).toBe(2);
    expect(markPlayed([2, 1, 3], 2)).toEqual([1, 3, 2]);
  });

  it('keeps the scale to the candles on screen, so it does not give the answer away', () => {
    const candles: Bar[] = [[10, 11, 9, 10], [10, 12, 10, 11], [11, 30, 11, 29]];
    const [lo, hi] = priceRange(candles, 2);
    expect(hi).toBeLessThan(13);
    expect(lo).toBeLessThan(9);
    expect(priceRange(candles, 3)[1]).toBeGreaterThan(30);
  });
});

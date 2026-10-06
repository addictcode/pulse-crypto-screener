import { describe, expect, it } from 'vitest';

import {
  atr,
  backtest,
  bollinger,
  ema,
  fairValueGaps,
  macd,
  rsi,
  sma,
  structure,
  supertrend,
  vwap,
  type Bar,
} from './indicators';

const bar = (i: number, open: number, high: number, low: number, close: number, volume = 1000): Bar => ({
  time: 1_700_000_000 + i * 60, open, high, low, close, volume,
});
/** Candles that close at the given prices, each with a 1-wide range around the close. */
const closes = (values: number[]) => values.map((c, i) => bar(i, values[i - 1] ?? c, c + 0.5, c - 0.5, c));

describe('moving averages', () => {
  it('sma averages the last n values and is null before that', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });

  it('ema is seeded with the sma and then follows the price', () => {
    const out = ema([1, 2, 3, 4, 5], 3);
    expect(out.slice(0, 2)).toEqual([null, null]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(3); // 4 * 0.5 + 2 * 0.5
    expect(out[4]).toBeCloseTo(4);
  });

  it('ema skips a warm-up prefix of nulls', () => {
    expect(ema([null, null, 2, 2, 2], 2)).toEqual([null, null, null, 2, 2]);
  });
});

describe('oscillators', () => {
  it('rsi is 100 when price only rises and 0 when it only falls', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3).at(-1)).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3).at(-1)).toBe(0);
  });

  it('macd of a flat market is zero', () => {
    const { line, signal, hist } = macd(new Array(60).fill(10));
    expect(line.at(-1)).toBe(0);
    expect(signal.at(-1)).toBe(0);
    expect(hist.at(-1)).toBe(0);
    expect(signal[32]).toBeNull(); // 26 bars for the slow ema, then 9 for the signal
    expect(signal[33]).toBe(0);
  });

  it('bollinger bands collapse onto the mean without volatility', () => {
    const { mid, upper, lower } = bollinger(new Array(25).fill(5), 20, 2);
    expect([mid[24], upper[24], lower[24]]).toEqual([5, 5, 5]);
    expect(mid[18]).toBeNull();
  });

  it('atr of identical candles equals their range', () => {
    const bars = Array.from({ length: 20 }, (_, i) => bar(i, 10, 11, 9, 10));
    expect(atr(bars, 14)[13]).toBeNull();
    expect(atr(bars, 14)[14]).toBeCloseTo(2);
    expect(atr(bars, 14)[19]).toBeCloseTo(2);
  });
});

describe('vwap', () => {
  it('weights by volume and starts over at midnight UTC', () => {
    const day = 86_400 * 20_000;
    const bars: Bar[] = [
      { time: day - 60, open: 50, high: 50, low: 50, close: 50, volume: 5000 },
      { time: day, open: 10, high: 10, low: 10, close: 10, volume: 100 }, // 10 coins
      { time: day + 60, open: 20, high: 20, low: 20, close: 20, volume: 600 }, // 30 coins
    ];
    const out = vwap(bars);
    expect(out[0]).toBe(50);
    expect(out[1]).toBe(10);
    expect(out[2]).toBeCloseTo(700 / 40);
  });
});

describe('supertrend', () => {
  it('turns down after a rally reverses hard', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 129 - i * 3);
    const { dir, flips } = supertrend(closes([...up, ...down]), 10, 3);
    expect(dir[29]).toBe(1);
    expect(dir.at(-1)).toBe(-1);
    expect(flips.some((f) => f.dir === -1 && f.i > 30)).toBe(true);
  });
});

describe('smart money', () => {
  it('finds an unfilled fair value gap and drops it once price trades back into it', () => {
    const gap = [bar(0, 10, 11, 9, 10), bar(1, 11, 14, 11, 14), bar(2, 14, 15, 13, 15)];
    expect(fairValueGaps(gap)).toEqual([{ from: 1, top: 13, bottom: 11, bull: true }]);
    const filled = [...gap, bar(3, 15, 15, 10.5, 11)];
    expect(fairValueGaps(filled)).toEqual([]);
  });

  it('marks a break of structure only after the swing is confirmed', () => {
    // a swing high at 20 on bar 4, confirmed by four lower bars after it, then a close above it
    const prices = [10, 12, 14, 16, 20, 16, 15, 14, 13, 21];
    const bars = prices.map((c, i) => bar(i, prices[i - 1] ?? c, c, c - 1, c));
    const { breaks } = structure(bars);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ from: 4, to: 9, fromPrice: 20, bull: true, label: 'BOS' });
  });
});

describe('backtest', () => {
  const rules = { stopAtr: 1, targetAtr: 2, maxBars: 3 };
  const range = new Array(10).fill(1);

  it('books the target in R', () => {
    const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 102.5, 99.5, 102)];
    const { trades, stats } = backtest(bars, (i) => (i === 0 ? 1 : 0), range, rules);
    expect(trades[0].r).toBe(2);
    expect(stats).toMatchObject({ trades: 1, winRate: 100, netR: 2 });
  });

  it('assumes the stop was hit first when one candle touches both', () => {
    const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 103, 98, 101)];
    const { trades } = backtest(bars, (i) => (i === 0 ? 1 : 0), range, rules);
    expect(trades[0].r).toBe(-1);
  });

  it('closes a stale trade at market for a partial result', () => {
    const flat = [0, 1, 2, 3].map((i) => bar(i, 100, 100.6, 99.6, i === 3 ? 100.5 : 100));
    const { trades } = backtest(flat, (i) => (i === 0 ? 1 : 0), range, rules);
    expect(trades[0].exitIndex).toBe(3);
    expect(trades[0].r).toBeCloseTo(0.5);
  });

  it('keeps one position at a time and reports the open one', () => {
    const bars = [bar(0, 100, 100, 100, 100), bar(1, 100, 100.5, 99.5, 100.2), bar(2, 100, 100.5, 99.5, 100.4)];
    const { trades, open } = backtest(bars, () => 1, range, rules);
    expect(trades).toEqual([]);
    expect(open).toMatchObject({ entryIndex: 0, open: true });
    expect(open!.r).toBeCloseTo(0.4);
  });
});

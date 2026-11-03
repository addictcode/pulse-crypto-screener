import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { type Candle, changePct, natr, openInterestChangePct, type OpenInterestPoint, sparkline, surge, toBuckets } from './metrics';
import { detectWalls, type Levels } from './walls';

// The demo computes the market in the browser with a copy of the backend's calculations. Both run
// the inputs in parity.json; the backend is the reference and wrote the expected values
// (backend/src/test/java/dev/pulse/market/ParityTest.java). When this fails, the copy has
// drifted from the server: bring it back, do not rewrite the expected values from here.
interface Fixture {
  metrics: {
    candles: Candle[];
    price: number;
    now: number;
    openInterest: OpenInterestPoint[];
    expected: {
      changePct: Record<string, number | null>;
      surge: number | null;
      natr14: number | null;
      sparkline24: number[];
      openInterestChangePct15: number | null;
      buckets5: Candle[];
    };
  };
  walls: {
    bids: Levels;
    asks: Levels;
    volume24h: number;
    params: { bucketPct: number; multiple: number; minNotional: number; volumeShare: number; maxPerSide: number };
    expected: Array<{ side: string; bucket: number; price: number; notional: number; multiple: number }>;
  };
}

const fixture = JSON.parse(readFileSync(new URL('./parity.json', import.meta.url), 'utf8')) as Fixture;

/** Equal to a billionth of the size, or both missing. */
function same(actual: number | null, expected: number | null) {
  if (expected === null) return expect(actual).toBeNull();
  expect(actual).not.toBeNull();
  expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(Math.max(1e-9, Math.abs(expected) * 1e-9));
}

describe('the demo computes what the server computes', () => {
  const { candles, price, now, openInterest, expected } = fixture.metrics;

  it('price change over every window', () => {
    for (const [minutes, value] of Object.entries(expected.changePct)) same(changePct(candles, price, Number(minutes)), value);
  });

  it('volume surge, NATR and open interest change', () => {
    same(surge(candles), expected.surge);
    same(natr(candles, 14), expected.natr14);
    same(openInterestChangePct(openInterest, now, 15), expected.openInterestChangePct15);
  });

  it('five-minute buckets and the sparkline', () => {
    const buckets = toBuckets(candles, 5);
    expect(buckets).toHaveLength(expected.buckets5.length);
    buckets.forEach((b, i) => {
      const e = expected.buckets5[i];
      expect(b.openTime).toBe(e.openTime);
      for (const key of ['open', 'high', 'low', 'close', 'quoteVolume'] as const) same(b[key], e[key]);
    });
    const line = sparkline(candles, 24);
    expect(line).toHaveLength(expected.sparkline24.length);
    line.forEach((v, i) => same(v, expected.sparkline24[i]));
  });

  it('walls on a book both sides read the same way', () => {
    const { bids, asks, volume24h, params } = fixture.walls;
    const mid = (bids[0][0] + asks[0][0]) / 2;
    const width = (mid * params.bucketPct) / 100;
    const walls = detectWalls(bids, asks, width, volume24h, { ...params, maxDistancePct: 5 });
    expect(walls.map((w) => [w.side, w.bucket])).toEqual(fixture.walls.expected.map((w) => [w.side, w.bucket]));
    walls.forEach((w, i) => {
      const e = fixture.walls.expected[i];
      same(w.price, e.price);
      same(w.notional, e.notional);
      same(w.multiple, e.multiple);
    });
  });
});

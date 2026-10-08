import { describe, expect, it } from 'vitest';

import type { SymbolMetrics } from '../types';
import { compareVenues } from './compare';
import { candleFromTicker, klineToCandle, mergeHistory, tapeItems, upsertCandle } from './feed';
import { changePct, natr, openInterestChangePct, sparkline, surge, toBuckets, type Candle } from './metrics';
import { coveragePct, detectWalls, WALL_PARAMS, WallTracker, type Levels } from './walls';

// The same cases as MetricsCalculatorTest on the backend: the demo must show the same numbers.
const T0 = 1_791_150_000_000 - (1_791_150_000_000 % 300_000);
const candle = (minute: number, open: number, high: number, low: number, close: number, volume: number): Candle => ({
  openTime: T0 + minute * 60_000, open, high, low, close, quoteVolume: volume,
});
const flat = (count: number, price: number) => Array.from({ length: count }, (_, i) => candle(i, price, price, price, price, 1_000));

describe('metrics, as on the backend', () => {
  it('measures change from the open of the candle N minutes back', () => {
    const candles = flat(10, 100);
    candles[5] = candle(5, 95, 96, 94, 96, 1_000);
    expect(changePct(candles, 104.5, 5)).toBeCloseTo(10, 9);
    expect(changePct(flat(3, 100), 101, 5)).toBeNull();
  });

  it('compares the last five minutes with the hourly pace', () => {
    const candles = [
      ...Array.from({ length: 60 }, (_, i) => candle(i, 100, 100, 100, 100, 1_000)),
      ...Array.from({ length: 5 }, (_, i) => candle(60 + i, 100, 100, 100, 100, 6_000)),
    ];
    expect(surge(candles)).toBeCloseTo(6, 9);
    expect(surge(flat(20, 100))).toBeNull();
  });

  it('reads NATR of constant-range bars as range over price', () => {
    const candles = Array.from({ length: 100 }, (_, i) => candle(i, 100, 101, 99, 100, 1_000));
    expect(natr(candles, 14)).toBeCloseTo(2, 9);
  });

  it('aligns buckets to wall-clock five minutes', () => {
    const candles = Array.from({ length: 12 }, (_, i) => candle(i, 100 + i, 100 + i + 0.5, 100 + i - 0.5, 100 + i + 0.2, 10));
    const buckets = toBuckets(candles, 5);
    expect(buckets).toHaveLength(3);
    expect(buckets[0]).toMatchObject({ openTime: T0, open: 100, high: 104.5, low: 99.5, close: 104.2, quoteVolume: 50 });
    expect(sparkline(candles, 2)).toEqual([109.2, 111.2]);
  });

  it('measures open interest against the newest point at least 15 minutes old', () => {
    const now = T0 + 20 * 60_000;
    const history = [0, 5, 10, 15, 20].map((m, i) => ({ time: T0 + m * 60_000, contracts: 1000 + i * 10 }));
    // the point 15 minutes back is the one at minute 5: 1010 contracts
    expect(openInterestChangePct(history, now, 15)).toBeCloseTo((1040 / 1010 - 1) * 100, 9);
    expect(openInterestChangePct(history.slice(-1), now, 15)).toBeNull();
  });
});

describe('candles in the browser', () => {
  it('replaces the forming candle and appends the next one', () => {
    const candles = [candle(0, 1, 1, 1, 1, 5)];
    upsertCandle(candles, candle(0, 1, 2, 1, 2, 9));
    upsertCandle(candles, candle(1, 2, 2, 2, 2, 1));
    upsertCandle(candles, candle(0, 9, 9, 9, 9, 9)); // a late update for an old minute is ignored
    expect(candles.map((c) => [c.close, c.quoteVolume])).toEqual([[2, 9], [2, 1]]);
  });

  it('builds minute candles from tickers for pairs without their own stream', () => {
    const candles: Candle[] = [];
    candleFromTicker(candles, T0 + 1_000, 100, 0);
    candleFromTicker(candles, T0 + 30_000, 103, 500);
    candleFromTicker(candles, T0 + 59_000, 99, 250);
    candleFromTicker(candles, T0 + 61_000, 101, 40);
    expect(candles).toEqual([
      { openTime: T0, open: 100, high: 103, low: 99, close: 99, quoteVolume: 750 },
      { openTime: T0 + 60_000, open: 99, high: 101, low: 101, close: 101, quoteVolume: 40 },
    ]);
  });

  it('lets real history replace ticker-built candles but not a real stream', () => {
    const history = [candle(0, 1, 1, 1, 1, 100), candle(1, 1, 1, 1, 1, 100)];
    const live = [candle(1, 1, 1, 1, 1.5, 7), candle(2, 1.5, 2, 1.5, 2, 3)];
    expect(mergeHistory(live, history, false).map((c) => c.quoteVolume)).toEqual([100, 100, 3]);
    expect(mergeHistory(live, history, true).map((c) => c.quoteVolume)).toEqual([100, 7, 3]);
  });

  it('reads a REST kline', () => {
    expect(klineToCandle([T0, '1.0', '1.5', '0.9', '1.2', '300', T0 + 59_999, '345.6'])).toEqual({
      openTime: T0, open: 1, high: 1.5, low: 0.9, close: 1.2, quoteVolume: 345.6,
    });
  });
});

describe('tape rules, as on the backend', () => {
  const row = (over: Partial<SymbolMetrics>): SymbolMetrics => ({
    symbol: 'WIFUSDT', price: 0.84, ch1m: 0, ch5m: 0, ch15m: 0, ch1h: 0, ch24h: 0, high24h: 1, low24h: 0.5, vol24h: 1e9,
    surge: 1, natr: 1, funding: 0.01, nextFunding: 0, oi: 1e8, oiCh15m: 0, liq5m: 0, ...over,
  });

  it('names what moved and which way', () => {
    const items = tapeItems(row({ ch1m: 1.2, ch5m: -2.5, surge: 3.4, oiCh15m: -3 }), 0, 0, 1);
    expect(items.map((i) => i.kind)).toEqual(['PUMP_1M', 'DUMP_5M', 'VOLUME', 'OI_DOWN']);
    expect(tapeItems(row({}), 100_000, 60_000, 1).map((i) => [i.kind, i.value])).toEqual([['LIQ_LONGS', 160_000]]);
  });

  it('ignores thin markets', () => {
    expect(tapeItems(row({ ch1m: 9, vol24h: 1e6 }), 0, 0, 1)).toEqual([]);
  });
});

describe('walls', () => {
  // a book around 100 with one heavy bid at 99.5
  const bids: Levels = Array.from({ length: 60 }, (_, i) => [100 - 0.05 * (i + 1), i === 9 ? 5_000 : 20]);
  const asks: Levels = Array.from({ length: 60 }, (_, i) => [100 + 0.05 * (i + 1), 20]);

  it('finds the level that dwarfs the book around it', () => {
    const walls = detectWalls(bids, asks, 0.05, 1e8, WALL_PARAMS);
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({ side: 'BID', price: 99.5 });
    expect(walls[0].notional).toBeCloseTo(497_500, 0);
    expect(walls[0].multiple).toBeGreaterThan(100);
  });

  it('wants more on a market that trades more', () => {
    expect(detectWalls(bids, asks, 0.05, 1e10, WALL_PARAMS)).toEqual([]);
  });

  it('knows how far the snapshot reaches', () => {
    expect(coveragePct(bids, asks)).toBeCloseTo(3, 6);
  });

  it('remembers when a wall first appeared and forgives one missed scan', () => {
    const tracker = new WallTracker(90_000);
    const width = tracker.bucketWidth('WIFUSDT', 100, 0.05);
    const detected = detectWalls(bids, asks, width, 1e8, WALL_PARAMS);
    expect(tracker.update('WIFUSDT', detected, 1_000)[0].firstSeen).toBe(1_000);
    tracker.update('WIFUSDT', [], 31_000);
    expect(tracker.update('WIFUSDT', detected, 61_000)[0].firstSeen).toBe(1_000);
    tracker.update('WIFUSDT', [], 200_000);
    expect(tracker.update('WIFUSDT', detected, 230_000)[0].firstSeen).toBe(230_000);
  });
});

describe('Binance against Bybit in the browser', () => {
  const home = { symbol: 'WIFUSDT', price: 100, funding: 0.02, oi: 300e6 } as SymbolMetrics;
  const away = { symbol: 'WIFUSDT', lastPrice: '100.05', fundingRate: '0.0001', fundingIntervalHour: '8', openInterestValue: '100000000', turnover24h: '500000000' };

  it('brings both funding rates to eight hours, like the backend', () => {
    // Binance +0.02% every 4 hours is 0.04% per 8; Bybit pays 0.01% per 8
    expect(compareVenues(home, 4, away)).toMatchObject({ gap: 0.05, spread8h: 0.03, spreadApr: 32.9, oiShare: 0.25, homeHours: 4 });
  });

  it('keeps missing numbers missing', () => {
    const gap = compareVenues({ ...home, funding: null, oi: null }, 8, { ...away, fundingRate: '', openInterestValue: '' });
    expect(gap).toMatchObject({ spread8h: null, spreadApr: null, oiShare: null, funding: null });
    expect(compareVenues(home, 8, { ...away, lastPrice: '' })).toBeNull();
  });
});

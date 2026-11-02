import { describe, expect, it } from 'vitest';

import { applySummary, type Summary } from './api';
import { Market } from './market';
import type { Signal, TapeItem } from './types';

const signal = (id: number, time: number, ret1h: number | null = null): Signal => ({
  id, type: 'PUMP', symbol: 'WIFUSDT', time, price: 1, value: 2.5, title: `s${id}`, detail: '',
  direction: 1, ret5m: null, ret15m: null, ret1h,
});
const tape = (symbol: string, time: number): TapeItem => ({ kind: 'PUMP_5M', symbol, time, price: 1, value: 2.8 });

const summary = (over: Partial<Summary> = {}): Summary => ({
  ts: 1,
  rows: [{ symbol: 'WIFUSDT', price: 0.84, ch5m: 2.8, ch24h: 9.6, vol24h: 6e8 }],
  liquidations: [],
  walls: { ts: 1, walls: [], coverage: { WIFUSDT: 0.1 } },
  signals: [],
  tape: [],
  ...over,
});

describe('the landing summary', () => {
  it('fills the market as the stream would, with the fields it leaves out empty', () => {
    const market = new Market();
    applySummary(market, summary());

    const row = market.rows.get('WIFUSDT')!;
    expect(row.price).toBe(0.84);
    expect(row.ch24h).toBe(9.6);
    expect(row.funding).toBeNull();
    expect(market.coverage.get('WIFUSDT')).toBe(0.1);
  });

  it('takes the first poll as history and later ones as news', () => {
    const market = new Market();
    const announced: string[] = [];
    market.newTape.on((items) => announced.push(...items.map((t) => t.symbol)));
    market.newSignals.on((items) => announced.push(...items.map((s) => s.title)));

    applySummary(market, summary({ tape: [tape('BTCUSDT', 10)], signals: [signal(1, 10)] }));
    expect(announced).toEqual([]);

    // the next poll repeats what was there and adds what happened since
    applySummary(market, summary({ tape: [tape('SOLUSDT', 20), tape('ETHUSDT', 20), tape('BTCUSDT', 10)], signals: [signal(2, 20), signal(1, 10)] }));
    expect(announced).toEqual(['s2', 'SOLUSDT', 'ETHUSDT']);
    expect(market.tape).toHaveLength(3);
    expect(market.signals).toHaveLength(2);
  });

  it('news after an empty first poll is still news', () => {
    const market = new Market();
    const announced: string[] = [];
    market.newTape.on((items) => announced.push(...items.map((t) => t.symbol)));
    applySummary(market, summary());
    applySummary(market, summary({ tape: [tape('SOLUSDT', 20)] }));
    // an empty first answer is the history: the first real item after it is not swallowed
    expect(announced).toEqual(['SOLUSDT']);
  });

  it('a signal already shown gets its outcome from a later poll', () => {
    const market = new Market();
    applySummary(market, summary({ signals: [signal(1, 10)] }));
    applySummary(market, summary({ signals: [signal(1, 10, 1.4)] }));
    expect(market.signals[0].ret1h).toBe(1.4);
  });
});

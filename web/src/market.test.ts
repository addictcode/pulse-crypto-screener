import { describe, expect, it } from 'vitest';

import { Market } from './market';
import type { Signal, SymbolMetrics, Wall } from './types';

const row = (symbol: string, price: number): SymbolMetrics => ({
  symbol, price, ch1m: 0, ch5m: 0, ch15m: 0, ch1h: 0, ch24h: 1, high24h: price, low24h: price, vol24h: 1e9,
  surge: 1, natr: 1, funding: 0.01, nextFunding: 0, oi: 1e8, oiCh15m: 0, liq5m: 0,
});

const signal = (id: number, time: number): Signal => ({
  id, type: 'PUMP', symbol: 'WIFUSDT', time, price: 1, value: 2.5, title: `s${id}`, detail: '',
});

const wall = (symbol: string, distance: number): Wall => ({
  symbol, side: distance < 0 ? 'BID' : 'ASK', price: 1, size: 1e6, distance, multiple: 10, age: 60, eatMinutes: 5,
});

describe('Market', () => {
  it('merges partial deltas into the rows it already has', () => {
    const market = new Market();
    market.apply({ type: 'snapshot', ts: 1, rows: [row('WIFUSDT', 1.0)], liquidations: [] });
    const seen: Array<[number | undefined, number]> = [];
    market.delta.on((changes) => changes.forEach(([prev, next]) => seen.push([prev?.price, next.price])));

    market.apply({ type: 'delta', ts: 2, rows: [{ symbol: 'WIFUSDT', price: 1.05 }] });

    const merged = market.rows.get('WIFUSDT')!;
    expect(merged.price).toBe(1.05);
    expect(merged.funding).toBe(0.01); // untouched fields survive
    expect(seen).toEqual([[1.0, 1.05]]);
    expect(market.lastTick).toBe(2);
  });

  it('ignores a partial row for a symbol it has never seen', () => {
    const market = new Market();
    market.apply({ type: 'snapshot', ts: 1, rows: [], liquidations: [] });

    market.apply({ type: 'delta', ts: 2, rows: [{ symbol: 'NEWUSDT', ch5m: 1 }] });

    expect(market.rows.has('NEWUSDT')).toBe(false);
  });

  it('keeps signals unique and newest first across reconnects', () => {
    const market = new Market();
    market.apply({ type: 'signals', items: [signal(2, 200), signal(1, 100)] });
    market.apply({ type: 'signals', items: [signal(3, 300)] });
    market.apply({ type: 'signals', items: [signal(3, 300), signal(2, 200)] }); // history again after reconnect

    expect(market.signals.map((s) => s.id)).toEqual([3, 2, 1]);
  });

  it('only reports a single live signal as fresh', () => {
    const market = new Market();
    const fresh: number[][] = [];
    market.newSignals.on((items) => fresh.push(items.map((s) => s.id)));

    market.apply({ type: 'signals', items: [signal(1, 100), signal(2, 200)] });
    market.apply({ type: 'signals', items: [signal(3, 300)] });

    expect(fresh).toEqual([[], [3]]);
  });

  it('groups walls by symbol and keeps the nearest first', () => {
    const market = new Market();
    market.apply({
      type: 'walls', ts: 1,
      walls: [wall('WIFUSDT', -0.2), wall('SOLUSDT', 0.5), wall('WIFUSDT', 1.4)],
      coverage: { WIFUSDT: 4.2, SOLUSDT: 1.1 },
    });

    expect(market.wallsFor('WIFUSDT').map((w) => w.distance)).toEqual([-0.2, 1.4]);
    expect(market.nearestWall('SOLUSDT')?.distance).toBe(0.5);
    expect(market.nearestWall('BTCUSDT')).toBeNull();
    expect(market.coverage.get('WIFUSDT')).toBe(4.2);
  });
});

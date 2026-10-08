import { describe, expect, it } from 'vitest';

import { matches, metricValue, parseNumber, sanitize, type Rule } from './filters';
import type { SymbolMetrics, VenueGap, Wall } from './types';

const row = (over: Partial<SymbolMetrics> = {}): SymbolMetrics => ({
  symbol: 'WIFUSDT', price: 1, ch1m: 0, ch5m: 2.5, ch15m: 1, ch1h: -4, ch24h: 12, high24h: 1, low24h: 1, vol24h: 250e6,
  surge: 3.2, natr: 1.1, funding: -0.05, nextFunding: 0, oi: 1e8, oiCh15m: null, liq5m: 400_000, ...over,
});
const wall = { distance: -0.4 } as Wall;
const gap = { spread8h: -0.06 } as VenueGap;

describe('custom screener rules', () => {
  it('needs every rule to hold', () => {
    const rules: Rule[] = [{ metric: 'ch5m', op: 'gte', value: 2 }, { metric: 'surge', op: 'gte', value: 3 }];
    expect(matches(rules, row(), null, undefined)).toBe(true);
    expect(matches(rules, row({ surge: 2.9 }), null, undefined)).toBe(false);
  });

  it('reads volume in millions and liquidations in thousands', () => {
    expect(matches([{ metric: 'vol24h', op: 'gte', value: 200 }], row(), null, undefined)).toBe(true);
    expect(matches([{ metric: 'vol24h', op: 'gte', value: 300 }], row(), null, undefined)).toBe(false);
    expect(matches([{ metric: 'liq5m', op: 'gte', value: 400 }], row(), null, undefined)).toBe(true);
  });

  it('compares both ways and by size', () => {
    expect(matches([{ metric: 'ch1h', op: 'lte', value: -3 }], row(), null, undefined)).toBe(true);
    expect(matches([{ metric: 'ch1h', op: 'gte', value: 3 }], row(), null, undefined)).toBe(false);
    expect(matches([{ metric: 'ch1h', op: 'abs', value: 3 }], row(), null, undefined)).toBe(true);
    expect(matches([{ metric: 'funding', op: 'abs', value: 0.03 }], row(), null, undefined)).toBe(true);
  });

  it('does not match on a figure that is not known yet', () => {
    expect(matches([{ metric: 'oiCh15m', op: 'lte', value: 100 }], row(), null, undefined)).toBe(false);
    expect(matches([{ metric: 'wall', op: 'lte', value: 1 }], row(), null, undefined)).toBe(false);
  });

  it('measures a wall by its distance and the Bybit gap by its spread', () => {
    expect(metricValue('wall', row(), wall, gap)).toBe(0.4);
    expect(matches([{ metric: 'wall', op: 'lte', value: 0.5 }], row(), wall, gap)).toBe(true);
    expect(matches([{ metric: 'fgap', op: 'abs', value: 0.05 }], row(), wall, gap)).toBe(true);
  });
});

describe('stored presets', () => {
  it('keeps what it understands and drops the rest', () => {
    const stored = [
      { id: 'a', name: '  Squeeze  ', rules: [{ metric: 'ch5m', op: 'gte', value: 2 }, { metric: 'nonsense', op: 'gte', value: 1 }] },
      { id: 'b', name: '', rules: [{ metric: 'ch5m', op: 'gte', value: 2 }] },
      { id: 'c', name: 'Empty', rules: [] },
      'garbage',
      null,
    ];
    expect(sanitize(stored)).toEqual([{ id: 'a', name: 'Squeeze', rules: [{ metric: 'ch5m', op: 'gte', value: 2 }] }]);
    expect(sanitize('not a list')).toEqual([]);
  });
});

describe('parseNumber', () => {
  it('accepts a decimal comma and a minus', () => {
    expect(parseNumber('5,5')).toBe(5.5);
    expect(parseNumber(' -0.03 ')).toBe(-0.03);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import { crossed, parseLevel, type PriceAlert } from './alerts';

const alert = (level: number, above: boolean): PriceAlert => ({ id: 1, symbol: 'BTCUSDT', level, above, created: 0 });

describe('crossed', () => {
  it('fires on the way up only for alerts set above the price', () => {
    expect(crossed(alert(100, true), 99.9)).toBe(false);
    expect(crossed(alert(100, true), 100)).toBe(true);
    expect(crossed(alert(100, true), 104)).toBe(true);
  });

  it('fires on the way down only for alerts set below the price', () => {
    expect(crossed(alert(100, false), 100.1)).toBe(false);
    expect(crossed(alert(100, false), 100)).toBe(true);
    expect(crossed(alert(100, false), 97)).toBe(true);
  });

  it('ignores a missing price', () => {
    expect(crossed(alert(100, false), 0)).toBe(false);
  });
});

describe('parseLevel', () => {
  it('reads the ways people type a price', () => {
    expect(parseLevel('85000')).toBe(85000);
    expect(parseLevel('85,000.5')).toBe(85000.5);
    expect(parseLevel('85,000')).toBe(85000);
    expect(parseLevel(' 85 000 ')).toBe(85000);
    expect(parseLevel('0,0845')).toBe(0.0845);
    expect(parseLevel('$1.25')).toBe(1.25);
    expect(parseLevel('.5')).toBe(0.5);
  });

  it('rejects everything else', () => {
    expect(parseLevel('')).toBeNull();
    expect(parseLevel('abc')).toBeNull();
    expect(parseLevel('-5')).toBeNull();
    expect(parseLevel('0')).toBeNull();
    expect(parseLevel('1.2.3')).toBeNull();
  });
});

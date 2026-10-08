import { describe, expect, it } from 'vitest';

import { matchRank } from './palette';
import { parseHash } from './views';

describe('parseHash', () => {
  it('reads the view and the optional pair', () => {
    expect(parseHash('#heatmap')).toEqual({ view: 'heatmap', symbol: null });
    expect(parseHash('#screener:SOLUSDT')).toEqual({ view: 'screener', symbol: 'SOLUSDT' });
    expect(parseHash('#signals:1000PEPEUSDT')).toEqual({ view: 'signals', symbol: '1000PEPEUSDT' });
  });

  it('falls back to the terminal and ignores anything that is not a ticker', () => {
    expect(parseHash('')).toEqual({ view: 'screener', symbol: null });
    expect(parseHash('#nonsense:BTCUSDT')).toEqual({ view: 'screener', symbol: 'BTCUSDT' });
    expect(parseHash('#grid:<script>')).toEqual({ view: 'grid', symbol: null });
  });
});

describe('matchRank', () => {
  it('prefers the exact ticker, then a prefix, then any match', () => {
    expect(matchRank('SOLUSDT', 'SOL')).toBe(0);
    expect(matchRank('SOLVUSDT', 'SOL')).toBe(1);
    expect(matchRank('1000SOLXUSDT', 'SOL')).toBe(2);
    expect(matchRank('BTCUSDT', 'SOL')).toBe(-1);
  });
});

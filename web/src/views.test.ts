import { describe, expect, it } from 'vitest';

import { matchRank } from './palette';
import { momentLink, parseHash, parseMoment } from './views';

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

describe('a shared moment', () => {
  const TF = ['1m', '5m', '15m', '1h', '4h', '1d'];

  it('reads the timeframe and the time, and old links still work', () => {
    expect(parseHash('#screener:SOLUSDT:15m:1793123456')).toEqual({ view: 'screener', symbol: 'SOLUSDT' });
    expect(parseMoment('#screener:SOLUSDT:15m:1793123456', TF)).toEqual({ tf: '15m', at: 1793123456 });
    expect(parseMoment('#screener:SOLUSDT', TF)).toEqual({ tf: null, at: null });
  });

  it('ignores a timeframe it does not know and a time that makes no sense', () => {
    expect(parseMoment('#screener:SOLUSDT:7m:1793123456', TF).tf).toBeNull();
    expect(parseMoment('#screener:SOLUSDT:15m:12', TF).at).toBeNull();
    expect(parseMoment('#screener:SOLUSDT:15m:9999999999', TF).at).toBeNull();
    expect(parseMoment('#screener:SOLUSDT:15m:<b>', TF).at).toBeNull();
  });

  it('builds a tagged link back to the moment', () => {
    expect(momentLink('https://pulse.example', '/app/', 'SOLUSDT', '15m', 1793123456.7)).toBe(
      'https://pulse.example/app/?utm_source=share#screener:SOLUSDT:15m:1793123456',
    );
    expect(momentLink('https://pulse.example', '/app/', 'SOLUSDT', '1h', null)).toBe('https://pulse.example/app/?utm_source=share#screener:SOLUSDT:1h');
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

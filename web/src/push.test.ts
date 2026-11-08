import { describe, expect, it } from 'vitest';

import { keyBytes, needsHomeScreen, watchedSymbols } from './push';

describe('web push', () => {
  it('asks an iPhone to add the site to the Home Screen first', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';
    expect(needsHomeScreen(iphone, false)).toBe(true);
    expect(needsHomeScreen(iphone, true)).toBe(false);
    expect(needsHomeScreen('Mozilla/5.0 (Linux; Android 15) Chrome/131 Mobile Safari/537.36', false)).toBe(false);
  });

  it('sends the pairs of all watchlists once', () => {
    expect(watchedSymbols([{ id: 'a', name: 'A', symbols: ['BTCUSDT', 'WIFUSDT'] }, { id: 'b', name: 'B', symbols: ['WIFUSDT', 'SOLUSDT'] }])).toEqual([
      'BTCUSDT', 'WIFUSDT', 'SOLUSDT',
    ]);
    expect(watchedSymbols(null)).toEqual([]);
  });

  it('turns the server key into the 65 bytes of a P-256 point', () => {
    const bytes = keyBytes('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});

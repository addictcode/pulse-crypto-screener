import { describe, expect, it } from 'vitest';

import { Market } from './market';
import { staleness } from './stale';

const T0 = 1_000_000;

function market(receivedAt: number, feedAge: number | null = null, feedAgeAt = receivedAt) {
  const m = new Market();
  m.receivedAt = receivedAt;
  m.feedAge = feedAge;
  m.feedAgeAt = feedAgeAt;
  return m;
}

describe('stale data', () => {
  it('is fresh while ticks arrive and the exchange is current', () => {
    expect(staleness(market(T0, 500), T0 + 5_000, T0, false)).toBeNull();
  });

  it('blames the server when nothing arrives', () => {
    expect(staleness(market(T0, 500), T0 + 31_000, T0, false)).toEqual({ kind: 'server', age: 31_000 });
    // nothing ever arrived since the page opened
    expect(staleness(market(0), T0 + 31_000, T0, false)?.kind).toBe('server');
  });

  it('blames the exchange when the server ticks but its data is old, counting the time since it said so', () => {
    expect(staleness(market(T0 + 9_000, 25_000, T0), T0 + 10_000, T0, false)).toEqual({ kind: 'exchange', age: 35_000 });
  });

  it('explains itself differently in the demo, which reads Binance from the browser', () => {
    expect(staleness(market(T0), T0 + 40_000, T0, true)?.kind).toBe('demo');
    expect(staleness(market(T0 + 39_000, 90_000), T0 + 40_000, T0, true)).toBeNull();
  });
});

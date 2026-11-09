import { describe, expect, it } from 'vitest';

import { BUCKETS, buckets } from './status-math';

const NOW = Date.UTC(2026, 10, 9, 12);
const minute = (minutesAgo: number, feedAge: number | null) => ({ t: NOW - minutesAgo * 60_000, feedAge, booksSynced: 1, books: 1 });

describe('the last day on /status/', () => {
  it('marks a quarter hour live, stale if any minute was, and empty without a record', () => {
    const parts = buckets([minute(1, 400), minute(2, 900), minute(20, 400), minute(21, 45_000), minute(22, null)], NOW);
    expect(parts).toHaveLength(BUCKETS);
    expect(parts[BUCKETS - 1]).toBe('live');
    expect(parts[BUCKETS - 2]).toBe('stale');
    expect(parts[0]).toBe('none');
  });

  it('leaves out minutes older than a day', () => {
    expect(buckets([minute(24 * 60 + 5, 100)], NOW).every((p) => p === 'none')).toBe(true);
  });
});

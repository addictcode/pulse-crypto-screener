import { STALE_MS } from './stale-ms';

export interface Minute {
  t: number;
  feedAge: number | null;
  booksSynced: number;
  books: number;
}

const DAY = 24 * 60 * 60_000;
export const BUCKETS = 96;

/** Each quarter hour of the last day: live, stale at some point, or not recorded. */
export function buckets(minutes: Minute[], now: number): Array<'live' | 'stale' | 'none'> {
  const size = DAY / BUCKETS;
  const out: Array<'live' | 'stale' | 'none'> = Array(BUCKETS).fill('none');
  for (const m of minutes) {
    const i = Math.floor((m.t - (now - DAY)) / size);
    if (i < 0 || i >= BUCKETS) continue;
    const stale = m.feedAge === null || m.feedAge > STALE_MS;
    if (stale) out[i] = 'stale';
    else if (out[i] === 'none') out[i] = 'live';
  }
  return out;
}


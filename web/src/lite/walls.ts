// Wall detection for the standalone demo: dev.pulse.depth.WallDetector and WallTracker in the
// browser. The server keeps live books from a diff stream; the demo re-reads a 500-level
// snapshot every half a minute, so ages are coarser and a wall can be gone for a while before
// the page notices.

export type Side = 'BID' | 'ASK';

/** [price, quantity] levels, best price first. */
export type Levels = Array<[number, number]>;

export interface Detected {
  side: Side;
  /** Identifies the wall across scans while the bucket width is unchanged. */
  bucket: number;
  price: number;
  notional: number;
  multiple: number;
}

export interface WallParams {
  /** Bucket width as a percent of price. */
  bucketPct: number;
  /** How many times the median bucket a wall must be. */
  multiple: number;
  /** Absolute floor in USD for any market. */
  minNotional: number;
  /** Floor as a share of 24h volume. */
  volumeShare: number;
  maxPerSide: number;
  /** Walls further than this from the price are ignored, percent. */
  maxDistancePct: number;
}

export const WALL_PARAMS: WallParams = {
  bucketPct: 0.05, multiple: 8, minNotional: 25_000, volumeShare: 0.0003, maxPerSide: 3, maxDistancePct: 5,
};

interface Bucket {
  notional: number;
  peakNotional: number;
  /** The single heaviest level in the bucket: where the wall actually sits. */
  peakPrice: number;
}

function bucketize(levels: Levels, width: number, mid: number, maxDistancePct: number): Map<number, Bucket> {
  const buckets = new Map<number, Bucket>();
  for (const [price, quantity] of levels) {
    if ((Math.abs(price - mid) / mid) * 100 > maxDistancePct) continue;
    // epsilon: 99.0 / 0.05 can come out as 1979.9999..., which would merge two neighbouring buckets
    const id = Math.floor(price / width + 1e-9);
    const notional = price * quantity;
    let bucket = buckets.get(id);
    if (!bucket) buckets.set(id, (bucket = { notional: 0, peakNotional: 0, peakPrice: price }));
    bucket.notional += notional;
    if (notional > bucket.peakNotional) {
      bucket.peakNotional = notional;
      bucket.peakPrice = price;
    }
  }
  return buckets;
}

/**
 * Buckets that are many times the typical bucket of this book and large in absolute terms for
 * this market. The absolute floor scales with daily volume, otherwise every level in BTC would
 * qualify next to a thin altcoin.
 */
export function detectWalls(bids: Levels, asks: Levels, width: number, volume24h: number, params: WallParams): Detected[] {
  if (!bids.length || !asks.length) return [];
  const mid = (bids[0][0] + asks[0][0]) / 2;
  const bidBuckets = bucketize(bids, width, mid, params.maxDistancePct);
  const askBuckets = bucketize(asks, width, mid, params.maxDistancePct);
  const sizes = [...bidBuckets.values(), ...askBuckets.values()].map((b) => b.notional).sort((a, b) => a - b);
  if (!sizes.length) return [];
  const middle = sizes.length >> 1;
  const median = sizes.length % 2 ? sizes[middle] : (sizes[middle - 1] + sizes[middle]) / 2;
  if (median <= 0) return [];
  const threshold = Math.max(median * params.multiple, params.minNotional, volume24h * params.volumeShare);
  const pick = (side: Side, buckets: Map<number, Bucket>): Detected[] =>
    [...buckets.entries()]
      .filter(([, b]) => b.notional >= threshold)
      .sort((a, b) => b[1].notional - a[1].notional)
      .slice(0, params.maxPerSide)
      .map(([bucket, b]) => ({ side, bucket, price: b.peakPrice, notional: b.notional, multiple: b.notional / median }));
  return [...pick('BID', bidBuckets), ...pick('ASK', askBuckets)];
}

/** How far from the mid the snapshot reaches on its thinner side, in percent. */
export function coveragePct(bids: Levels, asks: Levels): number {
  if (!bids.length || !asks.length) return 0;
  const mid = (bids[0][0] + asks[0][0]) / 2;
  return Math.min(((mid - bids[bids.length - 1][0]) / mid) * 100, ((asks[asks.length - 1][0] - mid) / mid) * 100);
}

export interface TrackedWall extends Detected {
  firstSeen: number;
}

/**
 * Gives walls a memory across scans, so one that has held for an hour can be told from one
 * placed a moment ago. A wall missing from a single scan keeps its age: market makers cancel and
 * re-place them to stay at the front of the queue.
 */
export class WallTracker {
  /** Rebuild the bucket grid when the price moved this much since it was chosen. */
  static readonly REGRID_DRIFT = 0.2;

  private readonly tracks = new Map<string, { reference: number; width: number; seen: Map<string, { firstSeen: number; lastSeen: number }> }>();
  private readonly graceMs: number;

  constructor(graceMs: number) {
    this.graceMs = graceMs;
  }

  bucketWidth(symbol: string, mid: number, bucketPct: number): number {
    let track = this.tracks.get(symbol);
    if (!track || Math.abs(mid / track.reference - 1) > WallTracker.REGRID_DRIFT) {
      track = { reference: mid, width: (mid * bucketPct) / 100, seen: new Map() };
      this.tracks.set(symbol, track);
    }
    return track.width;
  }

  update(symbol: string, detected: Detected[], now: number): TrackedWall[] {
    const track = this.tracks.get(symbol);
    if (!track) return [];
    const walls = detected.map((d) => {
      const key = `${d.side}:${d.bucket}`;
      let seen = track.seen.get(key);
      if (!seen) track.seen.set(key, (seen = { firstSeen: now, lastSeen: now }));
      seen.lastSeen = now;
      return { ...d, firstSeen: seen.firstSeen };
    });
    for (const [key, seen] of track.seen) if (now - seen.lastSeen > this.graceMs) track.seen.delete(key);
    return walls;
  }

  forget(symbol: string) {
    this.tracks.delete(symbol);
  }
}

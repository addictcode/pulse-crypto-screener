// The backend's market maths (dev.pulse.market.MetricsCalculator and SymbolState), in the
// browser. The standalone demo has no server: the page computes the same numbers from the same
// Binance data. Keep the two in step; metrics.test.ts repeats the Java tests.

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Traded value in USDT. */
  quoteVolume: number;
}

export interface OpenInterestPoint {
  time: number;
  contracts: number;
}

const MINUTE_MS = 60_000;
const BUCKET_MINUTES = 5;

/**
 * Price change over the last `minutes`, measured from the open of the candle that started that
 * many minutes ago (the forming candle counts as one). Null without enough history.
 */
export function changePct(candles: Candle[], price: number, minutes: number): number | null {
  if (minutes <= 0 || candles.length < minutes || price <= 0) return null;
  const reference = candles[candles.length - minutes].open;
  return reference > 0 ? (price / reference - 1) * 100 : null;
}

/** Traded value of the last 5 minutes against the average 5 minutes of the preceding hour. */
export function surge(candles: Candle[]): number | null {
  const recentMinutes = 5;
  const n = candles.length;
  if (n < recentMinutes + 30) return null;
  const sum = (from: number, to: number) => {
    let total = 0;
    for (let i = from; i < to; i++) total += candles[i].quoteVolume;
    return total;
  };
  const baseFrom = Math.max(0, n - recentMinutes - 60);
  const baseMinutes = n - recentMinutes - baseFrom;
  const average = (sum(baseFrom, n - recentMinutes) / baseMinutes) * recentMinutes;
  return average > 0 ? sum(n - recentMinutes, n) / average : null;
}

/** One-minute candles grouped into wall-clock aligned buckets (00:00, 00:05, ...). */
export function toBuckets(candles: Candle[], minutes: number): Candle[] {
  const size = minutes * MINUTE_MS;
  const buckets: Candle[] = [];
  let current: Candle | null = null;
  for (const c of candles) {
    const start = Math.floor(c.openTime / size) * size;
    if (!current || current.openTime !== start) {
      current = { openTime: start, open: c.open, high: c.high, low: c.low, close: c.close, quoteVolume: 0 };
      buckets.push(current);
    }
    current.high = Math.max(current.high, c.high);
    current.low = Math.min(current.low, c.low);
    current.close = c.close;
    current.quoteVolume += c.quoteVolume;
  }
  return buckets;
}

/** Normalized ATR in percent on 5-minute bars with Wilder smoothing. */
export function natr(candles: Candle[], period: number): number | null {
  const bars = toBuckets(candles, BUCKET_MINUTES);
  if (bars.length < period + 1) return null;
  const trueRange = (i: number) => {
    const previous = bars[i - 1].close;
    return Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - previous), Math.abs(bars[i].low - previous));
  };
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += trueRange(i);
  atr /= period;
  for (let i = period + 1; i < bars.length; i++) atr = (atr * (period - 1) + trueRange(i)) / period;
  const lastClose = bars[bars.length - 1].close;
  return lastClose > 0 ? (atr / lastClose) * 100 : null;
}

/** Closes of the last `points` 5-minute buckets, oldest first. */
export function sparkline(candles: Candle[], points: number): number[] {
  return toBuckets(candles, BUCKET_MINUTES).slice(-points).map((b) => b.close);
}

/**
 * Open interest change against the newest snapshot at least `minutes` old. Contracts, not USD,
 * so a price move does not leak into it.
 */
export function openInterestChangePct(history: OpenInterestPoint[], now: number, minutes: number): number | null {
  if (history.length < 2) return null;
  const cutoff = now - minutes * MINUTE_MS;
  let reference: OpenInterestPoint | null = null;
  for (const point of history) if (point.time <= cutoff) reference = point;
  if (!reference || reference.contracts <= 0) return null;
  return (history[history.length - 1].contracts / reference.contracts - 1) * 100;
}

export function round(value: number | null, decimals: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

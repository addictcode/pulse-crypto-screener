const MINUS = '−';

export type Tone = 'up' | 'down' | 'flat';

export const sign = (v: number) => (v > 0 ? '+' : v < 0 ? MINUS : '');

export const pct = (v: number | null, digits = 2) =>
  v === null ? '–' : `${sign(v)}${Math.abs(v).toFixed(digits)}%`;

export const usd = (v: number | null) => {
  if (v === null) return '–';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

/** Enough decimals to see a tick move on anything from BTC to 1000PEPE. */
export const priceDigits = (v: number) =>
  v >= 1000 ? 1 : v >= 10 ? 2 : v >= 0.1 ? 4 : v >= 0.01 ? 5 : v >= 0.001 ? 6 : 7;

export const px = (v: number | null) =>
  v === null
    ? '–'
    : v.toLocaleString('en-US', { minimumFractionDigits: priceDigits(v), maximumFractionDigits: priceDigits(v) });

export const tone = (v: number | null, threshold = 0.02): Tone =>
  v === null ? 'flat' : v > threshold ? 'up' : v < -threshold ? 'down' : 'flat';

export const hms = (time: number) => new Date(time).toISOString().slice(11, 19);

/** BTCUSDT -> BTC. Every pair here is USDT-margined, so the quote is noise. */
export const base = (symbol: string) => symbol.replace(/USDT$/, '');

export const countdown = (until: number | null, now = Date.now()) => {
  if (until === null) return '–';
  const minutes = Math.max(0, Math.round((until - now) / 60_000));
  return `in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
};

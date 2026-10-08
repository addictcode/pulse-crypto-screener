import { connect, type Market } from './market';
import type { CandleDto, OutcomeStats, Positioning, Signal, VenueGap } from './types';

/**
 * Built as the standalone demo: no Pulse server, the page talks to the exchanges itself. Set at
 * build time, so the normal build drops the demo's code entirely.
 */
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Chart history, oldest first. */
export async function candles(symbol: string, interval: string, limit: number): Promise<CandleDto[]> {
  if (!STANDALONE) return getJson(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
  const { BINANCE_REST, klineToCandle } = await import('./lite/feed');
  const klines = await getJson<Parameters<typeof klineToCandle>[0][]>(
    `${BINANCE_REST}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`,
  );
  return klines.map((k) => {
    const c = klineToCandle(k);
    return { time: c.openTime / 1000, open: c.open, high: c.high, low: c.low, close: c.close, volume: Math.round(c.quoteVolume) };
  });
}

/** The exchange publishes these statistics from 5 minutes up; a 1-minute chart uses the finest. */
const STATISTIC_PERIOD: Record<string, string> = { '1m': '5m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d' };

/** Open interest, long/short ratios and funding over time, for the panes under the chart. */
export async function positioning(symbol: string, interval: string, limit = 300): Promise<Positioning> {
  const period = STATISTIC_PERIOD[interval] ?? '5m';
  if (!STANDALONE) return getJson(`/api/positioning?symbol=${encodeURIComponent(symbol)}&period=${period}&limit=${limit}`);
  return (await import('./lite/positioning')).positioningFromBinance(symbol, period, limit);
}

/** Binance against Bybit, pair by pair. */
export async function compare(market: Market): Promise<VenueGap[]> {
  if (!STANDALONE) return getJson('/api/compare');
  return (await import('./lite/compare')).compareWithBybit(market);
}

/** Stored signals, newest first. The demo has no server to store them. */
export async function signalHistory(limit: number): Promise<Signal[]> {
  return STANDALONE ? [] : getJson(`/api/signals?limit=${limit}`);
}

export async function signalStats(days: number): Promise<OutcomeStats[]> {
  return STANDALONE ? [] : getJson(`/api/signals/stats?days=${days}`);
}

/**
 * Starts the market feed: the backend's stream, or in the demo the browser's own connection to
 * Binance. Resolves once the feed is running; rejects when the demo cannot reach the exchange.
 */
export async function startFeed(market: Market): Promise<void> {
  if (STANDALONE) {
    const { BrowserFeed } = await import('./lite/feed');
    await new BrowserFeed(market).start();
    return;
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  connect(market, `${scheme}://${location.host}/ws/market`);
}

/**
 * Polls the Binance against Bybit comparison. It is not part of the stream: funding spreads move
 * slowly. The demo downloads Bybit's whole ticker list each time, so it asks less often.
 */
export function watchVenues(market: Market) {
  const poll = async (force = false) => {
    // a background tab keeps what it has; the first load happens either way
    if (document.hidden && !force) return;
    try {
      market.setGaps(await compare(market));
    } catch {
      // the previous comparison stays on screen until the next poll works
    }
  };
  // the demo joins with rows it has to load first
  setTimeout(() => void poll(true), STANDALONE ? 6_000 : 0);
  setInterval(() => void poll(), STANDALONE ? 60_000 : 10_000);
  document.addEventListener('visibilitychange', () => void poll());
}

import { connect, type Market } from './market';
import type { CandleDto, Liquidation, OutcomeStats, Positioning, SetupBoard, Signal, SymbolMetrics, TapeItem, TelegramLinks, VenueGap, Wall } from './types';

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
export async function positioning(symbol: string, interval: string, limit = 500): Promise<Positioning> {
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

export async function setupBoard(): Promise<SetupBoard> {
  return STANDALONE ? { open: [], closed: [], stats: [], since: null } : getJson('/api/setups');
}

/** The bot and the channel the site may link to; the demo has neither. */
export async function telegramLinks(): Promise<TelegramLinks> {
  return STANDALONE ? { bot: '', channel: '' } : getJson('/api/links');
}

export async function signalStats(days: number): Promise<OutcomeStats[]> {
  return STANDALONE ? [] : getJson(`/api/signals/stats?days=${days}`);
}

/**
 * Starts the market feed: the backend's stream, or in the demo the browser's own connection to
 * Binance. Resolves once the feed is running; rejects when the demo cannot reach the exchange.
 */
export async function startFeed(market: Market, keepInBackground?: () => boolean): Promise<void> {
  if (STANDALONE) {
    const { BrowserFeed } = await import('./lite/feed');
    await new BrowserFeed(market).start();
    return;
  }
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  connect(market, `${scheme}://${location.host}/ws/market`, keepInBackground);
}

/** What GET /api/summary answers: the landing's share of the stream (dev.pulse.api.SummaryController). */
export interface Summary {
  ts: number;
  rows: Array<Pick<SymbolMetrics, 'symbol' | 'price' | 'ch5m' | 'ch24h' | 'vol24h'>>;
  liquidations: Liquidation[];
  walls: { ts: number; walls: Wall[]; coverage: Record<string, number> };
  signals: Signal[];
  tape: TapeItem[];
}

/** How often the landing asks; the server rebuilds the answer at most every 2 seconds. */
export const SUMMARY_MS = 5_000;

/** A summary fed to the market as the stream messages it stands for. */
export function applySummary(market: Market, summary: Summary) {
  const rows = summary.rows.map((row): SymbolMetrics => ({
    ch1m: null, ch15m: null, ch1h: null, high24h: null, low24h: null, surge: null, natr: null,
    funding: null, nextFunding: null, oi: null, oiCh15m: null, liq5m: 0, ...row,
  }));
  market.apply({ type: 'snapshot', ts: summary.ts, rows, liquidations: summary.liquidations });
  market.apply({ type: 'walls', ...summary.walls });
  market.apply({ type: 'signals', items: summary.signals });
  // a signal already shown gets its outcome once the hour has passed
  market.apply({ type: 'outcomes', items: summary.signals });
  market.apply({ type: 'tape', items: summary.tape });
}

/**
 * The landing's feed: a poll of /api/summary while the tab is visible, not the full stream. Most
 * visitors only see the landing; this keeps them off the stream's client limit and its ~40 KB/s
 * (loadtest/REPORT.md). The demo has no server and keeps its own feed.
 */
export async function startSummary(market: Market): Promise<void> {
  if (STANDALONE) return startFeed(market);
  const poll = async () => {
    try {
      applySummary(market, await getJson<Summary>('/api/summary'));
      market.setConnection('live');
    } catch {
      market.setConnection('reconnecting');
    }
  };
  setInterval(() => {
    if (!document.hidden) void poll();
  }, SUMMARY_MS);
  // back from another tab: catch up now instead of at the next tick
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void poll();
  });
  await poll();
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

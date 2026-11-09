import { connect, type Market } from './market';
import type { CandleDto, Liquidation, OutcomeStats, Positioning, SetupBoard, Signal, SignalAudit, SymbolMetrics, TapeItem, TelegramLinks, VenueGap, Wall } from './types';

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

/** How many of the period's sampled signals the exchange's candles confirmed; null without a server. */
export async function signalAudit(days: number): Promise<SignalAudit | null> {
  return STANDALONE ? null : getJson(`/api/signals/audit?days=${days}`);
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
  /** Two hours of the pairs the events name, for the phone feed's cards. */
  sparklines: Record<string, number[]>;
  /** Milliseconds since the exchange's newest frame on the server; null before the first. */
  feedAge?: number | null;
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
  if (summary.sparklines && Object.keys(summary.sparklines).length) market.apply({ type: 'sparklines', series: summary.sparklines });
  market.setFeedAge(summary.feedAge);
}

/**
 * A poll of /api/summary while the tab is visible, instead of the full stream: the landing, and
 * the phone's live feed, need a fraction of it (loadtest/REPORT.md: the stream is ~40 KB/s, on a
 * phone's mobile data that is 140 MB an hour). `ready` settles after the first answer; `stop`
 * ends the polling, for when the full terminal takes over with the stream.
 */
export function pollSummary(market: Market): { ready: Promise<void>; stop(): void } {
  let stopped = false;
  const poll = async () => {
    if (stopped) return;
    try {
      const summary = await getJson<Summary>('/api/summary');
      // an answer that arrives after the stream took over must not roll its fresher data back
      if (stopped) return;
      applySummary(market, summary);
      market.setConnection('live');
    } catch {
      if (!stopped) market.setConnection('reconnecting');
    }
  };
  const timer = setInterval(() => {
    if (!document.hidden) void poll();
  }, SUMMARY_MS);
  // back from another tab: catch up now instead of at the next tick
  const onVisible = () => {
    if (!document.hidden) void poll();
  };
  document.addEventListener('visibilitychange', onVisible);
  return {
    ready: poll(),
    stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}

/**
 * While the terminal holds the stream: asks the server now and then how old the exchange's data
 * is (the stream itself keeps ticking when the exchange is quiet). Light: no history.
 */
export function watchFeedAge(market: Market) {
  if (STANDALONE) return;
  const ask = async () => {
    if (document.hidden) return;
    try {
      const status = await getJson<{ feedAge: number | null }>('/api/status/full?history=false');
      market.setFeedAge(status.feedAge);
    } catch {
      // the stream's own silence says the rest
    }
  };
  void ask();
  setInterval(() => void ask(), 15_000);
}

/** The landing's feed: the summary on the server, the demo's own feed without one. */
export async function startSummary(market: Market): Promise<void> {
  if (STANDALONE) return startFeed(market);
  await pollSummary(market).ready;
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

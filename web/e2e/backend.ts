import type { Page, WebSocketRoute } from '@playwright/test';

import type { Summary } from '../src/api';
import type { CandleDto, StreamMessage, SymbolMetrics, TelegramLinks } from '../src/types';

const row = (symbol: string, price: number, ch24h: number, vol24h: number, over: Partial<SymbolMetrics> = {}): SymbolMetrics => ({
  symbol, price, ch1m: 0.05, ch5m: 0.3, ch15m: 0.6, ch1h: 1.1, ch24h, high24h: price * 1.04, low24h: price * 0.95, vol24h,
  surge: 1.2, natr: 0.8, funding: 0.01, nextFunding: Date.now() + 3 * 3_600_000, oi: vol24h / 2, oiCh15m: 0.4, liq5m: 0, ...over,
});

/** The market the fake backend serves: enough variety for sorting, filters and the heatmap. */
export const ROWS: SymbolMetrics[] = [
  row('BTCUSDT', 83_000, -1.2, 12e9),
  row('ETHUSDT', 2_500, -2.4, 9e9),
  row('SOLUSDT', 115, 3.5, 2e9),
  row('WIFUSDT', 0.84, 9.6, 600e6, { ch5m: 2.8, surge: 4.1 }),
  row('DOGEUSDT', 0.087, 6.1, 480e6),
  row('XRPUSDT', 1.42, -7.3, 900e6, { ch5m: -2.2 }),
];

/** Flat-ish candles ending now, so the chart has something to draw and a scale to click on. */
export function candles(price: number, stepSeconds: number, count = 300): CandleDto[] {
  const last = Math.floor(Date.now() / 1000 / stepSeconds) * stepSeconds;
  return Array.from({ length: count }, (_, i) => {
    const wave = Math.sin(i / 9) * 0.01 * price;
    const open = price + wave;
    const close = price + Math.sin((i + 1) / 9) * 0.01 * price;
    return {
      time: last - (count - 1 - i) * stepSeconds,
      open, close, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, volume: 1_000_000,
    };
  });
}

const STEP: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 };

export interface FakeBackend {
  /** Sends a stream message to every open page, as the server would on its next tick. */
  push(message: StreamMessage): void;
  /** What the pages counted with POST /api/hit, in order. */
  hits: Array<{ page: string; source: string }>;
  /** What the pages reported with POST /api/client-errors, in order. */
  errors: Array<{ message: string; stack: string; page: string; build: string; lang: string }>;
  /** How many times a page opened /ws/market. */
  streams(): number;
  /** How many of those are open now. */
  openStreams(): number;
}

/** Call before `page.goto`: answers /api and plays /ws/market. */
/** @param feedAge how old the server says the exchange's data is, in ms (summary and status) */
export async function fakeBackend(page: Page, options: { links?: TelegramLinks; feedAge?: number } = {}): Promise<FakeBackend> {
  // tests start as a returning visitor: the first-visit card would sit on top of what they click
  await page.addInitScript(() => {
    if (!localStorage.getItem('pulse.welcomed')) localStorage.setItem('pulse.welcomed', 'true');
  });
  const sockets: WebSocketRoute[] = [];
  // what /api/summary answers (the landing polls it): the same market, kept up to date by push()
  const state: Summary = {
    ts: Date.now(),
    rows: ROWS.map((r) => ({ symbol: r.symbol, price: r.price, ch5m: r.ch5m, ch24h: r.ch24h, vol24h: r.vol24h })),
    liquidations: [],
    walls: { ts: Date.now(), walls: [], coverage: { BTCUSDT: 0.1 } },
    signals: [],
    tape: [],
    sparklines: Object.fromEntries(ROWS.map((r) => [r.symbol, [1, 1.01, 0.99, 1.02, 1.03]])),
    feedAge: options.feedAge ?? 300,
  };
  const slim = ({ symbol, price, ch5m, ch24h, vol24h }: SymbolMetrics) => ({ symbol, price, ch5m, ch24h, vol24h });
  const remember = (message: StreamMessage) => {
    state.ts = Date.now();
    if (message.type === 'snapshot') {
      state.rows = message.rows.map(slim);
      state.liquidations = message.liquidations;
    }
    if (message.type === 'delta') {
      for (const partial of message.rows) {
        const row = state.rows.find((r) => r.symbol === partial.symbol);
        if (row) Object.assign(row, Object.fromEntries(Object.entries(partial).filter(([key]) => key in row)));
      }
    }
    if (message.type === 'tape') state.tape = [...message.items, ...state.tape];
    if (message.type === 'signals') state.signals = [...message.items, ...state.signals];
    if (message.type === 'liquidations') state.liquidations = [...message.items, ...state.liquidations];
    if (message.type === 'walls') state.walls = { ts: message.ts, walls: message.walls, coverage: message.coverage };
  };
  await page.route('**/api/summary', (route) => route.fulfill({ json: state }));
  let closed = 0;
  await page.routeWebSocket(/\/ws\/market$/, (ws) => {
    sockets.push(ws);
    ws.onClose(() => closed++);
    const send = (message: StreamMessage) => ws.send(JSON.stringify(message));
    send({ type: 'snapshot', ts: Date.now(), rows: ROWS, liquidations: [] });
    send({ type: 'sparklines', series: Object.fromEntries(ROWS.map((r) => [r.symbol, [1, 1.01, 0.99, 1.02, 1.03]])) });
    send({ type: 'walls', ts: Date.now(), walls: [], coverage: { BTCUSDT: 0.1 } });
    send({ type: 'signals', items: [] });
    send({ type: 'tape', items: [] });
  });
  await page.route('**/api/candles**', (route) => {
    const url = new URL(route.request().url());
    const symbol = url.searchParams.get('symbol') ?? 'BTCUSDT';
    const price = ROWS.find((r) => r.symbol === symbol)?.price ?? 1;
    return route.fulfill({ json: candles(price, STEP[url.searchParams.get('interval') ?? '5m'] ?? 300) });
  });
  const hits: FakeBackend['hits'] = [];
  await page.route('**/api/hit', (route) => {
    hits.push(route.request().postDataJSON() as FakeBackend['hits'][number]);
    return route.fulfill({ status: 204 });
  });
  const errors: FakeBackend['errors'] = [];
  await page.route('**/api/client-errors', (route) => {
    errors.push(route.request().postDataJSON() as FakeBackend['errors'][number]);
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/status/full**', (route) => {
    const now = Date.now();
    const full = !route.request().url().includes('history=false');
    route.fulfill({
      json: {
        now, feedAge: options.feedAge ?? 300, stale: (options.feedAge ?? 300) > 30_000,
        exchanges: [{ exchange: 'binance', symbols: 530, historyLoaded: 530, connections: 2, connectionsOpen: 2, lastFrameAt: now - 300 }],
        booksSynced: 58, books: 60,
        lastSignal: { id: 1, type: 'PUMP', symbol: 'WIFUSDT', time: now - 95_000, price: 0.84, value: 3.1, title: 't', detail: 'd' },
        since: now - 3 * 3_600_000,
        // three hours recorded, one stale quarter hour in the middle
        minutes: full ? Array.from({ length: 180 }, (_, i) => ({ t: now - (180 - i) * 60_000, feedAge: i >= 90 && i < 95 ? 45_000 : 400, booksSynced: 58, books: 60 })) : [],
      },
    });
  });
  await page.route('**/api/links', (route) => route.fulfill({ json: options.links ?? { bot: '', channel: '' } }));
  await page.route('**/api/compare', (route) => route.fulfill({ json: [] }));
  // no VAPID keys: the site offers no notifications (push.e2e.ts routes its own key)
  await page.route('**/api/push/key', (route) => route.fulfill({ status: 404 }));
  await page.route('**/api/signals**', (route) =>
    route.request().url().includes('/api/signals/audit')
      ? route.fulfill({ json: { days: 7, checked: 38, confirmed: 37, lastRun: new Date().toISOString() } })
      : route.fulfill({ json: [] }),
  );
  await page.route('**/api/setups**', (route) =>
    route.fulfill({
      json: {
        since: '2026-10-11T10:00:00Z',
        stats: [{ timeframe: '1h', trades: 3, wins: 2, netR: 4.7 }],
        open: [{ id: 5, symbol: 'SOLUSDT', timeframe: '15m', direction: 1, entry: 114, stop: 113, target: 117, openedAt: '2026-10-11T12:15:25Z', expiresAt: '2026-10-12T03:15:00Z', status: 'OPEN', closedAt: null, exitPrice: null, resultR: null }],
        closed: [{ id: 4, symbol: 'WIFUSDT', timeframe: '1h', direction: -1, entry: 0.9, stop: 0.92, target: 0.84, openedAt: '2026-10-11T10:00:25Z', expiresAt: '2026-10-13T22:00:00Z', status: 'WON', closedAt: '2026-10-11T11:40:00Z', exitPrice: 0.84, resultR: 2.96 }],
      },
    }),
  );
  await page.route('**/api/positioning**', (route) =>
    route.fulfill({ json: { openInterest: [], longShortAccounts: [], longShortTop: [], takerBuySell: [], funding: [] } }),
  );
  return {
    push: (message) => {
      remember(message);
      sockets.forEach((ws) => ws.send(JSON.stringify(message)));
      // a page that polls the summary (the landing, the phone feed) asks again when it becomes
      // visible: that makes it take the news now instead of at its next five-second tick
      void page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))).catch(() => undefined);
    },
    hits,
    errors,
    streams: () => sockets.length,
    openStreams: () => sockets.length - closed,
  };
}

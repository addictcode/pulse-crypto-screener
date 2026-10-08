import type { Page, WebSocketRoute } from '@playwright/test';

import type { CandleDto, StreamMessage, SymbolMetrics } from '../src/types';

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
}

/** Call before `page.goto`: answers /api and plays /ws/market. */
export async function fakeBackend(page: Page): Promise<FakeBackend> {
  const sockets: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/ws\/market$/, (ws) => {
    sockets.push(ws);
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
  await page.route('**/api/compare', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/signals**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/positioning**', (route) =>
    route.fulfill({ json: { openInterest: [], longShortAccounts: [], longShortTop: [], takerBuySell: [], funding: [] } }),
  );
  return { push: (message) => sockets.forEach((ws) => ws.send(JSON.stringify(message))) };
}

// The standalone demo's data source. There is no Pulse server behind it: the page itself opens
// Binance's public streams, keeps the market in memory and feeds the same messages to the UI
// that the backend would send over /ws/market. Lighter than the server in three ways, to be kind
// to a visitor's connection: own candle streams only for the busiest pairs, order books as
// periodic snapshots for a few of them, and no stored signals.

import type { Market } from '../market';
import type { Liquidation, SymbolMetrics, TapeItem, TapeKind, Wall } from '../types';
import { changePct, natr, openInterestChangePct, round, sparkline, surge, type Candle, type OpenInterestPoint } from './metrics';
import { coveragePct, detectWalls, WALL_PARAMS, WallTracker, type Levels, type TrackedWall } from './walls';

export const BINANCE_REST = 'https://fapi.binance.com';
const STREAM = 'wss://fstream.binance.com/market/stream';

const MAX_CANDLES = 180;
/** Under 100 candles a klines request costs 1 weight instead of 2. */
const HISTORY = 99;
/** Pairs with their own 1-minute candle stream; the rest build candles from the ticker. */
const KLINE_STREAMS = 100;
const OPEN_INTEREST_PAIRS = 100;
const BOOKS = 30;
const BOOK_EVERY_MS = 1_200;
const TICK_MS = 500;
const LIQUIDATION_WINDOW_MS = 5 * 60_000;
const SLEEP_AFTER_HIDDEN_MS = 90_000;

// dev.pulse.signal.TapeRules
const TAPE = { move1m: 1, move5m: 2, volume: 3, openInterest: 2.5, liquidations: 150_000, minVolume24h: 5_000_000 };
const TAPE_COOLDOWN_MS = 3 * 60_000;
const TAPE_ESCALATION = 1.5;

class SymbolState {
  readonly symbol: string;
  candles: Candle[] = [];
  price = 0;
  open24h = 0;
  high24h = 0;
  low24h = 0;
  volume24h = 0;
  mark = 0;
  funding: number | null = null;
  nextFunding: number | null = null;
  openInterest: OpenInterestPoint[] = [];
  liquidations: Liquidation[] = [];
  /** Has its own candle stream, so the ticker must not invent candles for it. */
  streamed = false;
  /** 24h quote volume at the previous ticker, to turn the ticker into per-minute volume. */
  lastQuote = 0;

  constructor(symbol: string) {
    this.symbol = symbol;
  }
}

/** Upserts a candle from the stream: the forming one repeats many times a second. */
export function upsertCandle(candles: Candle[], candle: Candle) {
  const last = candles[candles.length - 1];
  if (!last || candle.openTime > last.openTime) {
    candles.push(candle);
    if (candles.length > MAX_CANDLES) candles.splice(0, candles.length - MAX_CANDLES);
  } else if (candle.openTime === last.openTime) {
    candles[candles.length - 1] = candle;
  }
}

/**
 * Builds minute candles for a pair without its own stream. Volume is the growth of the 24h
 * figure between two tickers: slightly low, because the same figure also loses the trades that
 * just left the 24h window, but a spike stands out all the same.
 */
export function candleFromTicker(candles: Candle[], time: number, price: number, volumeDelta: number) {
  const minute = Math.floor(time / 60_000) * 60_000;
  const last = candles[candles.length - 1];
  if (!last || minute > last.openTime) {
    upsertCandle(candles, { openTime: minute, open: last ? last.close : price, high: price, low: price, close: price, quoteVolume: volumeDelta });
  } else if (minute === last.openTime) {
    last.high = Math.max(last.high, price);
    last.low = Math.min(last.low, price);
    last.close = price;
    last.quoteVolume += volumeDelta;
  }
}

/** REST history under whatever arrived live meanwhile. */
export function mergeHistory(live: Candle[], history: Candle[], streamed: boolean): Candle[] {
  const merged = new Map<number, Candle>();
  const lastHistory = history.length ? history[history.length - 1].openTime : -Infinity;
  for (const c of history) merged.set(c.openTime, c);
  // a real stream is newer than the REST answer; ticker-built candles are only better than nothing
  for (const c of live) if (streamed || c.openTime > lastHistory) merged.set(c.openTime, c);
  return [...merged.values()].sort((a, b) => a.openTime - b.openTime).slice(-MAX_CANDLES);
}

export function toMetrics(s: SymbolState, now: number): SymbolMetrics {
  while (s.liquidations.length && s.liquidations[0].time < now - LIQUIDATION_WINDOW_MS) s.liquidations.shift();
  const liquidated = s.liquidations.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const lastOi = s.openInterest[s.openInterest.length - 1];
  return {
    symbol: s.symbol,
    price: s.price,
    ch1m: round(changePct(s.candles, s.price, 1), 3),
    ch5m: round(changePct(s.candles, s.price, 5), 3),
    ch15m: round(changePct(s.candles, s.price, 15), 3),
    ch1h: round(changePct(s.candles, s.price, 60), 3),
    ch24h: round(s.open24h > 0 ? (s.price / s.open24h - 1) * 100 : null, 3),
    high24h: s.high24h > 0 ? Math.max(s.high24h, s.price) : null,
    low24h: s.low24h > 0 ? Math.min(s.low24h, s.price) : null,
    vol24h: Math.round(s.volume24h),
    surge: round(surge(s.candles), 2),
    natr: round(natr(s.candles, 14), 3),
    funding: round(s.funding === null ? null : s.funding * 100, 4),
    nextFunding: s.nextFunding,
    oi: round(lastOi && s.mark > 0 ? lastOi.contracts * s.mark : null, 0),
    oiCh15m: round(openInterestChangePct(s.openInterest, now, 15), 2),
    liq5m: Math.round(liquidated),
  };
}

/** dev.pulse.signal.TapeRules: everything that moves past the loose thresholds. */
export function tapeItems(m: SymbolMetrics, longsLiquidated: number, shortsLiquidated: number, now: number): TapeItem[] {
  const items: TapeItem[] = [];
  if (m.vol24h < TAPE.minVolume24h || m.price <= 0) return items;
  const item = (kind: TapeKind, value: number) =>
    items.push({ kind, symbol: m.symbol, time: now, price: m.price, value: Math.round(value * 100) / 100 });
  if (m.ch1m !== null && Math.abs(m.ch1m) >= TAPE.move1m) item(m.ch1m > 0 ? 'PUMP_1M' : 'DUMP_1M', m.ch1m);
  if (m.ch5m !== null && Math.abs(m.ch5m) >= TAPE.move5m) item(m.ch5m > 0 ? 'PUMP_5M' : 'DUMP_5M', m.ch5m);
  if (m.surge !== null && m.surge >= TAPE.volume) item('VOLUME', m.surge);
  if (m.oiCh15m !== null && Math.abs(m.oiCh15m) >= TAPE.openInterest) item(m.oiCh15m > 0 ? 'OI_UP' : 'OI_DOWN', m.oiCh15m);
  if (longsLiquidated + shortsLiquidated >= TAPE.liquidations) {
    item(longsLiquidated >= shortsLiquidated ? 'LIQ_LONGS' : 'LIQ_SHORTS', longsLiquidated + shortsLiquidated);
  }
  return items;
}

async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Kline = [number, string, string, string, string, string, number, string, ...unknown[]];

export const klineToCandle = (k: Kline): Candle => ({
  openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), quoteVolume: Number(k[7]),
});

export class BrowserFeed {
  private readonly market: Market;
  private readonly states = new Map<string, SymbolState>();
  private readonly dirty = new Set<string>();
  private pendingLiquidations: Liquidation[] = [];
  private readonly tapeLast = new Map<string, { time: number; value: number }>();
  private readonly tracker = new WallTracker(90_000);
  private readonly books = new Map<string, { walls: TrackedWall[]; coverage: number }>();
  private bookSymbols: string[] = [];
  private bookIndex = 0;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private requestId = 0;

  constructor(market: Market) {
    this.market = market;
  }

  /** @throws when Binance cannot be reached at all (blocked network or region) */
  async start() {
    this.market.setConnection('connecting');
    interface ExchangeInfo { symbols: Array<{ symbol: string; contractType: string; quoteAsset: string; status: string }> }
    const info = await getJson<ExchangeInfo>(`${BINANCE_REST}/fapi/v1/exchangeInfo`, 20_000);
    for (const s of info.symbols) {
      if (s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING') {
        this.states.set(s.symbol, new SymbolState(s.symbol));
      }
    }
    const [tickers, marks] = await Promise.all([
      getJson<Array<Record<string, string>>>(`${BINANCE_REST}/fapi/v1/ticker/24hr`),
      getJson<Array<Record<string, string | number>>>(`${BINANCE_REST}/fapi/v1/premiumIndex`),
    ]);
    for (const t of tickers) {
      const s = this.states.get(t.symbol);
      if (!s) continue;
      s.price = Number(t.lastPrice);
      s.open24h = Number(t.openPrice);
      s.high24h = Number(t.highPrice);
      s.low24h = Number(t.lowPrice);
      s.volume24h = Number(t.quoteVolume);
    }
    for (const m of marks) this.applyMark(String(m.symbol), Number(m.markPrice), Number(m.lastFundingRate), Number(m.nextFundingTime));

    const now = Date.now();
    this.market.apply({ type: 'snapshot', ts: now, rows: [...this.states.values()].map((s) => toMetrics(s, now)), liquidations: [] });

    const byVolume = this.byVolume();
    byVolume.slice(0, KLINE_STREAMS).forEach((s) => (s.streamed = true));
    this.connect();
    setInterval(() => this.tick(), TICK_MS);
    setInterval(() => this.scanTape(), 2_000);
    setInterval(() => this.emitWalls(), 3_000);
    setInterval(() => this.emitSparklines(), 60_000);
    setInterval(() => void this.nextBook(), BOOK_EVERY_MS);
    setInterval(() => this.chooseBooks(), 10 * 60_000);
    this.chooseBooks();
    this.sleepWhenHidden();

    // background work, most traded pairs first; none of it blocks the first paint
    void this.loadHistory(byVolume).then(() => this.emitSparklines());
    void this.loadOpenInterest(byVolume.slice(0, OPEN_INTEREST_PAIRS));
    setTimeout(() => this.emitSparklines(), 12_000);
  }

  private byVolume(): SymbolState[] {
    return [...this.states.values()].sort((a, b) => b.volume24h - a.volume24h);
  }

  // ---------- streams ----------

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(STREAM);
    this.socket = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.market.setConnection('live');
      const streams = ['!miniTicker@arr', '!markPrice@arr', '!forceOrder@arr'];
      for (const s of this.states.values()) if (s.streamed) streams.push(`${s.symbol.toLowerCase()}@kline_1m`);
      // Binance accepts a handful of control messages a second
      for (let from = 0, n = 0; from < streams.length; from += 100, n++) {
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: streams.slice(from, from + 100), id: ++this.requestId }));
          }
        }, n * 350);
      }
    };
    ws.onmessage = (event) => {
      try {
        this.onFrame(JSON.parse(event.data as string));
      } catch {
        // one frame the page cannot read is not worth dropping the stream for
      }
    };
    ws.onclose = () => {
      if (this.stopped) return;
      this.market.setConnection('reconnecting');
      setTimeout(() => this.connect(), Math.min(15_000, 500 * 2 ** this.attempt++));
    };
  }

  private onFrame(frame: { data?: unknown }) {
    const data = frame.data;
    if (!data) return; // subscription ack
    if (Array.isArray(data)) {
      for (const item of data as Array<Record<string, string | number>>) {
        if (item.e === '24hrMiniTicker') this.applyTicker(item);
        else if (item.e === 'markPriceUpdate') this.applyMark(String(item.s), Number(item.p), Number(item.r), Number(item.T));
      }
      return;
    }
    const event = data as { e?: string; s?: string; k?: Record<string, string | number>; o?: Record<string, string | number> };
    if (event.e === 'kline' && event.k && event.s) {
      const s = this.states.get(event.s);
      if (!s) return;
      const k = event.k;
      upsertCandle(s.candles, { openTime: Number(k.t), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), quoteVolume: Number(k.q) });
      s.price = Number(k.c);
      this.dirty.add(s.symbol);
    } else if (event.e === 'forceOrder' && event.o) {
      const o = event.o;
      const s = this.states.get(String(o.s));
      if (!s) return;
      // the exchange trades against the position: SELL closes a long, BUY closes a short
      const liquidation: Liquidation = {
        symbol: s.symbol,
        side: o.S === 'SELL' ? 'LONG' : 'SHORT',
        price: Number(o.ap) > 0 ? Number(o.ap) : Number(o.p),
        quantity: Number(o.z),
        time: Number(o.T),
      };
      s.liquidations.push(liquidation);
      this.pendingLiquidations.push(liquidation);
      this.dirty.add(s.symbol);
    }
  }

  private applyTicker(t: Record<string, string | number>) {
    const s = this.states.get(String(t.s));
    if (!s) return;
    const price = Number(t.c);
    const quote = Number(t.q);
    s.open24h = Number(t.o);
    s.high24h = Number(t.h);
    s.low24h = Number(t.l);
    s.volume24h = quote;
    if (!s.streamed) {
      candleFromTicker(s.candles, Number(t.E), price, s.lastQuote > 0 ? Math.max(0, quote - s.lastQuote) : 0);
      s.price = price;
    } else if (!s.candles.length) {
      s.price = price;
    }
    s.lastQuote = quote;
    this.dirty.add(s.symbol);
  }

  private applyMark(symbol: string, mark: number, funding: number, nextFunding: number) {
    const s = this.states.get(symbol);
    if (!s) return;
    const changed = s.funding !== funding || s.nextFunding !== nextFunding;
    s.mark = mark;
    s.funding = funding;
    s.nextFunding = nextFunding;
    if (changed) this.dirty.add(symbol);
  }

  // ---------- REST in the background ----------

  private async loadHistory(states: SymbolState[]) {
    const batch = 8;
    for (let from = 0; from < states.length && !this.stopped; from += batch) {
      await Promise.all(
        states.slice(from, from + batch).map(async (s) => {
          try {
            const klines = await getJson<Kline[]>(`${BINANCE_REST}/fapi/v1/klines?symbol=${s.symbol}&interval=1m&limit=${HISTORY}`);
            s.candles = mergeHistory(s.candles, klines.map(klineToCandle), s.streamed);
            if (s.price === 0 && s.candles.length) s.price = s.candles[s.candles.length - 1].close;
            this.dirty.add(s.symbol);
          } catch {
            // the pair stays on "warming up" and fills in from the stream
          }
        }),
      );
      await sleep(600);
    }
  }

  private async loadOpenInterest(states: SymbolState[]) {
    const each = async (work: (s: SymbolState) => Promise<void>) => {
      for (let from = 0; from < states.length && !this.stopped; from += 5) {
        await Promise.all(states.slice(from, from + 5).map((s) => work(s).catch(() => undefined)));
        await sleep(500);
      }
    };
    // the last 20 minutes first, so the 15-minute change is known without waiting for it
    await each(async (s) => {
      const points = await getJson<Array<{ timestamp: number; sumOpenInterest: string }>>(
        `${BINANCE_REST}/futures/data/openInterestHist?symbol=${s.symbol}&period=5m&limit=5`,
      );
      s.openInterest = points.map((p) => ({ time: p.timestamp, contracts: Number(p.sumOpenInterest) }));
      this.dirty.add(s.symbol);
    });
    while (!this.stopped) {
      const now = Date.now();
      await each(async (s) => {
        const answer = await getJson<{ openInterest: string }>(`${BINANCE_REST}/fapi/v1/openInterest?symbol=${s.symbol}`);
        s.openInterest.push({ time: now, contracts: Number(answer.openInterest) });
        if (s.openInterest.length > 40) s.openInterest.shift();
        this.dirty.add(s.symbol);
      });
      await sleep(50_000);
    }
  }

  // ---------- order books ----------

  private chooseBooks() {
    const next = this.byVolume().slice(0, BOOKS).map((s) => s.symbol);
    for (const symbol of this.bookSymbols) {
      if (!next.includes(symbol)) {
        this.books.delete(symbol);
        this.tracker.forget(symbol);
      }
    }
    this.bookSymbols = next;
  }

  private async nextBook() {
    if (this.stopped || !this.bookSymbols.length) return;
    const symbol = this.bookSymbols[this.bookIndex++ % this.bookSymbols.length];
    const s = this.states.get(symbol);
    if (!s) return;
    try {
      const depth = await getJson<{ bids: Array<[string, string]>; asks: Array<[string, string]> }>(
        `${BINANCE_REST}/fapi/v1/depth?symbol=${symbol}&limit=500`,
      );
      const levels = (side: Array<[string, string]>): Levels => side.map(([p, q]) => [Number(p), Number(q)]);
      const bids = levels(depth.bids);
      const asks = levels(depth.asks);
      if (!bids.length || !asks.length) return;
      const mid = (bids[0][0] + asks[0][0]) / 2;
      const width = this.tracker.bucketWidth(symbol, mid, WALL_PARAMS.bucketPct);
      const detected = detectWalls(bids, asks, width, s.volume24h, WALL_PARAMS);
      this.books.set(symbol, { walls: this.tracker.update(symbol, detected, Date.now()), coverage: coveragePct(bids, asks) });
    } catch {
      // the previous scan of this book stays until the next round
    }
  }

  private emitWalls() {
    if (!this.books.size) return;
    const now = Date.now();
    const walls: Wall[] = [];
    const coverage: Record<string, number> = {};
    for (const [symbol, book] of this.books) {
      const s = this.states.get(symbol);
      if (!s || s.price <= 0) continue;
      coverage[symbol] = Math.round(book.coverage * 100) / 100;
      const recent = s.candles.slice(-5);
      const perMinute = recent.length === 5 ? recent.reduce((sum, c) => sum + c.quoteVolume, 0) / 5 : null;
      for (const w of book.walls) {
        const distance = (w.price / s.price - 1) * 100;
        // the price has gone through it since the snapshot: the wall was eaten or pulled
        if ((w.side === 'BID') !== distance < 0 || Math.abs(distance) > WALL_PARAMS.maxDistancePct) continue;
        walls.push({
          symbol,
          side: w.side,
          price: w.price,
          size: Math.round(w.notional),
          distance: Math.round(distance * 1000) / 1000,
          multiple: Math.round(w.multiple * 10) / 10,
          age: Math.floor((now - w.firstSeen) / 1000),
          eatMinutes: perMinute && perMinute > 0 ? Math.round((w.notional / (perMinute / 2)) * 10) / 10 : null,
        });
      }
    }
    walls.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
    this.market.apply({ type: 'walls', ts: now, walls, coverage });
  }

  // ---------- what goes to the UI ----------

  private tick() {
    const now = Date.now();
    if (this.dirty.size) {
      const rows: SymbolMetrics[] = [];
      for (const symbol of this.dirty) {
        const s = this.states.get(symbol);
        if (s && s.price > 0) rows.push(toMetrics(s, now));
      }
      this.dirty.clear();
      this.market.apply({ type: 'delta', ts: now, rows });
    }
    if (this.pendingLiquidations.length) {
      this.market.apply({ type: 'liquidations', items: this.pendingLiquidations });
      this.pendingLiquidations = [];
    }
  }

  private scanTape() {
    const now = Date.now();
    const fresh: TapeItem[] = [];
    for (const s of this.states.values()) {
      if (s.volume24h < TAPE.minVolume24h || s.candles.length < 5) continue;
      let longs = 0;
      let shorts = 0;
      for (const l of s.liquidations) {
        if (l.time < now - LIQUIDATION_WINDOW_MS) continue;
        if (l.side === 'LONG') longs += l.price * l.quantity;
        else shorts += l.price * l.quantity;
      }
      for (const item of tapeItems(toMetrics(s, now), longs, shorts, now)) {
        const key = `${item.symbol}:${item.kind}`;
        const previous = this.tapeLast.get(key);
        // once per pair and kind every few minutes, unless it grew by half again
        if (!previous || now - previous.time >= TAPE_COOLDOWN_MS || Math.abs(item.value) >= Math.abs(previous.value) * TAPE_ESCALATION) {
          this.tapeLast.set(key, { time: now, value: item.value });
          fresh.push(item);
        }
      }
    }
    if (fresh.length) this.market.apply({ type: 'tape', items: fresh });
  }

  private emitSparklines() {
    const series: Record<string, number[]> = {};
    for (const s of this.states.values()) if (s.candles.length >= 10) series[s.symbol] = sparkline(s.candles, 24);
    this.market.apply({ type: 'sparklines', series });
  }

  /**
   * A tab left in the background would keep pulling a few hundred megabytes an hour for nobody.
   * It lets go after a while and starts clean when the visitor comes back.
   */
  private sleepWhenHidden() {
    let timer = 0;
    document.addEventListener('visibilitychange', () => {
      clearTimeout(timer);
      if (document.hidden) {
        timer = window.setTimeout(() => {
          this.stopped = true;
          this.socket?.close();
          this.market.setConnection('reconnecting');
        }, SLEEP_AFTER_HIDDEN_MS);
      } else if (this.stopped) {
        location.reload();
      }
    });
  }
}

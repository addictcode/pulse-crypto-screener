import {
  CandlestickSeries,
  createChart,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

import { candles } from './api';
import { CHART_FONT, INTERVALS, liveBar, type Bar } from './chart';
import { base, pct, priceDigits, px, tone, usd } from './format';
import { t } from './i18n';
import type { Market } from './market';
import { load, save } from './storage';
import type { CandleDto, SymbolMetrics } from './types';

const CELLS = 12;
const HISTORY = 180;
const CACHE_MS = 60_000;
/** History requests in flight at once: a page of twelve should not hit the exchange in one burst. */
const PARALLEL = 4;
/** The page keeps its pairs for this long, so charts do not reshuffle while you read them. */
const REORDER_MS = 60_000;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Cell {
  box: HTMLElement;
  head: HTMLButtonElement;
  chartEl: HTMLElement;
  chart: IChartApi;
  candles: ISeriesApi<'Candlestick'>;
  walls: Map<string, IPriceLine>;
  symbol: string | null;
  /** symbol|interval of the candles on screen, null while loading */
  shown: string | null;
  last: Bar | null;
  token: number;
}

/**
 * The v1 chart grid: twelve live candlestick charts for the pairs the screener lists, in its
 * order, paged. History is fetched once per pair and timeframe; afterwards each chart follows
 * the market stream like the big chart does, and shows the order book walls of its pair.
 */
export class ChartGrid {
  private readonly root = document.getElementById('cells')!;
  private readonly tfEl = document.getElementById('g-tf')!;
  private readonly pageEl = document.getElementById('g-page')!;
  private readonly metaEl = document.getElementById('g-meta')!;
  private readonly market: Market;
  private readonly source: () => { rows: SymbolMetrics[]; label: string };
  private readonly onOpen: (symbol: string) => void;
  private readonly cache = new Map<string, { at: number; data: CandleDto[] }>();
  private cells: Cell[] = [];
  private interval = load('gridInterval', '15m');
  private page = 0;
  private pages = 1;
  private symbols: string[] = [];
  private orderedAt = 0;
  private active = false;
  private pointerInside = false;
  private queue: Array<() => Promise<void>> = [];
  private running = 0;

  constructor(
    market: Market,
    source: () => { rows: SymbolMetrics[]; label: string },
    onOpen: (symbol: string) => void,
  ) {
    this.market = market;
    this.source = source;
    this.onOpen = onOpen;
    this.renderTimeframes();
    this.tfEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-tf]');
      if (!button || button.dataset.tf === this.interval) return;
      this.interval = button.dataset.tf!;
      save('gridInterval', this.interval);
      this.renderTimeframes();
      this.fill();
    });
    document.getElementById('g-prev')!.addEventListener('click', () => this.turn(-1));
    document.getElementById('g-next')!.addEventListener('click', () => this.turn(1));
    this.root.addEventListener('pointerenter', () => (this.pointerInside = true));
    this.root.addEventListener('pointerleave', () => (this.pointerInside = false));

    market.delta.on((changes) => {
      if (!this.active) return;
      for (const [, row] of changes) {
        const cell = this.cells.find((c) => c.symbol === row.symbol);
        if (cell) this.tick(cell, row);
      }
    });
    market.wallsUpdated.on(() => this.active && this.cells.forEach((c) => this.syncWalls(c)));
    market.snapshot.on(() => this.active && this.reorder(true));
    setInterval(() => this.active && !this.pointerInside && this.reorder(false), 5_000);
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) return;
    if (!this.cells.length) this.build();
    this.reorder(true);
  }

  private turn(by: number) {
    const next = Math.min(this.pages - 1, Math.max(0, this.page + by));
    if (next === this.page) return;
    this.page = next;
    this.reorder(true);
  }

  /** Takes the screener's current list; a forced call also re-reads the order. */
  private reorder(force: boolean) {
    const { rows, label } = this.source();
    this.pages = Math.max(1, Math.ceil(rows.length / CELLS));
    this.page = Math.min(this.page, this.pages - 1);
    this.pageEl.textContent = `${this.page + 1} / ${this.pages}`;
    this.metaEl.textContent = t('{label}, {n} pairs, in screener order', { label, n: rows.length });
    if (!force && Date.now() - this.orderedAt < REORDER_MS) return;
    const next = rows.slice(this.page * CELLS, this.page * CELLS + CELLS).map((r) => r.symbol);
    this.orderedAt = Date.now();
    if (next.join() === this.symbols.join()) return;
    this.symbols = next;
    this.fill();
  }

  private renderTimeframes() {
    this.tfEl.innerHTML = Object.keys(INTERVALS)
      .map((tf) => `<button role="tab" data-tf="${tf}" aria-selected="${tf === this.interval}">${tf}</button>`)
      .join('');
  }

  private build() {
    const up = css('--up');
    const down = css('--down');
    const ink3 = css('--ink-3');
    for (let i = 0; i < CELLS; i++) {
      const box = document.createElement('article');
      box.className = 'cell';
      box.innerHTML = `<button type="button" class="cell-head"></button><div class="cell-chart" data-failed="${t('History unavailable')}"></div>`;
      this.root.append(box);
      const head = box.querySelector<HTMLButtonElement>('.cell-head')!;
      const chartEl = box.querySelector<HTMLElement>('.cell-chart')!;
      const chart = createChart(chartEl, {
        autoSize: true,
        layout: { background: { color: 'transparent' }, textColor: ink3, fontFamily: CHART_FONT, fontSize: 10, attributionLogo: false },
        grid: { vertLines: { visible: false }, horzLines: { color: css('--rule-soft') } },
        rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 3 },
        crosshair: { vertLine: { color: ink3, labelVisible: false }, horzLine: { color: ink3, labelBackgroundColor: css('--rule') } },
      });
      const candles = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        wickUpColor: up,
        wickDownColor: down,
        borderVisible: false,
        priceLineColor: ink3,
        priceLineStyle: LineStyle.Dotted,
      });
      const cell: Cell = { box, head, chartEl, chart, candles, walls: new Map(), symbol: null, shown: null, last: null, token: 0 };
      head.addEventListener('click', () => cell.symbol && this.onOpen(cell.symbol));
      chartEl.addEventListener('dblclick', () => cell.symbol && this.onOpen(cell.symbol));
      this.cells.push(cell);
    }
  }

  /** Points every cell at its pair for this page and timeframe, loading only what changed. */
  private fill() {
    this.queue = [];
    this.cells.forEach((cell, i) => {
      const symbol = this.symbols[i] ?? null;
      cell.box.hidden = symbol === null;
      const key = symbol && `${symbol}|${this.interval}`;
      if (symbol === cell.symbol && key === cell.shown) return;
      cell.symbol = symbol;
      cell.shown = null;
      cell.last = null;
      cell.token++;
      // never let the previous pair's candles pass for the new one while it loads
      cell.candles.setData([]);
      this.clearWalls(cell);
      if (!symbol) return;
      cell.box.classList.add('loading');
      const row = this.market.rows.get(symbol);
      if (row) this.renderHead(cell, row);
      const token = cell.token;
      this.enqueue(() => this.load(cell, symbol, this.interval, token));
    });
    this.pump();
  }

  private enqueue(job: () => Promise<void>) {
    this.queue.push(job);
  }

  private pump() {
    while (this.running < PARALLEL && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;
      void job().finally(() => {
        this.running--;
        this.pump();
      });
    }
  }

  private async load(cell: Cell, symbol: string, interval: string, token: number) {
    const key = `${symbol}|${interval}`;
    let entry = this.cache.get(key);
    if (!entry || Date.now() - entry.at > CACHE_MS) {
      try {
        entry = { at: Date.now(), data: await candles(symbol, interval, HISTORY) };
        this.cache.set(key, entry);
        if (this.cache.size > 120) this.cache.delete(this.cache.keys().next().value!);
      } catch {
        if (token === cell.token) cell.box.classList.replace('loading', 'failed');
        return;
      }
    }
    if (token !== cell.token || !entry.data.length) return; // the cell moved on to another pair meanwhile
    const bars: Bar[] = entry.data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    const digits = priceDigits(bars.at(-1)!.close);
    cell.candles.applyOptions({ priceFormat: { type: 'custom', formatter: (v: number) => px(v), minMove: 10 ** -digits } });
    cell.candles.setData(bars);
    cell.last = bars.at(-1)!;
    cell.shown = key;
    cell.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 90), to: bars.length + 2 });
    cell.box.classList.remove('loading', 'failed');
    this.syncWalls(cell);
  }

  private tick(cell: Cell, row: SymbolMetrics) {
    this.renderHead(cell, row);
    if (!cell.last || !cell.shown) return;
    cell.last = liveBar(cell.last, row.price, INTERVALS[this.interval], Math.floor(Date.now() / 1000));
    cell.candles.update(cell.last);
  }

  private renderHead(cell: Cell, r: SymbolMetrics) {
    const wall = this.market.nearestWall(r.symbol);
    cell.head.innerHTML = `<b>${base(r.symbol)}</b><span class="num">${px(r.price)}</span><span class="num ${tone(r.ch24h)}">${pct(r.ch24h)}</span>${
      wall && Math.abs(wall.distance) <= 1 ? `<span class="num wall ${wall.side === 'BID' ? 'up' : 'down'}">${usd(wall.size)} ${pct(wall.distance, 2)}</span>` : ''
    }<span class="num vol">${usd(r.vol24h)}</span>`;
    cell.head.title = t('Open {sym} in the terminal', { sym: base(r.symbol) });
  }

  /** Walls of the pair as dashed lines, diffed so the lines do not blink on every rescan. */
  private syncWalls(cell: Cell) {
    if (!cell.symbol || !cell.shown) return;
    const wanted = new Map(this.market.wallsFor(cell.symbol).map((w) => [`${w.side}:${w.price}`, w]));
    for (const [key, line] of cell.walls) {
      if (!wanted.has(key)) {
        cell.candles.removePriceLine(line);
        cell.walls.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      if (cell.walls.has(key)) continue;
      cell.walls.set(
        key,
        cell.candles.createPriceLine({
          price: w.price,
          color: css(w.side === 'BID' ? '--up' : '--down'),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
        }),
      );
    }
  }

  private clearWalls(cell: Cell) {
    for (const line of cell.walls.values()) cell.candles.removePriceLine(line);
    cell.walls.clear();
  }
}

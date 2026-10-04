import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import { priceDigits, px, usd } from './format';
import type { Market } from './market';
import { load, save } from './storage';
import type { CandleDto, Liquidation } from './types';

const INTERVALS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 };
const HISTORY = 300;
const MIN_MARKER_USD = 5_000;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * History comes from /api/candles once per symbol and timeframe; after that the forming
 * candle follows the live price from the market stream, and liquidations of this pair
 * are pinned to the candle they happened in.
 */
export class PriceChart {
  private readonly el = document.getElementById('chart')!;
  private readonly tfEl = document.getElementById('tf')!;
  private chart: IChartApi | null = null;
  private candles: ISeriesApi<'Candlestick'> | null = null;
  private markers: ISeriesMarkersPluginApi<Time> | null = null;
  private markerList: SeriesMarker<Time>[] = [];
  private lastBar: Bar | null = null;
  private wallLines = new Map<string, IPriceLine>();
  private symbol = '';
  private interval = load('interval', '5m');
  private request = 0;

  private readonly market: Market;

  constructor(market: Market) {
    this.market = market;
    this.renderTimeframes();
    this.tfEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-tf]');
      if (!button || button.dataset.tf === this.interval) return;
      this.interval = button.dataset.tf!;
      save('interval', this.interval);
      this.renderTimeframes();
      void this.load();
    });
    market.delta.on((changes) => {
      const mine = changes.find(([, next]) => next.symbol === this.symbol);
      if (mine) this.tick(mine[1].price);
    });
    market.wallsUpdated.on(() => this.syncWalls());
    market.newLiquidations.on((items) => {
      const mine = items.filter((l) => l.symbol === this.symbol);
      if (mine.length) this.addLiquidationMarkers(mine);
    });
  }

  show(symbol: string) {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    void this.load();
  }

  private renderTimeframes() {
    this.tfEl.innerHTML = Object.keys(INTERVALS)
      .map((tf) => `<button role="tab" data-tf="${tf}" aria-selected="${tf === this.interval}">${tf}</button>`)
      .join('');
  }

  private async load() {
    const request = ++this.request;
    const symbol = this.symbol;
    let data: CandleDto[];
    try {
      const response = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${this.interval}&limit=${HISTORY}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = (await response.json()) as CandleDto[];
    } catch (error) {
      if (request === this.request) this.showError(`Could not load ${this.interval} candles: ${(error as Error).message}`);
      return;
    }
    if (request !== this.request) return; // the user already switched to another pair or timeframe
    this.build(data);
  }

  private build(data: CandleDto[]) {
    this.chart?.remove();
    this.el.innerHTML = '';
    const up = css('--up');
    const down = css('--down');
    const ink3 = css('--ink-3');
    const rule = css('--rule');

    this.chart = createChart(this.el, {
      autoSize: true,
      layout: {
        background: { color: css('--bg-1') },
        textColor: ink3,
        fontFamily: 'Azeret Mono, monospace',
        fontSize: 11,
        attributionLogo: false, // credited in the status bar
      },
      grid: { vertLines: { visible: false }, horzLines: { color: css('--rule-soft') } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: {
        vertLine: { color: ink3, labelBackgroundColor: rule },
        horzLine: { color: ink3, labelBackgroundColor: rule },
      },
    });

    const reference = data.at(-1)?.close ?? 1;
    const digits = priceDigits(reference);
    this.candles = this.chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceLineColor: ink3,
      priceLineStyle: LineStyle.Dotted,
      // minMove has to be a power of ten or the library throws "unexpected base"
      priceFormat: { type: 'custom', formatter: (v: number) => px(v), minMove: 10 ** -digits },
    });
    const bars: Bar[] = data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close }));
    this.candles.setData(bars);
    this.lastBar = bars.at(-1) ?? null;

    const volume = this.chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(
      data.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(86,185,138,.26)' : 'rgba(224,106,92,.26)',
      })),
    );

    this.markerList = [];
    this.markers = createSeriesMarkers(this.candles, []);
    this.wallLines.clear();
    this.syncWalls();
    this.addLiquidationMarkers(this.market.liquidations.filter((l) => l.symbol === this.symbol));
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 110), to: bars.length + 3 });
  }

  private tick(price: number) {
    if (!this.candles || !this.lastBar) return;
    const step = INTERVALS[this.interval];
    const now = Math.floor(Date.now() / 1000);
    if (now >= this.lastBar.time + step) {
      // a new candle started; open it at the last close so there is no visual gap
      const time = (Math.floor(now / step) * step) as UTCTimestamp;
      this.lastBar = { time, open: this.lastBar.close, high: price, low: price, close: price };
    } else {
      this.lastBar = {
        ...this.lastBar,
        close: price,
        high: Math.max(this.lastBar.high, price),
        low: Math.min(this.lastBar.low, price),
      };
    }
    this.candles.update(this.lastBar);
  }

  /** Walls of this pair as dashed price lines, updated in place so they do not flicker. */
  private syncWalls() {
    if (!this.candles) return;
    const wanted = new Map(this.market.wallsFor(this.symbol).map((w) => [`${w.side}:${w.price}`, w]));
    for (const [key, line] of this.wallLines) {
      if (!wanted.has(key)) {
        this.candles.removePriceLine(line);
        this.wallLines.delete(key);
      }
    }
    for (const [key, wall] of wanted) {
      const existing = this.wallLines.get(key);
      if (existing) {
        existing.applyOptions({ title: usd(wall.size) });
        continue;
      }
      this.wallLines.set(
        key,
        this.candles.createPriceLine({
          price: wall.price,
          color: css(wall.side === 'BID' ? '--up' : '--down'),
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: usd(wall.size),
        }),
      );
    }
  }

  private addLiquidationMarkers(items: Liquidation[]) {
    if (!this.markers || !this.lastBar) return;
    const step = INTERVALS[this.interval];
    for (const l of items) {
      if (l.price * l.quantity < MIN_MARKER_USD) continue;
      const time = (Math.floor(l.time / 1000 / step) * step) as UTCTimestamp;
      this.markerList.push(
        l.side === 'LONG'
          ? { time, position: 'belowBar', color: css('--down'), shape: 'circle', size: 0.6 }
          : { time, position: 'aboveBar', color: css('--up'), shape: 'circle', size: 0.6 },
      );
    }
    this.markerList.sort((a, b) => (a.time as number) - (b.time as number));
    this.markers.setMarkers(this.markerList);
  }

  private showError(message: string) {
    this.chart?.remove();
    this.chart = null;
    this.candles = null;
    this.el.innerHTML = `<p class="empty-note">${message}</p>`;
  }
}

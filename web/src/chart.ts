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

import type { Alerts } from './alerts';
import { DrawLayer, type ToolId } from './draw';
import { priceDigits, px, usd } from './format';
import { t } from './i18n';
import { ICONS, type IconName } from './icons';
import { IndicatorMenu, renderBacktest } from './indicator-menu';
import type { Market } from './market';
import { load, save } from './storage';
import { Studies } from './studies';
import type { CandleDto, Liquidation, Signal } from './types';

export const INTERVALS: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14_400, '1d': 86_400 };
const HISTORY = 300;
export const CHART_FONT = '"Inter Variable", system-ui, sans-serif';

/** The drawing toolbar, top to bottom. */
const TOOLS: Array<[ToolId, IconName, string]> = [
  ['trend', 'trend', t('Trend line')],
  ['ray', 'ray', t('Ray')],
  ['hline', 'hline', t('Horizontal level')],
  ['rect', 'rect', t('Zone')],
  ['fib', 'fib', t('Fibonacci retracement')],
  ['measure', 'measure', t('Ruler: change, bars and time between two points')],
];
const MIN_MARKER_USD = 5_000;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export interface Bar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * The forming candle after a new price. Once its interval is over a new one opens at the last
 * close, so there is no visual gap before the next history load.
 */
export function liveBar(last: Bar, price: number, step: number, nowSec: number): Bar {
  if (nowSec >= last.time + step) {
    const time = (Math.floor(nowSec / step) * step) as UTCTimestamp;
    return { time, open: last.close, high: price, low: price, close: price };
  }
  return { ...last, close: price, high: Math.max(last.high, price), low: Math.min(last.low, price) };
}

/**
 * History comes from /api/candles once per symbol and timeframe; after that the forming
 * candle follows the live price from the market stream, and liquidations of this pair
 * are pinned to the candle they happened in.
 */
export class PriceChart {
  private readonly el = document.getElementById('chart')!;
  private readonly tfEl = document.getElementById('tf')!;
  private readonly backtestEl = document.getElementById('bt')!;
  private readonly toolsEl = document.getElementById('tools')!;
  private readonly draw: DrawLayer;
  /** Open times of the candles on screen, in seconds: the drawings' time axis. */
  private times: number[] = [];
  private readonly menu: IndicatorMenu;
  private studies: Studies | null = null;
  /** The candles on screen with volume, which the indicators read; the last one is live. */
  private history: CandleDto[] = [];
  private chart: IChartApi | null = null;
  private candles: ISeriesApi<'Candlestick'> | null = null;
  private markers: ISeriesMarkersPluginApi<Time> | null = null;
  private markerList: SeriesMarker<Time>[] = [];
  private lastBar: Bar | null = null;
  private wallLines = new Map<string, IPriceLine>();
  private alertLines = new Map<number, IPriceLine>();
  private symbol = '';
  private interval = load('interval', '5m');
  private request = 0;

  private readonly market: Market;
  private readonly alerts: Alerts;

  constructor(market: Market, alerts: Alerts) {
    this.market = market;
    this.alerts = alerts;
    alerts.changed.on(() => this.syncAlerts());
    this.draw = new DrawLayer(this.el, () => this.renderTools());
    this.renderTools();
    this.toolsEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.dataset.act === 'delete') this.draw.deleteSelected();
      else if (button.dataset.act === 'clear') this.draw.clear();
      else this.draw.setTool((button.dataset.tool as ToolId) || null);
    });
    this.menu = new IndicatorMenu((ids) => this.studies?.setEnabled(ids));
    this.renderTimeframes();
    this.tfEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-tf]');
      if (button) this.setTimeframe(button.dataset.tf!);
    });
    market.delta.on((changes) => {
      const mine = changes.find(([, next]) => next.symbol === this.symbol);
      if (mine) this.tick(mine[1].price);
    });
    market.wallsUpdated.on(() => this.syncWalls());
    market.newSignals.on((fresh) => {
      const mine = fresh.filter((s) => s.symbol === this.symbol);
      if (mine.length) this.addSignalMarkers(mine);
    });
    market.newLiquidations.on((items) => {
      const mine = items.filter((l) => l.symbol === this.symbol);
      if (mine.length) this.addLiquidationMarkers(mine);
    });
  }

  show(symbol: string) {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    this.draw.setSymbol(symbol);
    void this.load();
  }

  setTimeframe(interval: string) {
    if (!(interval in INTERVALS) || interval === this.interval) return;
    this.interval = interval;
    save('interval', interval);
    this.renderTimeframes();
    if (this.symbol) void this.load();
  }

  get timeframe() {
    return this.interval;
  }

  /** Cursor, the drawing tools, then delete and clear. */
  private renderTools() {
    const tool = this.draw.tool;
    const button = (attrs: string, icon: IconName, label: string, pressed?: boolean) =>
      `<button type="button" ${attrs} title="${label}" aria-label="${label}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${ICONS[icon]}</button>`;
    this.toolsEl.innerHTML =
      button('data-tool=""', 'cursor', t('Cursor: select and move drawings'), tool === null) +
      TOOLS.map(([id, icon, label]) => button(`data-tool="${id}"`, icon, label, tool === id)).join('') +
      '<hr>' +
      button(`data-act="delete"${this.draw.hasSelection ? '' : ' disabled'}`, 'close', t('Delete the selected drawing (Del)')) +
      button(`data-act="clear"${this.draw.count ? '' : ' disabled'}`, 'trash', t('Remove all drawings on this pair'));
  }

  private renderTimeframes() {
    this.tfEl.innerHTML = Object.keys(INTERVALS)
      .map((tf) => `<button role="tab" data-tf="${tf}" aria-selected="${tf === this.interval}">${tf}</button>`)
      .join('');
  }

  private async load() {
    const request = ++this.request;
    const symbol = this.symbol;
    // dim the old chart right away: the previous pair must not pass for the new one
    this.el.classList.add('loading');
    let data: CandleDto[];
    try {
      const response = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${this.interval}&limit=${HISTORY}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = (await response.json()) as CandleDto[];
    } catch (error) {
      if (request === this.request) this.showError(t('Could not load {tf} candles: {error}', { tf: this.interval, error: (error as Error).message }));
      return;
    }
    if (request !== this.request) return; // the user already switched to another pair or timeframe
    this.build(data);
    this.el.classList.remove('loading');
  }

  private build(data: CandleDto[]) {
    this.studies?.dispose();
    this.studies = null;
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
        fontFamily: CHART_FONT,
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
        color: c.close >= c.open ? 'rgba(46,189,133,.28)' : 'rgba(246,70,93,.28)',
      })),
    );

    this.history = data.map((c) => ({ ...c }));
    this.times = data.map((c) => c.time);
    this.draw.attach(this.chart, this.candles, () => this.times, INTERVALS[this.interval]);
    this.studies = new Studies(this.chart, this.candles, (lines) => renderBacktest(this.backtestEl, lines));
    this.studies.setEnabled(this.menu.enabled);
    this.studies.setBars(this.history);

    this.markerList = [];
    this.markers = createSeriesMarkers(this.candles, []);
    this.wallLines.clear();
    this.syncWalls();
    this.alertLines.clear();
    this.syncAlerts();
    // Alt + click: an alert at the price under the cursor
    this.chart.subscribeClick((param) => {
      const event = param.sourceEvent;
      if (!event?.altKey || !param.point || !this.candles) return;
      const price = this.candles.coordinateToPrice(param.point.y);
      if (price !== null && price > 0) this.alerts.add(this.symbol, price);
    });
    this.addLiquidationMarkers(this.market.liquidations.filter((l) => l.symbol === this.symbol));
    this.addSignalMarkers(this.market.signals.filter((s) => s.symbol === this.symbol));
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - 110), to: bars.length + 3 });
  }

  private tick(price: number) {
    if (!this.candles || !this.lastBar) return;
    this.lastBar = liveBar(this.lastBar, price, INTERVALS[this.interval], Math.floor(Date.now() / 1000));
    this.candles.update(this.lastBar);

    const last = this.history.at(-1);
    if (last && last.time === this.lastBar.time) Object.assign(last, this.lastBar);
    else {
      this.history.push({ ...this.lastBar, volume: 0 });
      this.times.push(this.lastBar.time);
    }
    this.studies?.live(this.history);
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

  /** This pair's price alerts as solid amber lines, so they read differently from walls. */
  private syncAlerts() {
    if (!this.candles) return;
    const wanted = new Map(this.alerts.for(this.symbol).map((a) => [a.id, a]));
    for (const [id, line] of this.alertLines) {
      if (!wanted.has(id)) {
        this.candles.removePriceLine(line);
        this.alertLines.delete(id);
      }
    }
    for (const [id, alert] of wanted) {
      if (this.alertLines.has(id)) continue;
      this.alertLines.set(
        id,
        this.candles.createPriceLine({
          price: alert.level,
          color: css('--ind-amber'),
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: t('alert'),
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

  /** Where the detector fired on this pair, in the accent colour so they stand apart from liquidations. */
  private addSignalMarkers(signals: Signal[]) {
    if (!this.markers || !this.lastBar) return;
    const step = INTERVALS[this.interval];
    const accent = css('--accent');
    for (const s of signals) {
      const time = (Math.floor(s.time / 1000 / step) * step) as UTCTimestamp;
      this.markerList.push(
        s.type === 'PUMP'
          ? { time, position: 'belowBar', color: accent, shape: 'arrowUp', size: 0.8 }
          : s.type === 'DUMP'
            ? { time, position: 'aboveBar', color: accent, shape: 'arrowDown', size: 0.8 }
            : { time, position: 'aboveBar', color: accent, shape: 'square', size: 0.5 },
      );
    }
    this.markerList.sort((a, b) => (a.time as number) - (b.time as number));
    this.markers.setMarkers(this.markerList);
  }

  private showError(message: string) {
    this.el.classList.remove('loading');
    this.studies?.dispose();
    this.studies = null;
    renderBacktest(this.backtestEl, []);
    this.draw.detach();
    this.chart?.remove();
    this.chart = null;
    this.candles = null;
    this.el.innerHTML = `<p class="empty-note">${message}</p>`;
  }
}

import {
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IChartApiBase,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  type LineSeriesPartialOptions,
  type Logical,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

import { px } from './format';
import {
  bollinger,
  divergences,
  ema,
  fairValueGaps,
  hyperWave,
  macd,
  rsi,
  rsi2Strategy,
  smartTrail,
  squeezeStrategy,
  structure,
  supertrend,
  vwap,
  type Bar,
  type Line,
  type StrategyResult,
  type Trail,
} from './indicators';

export type StudyId =
  | 'ema' | 'bb' | 'vwap' | 'st' | 'smart'
  | 'fvg' | 'ob' | 'ms' | 'div'
  | 'rsi' | 'macd' | 'hw'
  | 'rsi2' | 'squeeze';

export interface StudyInfo {
  id: StudyId;
  name: string;
  hint: string;
  group: 'Overlays' | 'Smart money' | 'Oscillators' | 'Strategies';
}

export const STUDIES: StudyInfo[] = [
  { id: 'ema', name: 'EMA 20 / 50 / 200', hint: 'moving averages', group: 'Overlays' },
  { id: 'bb', name: 'Bollinger 20, 2', hint: 'volatility bands', group: 'Overlays' },
  { id: 'vwap', name: 'VWAP', hint: 'daily, from 00:00 UTC', group: 'Overlays' },
  { id: 'st', name: 'Supertrend 10, 3', hint: 'trend line with flips', group: 'Overlays' },
  { id: 'smart', name: 'Smart trail', hint: 'ATR trail, flips scored 1 to 4', group: 'Overlays' },
  { id: 'fvg', name: 'Fair value gaps', hint: 'unfilled imbalances', group: 'Smart money' },
  { id: 'ob', name: 'Order blocks', hint: 'last candle before a break', group: 'Smart money' },
  { id: 'ms', name: 'BOS / CHoCH', hint: 'breaks of structure', group: 'Smart money' },
  { id: 'div', name: 'RSI divergences', hint: 'price and momentum disagree', group: 'Smart money' },
  { id: 'rsi', name: 'RSI 14', hint: 'own pane', group: 'Oscillators' },
  { id: 'macd', name: 'MACD 12, 26, 9', hint: 'own pane', group: 'Oscillators' },
  { id: 'hw', name: 'HyperWave + money flow', hint: 'momentum, turning points', group: 'Oscillators' },
  { id: 'rsi2', name: 'RSI-2 pullback', hint: 'entries, stop, target, backtest', group: 'Strategies' },
  { id: 'squeeze', name: 'Squeeze breakout', hint: 'entries, stop, target, backtest', group: 'Strategies' },
];

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** #rrggbb from the theme to rgba(); both the chart library and canvas parse that everywhere. */
export function alpha(hex: string, a: number) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

// ---------- drawing primitive for zones and segments ----------

type Shape =
  | { kind: 'zone'; from: number; top: number; bottom: number; color: string; label?: string }
  | {
      kind: 'segment';
      from: number;
      to: number;
      fromPrice: number;
      toPrice: number;
      color: string;
      dashed?: boolean;
      label?: string;
      /** where along the segment the label sits, and on which side of it */
      labelAt?: 'start' | 'mid' | 'end';
      above?: boolean;
    };

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/**
 * Lightweight Charts has no boxes or arbitrary segments, so SMC zones and strategy levels are
 * drawn by a series primitive: a plugin that gets a canvas after every redraw and maps bar
 * indices and prices to pixels through the chart's own scales.
 */
class ShapesPrimitive implements ISeriesPrimitive<Time> {
  private shapes: Shape[] = [];
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly views: IPrimitivePaneView[] = [
    { renderer: () => ({ draw: (target: DrawTarget) => this.draw(target) }) },
  ];

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart;
    this.series = param.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = param.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  set(shapes: Shape[]) {
    this.shapes = shapes;
    this.requestUpdate?.();
  }

  paneViews() {
    return this.views;
  }

  private draw(target: DrawTarget) {
    if (!this.chart || !this.series || !this.shapes.length) return;
    const time = this.chart.timeScale();
    const series = this.series;
    const x = (i: number) => time.logicalToCoordinate(i as Logical);
    const y = (p: number) => series.priceToCoordinate(p);
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.font = '10px "Azeret Mono", monospace';
      ctx.lineWidth = 1;
      for (const s of this.shapes) {
        if (s.kind === 'zone') {
          const x1 = x(s.from);
          const y1 = y(s.top);
          const y2 = y(s.bottom);
          if (x1 === null || y1 === null || y2 === null) continue;
          ctx.fillStyle = alpha(s.color, 0.1);
          ctx.fillRect(x1, y1, mediaSize.width - x1, y2 - y1);
          ctx.strokeStyle = alpha(s.color, 0.32);
          ctx.strokeRect(x1 + 0.5, y1 + 0.5, mediaSize.width - x1, y2 - y1);
          if (s.label) {
            ctx.fillStyle = alpha(s.color, 0.8);
            ctx.fillText(s.label, x1 + 4, y1 + 11);
          }
          continue;
        }
        const x1 = x(s.from);
        const x2 = x(s.to);
        const y1 = y(s.fromPrice);
        const y2 = y(s.toPrice);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        ctx.strokeStyle = s.color;
        ctx.setLineDash(s.dashed ? [4, 3] : []);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (!s.label) continue;
        const at = s.labelAt ?? 'mid';
        const lx = at === 'start' ? x1 : at === 'end' ? x2 : (x1 + x2) / 2;
        const ly = at === 'start' ? y1 : at === 'end' ? y2 : (y1 + y2) / 2;
        const w = ctx.measureText(s.label).width;
        ctx.fillStyle = s.color;
        ctx.fillText(s.label, at === 'end' ? lx - w : at === 'start' ? lx : lx - w / 2, s.above ? ly - 5 : ly + 12);
      }
    });
  }
}

// ---------- the studies on one chart ----------

const quiet: LineSeriesPartialOptions = {
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
};

interface Palette {
  up: string;
  down: string;
  accent: string;
  amber: string;
  violet: string;
  orange: string;
  ink: string;
  rule: string;
}

export interface BacktestLine {
  name: string;
  result: StrategyResult;
}

/**
 * Owns every series, pane, marker and shape the enabled studies put on one price chart.
 * Toggling rebuilds the set from scratch; new data only replaces values in place, so a live
 * candle does not make anything flicker.
 */
export class Studies {
  private readonly chart: IChartApi;
  private readonly candles: ISeriesApi<'Candlestick'>;
  private readonly onBacktest: (lines: BacktestLine[]) => void;
  private readonly markers: ISeriesMarkersPluginApi<Time>;
  private readonly shapes = new ShapesPrimitive();
  private readonly palette: Palette;
  private enabled = new Set<StudyId>();
  private lines = new Map<string, ISeriesApi<'Line'> | ISeriesApi<'Histogram'>>();
  private bars: Bar[] = [];
  private lastLive = 0;

  constructor(chart: IChartApi, candles: ISeriesApi<'Candlestick'>, onBacktest: (lines: BacktestLine[]) => void) {
    this.chart = chart;
    this.candles = candles;
    this.onBacktest = onBacktest;
    this.markers = createSeriesMarkers(candles, []);
    candles.attachPrimitive(this.shapes);
    this.palette = {
      up: css('--up'),
      down: css('--down'),
      accent: css('--accent'),
      amber: css('--ind-amber'),
      violet: css('--ind-violet'),
      orange: css('--ind-orange'),
      ink: css('--ink-3'),
      rule: css('--rule-strong'),
    };
  }

  setEnabled(ids: Iterable<StudyId>) {
    for (const series of this.lines.values()) this.chart.removeSeries(series);
    this.lines.clear();
    this.enabled = new Set(ids);
    this.createSeries();
    this.compute();
  }

  setBars(bars: Bar[]) {
    this.bars = bars;
    this.compute();
  }

  /** The forming candle changes twice a second; the studies follow it every couple of seconds. */
  live(bars: Bar[]) {
    this.bars = bars;
    const now = Date.now();
    if (now - this.lastLive < 2_000) return;
    this.lastLive = now;
    this.compute();
  }

  dispose() {
    this.markers.detach();
    this.candles.detachPrimitive(this.shapes);
  }

  private add(key: string, pane: number, options: LineSeriesPartialOptions) {
    this.lines.set(key, this.chart.addSeries(LineSeries, { ...quiet, ...options }, pane));
  }

  private addHistogram(key: string, pane: number) {
    this.lines.set(key, this.chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane));
  }

  private createSeries() {
    const p = this.palette;
    const on = (id: StudyId) => this.enabled.has(id);
    if (on('ema')) {
      this.add('ema20', 0, { color: p.amber });
      this.add('ema50', 0, { color: p.accent });
      this.add('ema200', 0, { color: p.violet, lineWidth: 2 });
    }
    if (on('bb')) {
      this.add('bbUp', 0, { color: alpha(p.ink, 0.8) });
      this.add('bbMid', 0, { color: alpha(p.ink, 0.5), lineStyle: LineStyle.Dashed });
      this.add('bbLow', 0, { color: alpha(p.ink, 0.8) });
    }
    if (on('vwap')) this.add('vwap', 0, { color: p.orange, lineWidth: 2 });
    if (on('st')) {
      this.add('stUp', 0, { color: p.up, lineWidth: 2 });
      this.add('stDown', 0, { color: p.down, lineWidth: 2 });
    }
    if (on('smart')) {
      this.add('smartUp', 0, { color: alpha(p.up, 0.75), lineWidth: 2, lineStyle: LineStyle.Dotted });
      this.add('smartDown', 0, { color: alpha(p.down, 0.75), lineWidth: 2, lineStyle: LineStyle.Dotted });
    }

    // every oscillator gets a pane of its own under the price, in a fixed order
    let pane = 0;
    const level = (series: ISeriesApi<'Line'>, price: number, strong = true) =>
      series.createPriceLine({ price, color: strong ? p.rule : alpha(p.rule, 0.5), lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: false });
    if (on('rsi')) {
      pane++;
      this.add('rsi', pane, { color: p.violet, lineWidth: 2, lastValueVisible: true, title: 'RSI' });
      const line = this.lines.get('rsi') as ISeriesApi<'Line'>;
      level(line, 70);
      level(line, 30);
      level(line, 50, false);
    }
    if (on('macd')) {
      pane++;
      this.addHistogram('macdHist', pane);
      this.add('macd', pane, { color: p.accent, lastValueVisible: true, title: 'MACD' });
      this.add('macdSignal', pane, { color: p.amber });
    }
    if (on('hw')) {
      pane++;
      this.addHistogram('hwFlow', pane);
      this.add('hwWave', pane, { color: p.accent, lineWidth: 2, lastValueVisible: true, title: 'HW' });
      this.add('hwSignal', pane, { color: p.amber });
      const wave = this.lines.get('hwWave') as ISeriesApi<'Line'>;
      level(wave, 60);
      level(wave, -60);
      level(wave, 0, false);
    }
    // the price keeps most of the height; each oscillator pane is a third of it
    const panes = this.chart.panes();
    panes.forEach((p, i) => p.setStretchFactor(i === 0 ? 3 : 1));
  }

  private set(key: string, values: Line) {
    this.lines.get(key)?.setData(this.bars.map((b, i) => (values[i] === null ? { time: b.time as UTCTimestamp } : { time: b.time as UTCTimestamp, value: values[i]! })));
  }

  private setColored(key: string, values: Line, a: number) {
    this.lines.get(key)?.setData(
      this.bars.map((b, i) => {
        const v = values[i];
        const time = b.time as UTCTimestamp;
        return v === null ? { time } : { time, value: v, color: alpha(v >= 0 ? this.palette.up : this.palette.down, a) };
      }),
    );
  }

  /** A two-colour trail: the up series has values only where the direction is up, and vice versa. */
  private setTrail(prefix: string, trail: Trail) {
    this.set(`${prefix}Up`, trail.line.map((v, i) => (trail.dir[i] === 1 ? v : null)));
    this.set(`${prefix}Down`, trail.line.map((v, i) => (trail.dir[i] === -1 ? v : null)));
  }

  private compute() {
    const bars = this.bars;
    if (bars.length < 30) return;
    const p = this.palette;
    const on = (id: StudyId) => this.enabled.has(id);
    const closes = bars.map((b) => b.close);
    const time = (i: number) => bars[i].time as UTCTimestamp;
    const markers: SeriesMarker<Time>[] = [];
    const shapes: Shape[] = [];
    const backtests: BacktestLine[] = [];

    if (on('ema')) {
      this.set('ema20', ema(closes, 20));
      this.set('ema50', ema(closes, 50));
      this.set('ema200', ema(closes, 200));
    }
    if (on('bb')) {
      const bands = bollinger(closes);
      this.set('bbUp', bands.upper);
      this.set('bbMid', bands.mid);
      this.set('bbLow', bands.lower);
    }
    if (on('vwap')) this.set('vwap', vwap(bars));
    if (on('st')) {
      const trail = supertrend(bars);
      this.setTrail('st', trail);
      for (const f of trail.flips) {
        markers.push(
          f.dir === 1
            ? { time: time(f.i), position: 'belowBar', color: p.up, shape: 'arrowUp', text: 'Buy' }
            : { time: time(f.i), position: 'aboveBar', color: p.down, shape: 'arrowDown', text: 'Sell' },
        );
      }
    }
    if (on('smart')) {
      const trail = smartTrail(bars);
      this.setTrail('smart', trail);
      for (const f of trail.flips) {
        // a flip everything agrees with is drawn in amber, weak ones fade
        const base = f.dir === 1 ? p.up : p.down;
        const color = f.score! >= 4 ? p.amber : alpha(base, f.score === 3 ? 1 : 0.55);
        markers.push(
          f.dir === 1
            ? { time: time(f.i), position: 'belowBar', color, shape: 'arrowUp', text: String(f.score) }
            : { time: time(f.i), position: 'aboveBar', color, shape: 'arrowDown', text: String(f.score) },
        );
      }
    }

    if (on('fvg')) {
      for (const z of fairValueGaps(bars)) shapes.push({ kind: 'zone', from: z.from, top: z.top, bottom: z.bottom, color: z.bull ? p.up : p.down });
    }
    if (on('ob') || on('ms')) {
      const { breaks, blocks } = structure(bars);
      if (on('ob')) {
        for (const b of blocks) shapes.push({ kind: 'zone', from: b.from, top: b.top, bottom: b.bottom, color: b.bull ? p.accent : p.violet, label: 'OB' });
      }
      if (on('ms')) {
        for (const s of breaks) shapes.push({ kind: 'segment', ...s, color: s.bull ? p.up : p.down, above: s.bull });
      }
    }
    if (on('div')) {
      for (const s of divergences(bars)) shapes.push({ kind: 'segment', ...s, color: s.bull ? p.up : p.down, labelAt: 'end', above: !s.bull });
    }

    if (on('rsi')) this.set('rsi', rsi(closes, 14));
    if (on('macd')) {
      const m = macd(closes);
      this.set('macd', m.line);
      this.set('macdSignal', m.signal);
      this.setColored('macdHist', m.hist, 0.5);
    }
    if (on('hw')) {
      const h = hyperWave(bars);
      this.set('hwWave', h.wave);
      this.set('hwSignal', h.signal);
      this.setColored('hwFlow', h.flow, 0.3);
      const wave = this.lines.get('hwWave') as ISeriesApi<'Line'> | undefined;
      if (wave) {
        createOrUpdateMarkers(
          wave,
          h.turns.map((t) => ({
            time: time(t.i),
            position: t.dir === 1 ? 'belowBar' : 'aboveBar',
            color: alpha(t.dir === 1 ? p.up : p.down, t.strong ? 1 : 0.5),
            shape: 'circle',
            size: 0.6,
          })),
        );
      }
    }

    const strategies: Array<[StudyId, string, (b: Bar[]) => StrategyResult, string, string]> = [
      ['rsi2', 'RSI-2', rsi2Strategy, 'Long', 'Short'],
      ['squeeze', 'Squeeze', squeezeStrategy, 'Break', 'Break'],
    ];
    for (const [id, name, run, longText, shortText] of strategies) {
      if (!on(id)) continue;
      const result = run(bars);
      backtests.push({ name, result });
      const all = result.open ? [...result.trades, result.open] : result.trades;
      for (const t of all.slice(-30)) {
        markers.push(
          t.dir === 1
            ? { time: time(t.entryIndex), position: 'belowBar', color: p.accent, shape: 'arrowUp', text: longText }
            : { time: time(t.entryIndex), position: 'aboveBar', color: p.violet, shape: 'arrowDown', text: shortText },
        );
      }
      // entry, target and stop of the last few trades; only the latest one is labelled
      const recent = all.slice(-3);
      recent.forEach((t, k) => {
        const last = k === recent.length - 1;
        const a = last ? 0.95 : 0.4;
        const span = { from: t.entryIndex, to: t.exitIndex };
        shapes.push({ kind: 'segment', ...span, fromPrice: t.entry, toPrice: t.entry, color: alpha(p.ink, 0.7), dashed: true });
        shapes.push({ kind: 'segment', ...span, fromPrice: t.target, toPrice: t.target, color: alpha(p.up, a), label: last ? `TP ${px(t.target)}` : undefined, labelAt: 'end', above: t.dir === 1 });
        shapes.push({ kind: 'segment', ...span, fromPrice: t.stop, toPrice: t.stop, color: alpha(p.down, a), label: last ? `SL ${px(t.stop)}` : undefined, labelAt: 'end', above: t.dir !== 1 });
      });
    }

    markers.sort((a, b) => (a.time as number) - (b.time as number));
    this.markers.setMarkers(markers);
    this.shapes.set(shapes);
    this.onBacktest(backtests);
  }
}

// markers on an oscillator line live as long as that series does
const lineMarkers = new WeakMap<ISeriesApi<'Line'>, ISeriesMarkersPluginApi<Time>>();
function createOrUpdateMarkers(series: ISeriesApi<'Line'>, markers: SeriesMarker<Time>[]) {
  let plugin = lineMarkers.get(series);
  if (!plugin) {
    plugin = createSeriesMarkers(series, []);
    lineMarkers.set(series, plugin);
  }
  plugin.setMarkers(markers);
}

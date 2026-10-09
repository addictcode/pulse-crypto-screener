import type { IChartApi, ISeriesApi, Logical } from 'lightweight-charts';

import { px } from './format';
import { t } from './i18n';
import { load, save } from './storage';

export type ToolId = 'trend' | 'ray' | 'hline' | 'rect' | 'fib' | 'measure';

/** A corner of a drawing: unix seconds (UTC) and price, so it survives a timeframe change. */
export interface Point {
  t: number;
  p: number;
}

export interface Drawing {
  id: number;
  type: ToolId;
  points: Point[];
}

interface Px {
  x: number;
  y: number;
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const HIT = 6;
const HANDLE = 9;

/**
 * Where a moment in time sits on the bar axis, as a fractional bar index. Times before the first
 * bar and after the last one continue the axis at the chart's step, which is what lets a line
 * run into the empty space to the right of the last candle.
 */
export function logicalAt(times: number[], step: number, time: number): number | null {
  const n = times.length;
  if (!n) return null;
  if (time >= times[n - 1]) return n - 1 + (time - times[n - 1]) / step;
  if (time <= times[0]) return (time - times[0]) / step;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const t1 = times[lo];
  const t0 = times[lo - 1];
  return t1 === t0 ? lo : lo - 1 + (time - t0) / (t1 - t0);
}

/** The inverse of {@link logicalAt}. */
export function timeAt(times: number[], step: number, logical: number): number | null {
  const n = times.length;
  if (!n) return null;
  if (logical <= 0) return times[0] + logical * step;
  if (logical >= n - 1) return times[n - 1] + (logical - (n - 1)) * step;
  const i0 = Math.floor(logical);
  return times[i0] + (times[i0 + 1] - times[i0]) * (logical - i0);
}

/** Distance from a point to a segment, in pixels. */
export function distanceToSegment(p: Px, a: Px, b: Px): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

/** 90s, 45m, 6h 30m, 3d 4h */
export function spanText(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  if (s < 3600) return t('{n}m', { n: Math.max(1, Math.round(s / 60)) });
  if (s < 86_400) return t('{h}h {m}m', { h: Math.floor(s / 3600), m: String(Math.round((s % 3600) / 60)).padStart(2, '0') });
  return t('{d}d {h}h', { d: Math.floor(s / 86_400), h: Math.round((s % 86_400) / 3600) });
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const alpha = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})` : hex;
};

/**
 * Drawings on top of the price chart: trend lines, rays, levels, zones, Fibonacci retracements
 * and a ruler. They live in a canvas above the chart, are stored per symbol in this browser, and
 * are anchored to time and price rather than pixels.
 */
export class DrawLayer {
  private readonly wrap: HTMLElement;
  private readonly onChange: () => void;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;

  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private times: () => number[] = () => [];
  private step = 60;

  private symbol = '';
  private drawings: Drawing[] = [];
  private activeTool: ToolId | null = null;
  private draft: Drawing | null = null;
  private selectedId: number | null = null;
  private drag: { drawing: Drawing; handle: number | 'body'; from: Px; original: Point[] } | null = null;
  private width = 0;
  private height = 0;
  /** What is drawn right now, for a picture of the chart. */
  get image(): HTMLCanvasElement {
    return this.canvas;
  }

  /** The canvas is known to be clear. */
  private blank = true;
  private colors = { accent: '#4db8ff', amber: '#f0b90b', violet: '#a78bfa', up: '#2ebd85', down: '#f6465d', ink: '#e7eaf0', bg: '#0e1116' };

  constructor(wrap: HTMLElement, onChange: () => void) {
    this.wrap = wrap;
    this.onChange = onChange;
    this.canvas.className = 'drawlayer';
    // capture phase: a click that draws or drags must not also pan the chart underneath
    wrap.addEventListener('pointerdown', (e) => this.onDown(e), true);
    wrap.addEventListener('pointermove', (e) => this.onMove(e), true);
    wrap.addEventListener('pointerup', () => this.onUp(), true);
    wrap.addEventListener('pointercancel', () => this.onUp(), true);
    window.addEventListener('keydown', (e) => this.onKey(e));
    // every frame, because the chart pans and rescales under the drawings without telling anyone;
    // changes made here also repaint at once, so nothing waits for the next frame
    const frame = () => {
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Called every time the chart is rebuilt (new pair or timeframe). */
  attach(chart: IChartApi, series: ISeriesApi<'Candlestick'>, times: () => number[], step: number) {
    this.chart = chart;
    this.series = series;
    this.times = times;
    this.step = step;
    this.colors = {
      accent: css('--accent'), amber: css('--ind-amber'), violet: css('--ind-violet'),
      up: css('--up'), down: css('--down'), ink: css('--ink'), bg: css('--bg-1'),
    };
    this.wrap.append(this.canvas);
    this.draft = null;
    this.drag = null;
  }

  detach() {
    this.chart = null;
    this.series = null;
    this.canvas.remove();
  }

  setSymbol(symbol: string) {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    this.drawings = load<Drawing[]>(`draw.${symbol}`, []).filter((d) => d && Array.isArray(d.points) && d.points.length);
    this.selectedId = null;
    this.draft = null;
    this.drag = null;
    this.onChange();
  }

  get tool() {
    return this.activeTool;
  }

  get count() {
    return this.drawings.length;
  }

  get hasSelection() {
    return this.selectedId !== null;
  }

  setTool(tool: ToolId | null) {
    this.activeTool = tool;
    this.draft = null;
    this.wrap.classList.toggle('drawing', tool !== null);
    this.onChange();
  }

  deleteSelected() {
    if (this.selectedId === null) return;
    this.drawings = this.drawings.filter((d) => d.id !== this.selectedId);
    this.selectedId = null;
    this.commit();
  }

  clear() {
    this.drawings = [];
    this.selectedId = null;
    this.commit();
  }

  private commit() {
    if (this.symbol) save(`draw.${this.symbol}`, this.drawings);
    this.onChange();
    this.render();
  }

  // ---------- coordinates ----------

  private x(time: number): number | null {
    const logical = logicalAt(this.times(), this.step, time);
    return logical === null || !this.chart ? null : this.chart.timeScale().logicalToCoordinate(logical as Logical);
  }

  private y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null;
  }

  private pointAt(at: Px): Point | null {
    if (!this.chart || !this.series) return null;
    const logical = this.chart.timeScale().coordinateToLogical(at.x);
    const price = this.series.coordinateToPrice(at.y);
    if (logical === null || price === null) return null;
    const time = timeAt(this.times(), this.step, logical);
    return time === null ? null : { t: time, p: price };
  }

  private pixels(d: Drawing): Px[] | null {
    const out: Px[] = [];
    for (const point of d.points) {
      const x = this.x(point.t);
      const y = this.y(point.p);
      if (x === null || y === null) return null;
      out.push({ x, y });
    }
    return out;
  }

  /** The price pane without the axes and without the indicator panes below it. */
  private pane(): { w: number; h: number } {
    if (!this.chart) return { w: 0, h: 0 };
    const scale = this.chart.priceScale('right').width() || 64;
    let h = this.height - (this.chart.timeScale().height() || 26);
    try {
      const first = this.chart.panes()[0];
      if (first) h = Math.min(h, first.getHeight());
    } catch {
      // older builds have a single pane
    }
    return { w: this.width - scale, h };
  }

  private local(e: PointerEvent): Px {
    const box = this.wrap.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  }

  // ---------- pointer and keyboard ----------

  private onDown(e: PointerEvent) {
    if (e.button !== 0 || !this.chart || e.altKey) return;
    const at = this.local(e);
    const pane = this.pane();
    if (at.x > pane.w || at.y > pane.h) return; // the axes belong to the chart

    if (this.activeTool) {
      e.preventDefault();
      e.stopPropagation();
      this.place(at);
      return;
    }
    const handle = this.hitHandle(at);
    const drawing = handle?.drawing ?? this.hitDrawing(at);
    if (drawing) {
      this.selectedId = drawing.id;
      this.drag = { drawing, handle: handle ? handle.index : 'body', from: at, original: drawing.points.map((p) => ({ ...p })) };
      e.preventDefault();
      e.stopPropagation();
      this.wrap.setPointerCapture(e.pointerId);
      this.onChange();
    } else if (this.selectedId !== null) {
      this.selectedId = null; // a click on empty space deselects and still pans the chart
      this.onChange();
    }
  }

  private place(at: Px) {
    const point = this.pointAt(at);
    if (!point || !this.activeTool) return;
    if (this.activeTool === 'hline') {
      this.finish({ id: 0, type: 'hline', points: [point] });
    } else if (!this.draft) {
      this.draft = { id: 0, type: this.activeTool, points: [point, { ...point }] };
    } else {
      this.draft.points[1] = point;
      this.finish(this.draft);
    }
  }

  private finish(drawing: Drawing) {
    drawing.id = Date.now() + Math.floor(Math.random() * 1000);
    this.drawings.push(drawing);
    this.selectedId = drawing.id;
    this.draft = null;
    this.activeTool = null;
    this.wrap.classList.remove('drawing');
    this.commit();
  }

  private onMove(e: PointerEvent) {
    if (!this.draft && !this.drag) return;
    const at = this.local(e);
    const point = this.pointAt(at);
    if (!point) return;
    if (this.draft) {
      this.draft.points[1] = point;
      this.render();
      return;
    }
    const drag = this.drag!;
    e.stopPropagation();
    if (drag.handle === 'body') {
      const start = this.pointAt(drag.from);
      if (!start) return;
      const dt = point.t - start.t;
      const dp = point.p - start.p;
      drag.drawing.points = drag.original.map((p) => ({ t: p.t + dt, p: p.p + dp }));
    } else {
      drag.drawing.points[drag.handle] = point;
    }
    this.render();
  }

  private onUp() {
    if (!this.drag) return;
    this.drag = null;
    this.commit();
  }

  private onKey(e: KeyboardEvent) {
    const target = e.target instanceof HTMLElement ? e.target : null;
    if (target?.matches('input, select, textarea')) return;
    if (e.key === 'Escape' && (this.activeTool || this.draft)) {
      this.setTool(null);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId !== null) {
      e.preventDefault();
      this.deleteSelected();
    }
  }

  // ---------- hit tests ----------

  private hitHandle(at: Px): { drawing: Drawing; index: number } | null {
    const drawing = this.drawings.find((d) => d.id === this.selectedId);
    if (!drawing || drawing.type === 'hline') return null;
    const points = this.pixels(drawing);
    if (!points) return null;
    const index = points.findIndex((p) => Math.hypot(at.x - p.x, at.y - p.y) < HANDLE);
    return index < 0 ? null : { drawing, index };
  }

  private hitDrawing(at: Px): Drawing | null {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.type === 'hline') {
        const y = this.y(d.points[0].p);
        if (y !== null && Math.abs(at.y - y) < HIT) return d;
        continue;
      }
      const points = this.pixels(d);
      if (!points) continue;
      const [a, b] = points;
      if (d.type === 'trend' && distanceToSegment(at, a, b) < HIT) return d;
      if (d.type === 'ray' && distanceToSegment(at, a, rayEnd(a, b)) < HIT) return d;
      if (d.type === 'rect' || d.type === 'measure') {
        const inX = at.x >= Math.min(a.x, b.x) - 3 && at.x <= Math.max(a.x, b.x) + 3;
        const inY = at.y >= Math.min(a.y, b.y) - 3 && at.y <= Math.max(a.y, b.y) + 3;
        if (inX && inY) return d;
      }
      if (d.type === 'fib') {
        if (at.x >= Math.min(a.x, b.x) - 4) {
          for (const level of FIB_LEVELS) {
            const y = this.y(d.points[0].p + (d.points[1].p - d.points[0].p) * level);
            if (y !== null && Math.abs(at.y - y) < HIT - 1) return d;
          }
        }
        if (distanceToSegment(at, a, b) < HIT) return d;
      }
    }
    return null;
  }

  // ---------- render ----------

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    this.width = this.wrap.clientWidth;
    this.height = this.wrap.clientHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.blank = true; // resizing a canvas clears it
  }

  private render() {
    if (!this.chart || !this.canvas.isConnected || !this.wrap.offsetParent) return;
    if (this.wrap.clientWidth !== this.width || this.wrap.clientHeight !== this.height) this.resize();
    const ctx = this.ctx;
    const empty = !this.drawings.length && !this.draft;
    // nothing drawn and nothing to erase: most frames on most charts end here
    if (empty && this.blank) return;
    ctx.clearRect(0, 0, this.width, this.height);
    this.blank = empty;
    if (empty) return;
    const pane = this.pane();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, pane.w, pane.h);
    ctx.clip();
    for (const d of this.drawings) this.paint(d, d.id === this.selectedId, false, pane.w);
    if (this.draft) this.paint(this.draft, false, true, pane.w);
    ctx.restore();
  }

  private chip(x: number, y: number, text: string, color: string) {
    const ctx = this.ctx;
    ctx.font = '500 11px "Inter Variable", sans-serif';
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = alpha(this.colors.bg, 0.92);
    ctx.beginPath();
    ctx.roundRect(x, y - 9, w, 18, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x + 5, y + 4);
  }

  private paint(d: Drawing, selected: boolean, draft: boolean, width: number) {
    const ctx = this.ctx;
    const c = this.colors;
    const color = { trend: c.accent, ray: c.accent, hline: c.amber, rect: c.violet, fib: c.ink, measure: c.accent }[d.type];
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.strokeStyle = color;
    ctx.setLineDash(draft ? [4, 4] : []);

    if (d.type === 'hline') {
      const y = this.y(d.points[0].p);
      if (y === null) return;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.setLineDash([]);
      this.chip(6, y, px(d.points[0].p), color);
      return;
    }

    const points = this.pixels(d);
    if (!points) return;
    const [a, b] = points;

    if (d.type === 'trend' || d.type === 'ray') {
      const end = d.type === 'ray' ? rayEnd(a, b) : b;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    } else if (d.type === 'rect') {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      ctx.fillStyle = alpha(color, 0.12);
      ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (d.type === 'measure') {
      const [from, to] = d.points;
      const rising = to.p >= from.p;
      const tone = rising ? c.up : c.down;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      ctx.strokeStyle = tone;
      ctx.fillStyle = alpha(tone, 0.1);
      ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo((a.x + b.x) / 2, a.y);
      ctx.lineTo((a.x + b.x) / 2, b.y);
      ctx.moveTo(a.x, (a.y + b.y) / 2);
      ctx.lineTo(b.x, (a.y + b.y) / 2);
      ctx.stroke();
      const change = ((to.p - from.p) / from.p) * 100;
      const bars = Math.round(Math.abs(to.t - from.t) / this.step);
      const text = `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%   ${px(Math.abs(to.p - from.p))}   ${t('{n} bars', { n: bars })}, ${spanText(to.t - from.t)}`;
      ctx.font = '500 11px "Inter Variable", sans-serif';
      const w = ctx.measureText(text).width + 10;
      const lx = Math.max(4, Math.min(width - w - 4, (a.x + b.x) / 2 - w / 2));
      const ly = rising ? y - 14 : Math.max(a.y, b.y) + 14;
      this.chip(lx, Math.max(12, ly), text, tone);
    } else if (d.type === 'fib') {
      const left = Math.min(a.x, b.x);
      const [from, to] = d.points;
      ctx.font = '11px "Inter Variable", sans-serif';
      FIB_LEVELS.forEach((level, i) => {
        const price = from.p + (to.p - from.p) * level;
        const y = this.y(price);
        if (y === null) return;
        if (i > 0) {
          const prev = this.y(from.p + (to.p - from.p) * FIB_LEVELS[i - 1]);
          if (prev !== null) {
            ctx.fillStyle = alpha(c.accent, i % 2 ? 0.06 : 0.03);
            ctx.fillRect(left, Math.min(y, prev), width - left, Math.abs(y - prev));
          }
        }
        ctx.strokeStyle = alpha(color, level === 0 || level === 1 || level === 0.5 ? 0.7 : 0.35);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillStyle = alpha(color, 0.75);
        ctx.fillText(`${level}  ${px(price)}`, left + 5, y - 4);
      });
      ctx.strokeStyle = alpha(color, 0.5);
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    if (selected || draft) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = c.bg;
        ctx.fill();
        ctx.stroke();
      }
    }
  }
}

function rayEnd(a: Px, b: Px): Px {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + (dx / len) * 5000, y: a.y + (dy / len) * 5000 };
}

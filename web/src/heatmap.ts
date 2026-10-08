import { base, pct, px, usd } from './format';
import { t } from './i18n';
import type { Market } from './market';
import { load, save } from './storage';
import type { SymbolMetrics } from './types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Squarified treemap: fills the box with one rectangle per weight, keeping them as close to
 * squares as it can. Weights must be positive and sorted largest first.
 */
export function treemap(weights: number[], width: number, height: number): Rect[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const rects: Rect[] = [];
  if (!total || width <= 0 || height <= 0) return rects;
  const areas = weights.map((w) => (w / total) * width * height);
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;
  while (i < areas.length) {
    const side = Math.min(w, h);
    // how far the worst rectangle in a row of this sum is from a square
    const worst = (sum: number, smallest: number, largest: number) =>
      Math.max((side * side * largest) / (sum * sum), (sum * sum) / (side * side * smallest));
    let sum = areas[i];
    let best = worst(sum, areas[i], areas[i]);
    let j = i + 1;
    while (j < areas.length) {
      const next = worst(sum + areas[j], areas[j], areas[i]);
      if (next > best) break;
      sum += areas[j];
      best = next;
      j++;
    }
    const thickness = sum / side;
    let offset = 0;
    for (let k = i; k < j; k++) {
      const length = areas[k] / thickness;
      rects.push(w >= h ? { x, y: y + offset, w: thickness, h: length } : { x: x + offset, y, w: length, h: thickness });
      offset += length;
    }
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
    i = j;
  }
  return rects;
}

type Metric = 'ch5m' | 'ch1h' | 'ch24h';
type Size = 'vol24h' | 'oi';

/** The move that paints a tile fully green or red, per metric. */
const FULL: Record<Metric, number> = { ch5m: 2, ch1h: 5, ch24h: 12 };
const METRICS: Array<[Metric, string]> = [['ch5m', t('5m')], ['ch1h', t('1h')], ['ch24h', t('24h')]];
const SIZES: Array<[Size, string]> = [['vol24h', t('Volume')], ['oi', t('Open interest')]];
const MAX_TILES = 140;
const REFRESH_MS = 3_000;
const NEUTRAL = [34, 40, 52];
const UP = [24, 150, 104];
const DOWN = [214, 50, 74];

const $ = (id: string) => document.getElementById(id)!;

/** Neutral grey at zero, fading to full green or red at the metric's full-scale move. */
export function tileColor(change: number | null, full: number): string {
  if (change === null) return `rgb(${NEUTRAL.join(',')})`;
  const strength = Math.min(1, Math.abs(change) / full) ** 0.7;
  const target = change >= 0 ? UP : DOWN;
  return `rgb(${NEUTRAL.map((n, i) => Math.round(n + (target[i] - n) * strength)).join(',')})`;
}

/**
 * The whole market at a glance: one tile per pair, sized by volume or open interest, coloured by
 * its move. The square root of the size is used, otherwise BTC and ETH would leave no room for
 * anything else.
 */
export class Heatmap {
  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;
  private readonly el = $('heat');
  private metric = load<Metric>('heatMetric', 'ch1h');
  private size = load<Size>('heatSize', 'vol24h');
  private active = false;
  private selected = '';
  private timer = 0;

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    if (!(this.metric in FULL)) this.metric = 'ch1h';
    if (this.size !== 'vol24h' && this.size !== 'oi') this.size = 'vol24h';
    const bind = (id: string, apply: (value: string) => void) =>
      $(id).addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (!button) return;
        apply(button.dataset.value!);
        this.renderFilters();
        this.render();
      });
    bind('hm-metric', (v) => save('heatMetric', (this.metric = v as Metric)));
    bind('hm-size', (v) => save('heatSize', (this.size = v as Size)));
    this.el.addEventListener('click', (e) => {
      const tile = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]');
      if (tile) this.onSelect(tile.dataset.sym!);
    });
    new ResizeObserver(() => this.render()).observe(this.el);
    market.snapshot.on(() => this.render());
    this.renderFilters();
  }

  setActive(active: boolean) {
    this.active = active;
    clearInterval(this.timer);
    if (!active) return;
    this.render();
    this.timer = window.setInterval(() => this.render(), REFRESH_MS);
  }

  setSelected(symbol: string) {
    this.selected = symbol;
    if (this.active) this.render();
  }

  private renderFilters() {
    const seg = (id: string, options: Array<[string, string]>, current: string) =>
      ($(id).innerHTML = options
        .map(([value, label]) => `<button type="button" data-value="${value}" aria-pressed="${value === current}">${label}</button>`)
        .join(''));
    seg('hm-metric', METRICS, this.metric);
    seg('hm-size', SIZES, this.size);
  }

  private render() {
    if (!this.active) return;
    const width = this.el.clientWidth;
    const height = this.el.clientHeight;
    const weight = (r: SymbolMetrics) => Math.sqrt(Math.max(0, r[this.size] ?? 0));
    const rows = [...this.market.rows.values()]
      .filter((r) => weight(r) > 0)
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, MAX_TILES);
    if (!rows.length || width < 40 || height < 40) {
      this.el.innerHTML = `<p class="empty-note">${t('Waiting for market data.')}</p>`;
      $('hm-meta').textContent = '';
      return;
    }
    $('hm-meta').textContent = t('{n} largest pairs', { n: rows.length });
    const rects = treemap(rows.map(weight), width, height);
    const full = FULL[this.metric];
    this.el.innerHTML = rows
      .map((r, i) => {
        const box = rects[i];
        const change = r[this.metric];
        const small = Math.min(box.w, box.h);
        const fit = box.w < 34 || box.h < 16 ? 's0' : box.w < 54 || box.h < 32 ? 's1' : '';
        const font = Math.max(10.5, Math.min(22, small / 4.2, box.w / 5));
        const title = `${base(r.symbol)}  ${px(r.price)}  ${pct(change)}  ${t('Volume')} ${usd(r.vol24h)}  OI ${usd(r.oi)}`;
        return `<button type="button" class="tile ${fit}${r.symbol === this.selected ? ' is-selected' : ''}" data-sym="${r.symbol}" title="${title}" style="left:${box.x.toFixed(1)}px;top:${box.y.toFixed(1)}px;width:${box.w.toFixed(1)}px;height:${box.h.toFixed(1)}px;font-size:${font.toFixed(1)}px;background-color:${tileColor(change, full)}"><b>${base(r.symbol)}</b><span>${pct(change, 2)}</span></button>`;
      })
      .join('');
  }
}

import { age, base, eatTime, pct, px, usd } from './format';
import { t } from './i18n';
import type { Market } from './market';
import { load, save } from './storage';
import type { Wall } from './types';

interface Filters {
  distance: number;
  minSize: number;
  side: 'both' | 'BID' | 'ASK';
}

const DISTANCES = [1, 2, 5];
const SIZES: Array<[number, string]> = [[0, t('any size')], [250_000, '$250K'], [1_000_000, '$1M'], [5_000_000, '$5M']];
const SIDES: Array<[Filters['side'], string]> = [['both', t('both sides')], ['BID', t('bids')], ['ASK', t('asks')]];

const DISTANCE_TICKS = [0.25, 0.5, 1, 2, 3, 5];
const DISTANCE_EXPONENT = 0.7;
const SIZE_TICKS = [25e3, 50e3, 100e3, 250e3, 500e3, 1e6, 2.5e6, 5e6, 10e6, 25e6, 50e6, 100e6, 250e6];
/** Walls this close are about to be tested; the zone is shaded on the map. */
const HOT_ZONE = 0.25;
const MAX_LABELS = 28;
const MAX_LIST_ROWS = 200;
const PAD = { top: 18, right: 18, bottom: 30, left: 58 };

const $ = (id: string) => document.getElementById(id)!;

/**
 * Two views of the same walls: a map (distance from price on x, size on y) for spotting where
 * liquidity sits across the market, and a list for reading exact numbers.
 */
export class Densities {
  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;
  private readonly svg = document.getElementById('map') as unknown as SVGSVGElement;
  private readonly wrap = $('map-wrap');
  private readonly tip = $('map-tip');
  private filters: Filters = load<Filters>('density', { distance: 2, minSize: 0, side: 'both' });
  private visible: Wall[] = [];
  private selected = '';
  private active = false;

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    this.renderFilters();
    market.wallsUpdated.on(() => this.render());
    new ResizeObserver(() => this.render()).observe(this.wrap);
    this.bindEvents();
  }

  setActive(active: boolean) {
    this.active = active;
    if (active) this.render();
  }

  setSelected(symbol: string) {
    this.selected = symbol;
    if (this.active) this.render();
  }

  private render() {
    if (!this.active) return;
    const { distance, minSize, side } = this.filters;
    this.visible = this.market.walls.filter(
      (w) => Math.abs(w.distance) <= distance && w.size >= minSize && (side === 'both' || w.side === side),
    );
    $('dm-meta').textContent = t('{n} walls in {books} live books', { n: this.visible.length, books: this.market.coverage.size });
    this.renderMap();
    this.renderList();
  }

  private renderMap() {
    const width = this.wrap.clientWidth;
    const height = this.wrap.clientHeight;
    if (width < 50 || height < 50) return;
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

    if (!this.visible.length) {
      this.svg.innerHTML = '';
      this.showEmpty(
        this.market.coverage.size
          ? t('No walls match these filters. Widen the distance or lower the minimum size.')
          : t('Order books are syncing. Walls appear within a minute of startup.'),
      );
      return;
    }
    this.showEmpty(null);

    const maxD = this.filters.distance;
    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const cx = PAD.left + plotW / 2;
    // power scale: a bit more room near the price than linear, without wasting the centre,
    // where walls rarely survive for long
    const x = (d: number) => cx + Math.sign(d) * (Math.min(Math.abs(d), maxD) / maxD) ** DISTANCE_EXPONENT * (plotW / 2);

    const sizes = this.visible.map((w) => w.size);
    const lo = Math.max(1, Math.min(...sizes) / 1.3);
    const hi = Math.max(...sizes) * 1.3;
    const y = (s: number) => PAD.top + plotH - ((Math.log(s) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * plotH;

    const parts: string[] = [];
    const zone = Math.min(HOT_ZONE, maxD);
    parts.push(`<rect class="m-zone" x="${x(-zone)}" y="${PAD.top}" width="${x(zone) - x(-zone)}" height="${plotH}"/>`);

    for (const d of DISTANCE_TICKS.filter((t) => t <= maxD)) {
      for (const signed of [-d, d]) {
        const gx = x(signed).toFixed(1);
        parts.push(`<line class="m-grid" x1="${gx}" x2="${gx}" y1="${PAD.top}" y2="${PAD.top + plotH}"/>`);
        parts.push(`<text class="m-tick" x="${gx}" y="${height - 10}" text-anchor="middle">${signed > 0 ? '+' : '−'}${d}%</text>`);
      }
    }
    for (const s of SIZE_TICKS.filter((t) => t >= lo && t <= hi)) {
      const gy = y(s).toFixed(1);
      parts.push(`<line class="m-grid" x1="${PAD.left}" x2="${PAD.left + plotW}" y1="${gy}" y2="${gy}"/>`);
      parts.push(`<text class="m-tick" x="${PAD.left - 8}" y="${gy}" dy="4" text-anchor="end">${usd(s).replace('.0', '')}</text>`);
    }
    parts.push(`<line class="m-price" x1="${cx}" x2="${cx}" y1="${PAD.top - 6}" y2="${PAD.top + plotH}"/>`);
    parts.push(`<text class="m-tick" x="${cx}" y="${PAD.top - 8}" text-anchor="middle">${t('price')}</text>`);
    parts.push(`<text class="m-side" x="${PAD.left + 10}" y="${PAD.top + 18}">${t('Bids')}</text>`);
    parts.push(`<text class="m-side" x="${PAD.left + plotW - 10}" y="${PAD.top + 18}" text-anchor="end">${t('Asks')}</text>`);

    // biggest first so small bubbles stay clickable on top
    const order = this.visible.map((_w, i) => i).sort((a, b) => this.visible[b].size - this.visible[a].size);
    const placed: Array<[number, number, number, number]> = [];
    const labels: string[] = [];
    // one label per symbol, on its biggest wall: "BCH BCH BCH" says nothing new
    const labelled = new Set<string>();
    for (const i of order) {
      const w = this.visible[i];
      const bx = x(w.distance);
      const by = y(w.size);
      const r = Math.min(15, 3 + Math.sqrt(w.multiple) * 1.4);
      // fresh walls are faint and dashed: many get pulled within seconds
      const opacity = Math.min(0.85, 0.25 + (w.age / 600) * 0.6);
      const cls = `b ${w.side === 'BID' ? 'bid' : 'ask'}${w.age < 60 ? ' young' : ''}${w.symbol === this.selected ? ' sel' : ''}`;
      parts.push(`<circle class="${cls}" data-i="${i}" cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="${r.toFixed(1)}" fill-opacity="${opacity.toFixed(2)}"/>`);

      if (!labelled.has(w.symbol) && (labels.length < MAX_LABELS || w.symbol === this.selected)) {
        const text = base(w.symbol);
        const tw = text.length * 6.6;
        const right = bx + r + 4;
        const left = bx - r - 4 - tw;
        const spot = [right, left].find((lx) => {
          const box: [number, number, number, number] = [lx, by - 7, lx + tw, by + 7];
          return lx > PAD.left && lx + tw < width - 4 && !placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1]);
        });
        if (spot !== undefined) {
          placed.push([spot, by - 7, spot + tw, by + 7]);
          labelled.add(w.symbol);
          labels.push(`<text class="m-label${w.symbol === this.selected ? ' sel' : ''}" x="${spot.toFixed(1)}" y="${(by + 4).toFixed(1)}">${text}</text>`);
        }
      }
    }
    this.svg.innerHTML = parts.join('') + labels.join('');
  }

  private renderList() {
    const rows = this.visible.slice(0, MAX_LIST_ROWS);
    $('wl-meta').textContent = this.visible.length > rows.length ? t('nearest {n} of {total}', { n: rows.length, total: this.visible.length }) : t('nearest to price first');
    $('wl-rows').innerHTML = rows.length
      ? rows
          .map(
            (w) => `<tr data-sym="${w.symbol}"${w.symbol === this.selected ? ' class="is-selected"' : ''}>
              <td class="sym">${base(w.symbol)}</td>
              <td class="${w.side === 'BID' ? 'up' : 'down'}">${w.side === 'BID' ? t('Bid') : t('Ask')}</td>
              <td>${px(w.price)}</td>
              <td class="${w.size >= 1e6 ? 'strong' : ''}">${usd(w.size)}</td>
              <td class="${Math.abs(w.distance) <= HOT_ZONE ? 'hot strong' : 'dim'}">${pct(w.distance, 2)}</td>
              <td class="c-sm dim">${w.multiple.toFixed(1)}×</td>
              <td class="c-sm dim">${age(w.age)}</td>
              <td class="c-sm dim">${eatTime(w.eatMinutes)}</td>
            </tr>`,
          )
          .join('')
      : `<tr class="empty"><td colspan="8">${t('No walls to list.')}</td></tr>`;
  }

  private renderFilters() {
    const seg = <T,>(id: string, options: Array<[T, string]>, current: T) =>
      ($(id).innerHTML = options
        .map(([value, label]) => `<button type="button" data-value="${value}" aria-pressed="${value === current}">${label}</button>`)
        .join(''));
    seg('dm-dist', DISTANCES.map((d) => [d, `±${d}%`] as [number, string]), this.filters.distance);
    seg('dm-size', SIZES, this.filters.minSize);
    seg('dm-side', SIDES, this.filters.side);
  }

  private showEmpty(message: string | null) {
    let note = this.wrap.querySelector<HTMLElement>('.empty-note');
    if (!message) {
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement('p');
      note.className = 'empty-note';
      this.wrap.append(note);
    }
    note.textContent = message;
  }

  private showTip(wall: Wall, clientX: number, clientY: number) {
    const coverage = this.market.coverage.get(wall.symbol);
    this.tip.innerHTML =
      `<div><b>${base(wall.symbol)}</b><span class="${wall.side === 'BID' ? 'up' : 'down'}">${wall.side === 'BID' ? t('Bid wall') : t('Ask wall')}</span></div>` +
      `<div><span class="k">${t('Price')}</span>${px(wall.price)}</div>` +
      `<div><span class="k">${t('Size')}</span>${usd(wall.size)} <span class="mute">${wall.multiple.toFixed(1)}× ${t('avg')}</span></div>` +
      `<div><span class="k">${t('Distance')}</span>${pct(wall.distance, 2)}</div>` +
      `<div><span class="k">${t('Standing')}</span>${age(wall.age)}</div>` +
      `<div><span class="k">${t('Eaten in')}</span>${eatTime(wall.eatMinutes)}</div>` +
      (coverage !== undefined && Math.abs(wall.distance) > coverage
        ? `<div class="mute">${t('beyond the snapshot range (±{n}%)', { n: coverage })}</div>`
        : '');
    this.tip.hidden = false;
    const box = this.wrap.getBoundingClientRect();
    const tipW = this.tip.offsetWidth;
    const tipH = this.tip.offsetHeight;
    let left = clientX - box.left + 14;
    let top = clientY - box.top + 14;
    if (left + tipW > box.width - 6) left = clientX - box.left - tipW - 14;
    if (top + tipH > box.height - 6) top = clientY - box.top - tipH - 14;
    this.tip.style.left = `${Math.max(6, left)}px`;
    this.tip.style.top = `${Math.max(6, top)}px`;
  }

  private bindEvents() {
    const filterGroups: Array<[string, (value: string) => void]> = [
      ['dm-dist', (v) => (this.filters.distance = Number(v))],
      ['dm-size', (v) => (this.filters.minSize = Number(v))],
      ['dm-side', (v) => (this.filters.side = v as Filters['side'])],
    ];
    for (const [id, apply] of filterGroups) {
      $(id).addEventListener('click', (e) => {
        const button = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (!button) return;
        apply(button.dataset.value!);
        save('density', this.filters);
        this.renderFilters();
        this.render();
      });
    }
    this.svg.addEventListener('pointermove', (e) => {
      const bubble = (e.target as Element).closest('circle[data-i]');
      if (!bubble) {
        this.tip.hidden = true;
        return;
      }
      this.showTip(this.visible[Number(bubble.getAttribute('data-i'))], e.clientX, e.clientY);
    });
    this.svg.addEventListener('pointerleave', () => (this.tip.hidden = true));
    this.svg.addEventListener('click', (e) => {
      const bubble = (e.target as Element).closest('circle[data-i]');
      if (bubble) this.onSelect(this.visible[Number(bubble.getAttribute('data-i'))].symbol);
    });
    $('wl-rows').addEventListener('click', (e) => {
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-sym]');
      if (tr) this.onSelect(tr.dataset.sym!);
    });
  }
}

import { base, pct, px, tone, usd } from './format';
import type { Market } from './market';
import { sparkline } from './sparkline';
import { load, save } from './storage';
import type { SymbolMetrics } from './types';

type Key = keyof SymbolMetrics | 'star' | 'spark';

interface Column {
  key: Key;
  label: string;
  cls?: string;
  sortable?: boolean;
  cell: (r: SymbolMetrics, starred: boolean, spark: number[] | undefined) => string;
}

interface Preset {
  id: string;
  label: string;
  test: (r: SymbolMetrics, starred: boolean) => boolean;
}

const abs = (v: number | null) => (v === null ? 0 : Math.abs(v));

// highlight thresholds; later these become user-editable rules stored per account
export const RULES = {
  move5m: 1,
  move1h: 3,
  surge: 3,
  funding: 0.03,
  oiRise: 3,
  bigLiquidations: 250_000,
};

const PRESETS: Preset[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'movers', label: 'Movers', test: (r) => abs(r.ch5m) >= RULES.move5m || abs(r.ch1h) >= RULES.move1h },
  { id: 'surge', label: 'Volume surge', test: (r) => (r.surge ?? 0) >= RULES.surge },
  { id: 'funding', label: 'Funding skew', test: (r) => abs(r.funding) >= RULES.funding },
  { id: 'oi', label: 'OI rising', test: (r) => (r.oiCh15m ?? 0) >= RULES.oiRise },
  { id: 'watch', label: 'Watchlist', test: (_r, starred) => starred },
];

const meter = (v: number | null) => {
  const x = v ?? 0;
  const lit = x >= 5 ? 5 : x >= 3 ? 4 : x >= 2 ? 3 : x >= 1.3 ? 2 : x >= 0.8 ? 1 : 0;
  const cells = [0, 1, 2, 3, 4].map((i) => `<i${i < lit ? ' class="on"' : ''}></i>`).join('');
  return `<span class="meter${x >= RULES.surge ? ' hot' : ''}" aria-hidden="true">${cells}</span>`;
};

const pctCell = (v: number | null, extra = '') =>
  `<td class="${tone(v)}${abs(v) >= 3 ? ' strong' : ''}${extra}">${pct(v)}</td>`;

const COLUMNS: Column[] = [
  {
    key: 'star', label: '', cls: 'c-star', sortable: false,
    cell: (r, starred) =>
      `<td class="c-star"><button class="star${starred ? ' on' : ''}" data-star="${r.symbol}" aria-label="${starred ? 'Remove from' : 'Add to'} watchlist"><i class="${starred ? 'ph-fill' : 'ph'} ph-star"></i></button></td>`,
  },
  { key: 'symbol', label: 'Symbol', cls: 'sym', cell: (r) => `<td class="sym">${base(r.symbol)}</td>` },
  {
    key: 'spark', label: '2h', cls: 'spark c-sm', sortable: false,
    cell: (_r, _s, spark) => `<td class="spark c-sm">${spark ? sparkline(spark) : ''}</td>`,
  },
  { key: 'price', label: 'Price', cell: (r) => `<td>${px(r.price)}</td>` },
  { key: 'ch5m', label: '5m', cell: (r) => pctCell(r.ch5m) },
  { key: 'ch15m', label: '15m', cls: 'c-lg', cell: (r) => pctCell(r.ch15m, ' c-lg') },
  { key: 'ch1h', label: '1h', cls: 'c-sm', cell: (r) => pctCell(r.ch1h, ' c-sm') },
  { key: 'ch24h', label: '24h', cell: (r) => pctCell(r.ch24h) },
  { key: 'vol24h', label: 'Volume', cls: 'c-sm', cell: (r) => `<td class="dim c-sm">${usd(r.vol24h)}</td>` },
  {
    key: 'surge', label: 'Surge', cls: 'c-sm',
    cell: (r) =>
      `<td class="c-sm ${(r.surge ?? 0) >= RULES.surge ? 'hot strong' : 'dim'}">${meter(r.surge)}${r.surge === null ? '–' : `${r.surge.toFixed(1)}×`}</td>`,
  },
  { key: 'natr', label: 'NATR', cls: 'c-lg', cell: (r) => `<td class="dim c-lg">${r.natr === null ? '–' : `${r.natr.toFixed(2)}%`}</td>` },
  {
    key: 'funding', label: 'Funding', cls: 'c-sm',
    cell: (r) => `<td class="c-sm ${abs(r.funding) >= RULES.funding ? 'hot' : 'dim'}">${pct(r.funding, 4)}</td>`,
  },
  { key: 'oi', label: 'OI', cls: 'c-md', cell: (r) => `<td class="dim c-md">${usd(r.oi)}</td>` },
  {
    key: 'oiCh15m', label: 'OI 15m', cls: 'c-sm',
    cell: (r) => `<td class="c-sm ${tone(r.oiCh15m, 0.1)}${(r.oiCh15m ?? 0) >= RULES.oiRise ? ' strong' : ''}">${pct(r.oiCh15m, 1)}</td>`,
  },
  {
    key: 'liq5m', label: 'Liq 5m', cls: 'c-md',
    cell: (r) => `<td class="c-md ${r.liq5m >= RULES.bigLiquidations ? 'strong' : 'dim'}">${r.liq5m > 0 ? usd(r.liq5m) : '–'}</td>`,
  },
];

const RESORT_EVERY_MS = 5_000;

interface ScreenerState {
  preset: string;
  query: string;
  minVolume: number;
  sortKey: Key;
  ascending: boolean;
  selected: string;
}

export class Screener {
  private readonly head = document.getElementById('head')!;
  private readonly body = document.getElementById('rows')!;
  private readonly presetsEl = document.getElementById('presets')!;
  private readonly wrap = document.getElementById('table-wrap')!;
  private readonly searchInput = document.getElementById('q') as HTMLInputElement;
  private readonly volumeSelect = document.getElementById('minvol') as HTMLSelectElement;

  private readonly state: ScreenerState;
  private readonly starred = new Set<string>(load<string[]>('watchlist', ['BTCUSDT', 'ETHUSDT']));
  private pointerInside = false;

  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    this.state = {
      preset: 'all',
      query: '',
      minVolume: Number(this.volumeSelect.value),
      sortKey: 'vol24h',
      ascending: false,
      selected: load('selected', 'BTCUSDT'),
    };
    this.bindEvents();
    market.snapshot.on(() => {
      if (!market.rows.has(this.state.selected)) this.state.selected = 'BTCUSDT';
      this.render();
      this.onSelect(this.state.selected);
    });
    market.delta.on((changes) => changes.forEach(([prev, next]) => this.refreshRow(prev, next)));
    market.sparklinesUpdated.on(() => this.refreshSparklines());
    setInterval(() => this.periodic(), RESORT_EVERY_MS);
  }

  get selected() {
    return this.state.selected;
  }

  render() {
    this.renderPresets();
    this.renderHead();
    const rows = this.visibleRows();
    this.body.innerHTML = rows.length
      ? rows.map((r) => this.rowHtml(r)).join('')
      : `<tr class="empty"><td colspan="${COLUMNS.length}">${this.market.rows.size ? 'Nothing matches this preset right now. Lower the volume filter or clear the search.' : 'Waiting for market data.'}</td></tr>`;
    document.getElementById('st-pairs')!.textContent = `${rows.length} of ${this.market.rows.size} pairs`;
  }

  select(symbol: string, focus = false) {
    this.state.selected = symbol;
    save('selected', symbol);
    this.body.querySelectorAll<HTMLTableRowElement>('tr[data-sym]').forEach((tr) => {
      const on = tr.dataset.sym === symbol;
      tr.classList.toggle('is-selected', on);
      tr.tabIndex = on ? 0 : -1;
      if (on && focus) {
        tr.focus();
        tr.scrollIntoView({ block: 'nearest' });
      }
    });
    this.onSelect(symbol);
  }

  /** Re-sorts only while the pointer is elsewhere, so rows never jump under the cursor. */
  private periodic() {
    if (!this.pointerInside && !document.activeElement?.closest('#rows')) {
      const scroll = this.wrap.scrollTop;
      this.render();
      this.wrap.scrollTop = scroll;
    } else {
      this.renderPresets();
    }
  }

  private visibleRows() {
    const preset = PRESETS.find((p) => p.id === this.state.preset)!;
    const q = this.state.query.trim().toUpperCase();
    const rows = [...this.market.rows.values()].filter(
      (r) =>
        preset.test(r, this.starred.has(r.symbol)) &&
        (this.state.preset === 'watch' || r.vol24h >= this.state.minVolume) &&
        (!q || base(r.symbol).includes(q)),
    );
    const key = this.state.sortKey as keyof SymbolMetrics;
    const dir = this.state.ascending ? 1 : -1;
    return rows.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null) return 1; // missing values sink regardless of direction
      if (bv === null) return -1;
      if (typeof av === 'string') return (av as string).localeCompare(bv as string) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }

  private rowHtml(r: SymbolMetrics) {
    const selected = r.symbol === this.state.selected;
    const starred = this.starred.has(r.symbol);
    const spark = this.market.sparklines.get(r.symbol);
    return `<tr data-sym="${r.symbol}" tabindex="${selected ? 0 : -1}"${selected ? ' class="is-selected"' : ''}>${COLUMNS.map((c) => c.cell(r, starred, spark)).join('')}</tr>`;
  }

  /** Swaps cells in place: cheaper than re-rendering and keeps hover and focus intact. */
  private refreshRow(prev: SymbolMetrics | undefined, next: SymbolMetrics) {
    const tr = this.body.querySelector<HTMLTableRowElement>(`tr[data-sym="${CSS.escape(next.symbol)}"]`);
    if (!tr) return;
    const tmp = document.createElement('tbody');
    tmp.innerHTML = this.rowHtml(next);
    const fresh = [...tmp.firstElementChild!.children];
    COLUMNS.forEach((c, i) => {
      if (c.key === 'star' || c.key === 'spark') return;
      const cell = fresh[i];
      const ticked = c.key === 'price' && prev !== undefined && prev.price !== next.price;
      if (!ticked && cell.outerHTML === tr.children[i].outerHTML) return;
      if (ticked) cell.classList.add(next.price > prev!.price ? 'tick-up' : 'tick-down');
      tr.children[i].replaceWith(cell);
    });
  }

  private refreshSparklines() {
    const index = COLUMNS.findIndex((c) => c.key === 'spark');
    this.body.querySelectorAll<HTMLTableRowElement>('tr[data-sym]').forEach((tr) => {
      const spark = this.market.sparklines.get(tr.dataset.sym!);
      if (spark) tr.children[index].innerHTML = sparkline(spark);
    });
  }

  private renderPresets() {
    const rows = [...this.market.rows.values()];
    this.presetsEl.innerHTML = PRESETS.map((p) => {
      const n = rows.filter((r) => p.test(r, this.starred.has(r.symbol)) && (p.id === 'watch' || r.vol24h >= this.state.minVolume)).length;
      return `<button class="preset" role="tab" data-preset="${p.id}" aria-selected="${p.id === this.state.preset}">${p.label}<span class="count">${n}</span></button>`;
    }).join('');
  }

  private renderHead() {
    this.head.innerHTML = COLUMNS.map((c) => {
      const on = c.key === this.state.sortKey;
      const sorted = on ? ` sorted${this.state.ascending ? ' asc' : ''}` : '';
      const aria = on ? ` aria-sort="${this.state.ascending ? 'ascending' : 'descending'}"` : '';
      return `<th class="${c.cls ?? ''}${sorted}" data-sort="${c.key}"${aria}>${c.label}</th>`;
    }).join('');
  }

  private toggleStar(symbol: string) {
    if (this.starred.has(symbol)) this.starred.delete(symbol);
    else this.starred.add(symbol);
    save('watchlist', [...this.starred]);
    this.render();
  }

  private bindEvents() {
    this.presetsEl.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
      if (!button) return;
      this.state.preset = button.dataset.preset!;
      this.render();
    });
    this.head.addEventListener('click', (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>('[data-sort]');
      const column = th && COLUMNS.find((c) => c.key === th.dataset.sort);
      if (!column || column.sortable === false) return;
      this.state.ascending = this.state.sortKey === column.key ? !this.state.ascending : column.key === 'symbol';
      this.state.sortKey = column.key;
      this.render();
    });
    this.body.addEventListener('click', (e) => {
      const star = (e.target as HTMLElement).closest<HTMLElement>('[data-star]');
      if (star) {
        this.toggleStar(star.dataset.star!);
        return;
      }
      const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-sym]');
      if (tr) this.select(tr.dataset.sym!);
    });
    this.wrap.addEventListener('pointerenter', () => (this.pointerInside = true));
    this.wrap.addEventListener('pointerleave', () => (this.pointerInside = false));
    this.searchInput.addEventListener('input', () => {
      this.state.query = this.searchInput.value;
      this.render();
    });
    this.volumeSelect.addEventListener('change', () => {
      this.state.minVolume = Number(this.volumeSelect.value);
      this.render();
    });
    document.addEventListener('keydown', (e) => {
      // the target is not always an element (synthetic events, some extensions)
      const target = e.target instanceof HTMLElement ? e.target : null;
      const typing = target?.matches('input, select, textarea') ?? false;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        this.searchInput.focus();
        return;
      }
      if (e.key === 'Escape' && typing) {
        target!.blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'w') {
        this.toggleStar(this.state.selected);
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const current = this.body.querySelector<HTMLElement>('tr.is-selected');
        const next = current && (e.key === 'ArrowDown' ? current.nextElementSibling : current.previousElementSibling);
        if (next instanceof HTMLElement && next.dataset.sym) {
          e.preventDefault();
          this.select(next.dataset.sym, true);
        }
      }
    });
  }
}

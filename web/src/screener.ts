import { MAX_PRESETS, MAX_RULES, METRICS, OPS, matches, parseNumber, sanitize, type CustomPreset, type Rule } from './filters';
import { base, pct, px, tone, usd } from './format';
import type { Market } from './market';
import { sparkline } from './sparkline';
import { t } from './i18n';
import { ICONS } from './icons';
import { load, save } from './storage';
import type { SymbolMetrics, VenueGap, Wall } from './types';
import { currentView } from './views';

type Key = keyof SymbolMetrics | 'star' | 'spark' | 'wall' | 'fgap';

/** Per-row data that does not live in SymbolMetrics. */
interface RowContext {
  starred: boolean;
  spark: number[] | undefined;
  wall: Wall | null;
  gap: VenueGap | undefined;
}

interface Column {
  key: Key;
  label: string;
  cls?: string;
  /** In the narrow list beside the chart unless the user chose otherwise. */
  core?: boolean;
  sortable?: boolean;
  /** Sort value for keys that are not SymbolMetrics fields. */
  value?: (r: SymbolMetrics, ctx: RowContext) => number | null;
  /** Columns where the smallest value is the interesting one start ascending. */
  ascendingFirst?: boolean;
  cell: (r: SymbolMetrics, ctx: RowContext) => string;
}

interface Preset {
  id: string;
  label: string;
  test: (r: SymbolMetrics, ctx: RowContext) => boolean;
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
  /** Funding on Binance and Bybit this far apart per 8 hours is worth a look. */
  fundingGap: 0.03,
  nearWall: 1,
  hotWall: 0.5,
};

const PRESETS: Preset[] = [
  { id: 'all', label: t('All'), test: () => true },
  { id: 'movers', label: t('Movers'), test: (r) => abs(r.ch5m) >= RULES.move5m || abs(r.ch1h) >= RULES.move1h },
  { id: 'surge', label: t('Surge'), test: (r) => (r.surge ?? 0) >= RULES.surge },
  { id: 'funding', label: t('Funding'), test: (r) => abs(r.funding) >= RULES.funding },
  { id: 'fgap', label: t('Arb'), test: (_r, ctx) => abs(ctx.gap?.spread8h ?? null) >= RULES.fundingGap },
  { id: 'oi', label: t('OI rising'), test: (r) => (r.oiCh15m ?? 0) >= RULES.oiRise },
  { id: 'walls', label: t('Near walls'), test: (_r, ctx) => ctx.wall !== null && Math.abs(ctx.wall.distance) <= RULES.nearWall },
  { id: 'watch', label: t('Watchlist'), test: (_r, ctx) => ctx.starred },
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
    key: 'star', label: '', cls: 'c-star', core: true, sortable: false,
    cell: (r, { starred }) =>
      `<td class="c-star"><button class="star${starred ? ' on' : ''}" data-star="${r.symbol}" aria-label="${starred ? t('Remove from watchlist') : t('Add to watchlist')}">${starred ? ICONS.starFill : ICONS.star}</button></td>`,
  },
  { key: 'symbol', label: t('Symbol'), cls: 'sym', core: true, cell: (r) => `<td class="sym">${base(r.symbol)}</td>` },
  {
    key: 'spark', label: t('2h'), cls: 'spark c-md', sortable: false,
    cell: (_r, { spark }) => `<td class="spark c-md">${spark ? sparkline(spark) : ''}</td>`,
  },
  { key: 'price', label: t('Price'), core: true, cell: (r) => `<td>${px(r.price)}</td>` },
  { key: 'ch5m', label: t('5m'), core: true, cell: (r) => pctCell(r.ch5m) },
  { key: 'ch15m', label: t('15m'), cls: 'c-lg', cell: (r) => pctCell(r.ch15m, ' c-lg') },
  { key: 'ch1h', label: t('1h'), cls: 'c-sm', cell: (r) => pctCell(r.ch1h, ' c-sm') },
  { key: 'ch24h', label: t('24h'), core: true, cell: (r) => pctCell(r.ch24h) },
  { key: 'vol24h', label: t('Volume'), core: true, cell: (r) => `<td class="dim">${usd(r.vol24h)}</td>` },
  {
    key: 'surge', label: t('Surge'), cls: 'c-sm',
    cell: (r) =>
      `<td class="c-sm ${(r.surge ?? 0) >= RULES.surge ? 'hot strong' : 'dim'}">${meter(r.surge)}${r.surge === null ? '–' : `${r.surge.toFixed(1)}×`}</td>`,
  },
  { key: 'natr', label: 'NATR', cls: 'c-lg', cell: (r) => `<td class="dim c-lg">${r.natr === null ? '–' : `${r.natr.toFixed(2)}%`}</td>` },
  {
    key: 'funding', label: t('Funding'), cls: 'c-sm',
    cell: (r) => `<td class="c-sm ${abs(r.funding) >= RULES.funding ? 'hot' : 'dim'}">${pct(r.funding, 4)}</td>`,
  },
  {
    key: 'fgap', label: t('vs Bybit'), cls: 'c-md',
    value: (_r, { gap }) => (gap?.spread8h === null || gap?.spread8h === undefined ? null : Math.abs(gap.spread8h)),
    cell: (_r, { gap }) => {
      const spread = gap?.spread8h ?? null;
      if (!gap || spread === null) return '<td class="c-md flat">\u2013</td>';
      const vars = { v: Math.abs(spread).toFixed(4), apr: Math.abs(gap.spreadApr ?? 0).toFixed(0) };
      const title =
        spread > 0
          ? t('Funding per 8h: Binance higher than Bybit by {v}%, about {apr}% a year', vars)
          : t('Funding per 8h: Binance lower than Bybit by {v}%, about {apr}% a year', vars);
      return `<td class="c-md ${Math.abs(spread) >= RULES.fundingGap ? 'hot strong' : 'dim'}" title="${title}">${pct(spread, 4)}</td>`;
    },
  },
  {
    key: 'wall', label: t('Wall'), cls: 'c-sm', ascendingFirst: true,
    value: (_r, { wall }) => (wall ? Math.abs(wall.distance) : null),
    cell: (_r, { wall }) =>
      wall
        ? `<td class="c-sm ${Math.abs(wall.distance) <= RULES.hotWall ? 'hot strong' : wall.side === 'BID' ? 'up' : 'down'}" title="${wall.side === 'BID' ? t('Bid wall') : t('Ask wall')} ${usd(wall.size)}">${pct(wall.distance, 2)}</td>`
        : '<td class="c-sm flat">\u2013</td>',
  },
  { key: 'oi', label: 'OI', cls: 'c-lg', cell: (r) => `<td class="dim c-lg">${usd(r.oi)}</td>` },
  {
    key: 'oiCh15m', label: t('OI 15m'), cls: 'c-sm',
    cell: (r) => `<td class="c-sm ${tone(r.oiCh15m, 0.1)}${(r.oiCh15m ?? 0) >= RULES.oiRise ? ' strong' : ''}">${pct(r.oiCh15m, 1)}</td>`,
  },
  {
    key: 'liq5m', label: t('Liq 5m'), cls: 'c-lg',
    cell: (r) => `<td class="c-lg ${r.liq5m >= RULES.bigLiquidations ? 'strong' : 'dim'}">${r.liq5m > 0 ? usd(r.liq5m) : '–'}</td>`,
  },
];

/** Columns that are always there; the rest of the narrow list is the user's choice. */
const FIXED: Key[] = ['star', 'symbol'];
const DEFAULT_COLUMNS = COLUMNS.filter((c) => c.core && !FIXED.includes(c.key)).map((c) => c.key);
const compact = new Set<Key>(load<Key[]>('listCols', DEFAULT_COLUMNS).filter((key) => COLUMNS.some((c) => c.key === key)));
const inCompact = (c: Column) => FIXED.includes(c.key) || compact.has(c.key);

/** Cells of the columns hidden in the narrow list carry the class `x`. */
const cellHtml = (c: Column, r: SymbolMetrics, ctx: RowContext) =>
  inCompact(c) ? c.cell(r, ctx) : c.cell(r, ctx).replace('<td class="', '<td class="x ');

const RESORT_EVERY_MS = 5_000;
const VIEW_MARGIN_ROWS = 8;

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
  private custom: CustomPreset[] = sanitize(load<unknown>('customPresets', []));
  private readonly filterMenu = document.getElementById('flt-menu')!;
  private readonly columnsMenu = document.getElementById('cols-menu')!;
  /** The custom preset open in the editor, or null for a new one. */
  private editing: CustomPreset | null = null;
  private pointerInside = false;
  private scrollFrame = 0;

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
    market.delta.on((changes) => {
      // only rows on screen (plus a margin) are touched; the rest catch up when scrolled into view
      const visible = this.visibleSymbols();
      changes.forEach(([prev, next]) => {
        if (visible.has(next.symbol)) this.refreshRow(prev, next);
      });
    });
    market.sparklinesUpdated.on(() => this.refreshSparklines());
    market.wallsUpdated.on(() => this.refreshColumn('wall'));
    market.gapsUpdated.on(() => this.refreshColumn('fgap'));
    setInterval(() => this.periodic(), RESORT_EVERY_MS);
  }

  get selected() {
    return this.state.selected;
  }

  /** The rows the table shows right now, in its order; the chart grid pages through them. */
  list(): SymbolMetrics[] {
    return this.visibleRows();
  }

  get presetLabel() {
    return this.preset().label;
  }

  /** Built-in presets, then the ones the user built. */
  private presets(): Preset[] {
    return [
      ...PRESETS,
      ...this.custom.map((c) => ({ id: `custom:${c.id}`, label: c.name, test: (r: SymbolMetrics, ctx: RowContext) => matches(c.rules, r, ctx.wall, ctx.gap) })),
    ];
  }

  private preset(): Preset {
    return this.presets().find((p) => p.id === this.state.preset) ?? PRESETS[0];
  }

  render() {
    this.renderPresets();
    this.renderHead();
    const rows = this.visibleRows();
    this.body.innerHTML = rows.length
      ? rows.map((r) => this.rowHtml(r)).join('')
      : `<tr class="empty"><td colspan="${COLUMNS.length}">${this.market.rows.size ? t('Nothing matches this preset right now. Lower the volume filter or clear the search.') : t('Waiting for market data.')}</td></tr>`;
    document.getElementById('st-pairs')!.textContent = t('{n} of {total} pairs', { n: rows.length, total: this.market.rows.size });
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
    const preset = this.preset();
    const q = this.state.query.trim().toUpperCase();
    const rows = [...this.market.rows.values()].filter(
      (r) =>
        preset.test(r, this.context(r)) &&
        (this.state.preset === 'watch' || r.vol24h >= this.state.minVolume) &&
        (!q || base(r.symbol).includes(q)),
    );
    const column = COLUMNS.find((c) => c.key === this.state.sortKey);
    const value = (r: SymbolMetrics) =>
      column?.value ? column.value(r, this.context(r)) : r[this.state.sortKey as keyof SymbolMetrics];
    const dir = this.state.ascending ? 1 : -1;
    return rows.sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === null) return 1; // missing values sink regardless of direction
      if (bv === null) return -1;
      if (typeof av === 'string') return (av as string).localeCompare(bv as string) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }

  private context(r: SymbolMetrics): RowContext {
    return {
      starred: this.starred.has(r.symbol),
      spark: this.market.sparklines.get(r.symbol),
      wall: this.market.nearestWall(r.symbol),
      gap: this.market.gaps.get(r.symbol),
    };
  }

  private rowHtml(r: SymbolMetrics) {
    const selected = r.symbol === this.state.selected;
    const ctx = this.context(r);
    return `<tr data-sym="${r.symbol}" tabindex="${selected ? 0 : -1}"${selected ? ' class="is-selected"' : ''}>${COLUMNS.map((c) => cellHtml(c, r, ctx)).join('')}</tr>`;
  }

  /** Walls and the Bybit comparison arrive on their own clock; only their cells change. */
  private refreshColumn(key: Key) {
    const index = COLUMNS.findIndex((c) => c.key === key);
    const column = COLUMNS[index];
    const visible = this.visibleSymbols();
    this.body.querySelectorAll<HTMLTableRowElement>('tr[data-sym]').forEach((tr) => {
      if (!visible.has(tr.dataset.sym!)) return;
      const row = this.market.rows.get(tr.dataset.sym!);
      if (!row) return;
      const html = cellHtml(column, row, this.context(row));
      if (tr.children[index].outerHTML !== html) tr.children[index].outerHTML = html;
    });
  }

  /** Swaps cells in place: cheaper than re-rendering and keeps hover and focus intact. */
  /** Symbols of the rows inside the scrolled viewport, with a margin above and below. */
  private visibleSymbols(): Set<string> {
    const rows = this.body.children;
    const visible = new Set<string>();
    if (!rows.length) return visible;
    const rowHeight = (rows[0] as HTMLElement).offsetHeight || 31;
    const first = Math.max(0, Math.floor(this.wrap.scrollTop / rowHeight) - VIEW_MARGIN_ROWS);
    const last = Math.min(rows.length - 1, Math.ceil((this.wrap.scrollTop + this.wrap.clientHeight) / rowHeight) + VIEW_MARGIN_ROWS);
    for (let i = first; i <= last; i++) {
      const sym = (rows[i] as HTMLElement).dataset.sym;
      if (sym) visible.add(sym);
    }
    return visible;
  }

  /** Rows that scrolled into view may hold values from before they left it. */
  private refreshVisible() {
    this.scrollFrame = 0;
    for (const symbol of this.visibleSymbols()) {
      const row = this.market.rows.get(symbol);
      if (row) this.refreshRow(undefined, row);
    }
  }

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
    const selected = this.preset().id;
    const chips = this.presets().map((p) => {
      const n = rows.filter((r) => p.test(r, this.context(r)) && (p.id === 'watch' || r.vol24h >= this.state.minVolume)).length;
      return `<button class="preset" role="tab" data-preset="${p.id}" aria-selected="${p.id === selected}">${escapeHtml(p.label)}<span class="count">${n}</span></button>`;
    });
    // a custom preset can be edited while it is selected; a new one can always be added
    const edit = selected.startsWith('custom:')
      ? `<button type="button" class="preset tool" data-act="edit" title="${t('Edit this filter')}" aria-label="${t('Edit this filter')}">${ICONS.edit}</button>`
      : '';
    const add = this.custom.length < MAX_PRESETS
      ? `<button type="button" class="preset tool" data-act="new" title="${t('New filter')}" aria-label="${t('New filter')}">${ICONS.plus}</button>`
      : '';
    this.presetsEl.innerHTML = chips.join('') + edit + add;
  }

  private renderHead() {
    this.head.innerHTML = COLUMNS.map((c) => {
      const on = c.key === this.state.sortKey;
      const sorted = on ? ` sorted${this.state.ascending ? ' asc' : ''}` : '';
      const aria = on ? ` aria-sort="${this.state.ascending ? 'ascending' : 'descending'}"` : '';
      return `<th class="${c.cls ?? ''}${inCompact(c) ? '' : ' x'}${sorted}" data-sort="${c.key}"${aria}>${c.label}</th>`;
    }).join('');
  }

  private toggleStar(symbol: string) {
    if (this.starred.has(symbol)) this.starred.delete(symbol);
    else this.starred.add(symbol);
    save('watchlist', [...this.starred]);
    this.render();
  }

  /** "All columns": the list takes most of the width and shows every column. */
  setWide(wide: boolean) {
    if (wide) document.body.dataset.list = 'wide';
    else delete document.body.dataset.list;
    document.getElementById('list-wide')!.setAttribute('aria-pressed', String(wide));
    save('listWide', wide);
  }

  get wide() {
    return document.body.dataset.list === 'wide';
  }

  // ---------- which columns the narrow list shows ----------

  private renderColumnsMenu() {
    this.columnsMenu.innerHTML =
      `<p class="menu-title">${t('Columns in the list')}</p>` +
      COLUMNS.filter((c) => !FIXED.includes(c.key))
        .map((c) => `<label class="ind-item"><input type="checkbox" value="${c.key}"${compact.has(c.key) ? ' checked' : ''}><span>${c.key === 'spark' ? t('Sparkline 2h') : c.label}</span></label>`)
        .join('') +
      `<p class="menu-note">${t('"All columns" shows every one of them at once.')}</p>`;
  }

  private applyColumns() {
    document.documentElement.style.setProperty('--list-cols', String(Math.max(2, compact.size)));
  }

  private toggleMenu(menu: HTMLElement, button: HTMLElement | null, open: boolean) {
    menu.hidden = !open;
    button?.setAttribute('aria-expanded', String(open));
  }

  // ---------- custom filters ----------

  private openFilter(preset: CustomPreset | null) {
    this.editing = preset;
    const rules: Rule[] = preset ? preset.rules : [{ metric: 'ch5m', op: 'abs', value: 2 }];
    this.filterMenu.innerHTML = `
      <form class="flt-form" novalidate>
        <label class="flt-name"><span>${t('Filter name')}</span><input name="name" maxlength="24" autocomplete="off" spellcheck="false" value="${escapeHtml(preset?.name ?? '')}" placeholder="${t('For example: Squeeze')}"></label>
        <div class="flt-rules">${rules.map((r) => this.ruleHtml(r)).join('')}</div>
        <button type="button" class="btn ghost" data-act="add-rule">${ICONS.plus}<span>${t('Add a condition')}</span></button>
        <p class="al-note" role="status"></p>
        <div class="flt-actions">
          ${preset ? `<button type="button" class="btn" data-act="delete">${t('Delete')}</button>` : ''}
          <button type="button" class="btn" data-act="cancel">${t('Cancel')}</button>
          <button type="submit" class="btn primary">${t('Save')}</button>
        </div>
      </form>`;
    this.toggleMenu(this.filterMenu, null, true);
    this.filterMenu.querySelector<HTMLInputElement>('input[name="name"]')!.focus();
  }

  private ruleHtml(rule: Rule) {
    const unit = METRICS.find((m) => m.id === rule.metric)?.unit ?? '';
    return `<div class="flt-rule">
      <select name="metric" aria-label="${t('Metric')}">${METRICS.map((m) => `<option value="${m.id}"${m.id === rule.metric ? ' selected' : ''}>${m.label}</option>`).join('')}</select>
      <select name="op" aria-label="${t('Comparison')}">${OPS.map(([op, label]) => `<option value="${op}"${op === rule.op ? ' selected' : ''}>${label}</option>`).join('')}</select>
      <input name="value" inputmode="decimal" autocomplete="off" aria-label="${t('Value')}" value="${rule.value}">
      <span class="unit">${unit}</span>
      <button type="button" data-act="remove-rule" aria-label="${t('Remove this condition')}">${ICONS.close}</button>
    </div>`;
  }

  private saveFilter() {
    const form = this.filterMenu.querySelector('form')!;
    const note = form.querySelector<HTMLElement>('.al-note')!;
    const name = form.querySelector<HTMLInputElement>('input[name="name"]')!.value.trim();
    const rules: Rule[] = [];
    for (const row of form.querySelectorAll<HTMLElement>('.flt-rule')) {
      const value = parseNumber(row.querySelector<HTMLInputElement>('input[name="value"]')!.value);
      if (value === null) {
        note.textContent = t('Every condition needs a number.');
        return;
      }
      rules.push({
        metric: row.querySelector<HTMLSelectElement>('select[name="metric"]')!.value as Rule['metric'],
        op: row.querySelector<HTMLSelectElement>('select[name="op"]')!.value as Rule['op'],
        value,
      });
    }
    if (!name) {
      note.textContent = t('Give the filter a name.');
      return;
    }
    if (!rules.length) {
      note.textContent = t('Add at least one condition.');
      return;
    }
    const id = this.editing?.id ?? String(Date.now());
    const saved: CustomPreset = { id, name, rules };
    this.custom = this.editing ? this.custom.map((c) => (c.id === id ? saved : c)) : [...this.custom, saved];
    save('customPresets', this.custom);
    this.state.preset = `custom:${id}`;
    this.toggleMenu(this.filterMenu, null, false);
    this.render();
  }

  private bindMenus() {
    const columnsButton = document.getElementById('list-cols')!;
    this.applyColumns();
    columnsButton.addEventListener('click', () => {
      const open = this.columnsMenu.hidden !== false;
      if (open) this.renderColumnsMenu();
      this.toggleMenu(this.columnsMenu, columnsButton, open);
    });
    this.columnsMenu.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      if (box.checked) compact.add(box.value as Key);
      else compact.delete(box.value as Key);
      save('listCols', [...compact]);
      this.applyColumns();
      this.render();
    });
    this.filterMenu.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveFilter();
    });
    this.filterMenu.addEventListener('change', (e) => {
      // the unit follows the metric: volume is typed in millions, liquidations in thousands
      const select = e.target as HTMLSelectElement;
      if (select.name !== 'metric') return;
      select.closest('.flt-rule')!.querySelector('.unit')!.textContent = METRICS.find((m) => m.id === select.value)?.unit ?? '';
    });
    this.filterMenu.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      const rulesEl = this.filterMenu.querySelector('.flt-rules');
      if (act === 'add-rule' && rulesEl && rulesEl.children.length < MAX_RULES) {
        rulesEl.insertAdjacentHTML('beforeend', this.ruleHtml({ metric: 'vol24h', op: 'gte', value: 100 }));
      } else if (act === 'remove-rule') {
        (e.target as HTMLElement).closest('.flt-rule')!.remove();
      } else if (act === 'cancel') {
        this.toggleMenu(this.filterMenu, null, false);
      } else if (act === 'delete' && this.editing) {
        this.custom = this.custom.filter((c) => c.id !== this.editing!.id);
        save('customPresets', this.custom);
        this.state.preset = 'all';
        this.toggleMenu(this.filterMenu, null, false);
        this.render();
      }
    });
    document.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (!this.columnsMenu.hidden && !target.closest('#cols-menu, #list-cols')) this.toggleMenu(this.columnsMenu, columnsButton, false);
      if (!this.filterMenu.hidden && !target.closest('#flt-menu, #presets')) this.toggleMenu(this.filterMenu, null, false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!this.columnsMenu.hidden) this.toggleMenu(this.columnsMenu, columnsButton, false);
      if (!this.filterMenu.hidden) this.toggleMenu(this.filterMenu, null, false);
    });
  }

  private bindEvents() {
    this.bindMenus();
    document.getElementById('list-wide')!.addEventListener('click', () => this.setWide(!this.wide));
    this.setWide(load('listWide', false));
    this.presetsEl.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (act) {
        this.openFilter(act.dataset.act === 'edit' ? (this.custom.find((c) => `custom:${c.id}` === this.state.preset) ?? null) : null);
        return;
      }
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-preset]');
      if (!button) return;
      this.state.preset = button.dataset.preset!;
      this.render();
    });
    this.head.addEventListener('click', (e) => {
      const th = (e.target as HTMLElement).closest<HTMLElement>('[data-sort]');
      const column = th && COLUMNS.find((c) => c.key === th.dataset.sort);
      if (!column || column.sortable === false) return;
      this.state.ascending = this.state.sortKey === column.key ? !this.state.ascending : column.key === 'symbol' || !!column.ascendingFirst;
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
    this.wrap.addEventListener(
      'scroll',
      () => {
        if (!this.scrollFrame) this.scrollFrame = requestAnimationFrame(() => this.refreshVisible());
      },
      { passive: true },
    );
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
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && currentView() === 'screener') {
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

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

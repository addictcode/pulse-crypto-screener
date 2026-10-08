import { base, pct, px, tone } from './format';
import { t } from './i18n';
import { ICONS, type IconName } from './icons';
import type { Market } from './market';

export interface Command {
  label: string;
  icon: IconName;
  /** Shown on the right, usually the hotkey. */
  hint?: string;
  run: () => void;
}

interface Item {
  html: string;
  run: () => void;
}

const MAX_PAIRS = 40;
const TOP_PAIRS = 8;

/** How well a pair answers the query: exact, prefix, then anywhere; -1 for no match. */
export function matchRank(symbol: string, query: string): number {
  const name = symbol.replace(/USDT$/, '');
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return name.includes(query) ? 2 : -1;
}

/**
 * Ctrl/Cmd + K: jump to any pair or run any command from the keyboard. A dialog is right here:
 * the palette interrupts on purpose and needs the focus to itself.
 */
export class Palette {
  private readonly dialog = document.getElementById('palette') as HTMLDialogElement;
  private readonly input = document.getElementById('pal-q') as HTMLInputElement;
  private readonly list = document.getElementById('pal-list')!;
  private items: Item[] = [];
  private index = 0;

  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;
  private readonly commands: () => Command[];

  constructor(market: Market, onSelect: (symbol: string) => void, commands: () => Command[]) {
    this.market = market;
    this.onSelect = onSelect;
    this.commands = commands;
    this.input.addEventListener('input', () => this.render());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.move(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.run(this.index);
      }
    });
    this.list.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (row) this.run(Number(row.dataset.i));
    });
    this.list.addEventListener('pointermove', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
      if (row && Number(row.dataset.i) !== this.index) this.highlight(Number(row.dataset.i));
    });
    // a click on the backdrop lands on the dialog element itself
    this.dialog.addEventListener('click', (e) => {
      if (e.target === this.dialog) this.dialog.close();
    });
  }

  toggle() {
    if (this.dialog.open) {
      this.dialog.close();
      return;
    }
    this.input.value = '';
    this.render();
    this.dialog.showModal();
    this.input.focus();
  }

  private run(index: number) {
    const item = this.items[index];
    if (!item) return;
    this.dialog.close();
    item.run();
  }

  private move(by: number) {
    if (this.items.length) this.highlight((this.index + by + this.items.length) % this.items.length);
  }

  private highlight(index: number) {
    this.index = index;
    this.list.querySelectorAll<HTMLElement>('[data-i]').forEach((el) => {
      const on = Number(el.dataset.i) === index;
      el.setAttribute('aria-selected', String(on));
      if (on) el.scrollIntoView({ block: 'nearest' });
    });
  }

  private render() {
    const query = this.input.value.trim();
    const upper = query.toUpperCase().replace(/[/\-\s]/g, '').replace(/USDT$/, '');
    const lower = query.toLowerCase();

    const rows = [...this.market.rows.values()].sort((a, b) => b.vol24h - a.vol24h);
    const pairs = upper
      ? rows
          .map((r) => ({ r, rank: matchRank(r.symbol, upper) }))
          .filter((m) => m.rank >= 0)
          .sort((a, b) => a.rank - b.rank)
          .slice(0, MAX_PAIRS)
          .map((m) => m.r)
      : rows.slice(0, TOP_PAIRS);
    const commands = this.commands().filter((c) => !lower || c.label.toLowerCase().includes(lower));

    this.items = [];
    const section = (title: string, items: Item[]) => {
      if (!items.length) return '';
      const html = items.map((item) => {
        const i = this.items.push(item) - 1;
        return `<li class="pal-item" role="option" data-i="${i}" aria-selected="false">${item.html}</li>`;
      });
      return `<li class="pal-group" role="presentation">${title}</li>${html.join('')}`;
    };
    const pairItems: Item[] = pairs.map((r) => ({
      html: `<b>${base(r.symbol)}</b><span class="r"><span>${px(r.price)}</span><span class="${tone(r.ch24h)}">${pct(r.ch24h)}</span></span>`,
      run: () => this.onSelect(r.symbol),
    }));
    const commandItems: Item[] = commands.map((c) => ({
      html: `<span class="i">${ICONS[c.icon]}</span><span>${c.label}</span>${c.hint ? `<span class="r"><kbd>${c.hint}</kbd></span>` : ''}`,
      run: c.run,
    }));
    // typing a name means a pair is wanted, so pairs lead; with an empty box commands teach the hotkeys
    const html = upper
      ? section(t('Pairs'), pairItems) + section(t('Commands'), commandItems)
      : section(t('Commands'), commandItems) + section(t('Most traded'), pairItems);
    this.list.innerHTML = html || `<li class="pal-empty">${t('Nothing found. Try a ticker like SOL, or a command like "heatmap".')}</li>`;
    this.highlight(0);
  }
}

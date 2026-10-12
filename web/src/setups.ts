import { setupBoard } from './api';
import { STANDALONE } from './api';
import { base, px } from './format';
import { ICONS } from './icons';
import { load, save } from './storage';
import { lang, t } from './i18n';
import type { Market } from './market';
import type { SetupBoard, SetupTrade } from './types';

const REFRESH_MS = 20_000;
/** How often the journal is looked at while another view is on screen. */
const WATCH_MS = 60_000;
/** Taker fee per side, the same the server takes off every result. */
const FEE = 0.0005;
/** Fewer finished trades than this say nothing about the strategy yet. */
const THIN_SAMPLE = 20;

const $ = (id: string) => document.getElementById(id)!;

/**
 * The journal of Pulse Setups kept by the server: trades taken on every closed candle across
 * the market, followed to their stop, target or time limit. A backtest says what would have
 * happened; this says what did, on candles nobody had seen when the trade was taken.
 */
export class SetupJournal {
  private readonly market: Market;
  private readonly onOpen: (symbol: string, timeframe: string) => void;
  private board: SetupBoard | null = null;
  private active = false;
  private timer = 0;
  private failed = false;
  /** Open trades already seen, so only a setup taken while the page is open is announced. */
  private known: Set<number> | null = null;

  constructor(market: Market, onOpen: (symbol: string, timeframe: string) => void) {
    this.market = market;
    this.onOpen = onOpen;
    $('setups').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-sym]');
      if (row) this.onOpen(row.dataset.sym!, row.dataset.tf!);
    });
    // open trades are priced from the live market between refreshes
    setInterval(() => this.active && this.renderOpen(), 2_000);
    if (!STANDALONE) {
      // whatever is on screen, a new setup is worth a word and the tab shows how many are open
      setInterval(() => !this.active && void this.load(), WATCH_MS);
      void this.load();
    }
  }

  setActive(active: boolean) {
    this.active = active;
    clearInterval(this.timer);
    if (!active) return;
    void this.load();
    this.timer = window.setInterval(() => void this.load(), REFRESH_MS);
  }

  private async load() {
    try {
      this.board = await setupBoard();
      this.failed = false;
      this.announce(this.board.open);
    } catch {
      this.failed = true;
    }
    this.render();
  }

  private announce(open: SetupTrade[]) {
    const badge = document.querySelector<HTMLElement>('.view[data-view="setups"] .count');
    if (badge) badge.textContent = open.length ? String(open.length) : '';
    const fresh = this.known ? open.filter((s) => !this.known!.has(s.id)) : [];
    this.known = new Set(open.map((s) => s.id));
    for (const s of fresh) {
      const toast = document.createElement('div');
      toast.className = `toast ${s.direction === 1 ? 'up' : 'down'}`;
      toast.dataset.sym = s.symbol;
      toast.setAttribute('role', 'status');
      const side = s.direction === 1 ? t('long') : t('short');
      toast.innerHTML = `<b>${t('{sym} {tf}: {side} setup', { sym: base(s.symbol), tf: s.timeframe, side })}</b><span>${t('entry {entry}, stop {stop}, target {target}', { entry: px(s.entry), stop: px(s.stop), target: px(s.target) })}</span><button type="button" class="toast-x" aria-label="${t('Dismiss')}">${ICONS.close}</button>`;
      $('toasts').prepend(toast);
    }
  }

  /** What an open trade would make if it were closed at the current price, in R after fees. */
  private live(trade: SetupTrade): number | null {
    const price = this.market.rows.get(trade.symbol)?.price;
    if (price === undefined) return null;
    const risk = Math.abs(trade.entry - trade.stop);
    return ((price - trade.entry) * trade.direction - 2 * FEE * trade.entry) / risk;
  }

  private render() {
    const board = this.board;
    if (!board) {
      $('su-meta').textContent = this.failed ? t('The journal cannot be read right now') : '';
      return;
    }
    const since = board.since
      ? new Date(board.since).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : null;
    $('su-meta').textContent = since ? t('journal kept since {date}', { date: since }) : '';

    const total = board.stats.reduce((a, s) => ({ trades: a.trades + s.trades, wins: a.wins + s.wins, netR: a.netR + s.netR }), { trades: 0, wins: 0, netR: 0 });
    const cell = (label: string, s: { trades: number; wins: number; netR: number }) => {
      if (!s.trades) return `<div><dt>${label}</dt><dd class="mute">${t('no finished trades yet')}</dd></div>`;
      const net = `${s.netR >= 0 ? '+' : ''}${s.netR.toFixed(1)}R`;
      return `<div${s.trades < THIN_SAMPLE ? ` class="thin" title="${t('Too few trades to judge the strategy by')}"` : ''}>
        <dt>${label}</dt>
        <dd><b class="${s.netR >= 0 ? 'up' : 'down'}">${net}</b><span>${t('{n} trades', { n: s.trades })}</span><span>${t('{n}% win', { n: ((s.wins / s.trades) * 100).toFixed(0) })}</span><span class="mute">${t('{n}R a trade', { n: (s.netR / s.trades).toFixed(2) })}</span></dd>
      </div>`;
    };
    $('su-stats').innerHTML = cell(t('All timeframes'), total) + board.stats.map((s) => cell(s.timeframe, s)).join('');

    this.renderOpen();
    const done: Record<SetupTrade['status'], string> = { OPEN: '', WON: t('target'), LOST: t('stop'), TIMEOUT: t('time ran out') };
    $('su-closed').innerHTML = board.closed.length
      ? board.closed
          .map((s) => {
            const r = s.resultR ?? 0;
            return `<tr data-sym="${s.symbol}" data-tf="${s.timeframe}">
              <td class="sym">${clock(s.closedAt!)}</td><td class="sym">${base(s.symbol)}</td><td class="sym mute">${s.timeframe}</td>
              <td class="sym ${s.direction === 1 ? 'up' : 'down'}">${s.direction === 1 ? t('Long') : t('Short')}</td>
              <td>${px(s.entry)}</td><td>${px(s.exitPrice)}</td><td class="sym mute">${done[s.status]}</td>
              <td class="${r >= 0 ? 'up' : 'down'}">${r >= 0 ? '+' : ''}${r.toFixed(2)}R</td>
            </tr>`;
          })
          .join('')
      : `<tr><td class="empty" colspan="8">${t('Finished trades will be listed here. The first ones take a few hours: a setup needs a trend, a breakout and growing open interest at the same time.')}</td></tr>`;
  }

  private renderOpen() {
    const board = this.board;
    if (!board) return;
    $('su-open-n').textContent = board.open.length ? String(board.open.length) : '';
    $('su-open').innerHTML = board.open.length
      ? board.open
          .map((s) => {
            const r = this.live(s);
            return `<tr data-sym="${s.symbol}" data-tf="${s.timeframe}">
              <td class="sym">${clock(s.openedAt)}</td><td class="sym">${base(s.symbol)}</td><td class="sym mute">${s.timeframe}</td>
              <td class="sym ${s.direction === 1 ? 'up' : 'down'}">${s.direction === 1 ? t('Long') : t('Short')}</td>
              <td>${px(s.entry)}</td><td class="down">${px(s.stop)}</td><td class="up">${px(s.target)}</td>
              <td class="${r === null ? 'mute' : r >= 0 ? 'up' : 'down'}">${r === null ? '' : `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`}</td>
            </tr>`;
          })
          .join('')
      : `<tr><td class="empty" colspan="8">${t('No setup is open right now. The scanner looks at the 40 most traded pairs every time a 15m or 1h candle closes.')}</td></tr>`;
  }
}

/**
 * Four things a newcomer would otherwise find by accident, shown once in a corner. It does not
 * block anything and goes away for good on the first click.
 */
export function welcomeOnce() {
  if (load('welcomed', false)) return;
  const card = document.createElement('aside');
  card.className = 'welcome';
  card.setAttribute('aria-label', t('Getting started'));
  const tips: Array<[string, string]> = [
    [/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K', t('finds any pair, view or command')],
    ['Alt', t('and a click on the chart sets a price alert')],
    ['?', t('lists every shortcut')],
  ];
  card.innerHTML = `<h2>${t('Getting started')}</h2>
    <ul>${tips.map(([key, text]) => `<li><kbd>${key}</kbd><span>${text}</span></li>`).join('')}
    <li><span>${t('Indicators has Pulse Setups: a trade plan with a stop, a target and an honest record. The Setups tab shows how it does live.')}</span></li></ul>
    <button type="button" class="btn primary">${t('Got it')}</button>`;
  card.querySelector('button')!.addEventListener('click', () => {
    save('welcomed', true);
    card.remove();
  });
  document.body.append(card);
}

/** Day and time in UTC, short: trades run for hours, so the day matters. */
function clock(iso: string): string {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getUTCDate())}.${two(d.getUTCMonth() + 1)} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

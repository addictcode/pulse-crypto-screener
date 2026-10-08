import { signalHistory, signalStats } from './api';
import { base, hms, pct, px, tone } from './format';
import { lang, t } from './i18n';
import { ICONS } from './icons';
import { signalTitle } from './signal-text';
import type { Market } from './market';
import { load, save } from './storage';
import type { OutcomeStats, Signal } from './types';

const PERIODS: Array<[number, string]> = [[1, t('24h')], [7, t('7d')], [30, t('30d')]];
const REFRESH_MS = 30_000;
/** Below this many measured signals an average is an anecdote, so the row is dimmed. */
const THIN_SAMPLE = 10;

const $ = (id: string) => document.getElementById(id)!;

/**
 * The signal record: what the price did after each kind of signal on average, and the recent
 * signals one by one with their own outcomes. Answers "should I care when this fires?".
 */
export class SignalRecord {
  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;
  private days = load('outcomeDays', 7);
  private stats: OutcomeStats[] | null = null;
  private active = false;
  private selected = '';
  private timer = 0;
  private historyLoaded = false;

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    market.newSignals.on(() => this.renderHistory());
    $('oc-period').innerHTML = PERIODS.map(([days, label]) => `<button type="button" data-days="${days}">${label}</button>`).join('');
    $('oc-period').addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-days]');
      if (!button) return;
      this.days = Number(button.dataset.days);
      save('outcomeDays', this.days);
      this.stats = null;
      this.renderStats();
      void this.loadStats();
    });
    $('sh-rows').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]');
      if (row) this.onSelect(row.dataset.sym!);
    });
  }

  setActive(active: boolean) {
    this.active = active;
    clearInterval(this.timer);
    if (!active) return;
    this.renderStats();
    this.renderHistory();
    void this.loadStats();
    void this.loadHistory();
    // the history is redrawn too: its "in 3m" countdowns move even when no signal arrives
    this.timer = window.setInterval(() => {
      void this.loadStats();
      this.renderHistory();
    }, REFRESH_MS);
  }

  setSelected(symbol: string) {
    this.selected = symbol;
    if (this.active) this.renderHistory();
  }

  private async loadStats() {
    const days = this.days;
    try {
      const stats = await signalStats(days);
      if (days !== this.days) return; // the period changed while this was loading
      this.stats = stats;
    } catch {
      if (this.stats === null) this.stats = [];
    }
    this.renderStats();
  }

  /** The stream carries only the newest signals; the record wants a longer look back. */
  private async loadHistory() {
    if (this.historyLoaded) return;
    try {
      const items = await signalHistory(100);
      this.historyLoaded = true;
      this.market.apply({ type: 'signals', items });
    } catch {
      // the live part still works
    }
  }

  private renderStats() {
    if (!this.active) return;
    [...$('oc-period').children].forEach((b) =>
      b.setAttribute('aria-pressed', String(Number((b as HTMLElement).dataset.days) === this.days)),
    );
    const rows = (this.stats ?? []).filter((s) => s.horizons.some((h) => h.n > 0));
    const measured = rows.reduce((sum, s) => sum + Math.max(...s.horizons.map((h) => h.n)), 0);
    $('oc-meta').textContent = this.stats === null ? t('loading') : t('{n} signals measured', { n: measured });
    if (this.stats === null) {
      $('oc-rows').innerHTML = '';
      return;
    }
    $('oc-rows').innerHTML = rows.length
      ? rows.map(statsRow).join('')
      : `<tr class="empty"><td colspan="8">${t('No measured signals in this period yet. Each signal is checked 5 minutes, 15 minutes and an hour after it fires, so the table fills in as the market moves.')}</td></tr>`;
  }

  private renderHistory() {
    if (!this.active) return;
    const signals = this.market.signals;
    $('sh-meta').textContent = signals.length ? t('latest {n}', { n: signals.length }) : '';
    $('sh-rows').innerHTML = signals.length
      ? signals.map((s) => historyRow(s, s.symbol === this.selected)).join('')
      : `<tr class="empty"><td colspan="7">${t('No signals yet. They appear here the moment the detector fires.')}</td></tr>`;
  }
}

function statsRow(s: OutcomeStats) {
  const count = Math.max(...s.horizons.map((h) => h.n));
  const cells = s.horizons
    .map((h) => {
      if (h.n === 0 || h.avg === null || h.upShare === null) return '<td class="mute">\u2013</td><td class="mute">\u2013</td>';
      return `<td class="${tone(h.avg)}">${pct(h.avg, 2)}</td><td>${upShare(h.upShare)}</td>`;
    })
    .join('');
  const arrow = `<span class="dir${s.direction > 0 ? ' up' : s.direction < 0 ? ' down' : ''}">${s.direction > 0 ? ICONS.up : s.direction < 0 ? ICONS.down : ''}</span>`;
  const thin = count < THIN_SAMPLE;
  return `<tr class="${thin ? 'thin' : ''}"${thin ? ` title="${t('Few signals so far: treat these numbers as a hint, not a pattern')}"` : ''}><td class="sym">${arrow}${t(s.label)}</td><td>${count}</td>${cells}</tr>`;
}

/** Share of signals after which the price was higher, with a bar centred on 50%. */
function upShare(share: number) {
  const percent = Math.round(share * 100);
  const lean = share >= 0.5 ? 'up' : 'down';
  return `<span class="share ${lean}"><i style="width:${Math.abs(percent - 50)}%"></i></span>${percent}%`;
}

function historyRow(s: Signal, selected: boolean) {
  const now = Date.now();
  const outcome = (value: number | null, minutes: number) => {
    if (value !== null) return `<td class="${tone(value)}">${pct(value, 2)}</td>`;
    const left = Math.ceil((s.time + minutes * 60_000 - now) / 60_000);
    // past its horizon and still empty: the backend was not running then
    return left > 0
      ? `<td class="mute" title="${t('Measured in {n} min', { n: left })}">${t('{n}m', { n: left })}</td>`
      : `<td class="mute" title="${t('Not measured: Pulse was not running then')}">\u2013</td>`;
  };
  return `<tr data-sym="${s.symbol}"${selected ? ' class="is-selected"' : ''}><td class="sym when">${day(s.time)}${hms(s.time).slice(0, 5)}</td><td class="sym">${base(s.symbol)}</td><td class="sym title">${escape(signalTitle(s))}</td><td class="c-sm dim">${px(s.price)}</td>${outcome(s.ret5m, 5)}${outcome(s.ret15m, 15)}${outcome(s.ret1h, 60)}</tr>`;
}

/** "Oct 7 " for anything not from today (UTC), nothing otherwise. */
function day(time: number) {
  const date = new Date(time);
  if (date.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)) return '';
  return `${date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} `;
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

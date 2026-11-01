import { base, usd } from './format';
import { t } from './i18n';
import type { Market } from './market';
import { signalTitle } from './signal-text';
import { sparkline } from './sparkline';
import { load, save } from './storage';
import { ALERT_TONE, tapeLabel } from './tape';
import { loadTelegramTargets, telegramAnchor } from './telegram';

/** How the terminal opens on a phone: the simple feed or the full terminal. */
export type PhoneMode = 'feed' | 'terminal';

const PHONE = '(max-width: 700px)';
const SHOWN = 30;
/** A liquidation this large is news on its own. */
const BIG_LIQUIDATION = 100_000;

/**
 * Which mode to open in. A choice once made is kept. Without one, a phone that has never stored
 * anything for Pulse (a first visit, likely from a video) gets the feed and keeps it, and a link
 * to a view or a pair (a hash) always opens the terminal it points at.
 */
export function phoneMode(phone: boolean, firstVisit: boolean, hash: string): PhoneMode {
  if (!phone || hash.replace('#', '') !== '') return 'terminal';
  const chosen = load<PhoneMode | null>('phoneMode', null);
  if (chosen) return chosen;
  if (!firstVisit) return 'terminal';
  save('phoneMode', 'feed');
  return 'feed';
}

export const isPhone = () => window.matchMedia(PHONE).matches;

/** Saved by the landing page and the record, not by the terminal: they do not make a visit a return. */
const NOT_TERMINAL = new Set(['pulse.lang', 'pulse.recordDays']);

/** True when this browser has no terminal settings yet. Ask before anything is saved. */
export function nothingStored(): boolean {
  try {
    return !Object.keys(localStorage).some((key) => key.startsWith('pulse.') && !NOT_TERMINAL.has(key));
  } catch {
    return true;
  }
}

interface Card {
  key: string;
  time: number;
  symbol: string;
  label: string;
  tone: 'up' | 'down' | 'hot';
  text: string;
}

/** Everything that happened, newest first: signals, the tape and large liquidations as cards. */
export function feedCards(market: Pick<Market, 'signals' | 'tape' | 'liquidations'>, limit = SHOWN): Card[] {
  const cards: Card[] = [];
  for (const s of market.signals) {
    cards.push({ key: `s${s.id}`, time: s.time, symbol: s.symbol, label: t('Alert'), tone: ALERT_TONE[s.type], text: signalTitle(s) });
  }
  for (const item of market.tape) {
    const { label, value, tone } = tapeLabel(item);
    cards.push({ key: `t${item.time}:${item.symbol}:${item.kind}`, time: item.time, symbol: item.symbol, label, tone, text: `${base(item.symbol)} ${value}` });
  }
  for (const l of market.liquidations) {
    const value = l.price * l.quantity;
    if (value < BIG_LIQUIDATION) continue;
    cards.push({
      key: `l${l.time}:${l.symbol}:${l.side}:${value}`,
      time: l.time,
      symbol: l.symbol,
      label: t('Liquidation'),
      tone: l.side === 'LONG' ? 'down' : 'up',
      text: `${base(l.symbol)}: ${usd(value)} ${l.side === 'LONG' ? t('longs liquidated') : t('shorts liquidated')}`,
    });
  }
  return cards.sort((a, b) => b.time - a.time).slice(0, limit);
}

export function ago(time: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return t('{n} s ago', { n: s });
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  return t('{n} h ago', { n: Math.floor(s / 3600) });
}

/**
 * The simple view for a phone: big cards of what the market is doing right now, each with a
 * mini chart and a button to its full chart, and the Telegram buttons under the thumb.
 * New events wait behind a "new events" button instead of pushing the cards down while someone
 * reads them.
 */
export class LiveFeed {
  private readonly root = document.getElementById('live-feed')!;
  private readonly list = document.getElementById('feed-list')!;
  private readonly more = document.getElementById('feed-more') as HTMLButtonElement;
  private shown = new Set<string>();
  private filled = false;

  private readonly market: Market;

  constructor(market: Market, openChart: (symbol: string) => void, setMode: (mode: PhoneMode) => void) {
    this.market = market;
    document.getElementById('feed-terminal')!.addEventListener('click', () => setMode('terminal'));
    document.getElementById('feed-back')!.addEventListener('click', () => setMode('feed'));
    this.more.addEventListener('click', () => {
      this.render();
      window.scrollTo({ top: 0 });
    });
    this.list.addEventListener('click', (e) => {
      const button = (e.target as HTMLElement).closest<HTMLElement>('[data-open]');
      if (button) openChart(button.dataset.open!);
    });
    // the history arrives as a few messages right after connecting: the first render waits for all
    // of them, so the list appears once instead of growing card by card
    let settling: number | undefined;
    const refresh = () => {
      if (this.filled) this.notice();
      else settling ??= window.setTimeout(() => {
        settling = undefined;
        this.render();
      }, 800);
    };
    market.newSignals.on(refresh);
    market.newTape.on(refresh);
    market.newLiquidations.on(refresh);
    market.snapshot.on(refresh);
    setInterval(() => this.tick(), 10_000);
    void this.mountTelegram();
  }

  get active() {
    return document.body.dataset.phone === 'feed';
  }

  private render() {
    const cards = feedCards(this.market);
    if (!cards.length) return;
    this.filled = true;
    this.shown = new Set(cards.map((c) => c.key));
    this.more.hidden = true;
    const now = Date.now();
    this.list.innerHTML = cards
      .map((c) => {
        const points = this.market.sparklines.get(c.symbol) ?? [];
        return (
          `<li class="feed-card" data-sym="${c.symbol}">` +
          `<div class="fc-top"><span class="badge ${c.tone}">${c.label}</span><time data-time="${c.time}">${ago(c.time, now)}</time></div>` +
          `<p class="fc-text">${escape(c.text)}</p>` +
          `<div class="fc-foot"><span class="fc-spark">${sparkline(points, 132, 40)}</span>` +
          `<button type="button" class="btn fc-open" data-open="${c.symbol}">${t('Open chart')}</button></div></li>`
        );
      })
      .join('');
  }

  /** New events are counted on a floating button; the cards on screen stay where they are. */
  private notice() {
    const fresh = feedCards(this.market).filter((c) => !this.shown.has(c.key)).length;
    if (!fresh) return;
    this.more.textContent = t('New events: {n}', { n: fresh });
    this.more.hidden = false;
  }

  private tick() {
    if (!this.active) return;
    const now = Date.now();
    this.list.querySelectorAll<HTMLElement>('time[data-time]').forEach((el) => (el.textContent = ago(Number(el.dataset.time), now)));
  }

  private async mountTelegram() {
    const targets = await loadTelegramTargets();
    const bar = document.getElementById('feed-tg')!;
    if (!targets.length) return;
    bar.replaceChildren(...targets.map((target) => telegramAnchor(target, target.kind === 'bot' ? 'btn tg-btn primary' : 'btn tg-btn')));
    bar.hidden = false;
    this.root.dataset.tg = '';
  }
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

import { base, hms, pct, priceDigits, px } from './format';
import { t } from './i18n';
import { ICONS } from './icons';
import { Emitter, type Market } from './market';
import { load, save } from './storage';

/**
 * A price level to be told about. {@code above} is fixed when the alert is set: a level over the
 * current price fires on the way up, one under it on the way down.
 */
export interface PriceAlert {
  id: number;
  symbol: string;
  level: number;
  above: boolean;
  created: number;
}

export const MAX_ALERTS = 40;

/** True once the price has reached the level from the side the alert was set on. */
export const crossed = (alert: PriceAlert, price: number) =>
  price > 0 && (alert.above ? price >= alert.level : price <= alert.level);

/** Accepts what people type: "85,000", "85 000", "0,0845". Null when it is not a positive number. */
export function parseLevel(text: string): number | null {
  let cleaned = text.trim().replace(/[\s$_]/g, '');
  // a lone comma followed by anything but three digits is a decimal comma
  if (/^\d+,\d+$/.test(cleaned) && !/^\d{1,3},\d{3}$/.test(cleaned)) cleaned = cleaned.replace(',', '.');
  cleaned = cleaned.replace(/,/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const $ = (id: string) => document.getElementById(id)!;

/**
 * Price alerts kept in this browser. They are checked against the live stream, so they work
 * while a Pulse tab is open; the Telegram bot's /alert covers the rest of the day.
 */
export class Alerts {
  /** Fires after an alert is added, removed or triggered. */
  readonly changed = new Emitter<void>();
  private list: PriceAlert[] = load<PriceAlert[]>('alerts', []).filter((a) => a && a.symbol && a.level > 0);
  private symbol = '';
  private audio: AudioContext | null = null;

  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;
  private readonly button = $('al-btn') as HTMLButtonElement;
  private readonly menu = $('al-menu');

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    market.delta.on((changes) => this.check(changes.map(([, next]) => next)));
    market.snapshot.on(() => this.check([...market.rows.values()]));

    this.button.addEventListener('click', () => this.toggle(this.menu.hidden !== false));
    this.menu.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.menu.querySelector<HTMLInputElement>('input')!;
      const level = parseLevel(input.value);
      if (level === null) {
        this.say(t('Type a price, for example {v}', { v: this.suggestion() }));
        return;
      }
      this.say(this.add(this.symbol, level) ?? '');
    });
    this.menu.addEventListener('click', (e) => {
      const remove = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
      if (remove) this.remove(Number(remove.dataset.remove));
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !(e.target as HTMLElement).closest('.al-box')) this.toggle(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.menu.hidden) {
        this.toggle(false);
        this.button.focus();
      }
    });
    $('toasts').addEventListener('click', (e) => {
      const toast = (e.target as HTMLElement).closest<HTMLElement>('.toast');
      if (!toast) return;
      if (!(e.target as HTMLElement).closest('.toast-x')) this.onSelect(toast.dataset.sym!);
      toast.remove();
    });
    this.render();
  }

  /** The pair the instrument panel shows; the popover and its count follow it. */
  show(symbol: string) {
    this.symbol = symbol;
    this.render();
  }

  for(symbol: string): PriceAlert[] {
    return this.list.filter((a) => a.symbol === symbol);
  }

  /** @returns a message for the user when the alert was not set */
  add(symbol: string, level: number): string | null {
    const price = this.market.rows.get(symbol)?.price;
    if (!price) return t('No live price for this pair yet.');
    if (this.list.length >= MAX_ALERTS) return t('That is the limit of {n} alerts. Remove one first.', { n: MAX_ALERTS });
    const rounded = Number(level.toFixed(priceDigits(level)));
    if (rounded === price) return t('That is the current price.');
    if (this.list.some((a) => a.symbol === symbol && a.level === rounded)) return t('There is already an alert at that price.');
    this.list.push({ id: Date.now() + Math.floor(Math.random() * 1000), symbol, level: rounded, above: rounded > price, created: Date.now() });
    this.unlock();
    this.commit();
    return null;
  }

  remove(id: number) {
    this.list = this.list.filter((a) => a.id !== id);
    this.commit();
  }

  private check(rows: Array<{ symbol: string; price: number }>) {
    if (!this.list.length) return;
    const prices = new Map(rows.map((r) => [r.symbol, r.price]));
    const fired = this.list.filter((a) => prices.has(a.symbol) && crossed(a, prices.get(a.symbol)!));
    if (!fired.length) return;
    this.list = this.list.filter((a) => !fired.includes(a));
    this.commit();
    fired.forEach((a) => this.announce(a, prices.get(a.symbol)!));
  }

  private announce(alert: PriceAlert, price: number) {
    const vars = { sym: base(alert.symbol), level: px(alert.level) };
    const text = alert.above ? t('{sym} rose to {level}', vars) : t('{sym} fell to {level}', vars);
    const toast = document.createElement('div');
    toast.className = `toast ${alert.above ? 'up' : 'down'}`;
    toast.dataset.sym = alert.symbol;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `<b>${text}</b><span>${t('now {price}, {time} UTC', { price: px(price), time: hms(Date.now()) })}</span><button type="button" class="toast-x" aria-label="${t('Dismiss')}">${ICONS.close}</button>`;
    $('toasts').prepend(toast);
    this.chime(alert.above);
    try {
      if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(`Pulse: ${text}`, { body: t('now {price}, {time} UTC', { price: px(price), time: hms(Date.now()) }), tag: `pulse-alert-${alert.id}` });
      }
    } catch {
      // the toast and the sound already said it
    }
  }

  private commit() {
    save('alerts', this.list);
    this.render();
    this.changed.emit();
  }

  private toggle(open: boolean) {
    this.menu.hidden = !open;
    this.button.setAttribute('aria-expanded', String(open));
    if (open) {
      this.render();
      const input = this.menu.querySelector<HTMLInputElement>('input');
      input?.focus();
      input?.select();
    }
  }

  private suggestion() {
    const price = this.market.rows.get(this.symbol)?.price ?? 0;
    return price ? String(Number(price.toFixed(priceDigits(price)))) : '';
  }

  private say(message: string) {
    const note = this.menu.querySelector<HTMLElement>('.al-note');
    if (note) note.textContent = message;
    if (!message) {
      const input = this.menu.querySelector<HTMLInputElement>('input');
      if (input) input.value = this.suggestion();
    }
  }

  private render() {
    const mine = this.for(this.symbol).sort((a, b) => b.level - a.level);
    this.button.querySelector('.count')!.textContent = mine.length ? String(mine.length) : '';
    if (this.menu.hidden) return;
    const price = this.market.rows.get(this.symbol)?.price ?? 0;
    const others = this.list.length - mine.length;
    const keep = this.menu.querySelector<HTMLInputElement>('input')?.value;
    this.menu.innerHTML = `
      <form class="al-form">
        <label for="al-level">${t('Tell me when {sym} reaches', { sym: base(this.symbol) })}</label>
        <div class="al-row"><input id="al-level" inputmode="decimal" autocomplete="off" spellcheck="false" value="${keep ?? this.suggestion()}"><button type="submit">${t('Set alert')}</button></div>
        <p class="al-note" role="status"></p>
      </form>
      ${mine.length ? `<ul class="al-list">${mine
        .map(
          (a) => `<li><span class="${a.above ? 'up' : 'down'}">${a.above ? t('above') : t('below')}</span><span>${px(a.level)}</span><span class="mute">${price ? pct((a.level / price - 1) * 100, 2) : ''}</span><button type="button" data-remove="${a.id}" aria-label="${t('Remove alert at {level}', { level: px(a.level) })}">${ICONS.close}</button></li>`,
        )
        .join('')}</ul>` : ''}
      <p class="al-hint">${t('Alt + click on the chart sets one at that price. Alerts live in this browser and fire while a Pulse tab is open.')}${others ? ` ${t('{n} more on other pairs.', { n: others })}` : ''}</p>`;
  }

  /** Called from a click: lets the browser play sound later and asks once for notifications. */
  private unlock() {
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
      if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission();
    } catch {
      // alerts still show as toasts
    }
  }

  /** Two notes, rising or falling with the direction of the cross. */
  private chime(up: boolean) {
    try {
      this.audio ??= new AudioContext();
      const audio = this.audio;
      (up ? [784, 1175] : [784, 523]).forEach((frequency, i) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const start = audio.currentTime + i * 0.16;
        osc.type = 'triangle';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.09, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
        osc.connect(gain).connect(audio.destination);
        osc.start(start);
        osc.stop(start + 0.32);
      });
    } catch {
      // no audio available
    }
  }
}

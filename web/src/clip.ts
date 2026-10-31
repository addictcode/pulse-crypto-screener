import { base, hms, pct, px, tone, usd } from './format';
import { t } from './i18n';
import type { Market } from './market';
import { signalTitle } from './signal-text';
import { tapeLabel } from './tape';

const $ = (id: string) => document.getElementById(id)!;
/** How many events the frame shows: enough to tell a story, few enough to read in a video. */
const EVENTS = 4;
/** Single liquidations smaller than this are noise on camera. */
const MIN_LIQUIDATION = 10_000;
/** The cursor disappears after this long without moving, so it does not sit in the recording. */
const IDLE_MS = 2_000;

interface Event {
  time: number;
  key: string;
  html: string;
}

/**
 * A 9:16 frame around the live chart of one pair, for recording the screen into a short video:
 * the pair and its price large, the chart, and the latest things that happened on that pair.
 * Everything else of the terminal steps aside.
 */
export class ClipFrame {
  private readonly market: Market;
  private symbol = '';
  private active = false;
  private clock = 0;
  private idle = 0;
  private frame = 0;
  private shown = new Set<string>();

  constructor(market: Market) {
    this.market = market;
    market.delta.on((changes) => {
      if (this.active && changes.some(([, row]) => row.symbol === this.symbol)) this.schedule();
    });
    market.snapshot.on(() => this.schedule());
    market.newSignals.on(() => this.schedule());
    market.newTape.on(() => this.schedule());
    market.newLiquidations.on(() => this.schedule());
    document.addEventListener('mousemove', () => this.wake());
  }

  setSymbol(symbol: string) {
    if (symbol === this.symbol) return;
    this.symbol = symbol;
    this.shown.clear();
    this.schedule();
  }

  setActive(active: boolean) {
    this.active = active;
    clearInterval(this.clock);
    if (!active) {
      delete document.body.dataset.idle;
      return;
    }
    this.tick();
    this.clock = window.setInterval(() => this.tick(), 1_000);
    this.wake();
    this.schedule();
  }

  private tick() {
    $('clip-clock').textContent = `${hms(Date.now())} UTC`;
  }

  private wake() {
    if (!this.active) return;
    delete document.body.dataset.idle;
    clearTimeout(this.idle);
    this.idle = window.setTimeout(() => (document.body.dataset.idle = ''), IDLE_MS);
  }

  /** Price updates come twice a second for hundreds of pairs; draw at most once a frame. */
  private schedule() {
    if (!this.active || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private render() {
    const row = this.market.rows.get(this.symbol);
    $('clip-sym').textContent = base(this.symbol);
    if (row) {
      $('clip-price').textContent = px(row.price);
      const ch = $('clip-ch');
      ch.textContent = pct(row.ch24h, 2);
      ch.className = `clip-ch ${tone(row.ch24h)}`;
      $('clip-moves').innerHTML = (
        [
          [t('5m'), row.ch5m],
          [t('1h'), row.ch1h],
          [t('24h'), row.ch24h],
        ] as Array<[string, number | null]>
      )
        .map(([label, value]) => `<div><dt>${label}</dt><dd class="${tone(value)}">${pct(value, 2)}</dd></div>`)
        .join('');
    }
    this.renderEvents();
  }

  private renderEvents() {
    const events = this.events();
    const list = $('clip-events');
    if (!events.length) {
      list.innerHTML = `<li class="clip-wait">${t('Watching {sym}: pumps, liquidations and walls show up here as they happen.', { sym: base(this.symbol) })}</li>`;
      return;
    }
    // only events that were not on screen before slide in, so the recording shows what is new
    list.innerHTML = events
      .map((e) => `<li class="${this.shown.has(e.key) ? '' : 'fresh'}">${e.html}</li>`)
      .join('');
    events.forEach((e) => this.shown.add(e.key));
  }

  private events(): Event[] {
    const sym = this.symbol;
    const at = (time: number) => `<time>${hms(time).slice(0, 5)}</time>`;
    const events: Event[] = [
      ...this.market.signals
        .filter((s) => s.symbol === sym)
        .map((s) => ({
          time: s.time,
          key: `s${s.id}`,
          html: `${at(s.time)}<span class="${s.direction > 0 ? 'up' : s.direction < 0 ? 'down' : ''}">${signalTitle(s)}</span>`,
        })),
      ...this.market.tape
        .filter((item) => item.symbol === sym)
        .map((item) => {
          const { label, value, tone: itemTone } = tapeLabel(item);
          return { time: item.time, key: `t${item.kind}${item.time}`, html: `${at(item.time)}<span>${label} <b class="${itemTone}">${value}</b></span>` };
        }),
      ...this.market.liquidations
        .filter((l) => l.symbol === sym && l.price * l.quantity >= MIN_LIQUIDATION)
        .map((l) => ({
          time: l.time,
          key: `l${l.time}${l.side}${l.quantity}`,
          html: `${at(l.time)}<span>${usd(l.price * l.quantity)} ${l.side === 'LONG' ? t('longs liquidated') : t('shorts liquidated')}</span>`,
        })),
    ];
    return events.sort((a, b) => b.time - a.time).slice(0, EVENTS);
  }
}

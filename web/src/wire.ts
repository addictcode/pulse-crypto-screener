import { base, hms } from './format';
import { RECENT_SIGNALS, type Market } from './market';
import type { Signal, SignalType } from './types';

const LABELS: Record<SignalType, [string, string]> = {
  PUMP: ['Pump', 'up'],
  DUMP: ['Dump', 'down'],
  VOLUME: ['Volume', 'hot'],
  OPEN_INTEREST: ['Open interest', 'hot'],
  FUNDING: ['Funding', 'hot'],
  LIQUIDATIONS: ['Liquidations', 'down'],
  WALL: ['Near wall', 'hot'],
};

const STORIES = 4;
const HOUR = 3_600_000;

const $ = (id: string) => document.getElementById(id)!;

/**
 * The newest signals laid out like a front page: the latest as the lead story with its context,
 * the next few as shorter headlines. Clicking a story opens the pair.
 */
export class Wire {
  private readonly market: Market;
  private readonly onSelect: (symbol: string) => void;

  constructor(market: Market, onSelect: (symbol: string) => void) {
    this.market = market;
    this.onSelect = onSelect;
    market.newSignals.on((fresh) => this.render(fresh));
    setInterval(() => this.renderMeta(), 30_000);
    $('stories').addEventListener('click', (e) => {
      const story = (e.target as HTMLElement).closest<HTMLElement>('[data-sym]');
      if (story) this.onSelect(story.dataset.sym!);
    });
  }

  private render(fresh: Signal[]) {
    const items = this.market.signals.slice(0, STORIES);
    const freshIds = new Set(fresh.map((s) => s.id));
    $('stories').innerHTML = items.length
      ? items
          .map((s, i) => {
            const [label, tone] = LABELS[s.type];
            return `<article class="story${i === 0 ? ' lead' : ''}${i === 0 && freshIds.has(s.id) ? ' enter' : ''}" data-sym="${s.symbol}" title="Open ${base(s.symbol)}">
              <p class="meta">${hms(s.time)}<b class="${tone}">${label}</b></p>
              <h3>${escape(s.title)}</h3>
              ${i === 0 ? `<p class="deck">${escape(s.detail)}</p>` : ''}
            </article>`;
          })
          .join('')
      : '<p class="empty-note">No signals yet. The detector warms up for two minutes after the server starts, then reports pumps, dumps, volume surges, open interest moves, extreme funding, liquidation bursts and prices nearing big walls.</p>';
    this.renderMeta();
  }

  private renderMeta() {
    const since = Date.now() - HOUR;
    const count = this.market.signals.filter((s) => s.time >= since).length;
    // the client keeps a limited list; if all of it is from the last hour, there were more
    const capped = count > 0 && count === this.market.signals.length && count >= RECENT_SIGNALS;
    $('wire-meta').textContent = count
      ? `${count}${capped ? '+' : ''} signal${count === 1 ? '' : 's'} in the last hour`
      : 'signals, newest first';
  }
}

function escape(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

import { base, hms, usd } from './format';
import type { Market } from './market';
import { RULES } from './screener';

const WINDOW_MS = 5 * 60_000;
const VISIBLE = 14;

const $ = (id: string) => document.getElementById(id)!;

export class LiquidationsPanel {
  private readonly market: Market;

  constructor(market: Market) {
    this.market = market;
    market.snapshot.on(() => this.render(new Set()));
    market.newLiquidations.on((items) => this.render(new Set(items)));
    // the 5 minute totals have to decay even when nothing new arrives
    setInterval(() => this.renderTotals(), 5_000);
  }

  private render(fresh: Set<object>) {
    const items = this.market.liquidations.slice(0, VISIBLE);
    const max = Math.max(1, ...items.map((l) => l.price * l.quantity));
    $('liqs').innerHTML = items
      .map((l) => {
        const value = l.price * l.quantity;
        const side = l.side === 'LONG' ? 'long' : 'short';
        return `<li class="liq-row ${side}${fresh.has(l) ? ' enter' : ''}">
          <time>${hms(l.time)}</time><span class="s">${base(l.symbol)}</span>
          <span class="${l.side === 'LONG' ? 'down' : 'up'}">${l.side === 'LONG' ? 'Long' : 'Short'}</span>
          <span class="v"><i style="width:${Math.max(2, Math.round((value / max) * 44))}px"></i><span class="${value >= RULES.bigLiquidations ? 'strong' : 'dim'}">${usd(value)}</span></span>
        </li>`;
      })
      .join('');
    if (!items.length) $('liqs').innerHTML = '<li class="empty-note">No liquidations yet.</li>';
    this.renderTotals();
  }

  private renderTotals() {
    const since = Date.now() - WINDOW_MS;
    let longs = 0;
    let shorts = 0;
    for (const l of this.market.liquidations) {
      if (l.time < since) continue;
      if (l.side === 'LONG') longs += l.price * l.quantity;
      else shorts += l.price * l.quantity;
    }
    $('liq-l').textContent = `Longs ${usd(longs)}`;
    $('liq-s').textContent = `Shorts ${usd(shorts)}`;
    $('liq-lb').style.flexGrow = String(longs || 1);
    $('liq-sb').style.flexGrow = String(shorts || 1);
  }
}

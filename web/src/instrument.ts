import { base, countdown, pct, px, tone, usd } from './format';
import type { Market } from './market';
import { RULES } from './screener';
import type { SymbolMetrics } from './types';

const $ = (id: string) => document.getElementById(id)!;

/** Highlight chips: the same thresholds as the screener presets, applied to one pair. */
function highlights(r: SymbolMetrics): Array<[string, string]> {
  const chips: Array<[string, string]> = [];
  if (r.ch5m !== null && Math.abs(r.ch5m) >= RULES.move5m) chips.push([tone(r.ch5m), `${r.ch5m > 0 ? 'Pump' : 'Dump'} ${pct(r.ch5m, 1)} 5m`]);
  if ((r.surge ?? 0) >= RULES.surge) chips.push(['hot', `Vol ${r.surge!.toFixed(1)}×`]);
  if ((r.oiCh15m ?? 0) >= RULES.oiRise) chips.push(['up', `OI ${pct(r.oiCh15m, 1)}`]);
  if (r.funding !== null && Math.abs(r.funding) >= RULES.funding) chips.push(['hot', `Funding ${pct(r.funding, 3)}`]);
  if (r.liq5m >= RULES.bigLiquidations) chips.push(['down', `Liq ${usd(r.liq5m)} 5m`]);
  return chips;
}

export class InstrumentPanel {
  private symbol = '';
  private pingTimer = 0;

  private readonly market: Market;

  constructor(market: Market) {
    this.market = market;
    market.delta.on((changes) => {
      const mine = changes.find(([, next]) => next.symbol === this.symbol);
      if (mine) this.fill(mine[1]);
    });
    setInterval(() => {
      const row = market.rows.get(this.symbol);
      if (row) $('ins-fund-t').textContent = countdown(row.nextFunding);
    }, 30_000);
  }

  show(symbol: string) {
    this.symbol = symbol;
    const row = this.market.rows.get(symbol);
    if (row) this.fill(row);
    // the crop marks flash to tie the panel to the row you just picked
    const panel = $('instrument');
    panel.classList.add('ping');
    clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => panel.classList.remove('ping'), 700);
  }

  private fill(r: SymbolMetrics) {
    $('ins-sym').textContent = base(r.symbol);
    $('ins-name').textContent = `${r.symbol}, Binance perpetual`;
    $('ins-price').textContent = px(r.price);
    const change = $('ins-chg');
    change.textContent = `${pct(r.ch24h)} 24h`;
    change.className = `ins-chg ${tone(r.ch24h)}`;

    const chips = highlights(r);
    $('tags').innerHTML = chips.length
      ? chips.map(([cls, label]) => `<span class="tag ${cls}">${label}</span>`).join('')
      : '<span class="none">Nothing unusual on this pair right now.</span>';

    $('rng-lo').textContent = px(r.low24h);
    $('rng-hi').textContent = px(r.high24h);
    const span = (r.high24h ?? 0) - (r.low24h ?? 0);
    const position = span > 0 ? ((r.price - r.low24h!) / span) * 100 : 50;
    $('rng-mark').style.left = `${Math.min(100, Math.max(0, position))}%`;

    const funding = $('ins-fund');
    funding.textContent = pct(r.funding, 4);
    funding.className = r.funding !== null && Math.abs(r.funding) >= RULES.funding ? 'hot' : '';
    $('ins-fund-t').textContent = countdown(r.nextFunding);

    $('ins-oi').textContent = usd(r.oi);
    const oi = $('ins-oi15');
    oi.textContent = r.oiCh15m === null ? 'warming up' : `${pct(r.oiCh15m, 1)} 15m`;
    oi.className = `sub ${tone(r.oiCh15m, 0.1)}`;

    $('ins-vol').textContent = usd(r.vol24h);
    const surge = $('ins-volx');
    surge.textContent = r.surge === null ? 'warming up' : `${r.surge.toFixed(1)}× avg`;
    surge.className = `sub${(r.surge ?? 0) >= RULES.surge ? ' hot' : ''}`;
  }
}

import { age, base, countdown, eatTime, pct, px, tone, usd } from './format';
import { t } from './i18n';
import type { Market } from './market';
import { RULES } from './screener';
import type { SymbolMetrics, Wall } from './types';

const $ = (id: string) => document.getElementById(id)!;

/** A wall this close to the price is worth a chip in the instrument header. */
const NEAR_WALL = 0.5;

/** Highlight chips: the same thresholds as the screener presets, applied to one pair. */
function highlights(r: SymbolMetrics, wall: Wall | null): Array<[string, string]> {
  const chips: Array<[string, string]> = [];
  if (r.ch5m !== null && Math.abs(r.ch5m) >= RULES.move5m) {
    chips.push([tone(r.ch5m), `${r.ch5m > 0 ? t('Pump') : t('Dump')} ${pct(r.ch5m, 1)}`]);
  }
  if ((r.surge ?? 0) >= RULES.surge) chips.push(['hot', t('Volume {v}×', { v: r.surge!.toFixed(1) })]);
  if ((r.oiCh15m ?? 0) >= RULES.oiRise) chips.push(['up', `OI ${pct(r.oiCh15m, 1)}`]);
  if (r.funding !== null && Math.abs(r.funding) >= RULES.funding) chips.push(['hot', t('Funding {v}', { v: pct(r.funding, 3) })]);
  if (r.liq5m >= RULES.bigLiquidations) chips.push(['down', t('Liquidations {v}', { v: usd(r.liq5m) })]);
  if (wall && Math.abs(wall.distance) <= NEAR_WALL) {
    chips.push(['hot', `${wall.side === 'BID' ? t('Bid wall') : t('Ask wall')} ${pct(wall.distance, 2)}`]);
  }
  return chips;
}

export class InstrumentPanel {
  private symbol = '';

  private readonly market: Market;

  constructor(market: Market) {
    this.market = market;
    market.delta.on((changes) => {
      const mine = changes.find(([, next]) => next.symbol === this.symbol);
      if (mine) this.fill(mine[1]);
    });
    market.wallsUpdated.on(() => this.renderLadder());
    market.gapsUpdated.on(() => {
      this.renderVenue();
      const row = market.rows.get(this.symbol);
      if (row) this.fill(row);
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
    this.renderLadder();
    this.renderVenue();
  }

  /** How the same contract trades on Bybit; hidden for pairs Bybit does not list. */
  private renderVenue() {
    const el = $('venue');
    const g = this.market.gaps.get(this.symbol);
    el.hidden = !g;
    if (!g) return;
    const wide = g.spread8h !== null && Math.abs(g.spread8h) >= RULES.fundingGap;
    const apr = Math.abs(g.spreadApr ?? 0).toFixed(1);
    const hint =
      (g.spread8h ?? 0) > 0
        ? t('Binance funding minus Bybit funding, both per 8 hours. About {apr}% a year to whoever is short Binance and long Bybit.', { apr })
        : t('Binance funding minus Bybit funding, both per 8 hours. About {apr}% a year to whoever is long Binance and short Bybit.', { apr });
    const perHours = t('/{n}h', { n: g.fundingHours });
    el.innerHTML = `
      <div><dt>${t('Bybit price')}</dt><dd>${px(g.price)} <span class="${tone(g.gap, 0.03)}">${pct(g.gap, 3)}</span></dd></div>
      <div><dt>${t('Bybit funding')}</dt><dd>${g.funding === null ? '–' : `${pct(g.funding, 4)} <span class="mute">${perHours}</span>`}</dd></div>
      <div title="${hint}"><dt>${t('Funding gap 8h')}</dt><dd class="${wide ? 'hot' : ''}">${pct(g.spread8h, 4)}</dd></div>
      <div><dt>${t('Bybit OI')}</dt><dd>${usd(g.oi)}${g.oiShare === null ? '' : ` <span class="mute">${Math.round(g.oiShare * 100)}%</span>`}</dd></div>`;
  }

  /** Walls of the selected pair as a small book: asks on top, bids below, bars to scale. */
  private renderLadder() {
    const ladder = $('ladder');
    const meta = $('book-meta');
    const coverage = this.market.coverage.get(this.symbol);
    if (coverage === undefined && this.market.coverage.size === 0) {
      meta.textContent = t('syncing');
      ladder.innerHTML = `<p class="empty-note">${t('Order books are syncing after startup. Walls appear within a minute.')}</p>`;
      return;
    }
    if (coverage === undefined) {
      meta.textContent = t('not tracked');
      ladder.innerHTML = `<p class="empty-note">${t('Live order books are kept for the 60 most traded pairs. This one is outside that list right now.')}</p>`;
      return;
    }
    meta.textContent = coverage < 5 ? t('book known within ±{n}%', { n: coverage }) : t('walls within 5%');
    const walls = [...this.market.wallsFor(this.symbol)].sort((a, b) => b.price - a.price);
    if (!walls.length) {
      ladder.innerHTML = `<p class="empty-note">${t('No walls within 5% of the price right now.')}</p>`;
      return;
    }
    const max = Math.max(...walls.map((w) => w.size));
    const nearest = this.market.nearestWall(this.symbol);
    ladder.innerHTML = walls
      .map((w) => {
        const side = w.side === 'BID' ? 'bid' : 'ask';
        const title = t('standing {age}, eaten in {eat}', { age: age(w.age), eat: eatTime(w.eatMinutes) });
        return `<div class="rung ${side}${w === nearest ? ' near' : ''}" title="${title}">
          <span class="${side === 'bid' ? 'up' : 'down'}">${side === 'bid' ? t('Bid') : t('Ask')}</span>
          <span class="bar" style="width:${((w.size / max) * 100).toFixed(1)}%"></span>
          <span>${px(w.price)}</span>
          <span class="dim">${usd(w.size)}</span>
          <span class="dist">${pct(w.distance, 2)}</span>
        </div>`;
      })
      .join('');
  }

  private fill(r: SymbolMetrics) {
    $('ins-sym').textContent = base(r.symbol);
    $('ins-name').textContent = t('{symbol}, Binance perpetual', { symbol: r.symbol });
    $('ins-price').textContent = px(r.price);
    const change = $('ins-chg');
    change.textContent = `${pct(r.ch24h)} ${t('24h')}`;
    change.className = `ins-chg ${tone(r.ch24h)}`;

    $('ins-moves').innerHTML = (
      [
        [t('5m'), r.ch5m],
        [t('15m'), r.ch15m],
        [t('1h'), r.ch1h],
      ] as Array<[string, number | null]>
    )
      .map(([label, value]) => `<span><em>${label}</em><b class="${tone(value)}">${pct(value)}</b></span>`)
      .join('');

    $('tags').innerHTML = highlights(r, this.market.nearestWall(r.symbol))
      .map(([cls, label]) => `<span class="tag ${cls}">${label}</span>`)
      .join('');

    $('rng-lo').textContent = px(r.low24h);
    $('rng-hi').textContent = px(r.high24h);
    const span = (r.high24h ?? 0) - (r.low24h ?? 0);
    const position = span > 0 ? ((r.price - r.low24h!) / span) * 100 : 50;
    $('rng-mark').style.left = `${Math.min(100, Math.max(0, position))}%`;

    const funding = $('ins-fund');
    const hours = this.market.gaps.get(r.symbol)?.homeHours;
    funding.textContent = pct(r.funding, 4) + (hours && r.funding !== null ? ` ${t('/{n}h', { n: hours })}` : '');
    funding.className = r.funding !== null && Math.abs(r.funding) >= RULES.funding ? 'hot' : '';
    $('ins-fund-t').textContent = countdown(r.nextFunding);

    $('ins-oi').textContent = usd(r.oi);
    const oi = $('ins-oi15');
    oi.textContent = r.oiCh15m === null ? t('warming up') : `${pct(r.oiCh15m, 1)} ${t('15m')}`;
    oi.className = `sub ${tone(r.oiCh15m, 0.1)}`;

    $('ins-vol').textContent = usd(r.vol24h);
    const surge = $('ins-volx');
    surge.textContent = r.surge === null ? t('warming up') : t('{v}× the hourly pace', { v: r.surge.toFixed(1) });
    surge.className = `sub${(r.surge ?? 0) >= RULES.surge ? ' hot' : ''}`;
  }
}

import { hms, pct, px, tone, usd } from './format';
import { t } from './i18n';
import type { ConnectionState, Market } from './market';

const $ = (id: string) => document.getElementById(id)!;

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: t('Connecting'),
  live: t('Connected'),
  reconnecting: t('Reconnecting'),
};

/** Masthead market summary, UTC clock and the status bar along the bottom. */
export class Masthead {
  private readonly market: Market;

  constructor(market: Market) {
    this.market = market;
    market.snapshot.on(() => this.renderMarket());
    market.connectionChanged.on((state) => this.renderConnection(state));
    this.renderConnection(market.connection);
    setInterval(() => this.everySecond(), 1_000);
    this.everySecond();
  }

  private everySecond() {
    ($('clock').firstChild as Text).textContent = hms(Date.now());
    this.renderMarket();
    const age = this.market.lastTick ? Math.max(0, Date.now() - this.market.lastTick) : null;
    $('st-age').textContent = age === null ? '' : t('data age {v}', { v: age < 1000 ? `${age} ms` : `${(age / 1000).toFixed(1)} s` });
  }

  private renderMarket() {
    const rows = [...this.market.rows.values()];
    if (!rows.length) return;
    for (const [symbol, id] of [['BTCUSDT', 'm-btc'], ['ETHUSDT', 'm-eth']] as const) {
      const row = this.market.rows.get(symbol);
      if (!row) continue;
      $(id).textContent = px(row.price);
      const change = $(`${id}-c`);
      change.textContent = pct(row.ch24h);
      change.className = `mk-chg ${tone(row.ch24h)}`;
    }
    $('m-vol').textContent = usd(rows.reduce((sum, r) => sum + r.vol24h, 0));

    const share = rows.filter((r) => (r.ch24h ?? 0) > 0).length / rows.length;
    const [upBar, downBar] = $('breadth').children as HTMLCollectionOf<HTMLElement>;
    upBar.style.cssText = `flex:${share};background:var(--up)`;
    downBar.style.cssText = `flex:${1 - share};background:var(--down)`;
    $('breadth-v').textContent = `${Math.round(share * 100)}%`;

    // rough trading-session hours in UTC
    const hour = new Date().getUTCHours();
    const open = [hour < 9, hour >= 7 && hour < 16, hour >= 13 && hour < 21];
    [...$('sessions').children].forEach((el, i) => el.classList.toggle('on', open[i]));
  }

  private renderConnection(state: ConnectionState) {
    const el = $('st-conn');
    el.textContent = CONNECTION_LABEL[state];
    el.dataset.state = state;
  }
}

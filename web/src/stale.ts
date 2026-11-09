import './stale.css';

import { t } from './i18n';
import type { Market } from './market';
import { duration } from './ago';
import { STALE_MS } from './stale-ms';

// When the data stops, the page says so. A dead exchange feed or a silent server would otherwise
// look like a calm market: the last numbers stay on screen, unchanged, and look true.

export { STALE_MS };

export type Staleness = { kind: 'server' | 'exchange' | 'demo'; age: number } | null;

/**
 * What is wrong, if anything: the server has been silent (no tick, no summary), or it speaks but
 * the exchange behind it has not. Measured on this browser's clock from when things arrived, plus
 * the server's own measure of the exchange, so neither clock has to agree with the other.
 */
export function staleness(market: Market, now: number, startedAt: number, demo: boolean): Staleness {
  const heard = market.receivedAt || startedAt;
  const silent = now - heard;
  if (silent > STALE_MS) return { kind: demo ? 'demo' : 'server', age: silent };
  if (market.feedAge !== null && !demo) {
    const age = market.feedAge + (now - market.feedAgeAt);
    if (age > STALE_MS) return { kind: 'exchange', age };
  }
  return null;
}


export function staleText(s: NonNullable<Staleness>): string {
  const v = duration(s.age);
  switch (s.kind) {
    case 'server':
      return t('No data from the Pulse server for {v}. Reconnecting; the numbers on screen are not live.', { v });
    case 'exchange':
      return t('The exchange data is {v} old: Pulse is reconnecting to Binance. The numbers on screen are not live.', { v });
    case 'demo':
      return t('No data from Binance for {v}. The demo reads it straight from your browser; Binance may be unreachable from your network.', { v });
  }
}

/**
 * A bar fixed to the top of the screen while the data is stale: fixed, so its coming and going
 * moves nothing on the page. Checked every two seconds.
 */
export function mountStaleBanner(market: Market, demo: boolean, link = 'status/') {
  const bar = document.createElement('div');
  bar.className = 'stale-banner';
  bar.setAttribute('role', 'status');
  bar.hidden = true;
  document.body.append(bar);
  const startedAt = Date.now();
  const check = () => {
    const s = staleness(market, Date.now(), startedAt, demo);
    bar.hidden = !s;
    if (s) {
      bar.textContent = `${staleText(s)} `;
      if (!demo) {
        const a = document.createElement('a');
        a.href = link;
        a.textContent = t('Status');
        bar.append(a);
      }
    }
    document.body.classList.toggle('is-stale', Boolean(s));
  };
  setInterval(check, 2_000);
}

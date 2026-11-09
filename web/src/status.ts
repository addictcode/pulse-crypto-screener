import './client-errors';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './theme.css';
import './landing.css';
import './record.css';
import './status.css';

import { extend, localize, mountLangSwitch, t } from './i18n';
import { STATUS } from './locale-status';
import { duration, STALE_MS } from './stale';
import { buckets, type Minute } from './status-math';

// /status/: is Pulse live right now, and how was the last day. A poll every ten seconds of
// /api/status/full, which the server measures on its own clock.

interface Status {
  now: number;
  feedAge: number | null;
  stale: boolean;
  exchanges: Array<{ exchange: string; symbols: number; connections: number; connectionsOpen: number }>;
  booksSynced: number;
  books: number;
  lastSignal: { type: string; symbol: string; time: number } | null;
  since: number;
  minutes: Minute[];
}

const DAY = 24 * 60 * 60_000;
const $ = (id: string) => document.getElementById(id)!;

extend(STATUS);
localize();
mountLangSwitch($('lang'));

/** SignalType labels on the server, translated like the record's. */
const LABEL: Record<string, string> = {
  PUMP: 'Pump', DUMP: 'Dump', VOLUME: 'Volume', OPEN_INTEREST: 'Open interest', FUNDING: 'Funding', LIQUIDATIONS: 'Liquidations', WALL: 'Near wall',
};

function base(symbol: string) {
  return symbol.replace(/USDT$/, '');
}

function render(s: Status) {
  const live = !s.stale;
  $('st-now').className = `st-now${live ? ' live' : ''}`;
  $('st-word').textContent = live ? t('Live') : t('Not live');
  $('st-meta').textContent = t('updated every 10 seconds');
  const feed = s.exchanges[0];
  $('st-feed').textContent = feed
    ? t('{n} pairs, {open} of {total} connections open', { n: feed.symbols, open: feed.connectionsOpen, total: feed.connections })
    : '–';
  $('st-age').textContent = s.feedAge === null ? t('no data yet') : s.feedAge < 1000 ? t('under a second') : duration(s.feedAge);
  $('st-books').textContent = t('{synced} of {books}', { synced: s.booksSynced, books: s.books });
  $('st-signal').textContent = s.lastSignal
    ? t('{signal} {symbol}, {ago} ago', { signal: t(LABEL[s.lastSignal.type] ?? s.lastSignal.type), symbol: base(s.lastSignal.symbol), ago: duration(s.now - s.lastSignal.time) })
    : t('none yet');
  const parts = buckets(s.minutes, s.now);
  $('st-strip').innerHTML = parts.map((p) => `<span class="${p}"></span>`).join('');
  const recorded = s.minutes.length;
  const fresh = s.minutes.filter((m) => m.feedAge !== null && m.feedAge <= STALE_MS).length;
  const since = Math.max(s.since, s.now - DAY);
  const text = recorded
    ? t('Live {share} of the recorded minutes since {since} (UTC).', {
        share: `${((fresh / recorded) * 100).toFixed(1)}%`,
        since: new Date(since).toISOString().slice(0, 16).replace('T', ' '),
      })
    : t('No minutes recorded yet: the server started less than a minute ago.');
  $('st-share').textContent = text;
  $('st-strip').setAttribute('aria-label', `${t('The last 24 hours')}. ${text}`);
}

async function poll() {
  if (import.meta.env.VITE_STANDALONE === '1') {
    $('st-word').textContent = t('The status is kept by the Pulse server; this demo runs without one.');
    return;
  }
  try {
    const response = await fetch('/api/status/full');
    if (!response.ok) throw new Error(String(response.status));
    render((await response.json()) as Status);
  } catch {
    $('st-now').className = 'st-now';
    $('st-word').textContent = t('The Pulse server is not answering.');
    $('st-meta').textContent = '';
  }
}

void poll();
setInterval(() => {
  if (!document.hidden) void poll();
}, 10_000);

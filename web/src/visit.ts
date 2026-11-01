import { STANDALONE } from './api';

/** The steps of the funnel a page may report; the server keeps the same list. */
export type FunnelPage = 'landing' | 'app' | 'record' | 'clip' | 'bot-click' | 'channel-click';

const SOURCE_KEY = 'pulse.source';

/**
 * Where this visit came from, as the page sees it: `utm_source` or `ref` in the address first (a
 * link in a TikTok bio can carry them), then the site that linked here. The server folds this
 * into a few buckets. Moving between our own pages keeps the source the visit started with, so
 * a visitor who came from TikTok is still from TikTok on the terminal.
 */
export function sourceOf(search: string, referrer: string, ownHost: string, remembered: string | null): string {
  const params = new URLSearchParams(search);
  const tagged = params.get('utm_source') ?? params.get('ref');
  if (tagged) return tagged.slice(0, 64);
  let host = '';
  try {
    host = referrer ? new URL(referrer).hostname : '';
  } catch {
    host = '';
  }
  if (host && host !== ownHost) return host;
  return remembered ?? '';
}

function source(): string {
  let remembered: string | null = null;
  try {
    remembered = sessionStorage.getItem(SOURCE_KEY);
  } catch {
    // storage can be blocked; then every page decides on its own
  }
  const found = sourceOf(location.search, document.referrer, location.hostname, remembered);
  try {
    // the first page of the visit decides, later ones only carry it along
    if (remembered === null) sessionStorage.setItem(SOURCE_KEY, found);
  } catch {
    // see above
  }
  return found;
}

/**
 * Counts a step of the funnel: a page opened or a Telegram button clicked. No cookies and no
 * identifiers: the server only adds one to a counter of the day. A beacon survives the page
 * being left, which is exactly when a button click is reported. The demo has no server to tell.
 */
export function hit(page: FunnelPage) {
  if (STANDALONE || typeof navigator.sendBeacon !== 'function') return;
  try {
    navigator.sendBeacon('/api/hit', new Blob([JSON.stringify({ page, source: source() })], { type: 'application/json' }));
  } catch {
    // counting must never break the page
  }
}

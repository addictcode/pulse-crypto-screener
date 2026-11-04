import { STANDALONE } from './api';

/** The steps of the funnel a page may report; the server keeps the same list. */
export type FunnelPage = 'landing' | 'app' | 'record' | 'clip' | 'bot-click' | 'channel-click';

const PAGE_VIEWS = new Set<FunnelPage>(['landing', 'app', 'record', 'clip']);

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

/**
 * A tag is read once and then taken out of the address bar: a link copied from there would
 * otherwise carry this visitor's source to whoever opens it (a TikTok link pasted into Telegram
 * would count Telegram's visitors as TikTok's). The hash, which holds the terminal's view, stays.
 */
export function withoutTag(href: string): string | null {
  const url = new URL(href);
  const tags = [...url.searchParams.keys()].filter((key) => key === 'ref' || key.startsWith('utm_'));
  if (!tags.length) return null;
  tags.forEach((key) => url.searchParams.delete(key));
  return url.pathname + url.search + url.hash;
}

/** This page's source, once worked out: later hits of the same page (a button click) reuse it. */
let known: string | null = null;

function source(): string {
  if (known !== null) return known;
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
  known = found;
  const clean = withoutTag(location.href);
  if (clean !== null) history.replaceState(history.state, '', clean);
  return found;
}

/**
 * Counts a step of the funnel: a page opened or a Telegram button clicked. No cookies and no
 * identifiers: the server only adds one to a counter of the day. A beacon survives the page
 * being left, which is exactly when a button click is reported. The demo has no server to tell.
 */
export function hit(page: FunnelPage) {
  if (STANDALONE || typeof navigator.sendBeacon !== 'function') {
    // nothing is counted here, but the address is tidied all the same
    const clean = withoutTag(location.href);
    if (clean !== null) history.replaceState(history.state, '', clean);
    return;
  }
  // a page counts once a visit: a reload or a second look at the same page is not a new visitor.
  // The server cannot tell that by address any more (phones share one behind their operator), so
  // the page remembers it; clicks on the Telegram buttons count every time
  if (PAGE_VIEWS.has(page)) {
    try {
      const key = `pulse.counted.${page}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      // storage blocked: count it, the server still limits how often one address can
    }
  }
  try {
    navigator.sendBeacon('/api/hit', new Blob([JSON.stringify({ page, source: source() })], { type: 'application/json' }));
  } catch {
    // counting must never break the page
  }
}

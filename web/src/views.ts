export type View = 'screener' | 'grid' | 'heatmap' | 'densities' | 'signals' | 'setups' | 'clip';

/** `clip` has no tab: it is the vertical frame for screen recordings, entered with V. */
const VIEWS: View[] = ['screener', 'grid', 'heatmap', 'densities', 'signals', 'setups', 'clip'];

/**
 * What the address bar says: `#heatmap`, `#screener:SOLUSDT`. The pair is optional and rides
 * along so a copied link opens the same chart.
 */
export function parseHash(hash: string): { view: View; symbol: string | null } {
  const [name, symbol] = hash.replace(/^#/, '').split(':');
  return {
    view: (VIEWS as string[]).includes(name) ? (name as View) : 'screener',
    symbol: symbol && /^[A-Z0-9]{2,24}$/.test(symbol) ? symbol : null,
  };
}

/**
 * A shared moment: `#screener:SOLUSDT:15m:1793123456` names the timeframe and a time (unix
 * seconds) on top of the pair. Links without them read as before.
 */
export function parseMoment(hash: string, timeframes: readonly string[]): { tf: string | null; at: number | null } {
  const [, , tf, at] = hash.replace(/^#/, '').split(':');
  const seconds = Number(at);
  return {
    tf: tf && timeframes.includes(tf) ? tf : null,
    // a sane time: after 2017, Binance futures' start, and not far in the future
    at: at && /^\d{9,11}$/.test(at) && seconds > 1_500_000_000 && seconds < Date.now() / 1000 + 86_400 ? seconds : null,
  };
}

/** The address of a moment on a chart, tagged so the funnel can count visits from shared links. */
export function momentLink(origin: string, path: string, symbol: string, tf: string, at: number | null): string {
  return `${origin}${path}?utm_source=share#screener:${symbol}:${tf}${at === null ? '' : `:${Math.floor(at)}`}`;
}

export const currentView = (): View => (document.body.dataset.view as View) ?? 'screener';

/** Puts the selected pair into the address bar without adding a history entry. */
export function rememberSymbol(symbol: string) {
  // the live feed keeps a bare address, so a reload brings the feed back and not the terminal
  if (document.body.dataset.phone === 'feed') return;
  history.replaceState(null, '', `#${currentView()}:${symbol}`);
}

/**
 * Layouts over the same market: the terminal, the chart grid, the heatmap, the density map and
 * the signal record. The view lives in the URL hash so a reload or a shared link lands on the
 * same screen.
 */
export function initViews(onChange: (view: View) => void, onSymbol: (symbol: string) => void) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.view[data-view]')];
  const apply = () => {
    const { view, symbol } = parseHash(location.hash);
    document.body.dataset.view = view;
    links.forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    onChange(view);
    if (symbol) onSymbol(symbol);
  };
  window.addEventListener('hashchange', apply);
  apply();
}

export type View = 'screener' | 'grid' | 'densities' | 'signals';

const VIEWS: View[] = ['screener', 'grid', 'densities', 'signals'];

/**
 * What the address bar says: `#signals`, `#screener:SOLUSDT`. The pair is optional and rides
 * along so a copied link opens the same chart.
 */
export function parseHash(hash: string): { view: View; symbol: string | null } {
  const [name, symbol] = hash.replace(/^#/, '').split(':');
  return {
    view: (VIEWS as string[]).includes(name) ? (name as View) : 'screener',
    symbol: symbol && /^[A-Z0-9]{2,24}$/.test(symbol) ? symbol : null,
  };
}

export const currentView = (): View => (document.body.dataset.view as View) ?? 'screener';

/** Puts the selected pair into the address bar without adding a history entry. */
export function rememberSymbol(symbol: string) {
  history.replaceState(null, '', `#${currentView()}:${symbol}`);
}

/**
 * Layouts over the same market: the terminal, the chart grid, the density map and
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

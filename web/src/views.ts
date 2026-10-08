export type View = 'screener' | 'grid' | 'densities' | 'signals';

/**
 * Layouts over the same market: the terminal, the chart grid, the density map and the signal
 * record. The view lives in the URL hash so a reload
 * or a shared link lands on the same screen.
 */
export function initViews(onChange: (view: View) => void) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.view[data-view]')];
  const apply = () => {
    const hash = location.hash.slice(1);
    const view: View = hash === 'densities' || hash === 'grid' || hash === 'signals' ? hash : 'screener';
    document.body.dataset.view = view;
    links.forEach((a) => {
      if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    onChange(view);
  };
  window.addEventListener('hashchange', apply);
  apply();
}

export const currentView = (): View => (document.body.dataset.view as View) ?? 'screener';

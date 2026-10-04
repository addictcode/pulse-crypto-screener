export type View = 'screener' | 'densities';

/**
 * Two layouts over the same instrument panel. The view lives in the URL hash so a reload
 * or a shared link lands on the same screen.
 */
export function initViews(onChange: (view: View) => void) {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.view[data-view]')];
  const apply = () => {
    const view: View = location.hash === '#densities' ? 'densities' : 'screener';
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

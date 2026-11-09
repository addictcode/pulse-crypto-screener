import { t } from './i18n';
import { load, save } from './storage';

interface Step {
  /** what to point at; a step whose target is not on screen is skipped */
  target: string;
  title: string;
  text: string;
  /** said only where there is a keyboard: a phone has no Ctrl K */
  keyboard?: string;
}

const STEPS: Step[] = [
  {
    target: '.panel.screener',
    title: 'The whole market',
    text: 'Every Binance USDT perpetual in one list, re-sorted live. Tap a row to open its chart; words with a dotted line explain themselves.',
  },
  {
    target: '#chart',
    title: 'The chart',
    text: 'The pair you picked, with its signals and liquidations marked. Drawing tools and indicators sit above it.',
  },
  {
    target: '.panel.tape',
    title: 'What is happening',
    text: 'Pumps, dumps, volume bursts and liquidation waves the moment they happen. A signal says what happened, not where the price goes next.',
  },
  {
    target: '#cmd-btn',
    title: 'Find anything',
    text: 'Search finds any pair, view or command.',
    keyboard: 'On a keyboard it is Ctrl K, and ? lists every shortcut.',
  },
];

/** The words of the tour, for locale.test.ts. */
export const TOUR_TEXTS = STEPS.flatMap((s) => [s.title, s.text, ...(s.keyboard ? [s.keyboard] : [])]);

const keyboard = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

const visible = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/**
 * A short tour of the terminal on the first visit: three or four places pointed at in turn, with
 * a way out at every step. Done or skipped, it does not come back (Settings can bring it back).
 * It takes over from the old "Getting started" card and uses its key, so nobody who closed that
 * card sees the tour.
 */
export function tourOnce() {
  if (load('welcomed', false)) return;
  // the phone's live feed has no terminal on screen to point at; the tour waits for the terminal
  if (document.body.dataset.phone === 'feed') return;
  const steps = STEPS.filter((s) => visible(document.querySelector(s.target)));
  if (!steps.length) return;

  const ring = document.createElement('div');
  ring.className = 'tour-ring';
  const card = document.createElement('aside');
  card.className = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-live', 'polite');
  document.body.append(ring, card);

  const finish = () => {
    save('welcomed', true);
    ring.remove();
    card.remove();
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place);
    layout.disconnect();
  };

  let index = 0;
  // the tour starts before the market arrives; when the rows come in, the panels grow and the one
  // being shown can slide off a phone's screen. Bring it back, unless the visitor scrolled by hand.
  let handScrolled = false;
  const byHand = () => (handScrolled = true);
  window.addEventListener('wheel', byHand, { passive: true });
  window.addEventListener('touchmove', byHand, { passive: true });
  function bring() {
    const target = document.querySelector(steps[index].target) as HTMLElement;
    const r = target.getBoundingClientRect();
    if (!handScrolled && (r.top < 0 || r.bottom > window.innerHeight)) {
      target.scrollIntoView({ block: r.height > window.innerHeight * 0.7 ? 'start' : 'center' });
    }
    place();
  }
  const layout = new ResizeObserver(bring);
  layout.observe(document.body);

  function place() {
    const target = document.querySelector(steps[index].target) as HTMLElement;
    const r = target.getBoundingClientRect();
    const pad = 4;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const width = Math.min(320, window.innerWidth - 24);
    card.style.width = `${width}px`;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, r.left));
    const room = window.innerHeight - r.bottom;
    const top = room > card.offsetHeight + 24 ? r.bottom + 12 : Math.max(12, Math.min(r.top - card.offsetHeight - 12, window.innerHeight - card.offsetHeight - 12));
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  }

  function render() {
    const step = steps[index];
    const last = index === steps.length - 1;
    card.innerHTML = `<p class="tour-count">${t('{n} of {total}', { n: index + 1, total: steps.length })}</p>
      <h2>${t(step.title)}</h2><p>${t(step.text)}${step.keyboard && keyboard ? ` ${t(step.keyboard)}` : ''}</p>
      <div class="tour-actions"><button type="button" class="btn ghost" data-act="skip">${t('Skip')}</button>
      <button type="button" class="btn primary" data-act="next">${last ? t('Got it') : t('Next')}</button></div>`;
    // on a phone the panels are stacked: bring the one being shown into view first
    handScrolled = false;
    bring();
    (card.querySelector('[data-act="next"]') as HTMLElement).focus({ preventScroll: true });
  }

  card.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'skip') finish();
    if (act === 'next') {
      if (index === steps.length - 1) finish();
      else {
        index++;
        render();
      }
    }
  });
  card.addEventListener('keydown', (e) => e.key === 'Escape' && finish());
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  render();
}

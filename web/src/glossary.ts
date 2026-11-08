import { t } from './i18n';
import type { SignalType, TapeKind } from './types';

/**
 * Words a newcomer meets in the terminal, explained in a sentence each. An element with
 * `data-term="funding"` gets its explanation on hover with a mouse and on a tap on a phone.
 * The keys of the dictionary are these English texts; locale.test.ts checks the Russian.
 */
export const TERMS = {
  funding: 'Funding: a payment between longs and shorts every few hours that keeps the futures price near the spot price. Positive means longs pay shorts.',
  oi: 'Open interest: the total size of open futures positions. When it rises, new money is coming into the pair; it does not say on which side.',
  wall: 'A wall: a resting order in the order book many times larger than the levels around it. It may hold the price for a while, or be pulled.',
  liquidation: 'A liquidation: the exchange closes a position that ran out of margin. Waves of them come with sharp moves.',
  surge: 'Volume surge: trading in the last five minutes against this pair\'s hourly pace. 3× is three times as busy as usual.',
  natr: 'NATR: the average range of one candle in percent of the price. How widely this pair usually swings.',
} as const;

export type Term = keyof typeof TERMS;

/**
 * One line for the live feed: what an event is, never where the price goes next. After a pump,
 * dump, volume or open interest signal the next hour is wider than usual (research/), and that is
 * all that is said about it.
 */
export function meaning(kind: SignalType | TapeKind | 'LIQUIDATION'): string {
  switch (kind) {
    case 'PUMP':
    case 'PUMP_1M':
    case 'PUMP_5M':
    case 'DUMP':
    case 'DUMP_1M':
    case 'DUMP_5M':
      return t('A sharp move in minutes. The hour after one is usually livelier than an ordinary hour, either way.');
    case 'VOLUME':
      return t('Far busier trading than this pair\'s usual pace: the market woke up here.');
    case 'OPEN_INTEREST':
    case 'OI_UP':
    case 'OI_DOWN':
      return t('Open positions grew or shrank fast: money is coming into this pair or leaving it.');
    case 'FUNDING':
      return t('One side pays the other unusually much to keep its positions open.');
    case 'LIQUIDATIONS':
    case 'LIQ_LONGS':
    case 'LIQ_SHORTS':
    case 'LIQUIDATION':
      return t('Positions were closed by force: those traders ran out of margin.');
    case 'WALL':
      return t('The price came close to a large resting order in the book.');
  }
}

let tip: HTMLElement | null = null;
let owner: HTMLElement | null = null;

function hide() {
  tip?.remove();
  tip = null;
  owner = null;
}

function showFor(el: HTMLElement) {
  const term = el.dataset.term as Term;
  if (!(term in TERMS)) return;
  if (owner === el) return;
  hide();
  owner = el;
  tip = document.createElement('div');
  tip.className = 'term-tip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = t(TERMS[term]);
  document.body.append(tip);
  const r = el.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 16);
  tip.style.width = `${width}px`;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2));
  // below the word, or above it near the bottom of the screen; fixed, so nothing on the page moves
  const below = r.bottom + 8 + tip.offsetHeight < window.innerHeight;
  tip.style.left = `${left}px`;
  tip.style.top = `${below ? r.bottom + 8 : r.top - 8 - tip.offsetHeight}px`;
}

/** Explanations for every `[data-term]` under `root`, now and later (delegated). */
export function mountGlossary(root: HTMLElement | Document = document) {
  root.addEventListener('pointerover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
    if (el && (e as PointerEvent).pointerType === 'mouse') showFor(el);
  });
  root.addEventListener('pointerout', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
    if (el && (e as PointerEvent).pointerType === 'mouse' && !el.contains((e as PointerEvent).relatedTarget as Node)) hide();
  });
  // a tap shows it (a sortable header still sorts), a tap anywhere else puts it away
  root.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
    if (el) showFor(el);
    else hide();
  });
  root.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-term]');
    if (el) showFor(el);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide());
  window.addEventListener('scroll', hide, { passive: true, capture: true });
}

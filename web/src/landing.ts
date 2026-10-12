import '@fontsource-variable/unbounded';
import '@fontsource-variable/onest';
import './theme.css';
import './landing.css';

import { age, base, pct, px, tone, usd } from './format';
import { localize, mountLangSwitch, t } from './i18n';
import { STANDALONE, setupBoard, startFeed } from './api';
import { Market } from './market';
import type { VoxelPlanet } from './planet';
import { alertRow, tapeLabel, tapeRow } from './tape';
import type { SetupBoard } from './types';

localize();
mountLangSwitch(document.getElementById('lang')!);
// sections wait out of sight only when there is a script to bring them in (see .reveal)
document.documentElement.classList.add('js');

const $ = (id: string) => document.getElementById(id)!;
const market = new Market();

// The hero planet is three.js, by far the heaviest thing on the page. It loads after the text
// and the live numbers are already on screen; without WebGL a static disc stands in for it.
let planet: VoxelPlanet | null = null;
const canvas = $('planet') as HTMLCanvasElement;
const hasWebgl = (() => {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') ?? probe.getContext('webgl'));
  } catch {
    return false;
  }
})();
const withoutPlanet = () => document.body.classList.add('static');
if (hasWebgl) {
  const tip = $('planet-tip');
  const layer = $('planet-layer');
  void import('./planet')
    .then(({ VoxelPlanet }) => {
      planet = new VoxelPlanet(canvas, {
        layer,
        onHover: (coin, x, y) => {
          if (!coin) {
            tip.hidden = true;
            return;
          }
          tip.innerHTML = `<b>${base(coin.symbol)}</b>${px(coin.price)} <span class="${tone(coin.ch24h)}">${pct(coin.ch24h)}</span> <span class="mute">${usd(coin.vol24h)}</span>`;
          // keep the note on the side of the pointer that has room for it
          const left = x > layer.clientWidth - 260;
          tip.style.transform = `translate3d(${x + (left ? -14 : 14)}px, ${y + 14}px, 0) translateX(${left ? '-100%' : '0'})`;
          tip.hidden = false;
        },
        onPick: (coin) => (location.href = `app/#screener:${coin.symbol}`),
      });
      refreshPlanet();
      stage();
    })
    .catch(withoutPlanet);
} else {
  withoutPlanet();
}

/**
 * The page is one shot of the planet, and scrolling directs it. Each section names what the
 * planet does while that section is on screen: the hero and the ending see only its top, lit from
 * behind like an eclipse; the demos have it beside them in daylight; for the screener it unrolls
 * into a flat field; behind the feature list it steps back and dims. A section taller than the
 * screen holds its view for as long as it fills the screen, and between sections the views are
 * blended, so the planet travels with the scroll.
 */
type View = { x: number; y: number; r: number; glow: number; flat: number; dawn: number };
const stops = [...document.querySelectorAll<HTMLElement>('[data-planet]')];
const scene = $('scene');

/** `held` runs from 0 to 1 while a tall section stays on screen. */
function viewOf(kind: string, w: number, h: number, held: number): View {
  const wide = w >= 900;
  if (kind === 'horizon' || kind === 'ending') {
    // only the top of the planet is on screen; the ending shows less of it, to leave the words alone
    const r = Math.max(0.62 * w, 0.7 * h);
    const sunk = kind === 'ending' ? 0.74 : wide ? 0.66 : 0.36;
    return { x: w / 2, y: h + r * sunk, r, glow: 1, flat: 0, dawn: 1 };
  }
  if (kind === 'field') {
    // the camera keeps closing in while the field is on screen, so the scene never stands still
    const r = (wide ? Math.min(w * 0.17, h * 0.26) : w * 0.27) * (1 + held * 0.16);
    return { x: w / 2, y: h * (wide ? 0.68 : 0.7), r, glow: 1, flat: 1, dawn: 0 };
  }
  if (kind === 'back' || !wide) return { x: w / 2, y: h / 2, r: wide ? h * 0.4 : w * 0.46, glow: wide ? 0.16 : 0.2, flat: 0, dawn: 0.5 };
  return { x: w * (kind === 'right' ? 0.74 : 0.26), y: h * 0.52, r: Math.min(h * 0.3, w * 0.2), glow: 1, flat: 0, dawn: 0 };
}

function stage() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const middle = window.scrollY + h / 2;
  // where the middle of the screen is while a section holds the view: one point for a section
  // no taller than the screen, a stretch for a taller one
  const marks = stops.map((el, i) => {
    // the hero's mark is the middle of the first screen, so the page opens exactly on its view
    if (i === 0) return { from: h / 2, to: h / 2 };
    const top = el.getBoundingClientRect().top + window.scrollY;
    const half = Math.min(h, el.offsetHeight) / 2;
    return { from: top + half, to: top + el.offsetHeight - half };
  });
  let i = 0;
  while (i < stops.length - 1 && middle >= marks[i + 1].from) i++;
  const span = marks[i].to - marks[i].from;
  const held = span > 0 ? Math.min(1, (middle - marks[i].from) / span) : 1;
  let view = viewOf(stops[i].dataset.planet!, w, h, Math.max(0, held));
  if (middle > marks[i].to && i < stops.length - 1) {
    const to = viewOf(stops[i + 1].dataset.planet!, w, h, 0);
    const raw = Math.min(1, (middle - marks[i].to) / (marks[i + 1].from - marks[i].to));
    const k = raw * raw * (3 - 2 * raw);
    const from = view;
    const mix = (key: keyof View) => from[key] + (to[key] - from[key]) * k;
    view = { x: mix('x'), y: mix('y'), r: mix('r'), glow: mix('glow'), flat: mix('flat'), dawn: mix('dawn') };
  }
  planet?.setView(view.x, view.y, view.r);
  planet?.setMood(view.flat, view.dawn);
  scene.style.opacity = view.glow.toFixed(3);
  const root = document.documentElement.style;
  // how far the first screen has been scrolled away, for the headline that parts as it leaves
  root.setProperty('--away', Math.min(1, window.scrollY / h).toFixed(4));
  root.setProperty('--page', Math.min(1, window.scrollY / Math.max(1, document.documentElement.scrollHeight - h)).toFixed(4));
}
let staged = 0;
const restage = () => {
  cancelAnimationFrame(staged);
  staged = requestAnimationFrame(stage);
};
window.addEventListener('scroll', restage, { passive: true });
window.addEventListener('resize', restage);
stage();

// each block is brought in once, the first time a fifth of it is on screen
const arrivals = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      arrivals.unobserve(entry.target);
    }
  },
  { threshold: 0.2 },
);
document.querySelectorAll('.reveal').forEach((el) => arrivals.observe(el));

// what the tape reports also happens on the planet, a few events at a time so it stays readable
market.newTape.on((items) => {
  items.slice(0, 3).forEach((item) => {
    const { label, value, tone: mood } = tapeLabel(item);
    planet?.pulse(item.symbol, `<b>${base(item.symbol)}</b>${label} <span class="${mood}">${value}</span>`, mood);
  });
});

const refreshPlanet = () => planet?.setCoins([...market.rows.values()]);
market.snapshot.on(refreshPlanet);
setInterval(refreshPlanet, 5_000);

/** The strip under the hero: the most traded pairs, running. Built once, then only numbers change. */
const tickerCells = new Map<string, HTMLElement[]>();
let tickerShown = new Map<string, string>();
function renderTicker() {
  const track = $('ticker-track');
  if (!tickerCells.size) {
    const top = [...market.rows.values()].sort((a, b) => b.vol24h - a.vol24h).slice(0, 24);
    if (!top.length) return;
    const item = (symbol: string) =>
      `<a href="app/#screener:${symbol}" data-sym="${symbol}"><b>${base(symbol)}</b><span class="p"></span><span class="c"></span></a>`;
    // a short market is repeated until one run is wider than any screen
    const run = top.map((r) => item(r.symbol)).join('').repeat(Math.ceil(24 / top.length));
    // two runs in a row: the track slides by exactly one of them and starts over unseen
    track.innerHTML = `<div>${run}</div><div aria-hidden="true">${run.replaceAll('<a ', '<a tabindex="-1" ')}</div>`;
    track.querySelectorAll<HTMLElement>('a').forEach((a) => {
      const cells = tickerCells.get(a.dataset.sym!) ?? [];
      cells.push(a);
      tickerCells.set(a.dataset.sym!, cells);
    });
    $('ticker').classList.add('on');
  }
  const shown = new Map<string, string>();
  for (const [symbol, cells] of tickerCells) {
    const row = market.rows.get(symbol);
    if (!row) continue;
    const price = px(row.price);
    const change = pct(row.ch24h);
    shown.set(symbol, price + change);
    if (tickerShown.get(symbol) === price + change) continue;
    for (const cell of cells) {
      cell.querySelector('.p')!.textContent = price;
      const mark = cell.querySelector<HTMLElement>('.c')!;
      mark.textContent = change;
      mark.className = `c ${tone(row.ch24h)}`;
    }
  }
  tickerShown = shown;
}
market.snapshot.on(renderTicker);
setInterval(renderTicker, 2_000);

function renderStats() {
  $('s-pairs').textContent = market.rows.size ? String(market.rows.size) : '–';
  $('s-books').textContent = market.coverage.size ? String(market.coverage.size) : t('syncing');
  const minute = market.tape.filter((t) => t.time > Date.now() - 60_000).length;
  $('s-tape').textContent = String(minute);
  $('tape-rate').textContent = t('{n} / min', { n: minute });
  const since = Date.now() - 5 * 60_000;
  const liquidated = market.liquidations.filter((l) => l.time >= since).reduce((sum, l) => sum + l.price * l.quantity, 0);
  $('s-liq').textContent = usd(liquidated);
}
setInterval(renderStats, 1_000);
market.snapshot.on(renderStats);

/** As many rows as the frame is tall (see .live-tape in landing.css). */
const TAPE_ROWS = 11;

function renderTape(fresh: Set<string> = new Set()) {
  const rows = [
    ...market.tape.map((t) => ({ time: t.time, key: `${t.time}:${t.symbol}:${t.kind}`, html: tapeRow(t) })),
    ...market.signals.map((s) => ({ time: s.time, key: `s${s.id}`, html: alertRow(s) })),
  ]
    .sort((a, b) => b.time - a.time)
    .slice(0, TAPE_ROWS);
  if (!rows.length) return;
  $('tape-preview').innerHTML = rows
    .map((r) => (fresh.has(r.key) ? r.html.replace('class="tape-row', 'class="tape-row enter') : r.html))
    .join('');
}
market.newTape.on((items) => renderTape(new Set(items.map((t) => `${t.time}:${t.symbol}:${t.kind}`))));
market.newSignals.on((items) => renderTape(new Set(items.map((s) => `s${s.id}`))));

function renderWalls() {
  const walls = market.walls
    .filter((w) => Math.abs(w.distance) <= 1)
    .sort((a, b) => b.size - a.size)
    .slice(0, 7);
  if (!walls.length) return;
  const max = walls[0].size;
  $('walls-preview').innerHTML = `<tbody>${walls
    .map(
      (w) => `<tr>
        <td>${base(w.symbol)}</td>
        <td class="${w.side === 'BID' ? 'up' : 'down'}">${w.side === 'BID' ? t('Bid') : t('Ask')}</td>
        <td class="r">${usd(w.size)}</td>
        <td class="barcell"><span class="bar" style="width:${Math.max(3, (w.size / max) * 100).toFixed(0)}%;background:var(--${w.side === 'BID' ? 'up' : 'down'})"></span></td>
        <td class="r hot">${pct(w.distance, 2)}</td>
        <td class="r mute">${age(w.age)}</td>
      </tr>`,
    )
    .join('')}</tbody>`;
}
market.wallsUpdated.on(renderWalls);

/** Feature cell: every wall within 2% as a tick, bids left of the price line, asks right. */
function renderWallStrip() {
  const walls = market.walls.filter((w) => Math.abs(w.distance) <= 2);
  const max = Math.max(1, ...walls.map((w) => w.size));
  const x = (d: number) => 150 + (d / 2) * 145;
  $('wall-strip').innerHTML =
    '<line class="axis" x1="0" x2="300" y1="56" y2="56"/><line class="price" x1="150" x2="150" y1="0" y2="64"/>' +
    walls
      .map((w) => {
        const h = 6 + Math.sqrt(w.size / max) * 44;
        return `<rect x="${x(w.distance).toFixed(1)}" y="${(56 - h).toFixed(1)}" width="2" height="${h.toFixed(1)}" fill="var(--${w.side === 'BID' ? 'up' : 'down'})" opacity="${Math.min(1, 0.35 + w.age / 600).toFixed(2)}"/>`;
      })
      .join('');
}
market.wallsUpdated.on(renderWallStrip);

/** Feature cell: the latest tape badges, as a taste of what the detectors call out. */
function renderChips() {
  $('signal-chips').innerHTML = market.tape
    .slice(0, 8)
    .map((t) => {
      const row = tapeRow(t);
      const badge = row.match(/<span class="badge[^>]*>[^<]*<\/span>/)?.[0] ?? '';
      return badge.replace('</span>', ` ${base(t.symbol)}</span>`);
    })
    .join('');
}
market.newTape.on(renderChips);

function renderMovers() {
  const movers = [...market.rows.values()]
    .filter((r) => r.ch5m !== null && r.vol24h > 20_000_000)
    .sort((a, b) => Math.abs(b.ch5m!) - Math.abs(a.ch5m!))
    .slice(0, 5);
  if (!movers.length) return;
  ($('movers-preview') as HTMLTableElement).tBodies[0].innerHTML = movers
    .map(
      (r) => `<tr><td>${base(r.symbol)}</td><td class="r">${px(r.price)}</td><td class="r ${tone(r.ch5m)}">${pct(r.ch5m)} ${t('5m')}</td><td class="r mute">${usd(r.vol24h)}</td></tr>`,
    )
    .join('');
}
market.snapshot.on(renderMovers);
setInterval(renderMovers, 3_000);

/**
 * The setups the server is following right now and how the finished ones ended. Open trades are
 * priced from the live market, in R: 1R is the distance from the entry to the stop.
 */
let board: SetupBoard | null = null;
function renderSetups() {
  if (!board) return;
  const closed = board.stats.reduce((sum, s) => sum + s.trades, 0);
  const wins = board.stats.reduce((sum, s) => sum + s.wins, 0);
  const net = board.stats.reduce((sum, s) => sum + s.netR, 0);
  $('su-stats').hidden = closed === 0;
  $('su-n').textContent = String(closed);
  $('su-win').textContent = closed ? `${Math.round((wins / closed) * 100)}%` : '';
  $('su-net').textContent = inR(net, 1);
  $('su-net').className = tone(net);
  $('su-since').textContent = board.open.length ? t('Open now: {n}', { n: board.open.length }) : '';
  $('su-note').hidden = closed > 0 || board.open.length > 0;
  ($('su-open') as HTMLTableElement).tBodies[0].innerHTML = board.open
    .slice(0, 4)
    .map((s) => {
      const price = market.rows.get(s.symbol)?.price;
      const live = price === undefined ? null : (s.direction * (price - s.entry)) / Math.abs(s.entry - s.stop);
      return `<tr><td>${base(s.symbol)}</td><td class="${s.direction > 0 ? 'up' : 'down'}">${s.direction > 0 ? t('long') : t('short')}</td><td class="mute">${s.timeframe}</td><td class="r">${px(s.entry)}</td><td class="r ${tone(live)}">${live === null ? '' : inR(live, 2)}</td></tr>`;
    })
    .join('');
}
const inR = (value: number, digits: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}R`;
if (STANDALONE) {
  $('su-note').textContent = t('The journal is kept by the Pulse server; this demo runs without one.');
} else {
  const loadSetups = () =>
    setupBoard()
      .then((next) => {
        board = next;
        renderSetups();
      })
      .catch(() => undefined);
  void loadSetups();
  setInterval(loadSetups, 30_000);
  setInterval(renderSetups, 3_000);
}

void startFeed(market).catch(() => undefined);

import '@fontsource/chakra-petch/400.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import '@fontsource/azeret-mono/400.css';
import '@fontsource/azeret-mono/500.css';
// Chakra Petch has no Cyrillic; the files are split by unicode range, so only Russian pages fetch this
import '@fontsource-variable/tektur';
import './theme.css';
import './landing.css';

import { age, base, pct, px, tone, usd } from './format';
import { localize, mountLangSwitch, t } from './i18n';
import { startFeed } from './api';
import { Market } from './market';
import type { VoxelPlanet } from './planet';
import { alertRow, tapeLabel, tapeRow } from './tape';

localize();
mountLangSwitch(document.getElementById('lang')!);

const $ = (id: string) => document.getElementById(id)!;
const market = new Market();

// The hero planet is three.js, by far the heaviest thing on the page. It loads after the text
// and the live numbers are already on screen; without WebGL a static disc stands in for it.
const wrap = $('planet-anchor');
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
const withoutPlanet = () => document.querySelector('.hero')!.classList.add('static');
if (hasWebgl) {
  const tip = $('planet-tip');
  const layer = $('planet-layer');
  void import('./planet')
    .then(({ VoxelPlanet }) => {
      planet = new VoxelPlanet(canvas, {
        anchor: wrap,
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
    })
    .catch(withoutPlanet);
} else {
  withoutPlanet();
}

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
  ($('movers-preview') as HTMLTableElement).tBodies[0].innerHTML = movers
    .map(
      (r) => `<tr><td>${base(r.symbol)}</td><td class="r">${px(r.price)}</td><td class="r ${tone(r.ch5m)}">${pct(r.ch5m)} ${t('5m')}</td><td class="r mute">${usd(r.vol24h)}</td></tr>`,
    )
    .join('');
}
market.snapshot.on(renderMovers);
setInterval(renderMovers, 3_000);

void startFeed(market).catch(() => undefined);

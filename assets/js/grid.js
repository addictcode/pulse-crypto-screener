// Режим «Графики»: сетка из 12 живых свечных графиков.
// Каждая ячейка грузит реальную историю (180 свечей) с биржи, поддерживает
// зум/скролл, все таймфреймы и живёт: последний бар обновляется ценой из
// стора, раз в 15 секунд хвост дотягивается REST'ом.

import { store } from './store.js';
import { LS } from './config.js';
import * as U from './util.js';

const CELLS = 12;
const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TF_RU = { '1m': '1м', '5m': '5м', '15m': '15м', '1h': '1ч', '4h': '4ч', '1d': '1д' };

let A = null, cells = null, page = 0, onSelect = () => {}, isActive = () => false;
let gtf = LS.get('gtf2', '5m');
const cache = new Map(); // 'sym|tf' -> {bars, ts}
const tzOff = () => new Date().getTimezoneOffset() * 60;

export function priceFmtFor(p) {
  if (p >= 1000) return { type: 'price', precision: 1, minMove: 0.1 };
  if (p >= 100) return { type: 'price', precision: 2, minMove: 0.01 };
  if (p >= 1) return { type: 'price', precision: 4, minMove: 0.0001 };
  if (p >= 0.01) return { type: 'price', precision: 6, minMove: 0.000001 };
  return { type: 'price', precision: 8, minMove: 0.00000001 };
}

export function initGrid(opts) {
  onSelect = opts.onSelect;
  A = opts.adapter;
  isActive = opts.isActive || (() => true);
  U.$('#gprev').onclick = () => { if (page > 0) page--; };
  U.$('#gnext').onclick = () => { page++; };
  const tfBox = U.$('#gtfs');
  tfBox.innerHTML = '';
  for (const t of TFS) {
    const b = U.el('button', 'tf' + (t === gtf ? ' on' : ''), TF_RU[t]);
    b.dataset.tf = t;
    b.onclick = () => {
      gtf = t;
      LS.set('gtf2', t);
      tfBox.querySelectorAll('.tf').forEach(x => x.classList.toggle('on', x.dataset.tf === t));
    };
    tfBox.appendChild(b);
  }
  setInterval(refreshTails, 15000);
}

function build() {
  const root = U.$('#gridcells');
  cells = [];
  for (let i = 0; i < CELLS; i++) {
    const box = U.el('div', 'gcell');
    const head = U.el('div', 'ghead');
    const hSym = U.el('b', '', '—');
    const hPrice = U.el('span', 'gprice', '');
    const hPct = U.el('span', 'gpct', '');
    head.append(hSym, hPrice, hPct);
    head.title = 'Открыть большой график';
    const chartEl = U.el('div', 'gchart');
    box.append(head, chartEl);
    root.appendChild(box);
    const chart = LightweightCharts.createChart(chartEl, {
      width: chartEl.clientWidth || 320,
      height: chartEl.clientHeight || 220,
      layout: { background: { color: 'transparent' }, textColor: '#5d6b85', fontSize: 10, fontFamily: "'Inter', sans-serif", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,.03)' } },
      timeScale: { visible: true, timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,.06)', rightOffset: 2 },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.12 } },
      crosshair: { mode: 0 },
      handleScroll: true,
      handleScale: true,
    });
    const series = chart.addCandlestickSeries({
      upColor: '#2ebd85', downColor: '#f6465d',
      wickUpColor: '#2ebd85', wickDownColor: '#f6465d', borderVisible: false,
      priceLineVisible: true, priceLineColor: 'rgba(255,255,255,.25)',
    });
    const cell = { box, hSym, hPrice, hPct, chart, series, chartEl, sym: null, loaded: null, bars: null, token: 0 };
    head.onclick = () => { if (cell.sym) onSelect(cell.sym); };
    chartEl.ondblclick = () => { if (cell.sym) onSelect(cell.sym); };
    cells.push(cell);
  }
}

async function loadCell(cell, sym, tf) {
  const my = ++cell.token;
  const key = sym + '|' + tf;
  let entry = cache.get(key);
  if (!entry || Date.now() - entry.ts > 45000) {
    try {
      const ks = await A.fetchKlines(sym, tf, 180);
      const off = tzOff();
      entry = { bars: ks.map(k => ({ t: k.t / 1000 - off, o: k.o, h: k.h, l: k.l, c: k.c })), ts: Date.now() };
      cache.set(key, entry);
      if (cache.size > 120) cache.delete(cache.keys().next().value);
    } catch { cell.want = null; return; }
  }
  if (my !== cell.token || !entry.bars.length) return;
  cell.bars = entry.bars;
  cell.loaded = key;
  cell.series.applyOptions({ priceFormat: priceFmtFor(entry.bars[entry.bars.length - 1].c) });
  cell.series.setData(entry.bars.map(b => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c })));
  cell.chart.priceScale('right').applyOptions({ autoScale: true });
  cell.chart.timeScale().fitContent();
}

// раз в 15с дотягиваем последние бары видимых ячеек (закрытие баров, высокие ТФ)
async function refreshTails() {
  if (!cells || !isActive()) return;
  for (const cell of cells) {
    if (!cell.loaded || !cell.sym) continue;
    const [sym, tf] = cell.loaded.split('|');
    try {
      const ks = await A.fetchKlines(sym, tf, 3);
      if (cell.loaded !== sym + '|' + tf || !cell.bars) continue;
      const off = tzOff();
      for (const k of ks) {
        const t = k.t / 1000 - off;
        const bar = { t, o: k.o, h: k.h, l: k.l, c: k.c };
        const last = cell.bars[cell.bars.length - 1];
        if (last && t === last.t) cell.bars[cell.bars.length - 1] = bar;
        else if (!last || t > last.t) { cell.bars.push(bar); if (cell.bars.length > 400) cell.bars.shift(); }
        else continue;
        cell.series.update({ time: t, open: bar.o, high: bar.h, low: bar.l, close: bar.c });
      }
      const entry = cache.get(cell.loaded);
      if (entry) entry.ts = Date.now();
    } catch {}
    await U.sleep(250);
  }
}

export function renderGrid(list, tick) {
  if (!cells) build();
  const pages = Math.max(1, Math.ceil(list.length / CELLS));
  if (page >= pages) page = pages - 1;
  U.$('#gpage').textContent = (page + 1) + ' / ' + pages;
  const slice = list.slice(page * CELLS, page * CELLS + CELLS);
  for (let i = 0; i < CELLS; i++) {
    const cell = cells[i], r = slice[i];
    cell.box.style.display = r ? '' : 'none';
    if (!r) { cell.sym = null; cell.loaded = null; continue; }
    // подгоняем размер вручную (без ResizeObserver)
    const cw = cell.chartEl.clientWidth, chh = cell.chartEl.clientHeight;
    if (cw && chh && (cw !== cell.w || chh !== cell.h)) {
      cell.chart.applyOptions({ width: cw, height: chh });
      cell.w = cw; cell.h = chh;
      cell.chart.timeScale().fitContent();
    }
    cell.sym = r.symbol;
    cell.hSym.textContent = r.base;
    cell.hPrice.textContent = U.fmtPrice(r.price);
    cell.hPct.textContent = U.fmtPct(r.pct24);
    cell.hPct.className = 'gpct ' + U.pctCls(r.pct24);
    const key = r.symbol + '|' + gtf;
    if (cell.loaded !== key) {
      if (cell.want !== key) {
        cell.want = key;
        cell.series.setData([]); // не показываем свечи прошлой монеты, пока грузится новая
        loadCell(cell, r.symbol, gtf);
      }
      continue;
    }
    // живое обновление последнего бара ценой из стора
    const b = cell.bars?.[cell.bars.length - 1];
    const p = r.price;
    if (b && p && (p !== b.c || p > b.h || p < b.l)) {
      b.c = p;
      if (p > b.h) b.h = p;
      if (p < b.l) b.l = p;
      cell.series.update({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c });
    }
  }
}

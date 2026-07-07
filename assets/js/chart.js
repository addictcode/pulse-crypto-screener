// Большой график: свечи + объём, live-обновление, инструменты рисования,
// индикаторы, осцилляторные панели, полноэкранный режим

import { store } from './store.js';
import { LS } from './config.js';
import * as U from './util.js';
import { initDraw, registerOverlay, setTool, loadDrawSymbol, clearDrawings, deleteSelected } from './draw.js';
import { LIST as IND_LIST, initIndicators, isOn, toggleInd, setIndData, onLiveBar, renderIndOverlay } from './indicators.js';
import { renderDensityOverlay, densCfg, setDensCfg } from './density.js';
import { priceFmtFor } from './grid.js';

const TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TF_RU = { '1m': '1м', '5m': '5м', '15m': '15м', '1h': '1ч', '4h': '4ч', '1d': '1д' };
const TF_SEC = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 };

let A = null, chart = null, cs = null, vs = null, unsub = null, token = 0;
let tf = LS.get('tf', '5m');
let bars = []; // свечи текущего графика в chart-time

const tzOff = () => new Date().getTimezoneOffset() * 60;

export function initChart(adapter) {
  A = adapter;
  const box = U.$('#chart-main');
  chart = LightweightCharts.createChart(box, {
    width: box.clientWidth || 600,
    height: box.clientHeight || 360,
    layout: { background: { color: 'transparent' }, textColor: '#5d6b85', fontSize: 11, fontFamily: "'Inter', sans-serif", attributionLogo: false },
    grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: 'rgba(255,255,255,.08)', rightOffset: 3 },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.08)', minimumWidth: 72 },
    crosshair: { mode: 0 },
  });
  cs = chart.addCandlestickSeries({
    upColor: '#2ebd85', downColor: '#f6465d',
    wickUpColor: '#2ebd85', wickDownColor: '#f6465d', borderVisible: false,
  });
  vs = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

  initDraw({
    chart, series: cs, wrap: box,
    getBars: () => bars,
    getTfSec: () => TF_SEC[tf],
    getTzOff: tzOff,
    onToolDone: () => setActiveTool(''),
  });
  registerOverlay(renderIndOverlay);
  registerOverlay(renderDensityOverlay);
  initIndicators({ chart, series: cs, panesRoot: U.$('#subpanes') });

  // стены стакана на графике
  const densBtn = U.$('#ch-dens');
  densBtn.classList.toggle('on', densCfg.onChart);
  densBtn.onclick = () => {
    setDensCfg('onChart', !densCfg.onChart);
    densBtn.classList.toggle('on', densCfg.onChart);
  };

  // таймфреймы
  const tfBox = U.$('#tfs');
  for (const t of TFS) {
    const b = U.el('button', 'tf' + (t === tf ? ' on' : ''), TF_RU[t]);
    b.dataset.tf = t;
    b.onclick = () => {
      tf = t;
      LS.set('tf', t);
      tfBox.querySelectorAll('.tf').forEach(x => x.classList.toggle('on', x.dataset.tf === t));
      load();
    };
    tfBox.appendChild(b);
  }

  // инструменты рисования
  for (const b of document.querySelectorAll('#tools button[data-tool]')) {
    b.onclick = () => {
      const t = b.dataset.tool;
      const already = b.classList.contains('on') && t !== '';
      setActiveTool(already ? '' : t);
    };
  }
  U.$('#t-del').onclick = deleteSelected;
  U.$('#t-clear').onclick = clearDrawings;

  // меню индикаторов
  buildIndMenu();
  U.$('#ch-ind').onclick = e => {
    e.stopPropagation();
    U.$('#indmenu').classList.toggle('hidden');
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('#indmenu') && !e.target.closest('#ch-ind')) U.$('#indmenu').classList.add('hidden');
  });

  // развернуть / свернуть
  U.$('#ch-expand').onclick = () => {
    document.body.classList.toggle('chart-max');
    U.$('#ch-expand').textContent = document.body.classList.contains('chart-max') ? '🗗' : '⛶';
  };

  // размером управляем сами (не полагаемся на ResizeObserver — он есть не везде):
  // опрашиваем контейнер, при развороте/сворачивании кадрируем заново
  let lastW = box.clientWidth, lastH = box.clientHeight;
  setInterval(() => {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    if (w !== lastW || h !== lastH) {
      const big = lastW > 0 && Math.abs(w - lastW) / lastW > 0.4;
      chart.applyOptions({ width: w, height: h });
      if (big) resetChartView();
      lastW = w;
      lastH = h;
    }
  }, 400);
}

// стандартное кадрирование: последние N свечей, N зависит от ширины графика
export function resetChartView() {
  if (!chart || !bars.length) return;
  chart.priceScale('right').applyOptions({ autoScale: true });
  const w = chart.timeScale().width() || 300;
  const count = Math.min(bars.length, Math.max(80, Math.round(w / 7)));
  chart.timeScale().setVisibleLogicalRange({ from: bars.length - count, to: bars.length + 4 });
}

function setActiveTool(t) {
  setTool(t || null);
  for (const b of document.querySelectorAll('#tools button[data-tool]')) {
    b.classList.toggle('on', b.dataset.tool === t);
  }
}

function buildIndMenu() {
  const menu = U.$('#indmenu');
  for (const ind of IND_LIST) {
    const lab = document.createElement('label');
    lab.innerHTML = `<input type="checkbox" ${isOn(ind.id) ? 'checked' : ''}><div><b>${ind.name}</b><span>${ind.hint}</span></div>`;
    lab.querySelector('input').onchange = e => toggleInd(ind.id, e.target.checked);
    menu.appendChild(lab);
  }
}

export async function openChart(sym) {
  if (!chart) return;
  store.sel = sym;
  LS.set('sel', sym);
  const base = sym.replace(/USDT$/, '');
  U.$('#ch-sym').textContent = base + ' · USDT Perp';
  const hue = U.hueOf(base);
  const ava = U.$('#ch-ava');
  ava.textContent = base.slice(0, 4);
  ava.style.background = `hsl(${hue} 55% 20%)`;
  ava.style.color = `hsl(${hue} 85% 72%)`;
  await load();
}

async function load() {
  if (!store.sel) return;
  unsub?.();
  unsub = null;
  const my = ++token, sym = store.sel;
  document.body.classList.add('ch-loading');
  try {
    const ks = await A.fetchKlines(sym, tf, 400);
    if (my !== token) return;
    const off = tzOff();
    bars = ks.map(k => ({ t: k.t / 1000 - off, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v, qv: k.qv }));
    cs.applyOptions({ priceFormat: priceFmtFor(bars[bars.length - 1]?.c || 1) });
    const col = k => k.c >= k.o ? 'rgba(46,189,133,.35)' : 'rgba(246,70,93,.35)';
    cs.setData(bars.map(k => ({ time: k.t, open: k.o, high: k.h, low: k.l, close: k.c })));
    vs.setData(bars.map(k => ({ time: k.t, value: k.qv || k.v, color: col(k) })));
    // сброс вида: ручной зум/сдвиг шкал не должен переезжать на новую монету
    resetChartView();
    chart.applyOptions({
      watermark: {
        visible: true, text: sym.replace(/USDT$/, ''),
        color: 'rgba(219,228,243,.05)', fontSize: 54, fontFamily: "'Inter', sans-serif",
        horzAlign: 'center', vertAlign: 'center',
      },
    });
    loadDrawSymbol(sym);
    setIndData(bars);
    unsub = A.subscribeKline(sym, tf, b => {
      if (my !== token) return;
      const t = b.t / 1000 - off;
      const bar = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, qv: b.qv || b.v };
      const last = bars[bars.length - 1];
      if (last && t === last.t) bars[bars.length - 1] = bar;
      else if (!last || t > last.t) bars.push(bar);
      else return;
      cs.update({ time: t, open: b.o, high: b.h, low: b.l, close: b.c });
      vs.update({ time: t, value: bar.qv, color: col(bar) });
      onLiveBar(bars);
    });
  } catch (e) {
    console.warn('chart load failed', e);
  } finally {
    if (my === token) document.body.classList.remove('ch-loading');
  }
}

// обновление шапки графика из общего цикла рендера
export function chartHeadTick() {
  const r = store.sel && store.rows.get(store.sel);
  if (!r) return;
  const p = U.$('#ch-price');
  p.textContent = U.fmtPrice(r.price);
  p.className = 'ch-price ' + U.pctCls(r.pct24);
  const pc = U.$('#ch-pct');
  pc.textContent = U.fmtPct(r.pct24);
  pc.className = 'ch-pct ' + U.pctCls(r.pct24);
  U.$('#ch-meta').textContent =
    `24ч: ${U.fmtPrice(r.low24)} – ${U.fmtPrice(r.high24)}` +
    ` · Фандинг ${r.fundingRate != null ? (r.fundingRate * 100).toFixed(4) + '%' : '—'}` +
    ` · OI ${U.fmtUsd(r.oiValue)}` +
    ` · NATR ${r.natr != null ? r.natr.toFixed(2) + '%' : '—'}` +
    ` · Ликв. 5м ${U.fmtUsd(r.liqL5 + r.liqS5)}`;
}

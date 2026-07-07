// Индикаторы: оверлеи (EMA, BB, VWAP, Supertrend), SMC-разметка на канвасе
// (FVG, Order Blocks, BOS/CHoCH) и осцилляторы в отдельных панелях (RSI, MACD).

import { LS } from './config.js';

export const LIST = [
  { id: 'rsi2', name: '⭐ RSI-2 Стратегия', hint: 'высокий винрейт · вход/тейк/стоп + бектест' },
  { id: 'squeeze', name: '⭐ Squeeze Breakout', hint: 'Боллинджер+Кельтнер+объём · RR 1:4 · бектест' },
  { id: 'lux', name: '⭐ Smart Signals', hint: 'умный трейл + сигналы с силой 1–4 (конфлюенс)' },
  { id: 'hw', name: '⭐ HyperWave + Money Flow', hint: 'осциллятор импульса, поток денег, точки разворота' },
  { id: 'div', name: '⭐ Дивергенции (авто)', hint: 'бычьи/медвежьи расхождения цены и RSI' },
  { id: 'ema', name: 'EMA 20 / 50 / 200', hint: 'скользящие средние' },
  { id: 'bb', name: 'Bollinger Bands (20, 2)', hint: 'полосы волатильности' },
  { id: 'vwap', name: 'VWAP по дням', hint: 'средневзвешенная цена' },
  { id: 'st', name: 'Supertrend (10, 3)', hint: 'тренд и сигналы BUY / SELL' },
  { id: 'fvg', name: 'Fair Value Gaps', hint: 'имбалансы · Smart Money' },
  { id: 'ob', name: 'Order Blocks', hint: 'ордер-блоки · Smart Money' },
  { id: 'ms', name: 'Структура BOS / CHoCH', hint: 'слом структуры · Smart Money' },
  { id: 'rsi', name: 'RSI (14)', hint: 'осциллятор, панель снизу' },
  { id: 'macd', name: 'MACD (12, 26, 9)', hint: 'осциллятор, панель снизу' },
];

let chart, cs, panesRoot;
let enabled = new Set(LS.get('ind', ['ema', 'st']));
let bars = [];
let series = {};   // id -> [series...]
let panes = {};    // id -> {el, chart, s: {...}}
let prims = [];    // канвас-примитивы SMC
let liveT = 0;

export function initIndicators(opts) {
  chart = opts.chart; cs = opts.series; panesRoot = opts.panesRoot;
  chart.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (!r) return;
    for (const id in panes) panes[id].chart.timeScale().setVisibleLogicalRange(r);
  });
  // размер панелей ведём вручную (ResizeObserver есть не во всех окружениях)
  setInterval(() => {
    for (const id in panes) {
      const p = panes[id];
      const w = p.el.clientWidth, h = p.el.clientHeight;
      if (w && h && (w !== p.w || h !== p.h)) {
        p.chart.applyOptions({ width: w, height: h });
        p.w = w; p.h = h;
        const r = chart.timeScale().getVisibleLogicalRange();
        if (r) p.chart.timeScale().setVisibleLogicalRange(r);
      }
    }
  }, 500);
}

export const isOn = id => enabled.has(id);

export function toggleInd(id, on) {
  if (on) enabled.add(id); else { enabled.delete(id); teardown(id); }
  LS.set('ind', [...enabled]);
  recompute();
}

export function setIndData(newBars) {
  bars = newBars;
  recompute();
}

export function onLiveBar(newBars) {
  bars = newBars;
  const now = Date.now();
  if (now - liveT < 1500) return;
  liveT = now;
  recompute();
}

function teardown(id) {
  (series[id] || []).forEach(s => { try { chart.removeSeries(s); } catch {} });
  delete series[id];
  if (panes[id]) { try { panes[id].chart.remove(); } catch {} panes[id].el.remove(); delete panes[id]; }
  if (id === 'st' || id === 'lux' || id === 'rsi2' || id === 'squeeze') cs.setMarkers([]);
  if (id === 'rsi2' || id === 'squeeze') setBt(id, null);
}

// ── математика ──

function ema(src, len) {
  const out = new Array(src.length).fill(null);
  if (src.length < len) return out;
  let s = 0;
  for (let i = 0; i < len; i++) s += src[i];
  out[len - 1] = s / len;
  const k = 2 / (len + 1);
  for (let i = len; i < src.length; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
  return out;
}

function smaStd(src, len) {
  const mid = new Array(src.length).fill(null), sd = new Array(src.length).fill(null);
  let sum = 0, sum2 = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i]; sum2 += src[i] * src[i];
    if (i >= len) { sum -= src[i - len]; sum2 -= src[i - len] * src[i - len]; }
    if (i >= len - 1) {
      const m = sum / len;
      mid[i] = m;
      sd[i] = Math.sqrt(Math.max(0, sum2 / len - m * m));
    }
  }
  return { mid, sd };
}

function atrW(bars, len) {
  const out = new Array(bars.length).fill(null);
  let sum = 0;
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    if (i <= len) { sum += tr; if (i === len) out[i] = sum / len; }
    else out[i] = (out[i - 1] * (len - 1) + tr) / len;
  }
  return out;
}

function rsiW(src, len) {
  const out = new Array(src.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= len) {
      g += up; l += dn;
      if (i === len) { g /= len; l /= len; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    } else {
      g = (g * (len - 1) + up) / len;
      l = (l * (len - 1) + dn) / len;
      out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
    }
  }
  return out;
}

function smaArr(src, len) {
  const out = new Array(src.length).fill(null);
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    sum += src[i];
    if (i >= len) sum -= src[i - len];
    if (i >= len - 1) out[i] = sum / len;
  }
  return out;
}

// EMA по массиву с null-префиксом (результат выравнивается по исходным индексам)
function emaShift(src, len) {
  const first = src.findIndex(v => v != null);
  if (first < 0) return src.slice();
  const tail = ema(src.slice(first), len);
  const out = new Array(src.length).fill(null);
  for (let i = 0; i < tail.length; i++) out[first + i] = tail[i];
  return out;
}

// Money Flow Index по обороту (qv)
function mfiCalc(bars, len) {
  const n = bars.length;
  const out = new Array(n).fill(null);
  const pos = new Array(n).fill(0), neg = new Array(n).fill(0);
  let prevTp = null;
  for (let i = 0; i < n; i++) {
    const tp = (bars[i].h + bars[i].l + bars[i].c) / 3;
    const raw = bars[i].qv || bars[i].v * tp || 0;
    if (prevTp != null) {
      if (tp > prevTp) pos[i] = raw;
      else if (tp < prevTp) neg[i] = raw;
    }
    prevTp = tp;
  }
  let sp = 0, sn = 0;
  for (let i = 0; i < n; i++) {
    sp += pos[i]; sn += neg[i];
    if (i >= len) { sp -= pos[i - len]; sn -= neg[i - len]; }
    if (i >= len) out[i] = sp + sn > 0 ? (100 * sp) / (sp + sn) : 50;
  }
  return out;
}

const lineData = (times, vals) => times.map((t, i) => vals[i] == null ? { time: t } : { time: t, value: vals[i] });

// ── пересчёт ──

export function recompute() {
  if (!chart || bars.length < 30) return;
  prims = [];
  let markers = [];
  const times = bars.map(b => b.t);
  const closes = bars.map(b => b.c);

  if (enabled.has('ema')) {
    const cfg = [[20, '#f0b90b'], [50, '#4f8cff'], [200, '#e754c8']];
    if (!series.ema) series.ema = cfg.map(([len, color]) =>
      chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
    cfg.forEach(([len], i) => series.ema[i].setData(lineData(times, ema(closes, len))));
  }

  if (enabled.has('bb')) {
    const { mid, sd } = smaStd(closes, 20);
    const up = mid.map((m, i) => m == null ? null : m + 2 * sd[i]);
    const dn = mid.map((m, i) => m == null ? null : m - 2 * sd[i]);
    if (!series.bb) series.bb = [
      chart.addLineSeries({ color: 'rgba(120,140,180,.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      chart.addLineSeries({ color: 'rgba(120,140,180,.45)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      chart.addLineSeries({ color: 'rgba(120,140,180,.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    ];
    series.bb[0].setData(lineData(times, up));
    series.bb[1].setData(lineData(times, mid));
    series.bb[2].setData(lineData(times, dn));
  }

  if (enabled.has('vwap')) {
    const off = new Date().getTimezoneOffset() * 60;
    const vals = new Array(bars.length).fill(null);
    let day = null, cumPV = 0, cumV = 0;
    for (let i = 0; i < bars.length; i++) {
      const d = Math.floor((bars[i].t + off) / 86400);
      if (d !== day) { day = d; cumPV = 0; cumV = 0; }
      const tp = (bars[i].h + bars[i].l + bars[i].c) / 3;
      const v = bars[i].v || (bars[i].qv ? bars[i].qv / tp : 0);
      cumPV += tp * v; cumV += v;
      vals[i] = cumV > 0 ? cumPV / cumV : null;
    }
    if (!series.vwap) series.vwap = [chart.addLineSeries({ color: '#ff9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })];
    series.vwap[0].setData(lineData(times, vals));
  }

  if (enabled.has('st')) {
    const len = 10, mult = 3;
    const atr = atrW(bars, len);
    const n = bars.length;
    const stLine = new Array(n).fill(null), dir = new Array(n).fill(1);
    let fub = null, flb = null;
    for (let i = 0; i < n; i++) {
      if (atr[i] == null) continue;
      const hl2 = (bars[i].h + bars[i].l) / 2;
      const ub = hl2 + mult * atr[i], lb = hl2 - mult * atr[i];
      fub = fub == null || ub < fub || bars[i - 1].c > fub ? ub : fub;
      flb = flb == null || lb > flb || bars[i - 1].c < flb ? lb : flb;
      const prev = dir[i - 1] ?? 1;
      dir[i] = prev === 1 ? (bars[i].c < flb ? -1 : 1) : (bars[i].c > fub ? 1 : -1);
      if (dir[i] !== prev && stLine[i - 1] != null) {
        markers.push(dir[i] === 1
          ? { time: times[i], position: 'belowBar', color: '#2ebd85', shape: 'arrowUp', text: 'BUY' }
          : { time: times[i], position: 'aboveBar', color: '#f6465d', shape: 'arrowDown', text: 'SELL' });
      }
      stLine[i] = dir[i] === 1 ? flb : fub;
    }
    const upD = times.map((t, i) => stLine[i] != null && dir[i] === 1 ? { time: t, value: stLine[i] } : { time: t });
    const dnD = times.map((t, i) => stLine[i] != null && dir[i] === -1 ? { time: t, value: stLine[i] } : { time: t });
    if (!series.st) series.st = [
      chart.addLineSeries({ color: '#2ebd85', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      chart.addLineSeries({ color: '#f6465d', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    ];
    series.st[0].setData(upD);
    series.st[1].setData(dnD);
  }

  // ⭐ Smart Signals: ATR-трейл по сглаженной цене + сигналы с оценкой силы 1–4
  if (enabled.has('lux')) {
    const n = bars.length;
    const atr = atrW(bars, 14);
    const src = ema(closes, 3);
    const e200 = ema(closes, 200);
    const r14 = rsiW(closes, 14);
    const volAvg = smaArr(bars.map(b => b.qv || 0), 20);
    const trail = new Array(n).fill(null), dir = new Array(n).fill(1);
    for (let i = 0; i < n; i++) {
      if (atr[i] == null || src[i] == null) continue;
      const m = 3.2 * atr[i];
      const prev = trail[i - 1];
      if (prev == null) { trail[i] = src[i] - m; dir[i] = 1; continue; }
      let d = dir[i - 1];
      if (d === 1) {
        trail[i] = Math.max(prev, src[i] - m);
        if (closes[i] < trail[i]) { d = -1; trail[i] = src[i] + m; }
      } else {
        trail[i] = Math.min(prev, src[i] + m);
        if (closes[i] > trail[i]) { d = 1; trail[i] = src[i] - m; }
      }
      dir[i] = d;
      if (d !== dir[i - 1] && prev != null) {
        // конфлюенс: тренд EMA200, RSI, всплеск объёма
        let s = 1;
        if (e200[i] != null && (d === 1 ? closes[i] > e200[i] : closes[i] < e200[i])) s++;
        if (r14[i] != null && (d === 1 ? r14[i] > 50 : r14[i] < 50)) s++;
        if (volAvg[i] && (bars[i].qv || 0) > volAvg[i] * 1.3) s++;
        const gold = s >= 4;
        markers.push(d === 1
          ? { time: times[i], position: 'belowBar', color: gold ? '#f0b90b' : s === 3 ? '#2ebd85' : 'rgba(46,189,133,.55)', shape: 'arrowUp', text: String(s) }
          : { time: times[i], position: 'aboveBar', color: gold ? '#f0b90b' : s === 3 ? '#f6465d' : 'rgba(246,70,93,.55)', shape: 'arrowDown', text: String(s) });
      }
    }
    const upD = times.map((t, i) => trail[i] != null && dir[i] === 1 ? { time: t, value: trail[i] } : { time: t });
    const dnD = times.map((t, i) => trail[i] != null && dir[i] === -1 ? { time: t, value: trail[i] } : { time: t });
    if (!series.lux) series.lux = [
      chart.addLineSeries({ color: 'rgba(46,189,133,.9)', lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      chart.addLineSeries({ color: 'rgba(246,70,93,.9)', lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    ];
    series.lux[0].setData(upD);
    series.lux[1].setData(dnD);
  }

  // ⭐ Стратегии со входом/тейком/стопом и живым бектестом
  if (enabled.has('rsi2')) computeRSI2(markers); else setBt('rsi2', null);
  if (enabled.has('squeeze')) computeSqueeze(markers); else setBt('squeeze', null);

  markers.sort((a, b) => a.time - b.time);
  cs.setMarkers(markers);

  // ⭐ HyperWave + Money Flow: панель с осциллятором, сигнальной линией и точками разворота
  if (enabled.has('hw')) {
    const p = ensurePane('hw', () => pane => {
      const mf = pane.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
      const wave = pane.addLineSeries({ color: '#4f8cff', lineWidth: 1.6, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const sig = pane.addLineSeries({ color: 'rgba(240,185,11,.8)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      wave.createPriceLine({ price: 60, color: '#3d4761', lineStyle: 3, lineWidth: 1, axisLabelVisible: false });
      wave.createPriceLine({ price: -60, color: '#3d4761', lineStyle: 3, lineWidth: 1, axisLabelVisible: false });
      wave.createPriceLine({ price: 0, color: '#242e47', lineStyle: 3, lineWidth: 1, axisLabelVisible: false });
      return { mf, wave, sig };
    });
    const hw = emaShift(rsiW(closes, 14).map(v => v == null ? null : (v - 50) * 2), 4);
    const sig = emaShift(hw, 6);
    const mf = emaShift(mfiCalc(bars, 14).map(v => v == null ? null : (v - 50) * 2), 3);
    p.s.wave.setData(lineData(times, hw));
    p.s.sig.setData(lineData(times, sig));
    p.s.mf.setData(times.map((t, i) => mf[i] == null ? { time: t } :
      { time: t, value: mf[i], color: mf[i] >= 0 ? 'rgba(46,189,133,.35)' : 'rgba(246,70,93,.35)' }));
    // turning points: кросс волны и сигнальной в зоне перекупленности/перепроданности
    const dots = [];
    for (let i = 1; i < bars.length; i++) {
      if (hw[i] == null || sig[i] == null || hw[i - 1] == null || sig[i - 1] == null) continue;
      if (hw[i - 1] >= sig[i - 1] && hw[i] < sig[i] && hw[i] > 40) {
        dots.push({ time: times[i], position: 'aboveBar', color: hw[i] > 60 ? '#f6465d' : 'rgba(246,70,93,.5)', shape: 'circle', text: '' });
      } else if (hw[i - 1] <= sig[i - 1] && hw[i] > sig[i] && hw[i] < -40) {
        dots.push({ time: times[i], position: 'belowBar', color: hw[i] < -60 ? '#2ebd85' : 'rgba(46,189,133,.5)', shape: 'circle', text: '' });
      }
    }
    p.s.wave.setMarkers(dots);
  }

  if (enabled.has('div')) computeDivergences(closes);

  if (enabled.has('fvg')) computeFVG();
  if (enabled.has('ms') || enabled.has('ob')) computeStructure();

  if (enabled.has('rsi')) {
    const p = ensurePane('rsi', () => {
      const s = p2 => p2.addLineSeries({ color: '#7c5cff', lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      return pane => {
        const line = s(pane);
        line.createPriceLine({ price: 70, color: '#3d4761', lineStyle: 3, lineWidth: 1, axisLabelVisible: false });
        line.createPriceLine({ price: 30, color: '#3d4761', lineStyle: 3, lineWidth: 1, axisLabelVisible: false });
        line.createPriceLine({ price: 50, color: '#242e47', lineStyle: 3, lineWidth: 1, axisLabelVisible: false });
        return { line };
      };
    });
    p.s.line.setData(lineData(times, rsiW(closes, 14)));
  }

  if (enabled.has('macd')) {
    const p = ensurePane('macd', () => pane => ({
      hist: pane.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }),
      macd: pane.addLineSeries({ color: '#4f8cff', lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
      sig: pane.addLineSeries({ color: '#f0b90b', lineWidth: 1.2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }),
    }));
    const e12 = ema(closes, 12), e26 = ema(closes, 26);
    const macd = closes.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
    const valid = macd.map(v => v ?? 0);
    const sigRaw = ema(valid.slice(25), 9);
    const sig = new Array(closes.length).fill(null);
    for (let i = 0; i < sigRaw.length; i++) if (sigRaw[i] != null) sig[i + 25] = sigRaw[i];
    const hist = macd.map((v, i) => v != null && sig[i] != null ? v - sig[i] : null);
    p.s.macd.setData(lineData(times, macd));
    p.s.sig.setData(lineData(times, sig));
    p.s.hist.setData(times.map((t, i) => hist[i] == null ? { time: t } :
      { time: t, value: hist[i], color: hist[i] >= 0 ? 'rgba(46,189,133,.55)' : 'rgba(246,70,93,.55)' }));
  }
}

function ensurePane(id, mkFactory) {
  if (panes[id]) return panes[id];
  const el = document.createElement('div');
  el.className = 'subpane';
  const lbl = document.createElement('span');
  lbl.className = 'subpane-label';
  lbl.textContent = id.toUpperCase();
  el.appendChild(lbl);
  panesRoot.appendChild(el);
  const pc = LightweightCharts.createChart(el, {
    width: el.clientWidth || 400,
    height: el.clientHeight || 92,
    layout: { background: { color: 'transparent' }, textColor: '#5d6b85', fontSize: 10, fontFamily: "'Inter', sans-serif", attributionLogo: false },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,.03)' } },
    timeScale: { visible: false },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.08)', minimumWidth: 72 },
    crosshair: { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
    handleScroll: false,
    handleScale: false,
  });
  const s = mkFactory()(pc);
  panes[id] = { el, chart: pc, s, w: el.clientWidth, h: el.clientHeight };
  const r = chart.timeScale().getVisibleLogicalRange();
  if (r) pc.timeScale().setVisibleLogicalRange(r);
  return panes[id];
}

// ── ⭐ RSI-2 стратегия Ларри Коннорса + встроенный бектест ──
// Правила: тренд-фильтр SMA200, вход при RSI(2) в экстремуме, ATR-стоп и ATR-тейк.
// Бектест честно прогоняет стратегию по всем загруженным свечам и показывает
// реальный винрейт/профит-фактор именно для текущей монеты и таймфрейма.

const RSI2 = { slMult: 2.2, tpMult: 1.4, maxHold: 24, rsiLow: 10, rsiHigh: 90, trendLen: 200 };

function computeRSI2(markers) {
  const n = bars.length;
  const closes = bars.map(b => b.c);
  if (n < RSI2.trendLen + 10) { setBt('rsi2', { tooFew: true }); return; }
  const sma = smaArr(closes, RSI2.trendLen);
  const rsi = rsiW(closes, 2);
  const atr = atrW(bars, 14);
  const { slMult, tpMult, maxHold, rsiLow, rsiHigh } = RSI2;
  const rr = tpMult / slMult;

  const trades = [];
  let pos = null;
  for (let i = 0; i < n; i++) {
    if (sma[i] == null || rsi[i] == null || atr[i] == null || atr[i] <= 0) continue;
    if (!pos) {
      if (closes[i] > sma[i] && rsi[i] < rsiLow) {
        pos = { dir: 1, i, entry: closes[i], sl: closes[i] - slMult * atr[i], tp: closes[i] + tpMult * atr[i] };
      } else if (closes[i] < sma[i] && rsi[i] > rsiHigh) {
        pos = { dir: -1, i, entry: closes[i], sl: closes[i] + slMult * atr[i], tp: closes[i] - tpMult * atr[i] };
      }
      if (pos) markers.push(pos.dir === 1
        ? { time: bars[i].t, position: 'belowBar', color: '#4f8cff', shape: 'arrowUp', text: 'LONG' }
        : { time: bars[i].t, position: 'aboveBar', color: '#e754c8', shape: 'arrowDown', text: 'SHORT' });
    } else if (i > pos.i) {
      let exit = null, win = null;
      if (pos.dir === 1) {
        if (bars[i].l <= pos.sl) { exit = pos.sl; win = false; }
        else if (bars[i].h >= pos.tp) { exit = pos.tp; win = true; }
      } else {
        if (bars[i].h >= pos.sl) { exit = pos.sl; win = false; }
        else if (bars[i].l <= pos.tp) { exit = pos.tp; win = true; }
      }
      if (exit == null && i - pos.i >= maxHold) {
        exit = closes[i];
        win = pos.dir === 1 ? closes[i] >= pos.entry : closes[i] <= pos.entry;
      }
      if (exit != null) { trades.push({ ...pos, exitI: i, win }); pos = null; }
    }
  }
  const active = pos ? { ...pos, exitI: n - 1, open: true } : null;

  // рисуем TP/SL последних сделок (последняя — с подписями)
  const toDraw = trades.slice(-2);
  if (active) toDraw.push(active);
  toDraw.forEach((t, idx) => {
    const last = idx === toDraw.length - 1;
    prims.push({ kind: 'line', i1: t.i, i2: t.exitI, p1: t.entry, p2: t.entry, color: 'rgba(150,160,190,.55)', dash: true });
    prims.push({ kind: 'line', i1: t.i, i2: t.exitI, p1: t.tp, p2: t.tp, color: last ? 'rgba(46,189,133,.95)' : 'rgba(46,189,133,.4)' });
    prims.push({ kind: 'line', i1: t.i, i2: t.exitI, p1: t.sl, p2: t.sl, color: last ? 'rgba(246,70,93,.95)' : 'rgba(246,70,93,.4)' });
    if (last) {
      prims.push({ kind: 'label', i: t.exitI, p: t.tp, text: 'TP ' + fmtPr(t.tp), color: '#2ebd85', above: true });
      prims.push({ kind: 'label', i: t.exitI, p: t.sl, text: 'SL ' + fmtPr(t.sl), color: '#f6465d', above: false });
      prims.push({ kind: 'label', i: t.i, p: t.entry, text: (t.dir === 1 ? 'LONG ' : 'SHORT ') + fmtPr(t.entry), color: '#aab4cc', above: t.dir !== 1 });
    }
  });

  const wins = trades.filter(t => t.win).length;
  setBt('rsi2', statsOf(trades, active, tpMult, slMult));
}

// общий симулятор выходов TP/SL/тайм-аут для сделок, помеченных входами
// entries: [{dir, i, entry}], возвращает {trades, active}
function simulateTrades(entries, slMult, tpMult, maxHold, atr) {
  const n = bars.length, closes = bars.map(b => b.c);
  const trades = [];
  let active = null;
  for (const e of entries) {
    if (atr[e.i] == null || atr[e.i] <= 0) continue;
    const sl = e.dir === 1 ? e.entry - slMult * atr[e.i] : e.entry + slMult * atr[e.i];
    const tp = e.dir === 1 ? e.entry + tpMult * atr[e.i] : e.entry - tpMult * atr[e.i];
    let exitI = null, win = null;
    for (let i = e.i + 1; i < n; i++) {
      if (e.dir === 1) {
        if (bars[i].l <= sl) { exitI = i; win = false; break; }
        if (bars[i].h >= tp) { exitI = i; win = true; break; }
      } else {
        if (bars[i].h >= sl) { exitI = i; win = false; break; }
        if (bars[i].l <= tp) { exitI = i; win = true; break; }
      }
      if (i - e.i >= maxHold) { exitI = i; win = e.dir === 1 ? closes[i] >= e.entry : closes[i] <= e.entry; break; }
    }
    const t = { ...e, sl, tp, exitI: exitI == null ? n - 1 : exitI, win, open: exitI == null };
    if (exitI == null) active = t; else trades.push(t);
  }
  return { trades, active };
}

// отрисовка TP/SL последних сделок (последняя — с подписями)
function drawTrades(trades, active) {
  const toDraw = trades.slice(-2);
  if (active) toDraw.push(active);
  toDraw.forEach((t, idx) => {
    const last = idx === toDraw.length - 1;
    prims.push({ kind: 'line', i1: t.i, i2: t.exitI, p1: t.entry, p2: t.entry, color: 'rgba(150,160,190,.55)', dash: true });
    prims.push({ kind: 'line', i1: t.i, i2: t.exitI, p1: t.tp, p2: t.tp, color: last ? 'rgba(46,189,133,.95)' : 'rgba(46,189,133,.4)' });
    prims.push({ kind: 'line', i1: t.i, i2: t.exitI, p1: t.sl, p2: t.sl, color: last ? 'rgba(246,70,93,.95)' : 'rgba(246,70,93,.4)' });
    if (last) {
      prims.push({ kind: 'label', i: t.exitI, p: t.tp, text: 'TP ' + fmtPr(t.tp), color: '#2ebd85', above: true });
      prims.push({ kind: 'label', i: t.exitI, p: t.sl, text: 'SL ' + fmtPr(t.sl), color: '#f6465d', above: false });
      prims.push({ kind: 'label', i: t.i, p: t.entry, text: (t.dir === 1 ? 'LONG ' : 'SHORT ') + fmtPr(t.entry), color: '#aab4cc', above: t.dir !== 1 });
    }
  });
}

function statsOf(trades, active, tpMult, slMult) {
  const rr = tpMult / slMult;
  const wins = trades.filter(t => t.win).length;
  const losses = trades.length - wins;
  const wr = trades.length ? (wins / trades.length) * 100 : 0;
  const pf = losses > 0 ? (wins * tpMult) / (losses * slMult) : (wins > 0 ? 99 : 0);
  const netR = wins * rr - losses;
  const beWr = 100 / (1 + rr);
  return { trades: trades.length, wins, wr, pf, netR, beWr, rr, active: !!active, dir: active ? active.dir : 0 };
}

function fmtPr(p) {
  const a = Math.abs(p);
  return a >= 1000 ? p.toFixed(1) : a >= 1 ? p.toFixed(4) : p.toFixed(6);
}

// ── бейдж бектеста: строка на каждую активную стратегию ──

const btResults = {};
const BT_LABEL = { rsi2: 'RSI-2', squeeze: 'Squeeze' };

function setBt(id, s) {
  if (s == null) delete btResults[id]; else btResults[id] = s;
  renderBtStats();
}

function renderBtStats() {
  const el = document.getElementById('bt-stats');
  if (!el) return;
  const ids = Object.keys(btResults).filter(id => enabled.has(id));
  if (!ids.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = ids.map(id => {
    const s = btResults[id];
    if (s.tooFew) return `<div class="bt-row"><span class="bt-t">${BT_LABEL[id]}:</span><span class="dim">мало истории — смените таймфрейм</span></div>`;
    const wrCls = s.wr >= s.beWr ? 'up' : 'down';
    return `<div class="bt-row">` +
      `<span class="bt-t">${BT_LABEL[id]} · бектест (${s.trades} сд.):</span>` +
      `<b class="${wrCls}">${s.wr.toFixed(0)}% WR</b>` +
      `<span>RR 1:${s.rr.toFixed(1)}</span>` +
      `<span title="точка безубытка при этом соотношении тейк/стоп">б/у ${s.beWr.toFixed(0)}%</span>` +
      `<span>PF ${s.pf.toFixed(2)}</span>` +
      `<span class="${s.netR >= 0 ? 'up' : 'down'}">${s.netR >= 0 ? '+' : ''}${s.netR.toFixed(1)}R</span>` +
      (s.active ? `<span class="bt-live ${s.dir === 1 ? 'up' : 'down'}">● ${s.dir === 1 ? 'LONG' : 'SHORT'}</span>` : '') +
      `</div>`;
  }).join('');
}

// ── ⭐ Squeeze Breakout: Боллинджер внутри Кельтнера + объём + импульс (RR ~1:4) ──
// Тесный стоп под диапазоном сжатия, длинный тейк по ATR — высокий R:R, средний винрейт.

const SQZ = { len: 20, bbMult: 2, kcMult: 1.5, volMult: 1.5, breakoutLB: 20, slMult: 1.3, tpMult: 5.2, maxHold: 40 };

function computeSqueeze(markers) {
  const n = bars.length;
  const closes = bars.map(b => b.c);
  if (n < SQZ.len + 40) { setBt('squeeze', { tooFew: true }); return; }
  const { len, bbMult, kcMult, volMult, breakoutLB, slMult, tpMult, maxHold } = SQZ;
  const { mid, sd } = smaStd(closes, len);
  const atr = atrW(bars, len);
  const volSma = smaArr(bars.map(b => b.qv || b.v || 0), len);
  // squeeze[i]: BB внутри Кельтнера (сжатие волатильности)
  const squeeze = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (mid[i] == null || atr[i] == null) continue;
    const bbU = mid[i] + bbMult * sd[i], bbL = mid[i] - bbMult * sd[i];
    const kcU = mid[i] + kcMult * atr[i], kcL = mid[i] - kcMult * atr[i];
    squeeze[i] = bbU < kcU && bbL > kcL;
  }
  const entries = [];
  let cooldown = 0;
  for (let i = breakoutLB; i < n; i++) {
    if (mid[i] == null || atr[i] == null || atr[i] <= 0) continue;
    if (cooldown > 0) { cooldown--; continue; }
    // недавно было сжатие (в пределах 6 баров), сейчас разжалось
    let wasSq = false;
    for (let k = Math.max(0, i - 6); k < i; k++) if (squeeze[k]) wasSq = true;
    if (!wasSq || squeeze[i]) continue;
    const volSpike = volSma[i] > 0 && (bars[i].qv || bars[i].v || 0) > volSma[i] * volMult;
    if (!volSpike) continue;
    // пробой диапазона (Donchian) в сторону импульса
    let hh = -Infinity, ll = Infinity;
    for (let k = i - breakoutLB; k < i; k++) { if (bars[k].h > hh) hh = bars[k].h; if (bars[k].l < ll) ll = bars[k].l; }
    let dir = 0;
    if (closes[i] > hh && closes[i] > mid[i]) dir = 1;
    else if (closes[i] < ll && closes[i] < mid[i]) dir = -1;
    if (!dir) continue;
    entries.push({ dir, i, entry: closes[i] });
    markers.push(dir === 1
      ? { time: bars[i].t, position: 'belowBar', color: '#00c2ff', shape: 'arrowUp', text: 'BREAK▲' }
      : { time: bars[i].t, position: 'aboveBar', color: '#ff7ac2', shape: 'arrowDown', text: 'BREAK▼' });
    cooldown = 3;
  }
  const { trades, active } = simulateTrades(entries, slMult, tpMult, maxHold, atr);
  drawTrades(trades, active);
  setBt('squeeze', statsOf(trades, active, tpMult, slMult));
}

// ── ⭐ Дивергенции: расхождения цены и RSI на пивотах ──

function computeDivergences(closes) {
  const n = bars.length, W = 3;
  const r14 = rsiW(closes, 14);
  const from = Math.max(W + 14, n - 180);
  const pl = [], ph = [];
  for (let i = from; i < n - W; i++) {
    let isL = true, isH = true;
    for (let k = i - W; k <= i + W; k++) {
      if (bars[k].l < bars[i].l) isL = false;
      if (bars[k].h > bars[i].h) isH = false;
    }
    if (isL && r14[i] != null) pl.push(i);
    if (isH && r14[i] != null) ph.push(i);
  }
  // бычьи: цена ниже, RSI выше (по последним парам пивотов)
  let cnt = 0;
  for (let j = pl.length - 1; j > 0 && cnt < 3; j--) {
    const b = pl[j];
    for (let k = j - 1; k >= 0; k--) {
      const a = pl[k];
      if (b - a > 70) break;
      if (b - a < 5) continue;
      if (bars[b].l < bars[a].l && r14[b] > r14[a] + 1.5) {
        prims.push({ kind: 'line', i1: a, i2: b, p1: bars[a].l, p2: bars[b].l, color: 'rgba(46,189,133,.9)', dash: true });
        prims.push({ kind: 'label', i: b, p: bars[b].l, text: 'Bull Div', color: '#2ebd85', above: false });
        cnt++;
        break;
      }
    }
  }
  // медвежьи: цена выше, RSI ниже
  cnt = 0;
  for (let j = ph.length - 1; j > 0 && cnt < 3; j--) {
    const b = ph[j];
    for (let k = j - 1; k >= 0; k--) {
      const a = ph[k];
      if (b - a > 70) break;
      if (b - a < 5) continue;
      if (bars[b].h > bars[a].h && r14[b] < r14[a] - 1.5) {
        prims.push({ kind: 'line', i1: a, i2: b, p1: bars[a].h, p2: bars[b].h, color: 'rgba(246,70,93,.9)', dash: true });
        prims.push({ kind: 'label', i: b, p: bars[b].h, text: 'Bear Div', color: '#f6465d', above: true });
        cnt++;
        break;
      }
    }
  }
}

// ── SMC: Fair Value Gaps ──

function computeFVG() {
  const n = bars.length;
  const boxes = [];
  const from = Math.max(2, n - 200);
  for (let i = from; i < n; i++) {
    if (bars[i].l > bars[i - 2].h) boxes.push({ bull: true, top: bars[i].l, bot: bars[i - 2].h, i: i - 1 });
    if (bars[i].h < bars[i - 2].l) boxes.push({ bull: false, top: bars[i - 2].l, bot: bars[i].h, i: i - 1 });
  }
  const active = [];
  for (const b of boxes) {
    let ok = true;
    for (let k = b.i + 2; k < n; k++) {
      if (b.bull ? bars[k].l <= b.bot : bars[k].h >= b.top) { ok = false; break; }
    }
    if (ok) active.push(b);
  }
  for (const b of active.slice(-14)) {
    prims.push({
      kind: 'box', i1: b.i, i2: null, p1: b.top, p2: b.bot,
      fill: b.bull ? 'rgba(46,189,133,.09)' : 'rgba(246,70,93,.09)',
      stroke: b.bull ? 'rgba(46,189,133,.25)' : 'rgba(246,70,93,.25)',
    });
  }
}

// ── SMC: структура рынка + ордер-блоки ──

function computeStructure() {
  const n = bars.length, W = 4;
  const wantMS = enabled.has('ms'), wantOB = enabled.has('ob');
  // подтверждённые пивоты
  const pivH = [], pivL = [];
  for (let i = W; i < n - W; i++) {
    let isH = true, isL = true;
    for (let k = i - W; k <= i + W; k++) {
      if (bars[k].h > bars[i].h) isH = false;
      if (bars[k].l < bars[i].l) isL = false;
    }
    if (isH) pivH.push(i);
    if (isL) pivL.push(i);
  }
  let hIdx = 0, lIdx = 0;
  let lastH = null, lastL = null; // {i, p, active}
  let trend = 0;
  const obs = [];
  for (let i = 0; i < n; i++) {
    while (hIdx < pivH.length && pivH[hIdx] + W <= i) { lastH = { i: pivH[hIdx], p: bars[pivH[hIdx]].h, active: true }; hIdx++; }
    while (lIdx < pivL.length && pivL[lIdx] + W <= i) { lastL = { i: pivL[lIdx], p: bars[pivL[lIdx]].l, active: true }; lIdx++; }
    if (lastH && lastH.active && bars[i].c > lastH.p) {
      const label = trend === -1 ? 'CHoCH' : 'BOS';
      trend = 1; lastH.active = false;
      if (wantMS) {
        prims.push({ kind: 'line', i1: lastH.i, i2: i, p1: lastH.p, p2: lastH.p, color: 'rgba(46,189,133,.8)', dash: label === 'CHoCH' });
        prims.push({ kind: 'label', i: Math.round((lastH.i + i) / 2), p: lastH.p, text: label, color: '#2ebd85', above: true });
      }
      if (wantOB) {
        for (let j = i - 1; j >= Math.max(lastH.i, i - 20); j--) {
          if (bars[j].c < bars[j].o) { obs.push({ bull: true, i: j, top: bars[j].h, bot: bars[j].l }); break; }
        }
      }
    }
    if (lastL && lastL.active && bars[i].c < lastL.p) {
      const label = trend === 1 ? 'CHoCH' : 'BOS';
      trend = -1; lastL.active = false;
      if (wantMS) {
        prims.push({ kind: 'line', i1: lastL.i, i2: i, p1: lastL.p, p2: lastL.p, color: 'rgba(246,70,93,.8)', dash: label === 'CHoCH' });
        prims.push({ kind: 'label', i: Math.round((lastL.i + i) / 2), p: lastL.p, text: label, color: '#f6465d', above: false });
      }
      if (wantOB) {
        for (let j = i - 1; j >= Math.max(lastL.i, i - 20); j--) {
          if (bars[j].c > bars[j].o) { obs.push({ bull: false, i: j, top: bars[j].h, bot: bars[j].l }); break; }
        }
      }
    }
  }
  if (wantOB) {
    const alive = obs.filter(b => {
      for (let k = b.i + 1; k < n; k++) {
        if (b.bull ? bars[k].c < b.bot : bars[k].c > b.top) return false;
      }
      return true;
    });
    const bulls = alive.filter(b => b.bull).slice(-3);
    const bears = alive.filter(b => !b.bull).slice(-3);
    for (const b of [...bulls, ...bears]) {
      prims.push({
        kind: 'box', i1: b.i, i2: null, p1: b.top, p2: b.bot,
        fill: b.bull ? 'rgba(79,140,255,.10)' : 'rgba(231,84,200,.10)',
        stroke: b.bull ? 'rgba(79,140,255,.35)' : 'rgba(231,84,200,.35)',
        label: 'OB',
      });
    }
  }
}

// рендер SMC-примитивов на общем канвасе (вызывается из draw.js)
export function renderIndOverlay(ctx, help) {
  if (!prims.length) return;
  ctx.font = '9px Inter, sans-serif';
  for (const pr of prims) {
    if (pr.kind === 'box') {
      const x1 = help.xi(pr.i1);
      const x2 = pr.i2 == null ? help.w : help.xi(pr.i2);
      const y1 = help.yp(pr.p1), y2 = help.yp(pr.p2);
      if (x1 == null || y1 == null || y2 == null) continue;
      ctx.fillStyle = pr.fill;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.strokeStyle = pr.stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      if (pr.label) { ctx.fillStyle = pr.stroke; ctx.fillText(pr.label, x1 + 3, y1 + 9); }
    } else if (pr.kind === 'line') {
      const x1 = help.xi(pr.i1), x2 = help.xi(pr.i2);
      const y1 = help.yp(pr.p1), y2 = help.yp(pr.p2);
      if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
      ctx.strokeStyle = pr.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(pr.dash ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (pr.kind === 'label') {
      const x = help.xi(pr.i), y = help.yp(pr.p);
      if (x == null || y == null) continue;
      ctx.fillStyle = pr.color;
      const w = ctx.measureText(pr.text).width;
      ctx.fillText(pr.text, x - w / 2, pr.above ? y - 5 : y + 11);
    }
  }
}

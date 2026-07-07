// Слой рисования поверх графика: трендовые линии, лучи, уровни, зоны, фибоначчи.
// Точки хранятся как {t: unix-секунды UTC, p: цена} и живут в localStorage per-symbol,
// поэтому построения переживают перезагрузку, смену таймфрейма и панорамирование.

import { LS } from './config.js';

let chart, cs, wrap, canvas, ctx;
let getBars, getTfSec, getTzOff, onToolDone = () => {};
let overlayFns = [];

let drawings = [], symbol = null;
let tool = null, draft = null, selId = null, drag = null;
let cssW = 0, cssH = 0;

const COLORS = { trend: '#4f8cff', ray: '#4f8cff', hline: '#f0b90b', rect: '#7c5cff', fib: '#2ebd85' };
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export function initDraw(opts) {
  chart = opts.chart; cs = opts.series; wrap = opts.wrap;
  getBars = opts.getBars; getTfSec = opts.getTfSec; getTzOff = opts.getTzOff;
  onToolDone = opts.onToolDone || (() => {});
  canvas = document.createElement('canvas');
  canvas.className = 'drawlayer';
  wrap.appendChild(canvas);
  ctx = canvas.getContext('2d');
  new ResizeObserver(resize).observe(wrap);
  resize();
  wrap.addEventListener('pointerdown', onDown, true);
  wrap.addEventListener('pointermove', onMove, true);
  wrap.addEventListener('pointerup', onUp, true);
  window.addEventListener('keydown', onKey);
  requestAnimationFrame(loop);
}

export function registerOverlay(fn) { overlayFns.push(fn); }

export function setTool(t) { tool = t || null; draft = null; wrap.style.cursor = tool ? 'crosshair' : ''; }

export function loadDrawSymbol(sym) {
  symbol = sym;
  drawings = LS.get('draw.' + sym, []);
  selId = null; draft = null; drag = null;
}

export function clearDrawings() { drawings = []; selId = null; save(); }

export function deleteSelected() {
  if (selId == null) return;
  drawings = drawings.filter(d => d.id !== selId);
  selId = null;
  save();
}

function save() { if (symbol) LS.set('draw.' + symbol, drawings); }

function resize() {
  const dpr = devicePixelRatio || 1;
  cssW = wrap.clientWidth; cssH = wrap.clientHeight;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ── конвертация координат (время UTC ↔ пиксели через логический индекс) ──

function xFromT(tUtc) {
  const bars = getBars();
  if (!bars.length) return null;
  const tc = tUtc - getTzOff();
  const n = bars.length, tfs = getTfSec();
  let logical;
  if (tc >= bars[n - 1].t) logical = (n - 1) + (tc - bars[n - 1].t) / tfs;
  else if (tc <= bars[0].t) logical = (tc - bars[0].t) / tfs;
  else {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; bars[m].t < tc ? lo = m + 1 : hi = m; }
    const t1 = bars[lo].t, t0 = bars[lo - 1].t;
    logical = t1 === t0 ? lo : (lo - 1) + (tc - t0) / (t1 - t0);
  }
  return chart.timeScale().logicalToCoordinate(logical);
}

function tFromX(x) {
  const bars = getBars();
  if (!bars.length) return null;
  const l = chart.timeScale().coordinateToLogical(x);
  if (l == null) return null;
  const n = bars.length, tfs = getTfSec();
  let tc;
  if (l <= 0) tc = bars[0].t + l * tfs;
  else if (l >= n - 1) tc = bars[n - 1].t + (l - (n - 1)) * tfs;
  else { const i0 = Math.floor(l), i1 = Math.ceil(l); tc = bars[i0].t + (bars[i1].t - bars[i0].t) * (l - i0); }
  return tc + getTzOff();
}

const yFromP = p => cs.priceToCoordinate(p);
const pFromY = y => cs.coordinateToPrice(y);

function paneArea() {
  const tsH = chart.timeScale().height() || 28;
  const psW = chart.priceScale('right').width() || 70;
  return { w: cssW - psW, h: cssH - tsH };
}

// ── события мыши ──

function evXY(e) {
  const r = wrap.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e) {
  if (e.button !== 0) return;
  const { x, y } = evXY(e);
  const pa = paneArea();
  if (x > pa.w || y > pa.h) return; // клики по шкалам — графику

  if (tool) {
    e.preventDefault(); e.stopPropagation();
    toolClick(x, y);
    return;
  }
  const h = hitHandle(x, y);
  if (h) {
    drag = { d: h.d, mode: h.idx, sx: x, sy: y, orig: JSON.parse(JSON.stringify(h.d.points)) };
    selId = h.d.id;
    e.preventDefault(); e.stopPropagation();
    wrap.setPointerCapture(e.pointerId);
    return;
  }
  const d = hitDrawing(x, y);
  if (d) {
    selId = d.id;
    drag = { d, mode: 'body', sx: x, sy: y, orig: JSON.parse(JSON.stringify(d.points)) };
    e.preventDefault(); e.stopPropagation();
    wrap.setPointerCapture(e.pointerId);
  } else if (selId != null) {
    selId = null; // клик по пустому месту снимает выделение, панорамирование не блокируем
  }
}

function toolClick(x, y) {
  const t = tFromX(x), p = pFromY(y);
  if (t == null || p == null) return;
  if (tool === 'hline') { commit({ type: 'hline', points: [{ t, p }] }); return; }
  if (!draft) draft = { type: tool, points: [{ t, p }, { t, p }] };
  else { draft.points[1] = { t, p }; commit(draft); draft = null; }
}

function commit(d) {
  d.id = Date.now() + Math.random();
  drawings.push(d);
  selId = d.id;
  save();
  tool = null;
  wrap.style.cursor = '';
  onToolDone();
}

function onMove(e) {
  const { x, y } = evXY(e);
  if (draft) {
    const t = tFromX(x), p = pFromY(y);
    if (t != null && p != null) draft.points[1] = { t, p };
    return;
  }
  if (!drag) return;
  e.stopPropagation();
  const t = tFromX(x), p = pFromY(y);
  if (t == null || p == null) return;
  if (drag.mode === 'body') {
    const t0 = tFromX(drag.sx), p0 = pFromY(drag.sy);
    if (t0 == null || p0 == null) return;
    const dt = t - t0, dp = p - p0;
    drag.d.points = drag.orig.map(pt => ({ t: pt.t + dt, p: pt.p + dp }));
  } else {
    drag.d.points[drag.mode] = { t, p };
  }
}

function onUp() {
  if (drag) { save(); drag = null; }
}

function onKey(e) {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  if (e.key === 'Escape') { draft = null; if (tool) { tool = null; wrap.style.cursor = ''; onToolDone(); } }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selId != null) { deleteSelected(); e.preventDefault(); }
}

// ── hit-тесты ──

function pts(d) {
  return d.points.map(pt => ({ x: xFromT(pt.t), y: yFromP(pt.p) }));
}

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let u = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  u = Math.max(0, Math.min(1, u));
  const cx = ax + u * dx, cy = ay + u * dy;
  return Math.hypot(px - cx, py - cy);
}

function rayEnd(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx / len * 5000, y: a.y + dy / len * 5000 };
}

function hitHandle(x, y) {
  if (selId == null) return null;
  const d = drawings.find(v => v.id === selId);
  if (!d || d.type === 'hline') return null;
  const g = pts(d);
  for (let i = 0; i < g.length; i++) {
    if (g[i].x != null && g[i].y != null && Math.hypot(x - g[i].x, y - g[i].y) < 9) return { d, idx: i };
  }
  return null;
}

function hitDrawing(x, y) {
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    if (d.type === 'hline') {
      const ly = yFromP(d.points[0].p);
      if (ly != null && Math.abs(y - ly) < 6) return d;
      continue;
    }
    const g = pts(d);
    if (g.some(p => p.x == null || p.y == null)) continue;
    const [a, b] = g;
    if (d.type === 'trend' && distSeg(x, y, a.x, a.y, b.x, b.y) < 6) return d;
    if (d.type === 'ray') { const e2 = rayEnd(a, b); if (distSeg(x, y, a.x, a.y, e2.x, e2.y) < 6) return d; }
    if (d.type === 'rect') {
      const x1 = Math.min(a.x, b.x) - 3, x2 = Math.max(a.x, b.x) + 3;
      const y1 = Math.min(a.y, b.y) - 3, y2 = Math.max(a.y, b.y) + 3;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return d;
    }
    if (d.type === 'fib') {
      const xA = Math.min(a.x, b.x);
      if (x >= xA - 4) {
        for (const lv of FIB_LEVELS) {
          const ly = yFromP(d.points[0].p + (d.points[1].p - d.points[0].p) * lv);
          if (ly != null && Math.abs(y - ly) < 5) return d;
        }
      }
      if (distSeg(x, y, a.x, a.y, b.x, b.y) < 6) return d;
    }
  }
  return null;
}

// ── рендер ──

function loop() {
  render();
  requestAnimationFrame(loop);
}

function render() {
  if (!ctx) return;
  if (wrap.clientWidth !== cssW || wrap.clientHeight !== cssH) resize();
  ctx.clearRect(0, 0, cssW, cssH);
  if (!wrap.offsetParent || !getBars().length) return;
  const pa = paneArea();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, pa.w, pa.h);
  ctx.clip();
  const help = {
    xi: i => chart.timeScale().logicalToCoordinate(i),
    yp: yFromP,
    w: pa.w, h: pa.h,
  };
  for (const fn of overlayFns) { try { fn(ctx, help); } catch {} }
  for (const d of drawings) drawOne(d, d.id === selId, false);
  if (draft) drawOne(draft, false, true);
  ctx.restore();
}

function fmtP(p) {
  const a = Math.abs(p);
  return a >= 1000 ? p.toFixed(1) : a >= 1 ? p.toFixed(4) : p.toFixed(6);
}

function chip(x, y, text, color) {
  ctx.font = '9.5px Inter, sans-serif';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(10,14,23,.85)';
  ctx.fillRect(x, y - 7, w, 14);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y - 7, w, 14);
  ctx.fillStyle = color;
  ctx.fillText(text, x + 4, y + 3.5);
}

function drawOne(d, selected, isDraft) {
  const color = COLORS[d.type] || '#4f8cff';
  ctx.lineWidth = selected ? 2 : 1.4;
  ctx.strokeStyle = color;
  ctx.setLineDash(isDraft ? [4, 4] : []);

  if (d.type === 'hline') {
    const y = yFromP(d.points[0].p);
    if (y == null) return;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cssW, y); ctx.stroke();
    ctx.setLineDash([]);
    chip(4, y, fmtP(d.points[0].p), color);
    return;
  }

  const g = pts(d);
  if (g.some(p => p.x == null || p.y == null)) return;
  const [a, b] = g;

  if (d.type === 'trend' || d.type === 'ray') {
    const end = d.type === 'ray' ? rayEnd(a, b) : b;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(end.x, end.y); ctx.stroke();
  } else if (d.type === 'rect') {
    const x1 = Math.min(a.x, b.x), y1 = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillStyle = 'rgba(124,92,255,.12)';
    ctx.fillRect(x1, y1, w, h);
    ctx.strokeRect(x1, y1, w, h);
  } else if (d.type === 'fib') {
    const xA = Math.min(a.x, b.x);
    const p0 = d.points[0].p, p1 = d.points[1].p;
    ctx.font = '9.5px Inter, sans-serif';
    for (let i = 0; i < FIB_LEVELS.length; i++) {
      const lv = FIB_LEVELS[i];
      const price = p0 + (p1 - p0) * lv;
      const y = yFromP(price);
      if (y == null) continue;
      ctx.globalAlpha = lv === 0 || lv === 1 ? 1 : 0.75;
      ctx.beginPath(); ctx.moveTo(xA, y); ctx.lineTo(cssW, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.fillText(`${lv} — ${fmtP(price)}`, xA + 4, y - 3);
      if (i > 0) {
        const yPrev = yFromP(p0 + (p1 - p0) * FIB_LEVELS[i - 1]);
        if (yPrev != null) {
          ctx.fillStyle = `rgba(46,189,133,${i % 2 ? 0.05 : 0.03})`;
          ctx.fillRect(xA, Math.min(y, yPrev), cssW - xA, Math.abs(y - yPrev));
        }
      }
    }
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  if (selected || isDraft) {
    for (const p of g) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0a0e17';
      ctx.fill();
      ctx.stroke();
    }
  }
}

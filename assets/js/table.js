// Таблица скринера: keyed-строки, сортировка, фильтры, спарклайны

import { store, toggleWatch } from './store.js';
import { LS } from './config.js';
import * as U from './util.js';

const COLS = [
  { k: 'star', label: '' },
  { k: 'symbol', label: 'Пара', sortable: true, left: true },
  { k: 'price', label: 'Цена', sortable: true },
  { k: 'm1', label: '1м', sortable: true, title: 'Изменение цены за 1 минуту' },
  { k: 'm5', label: '5м', sortable: true, title: 'Изменение цены за 5 минут' },
  { k: 'm15', label: '15м', sortable: true, title: 'Изменение цены за 15 минут' },
  { k: 'h1', label: '1ч', sortable: true, title: 'Изменение цены за 1 час' },
  { k: 'pct24', label: '24ч', sortable: true, title: 'Изменение цены за 24 часа' },
  { k: 'volq24', label: 'Объём 24ч', sortable: true, title: 'Оборот за 24 часа, USD' },
  { k: 'spike', label: 'Vol ×', sortable: true, title: 'Всплеск объёма: минутный объём к среднему за 15 минут' },
  { k: 'natr', label: 'NATR', sortable: true, title: 'Волатильность: средний диапазон 1м-свечи за 14 минут' },
  { k: 'funding', label: 'Фандинг', sortable: true, sk: 'fundingRate', title: 'Ставка финансирования и время до расчёта' },
  { k: 'oiValue', label: 'OI', sortable: true, title: 'Открытый интерес, USD' },
  { k: 'oiCh15', label: 'ΔOI 15м', sortable: true, title: 'Изменение открытого интереса за 15 минут' },
  { k: 'liq5', label: 'Ликв. 5м', sortable: true, sk: '_liqSum', title: 'Ликвидации за 5 минут: ▼ лонги, ▲ шорты' },
  { k: 'spark', label: '2 часа', title: 'Цена за последние 2 часа' },
];

let sort = LS.get('sort', { k: 'volq24', d: -1 });
let thead, tbody, wrap, io;
let onSelect = () => {};
const rowEls = new Map();
let tick = 0;

export function initTable(opts) {
  onSelect = opts.onSelect;
  wrap = U.$('#tablewrap');
  const table = U.$('#grid');
  thead = table.tHead;
  tbody = table.tBodies[0];
  const trh = document.createElement('tr');
  for (const c of COLS) {
    const th = U.el('th', (c.left ? 'left' : '') + (c.sortable ? ' sortable' : ''), c.label);
    if (c.title) th.title = c.title;
    th.dataset.k = c.sk || c.k;
    if (c.sortable) th.onclick = () => {
      const key = c.sk || c.k;
      if (sort.k === key) sort.d = -sort.d; else sort = { k: key, d: -1 };
      LS.set('sort', sort);
      renderHead();
    };
    trh.appendChild(th);
  }
  thead.appendChild(trh);
  renderHead();
  io = new IntersectionObserver(es => {
    for (const e of es) {
      const r = store.rows.get(e.target.dataset.s);
      if (r) r._vis = e.isIntersecting;
    }
  }, { root: wrap, rootMargin: '300px 0px' });
}

function renderHead() {
  for (const th of thead.querySelectorAll('th')) {
    th.classList.toggle('sorted', th.dataset.k === sort.k);
    th.classList.toggle('asc', th.dataset.k === sort.k && sort.d === 1);
  }
}

function sortVal(r, k) {
  if (k === 'symbol') return r.base;
  if (k === '_liqSum') { const s = r.liqL5 + r.liqS5; return s > 0 ? s : null; }
  const v = r[k];
  return v == null || !isFinite(v) ? null : v;
}

export function currentList(f) {
  const q = (f.q || '').trim().toUpperCase();
  const list = [];
  for (const r of store.rows.values()) {
    if (!store.universe.has(r.symbol)) continue;
    if (r.price == null) continue;
    const watched = store.watch.has(r.symbol);
    if (f.watchOnly && !watched) continue;
    if (f.minVol && !watched && (r.volq24 == null || r.volq24 < f.minVol)) continue;
    if (q && !r.symbol.toUpperCase().includes(q)) continue;
    list.push(r);
  }
  const { k, d } = sort;
  list.sort((a, b) => {
    const va = sortVal(a, k), vb = sortVal(b, k);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === 'string') return d * va.localeCompare(vb);
    return d * (va > vb ? 1 : va < vb ? -1 : 0);
  });
  return list;
}

function buildRow(r) {
  const tr = document.createElement('tr');
  tr.dataset.s = r.symbol;
  const cells = {};
  for (const c of COLS) {
    const td = document.createElement('td');
    if (c.k === 'star') {
      td.className = 'star' + (store.watch.has(r.symbol) ? ' on' : '');
      td.textContent = '★';
      td.onclick = e => {
        e.stopPropagation();
        toggleWatch(r.symbol);
        td.classList.toggle('on', store.watch.has(r.symbol));
      };
    } else if (c.k === 'symbol') {
      td.className = 'left';
      const hue = U.hueOf(r.base);
      td.innerHTML = `<div class="sym"><i style="background:hsl(${hue} 55% 20%);color:hsl(${hue} 85% 72%)">${r.base.slice(0, 4)}</i><b>${r.base}</b><s>USDT</s></div>`;
    } else if (c.k === 'spark') {
      td.className = 'num';
      const cv = document.createElement('canvas');
      cv.className = 'spark';
      cv.width = Math.round(110 * devicePixelRatio);
      cv.height = Math.round(26 * devicePixelRatio);
      td.appendChild(cv);
      cells.sparkCv = cv;
    } else {
      td.className = 'num';
    }
    tr.appendChild(td);
    cells[c.k] = td;
  }
  tr.onclick = () => onSelect(r.symbol);
  tr.ondblclick = () => { onSelect(r.symbol); document.body.classList.add('chart-max'); };
  const re = { tr, c: cells, v: {} };
  rowEls.set(r.symbol, re);
  io.observe(tr);
  return re;
}

function put(re, key, txt, cls) {
  const sig = txt + '|' + cls;
  if (re.v[key] === sig) return;
  re.v[key] = sig;
  re.c[key].textContent = txt;
  re.c[key].className = cls;
}

function drawSpark(cv, r) {
  const ks = r.klines;
  if (ks.length < 5) return;
  const data = ks.slice(-120).map(k => k.c);
  const ctx = cv.getContext('2d');
  const w = cv.width, h = cv.height;
  ctx.clearRect(0, 0, w, h);
  let mn = Infinity, mx = -Infinity;
  for (const v of data) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (!(mx > mn)) return;
  const up = data[data.length - 1] >= data[0];
  ctx.strokeStyle = up ? 'rgba(46,189,133,.9)' : 'rgba(246,70,93,.9)';
  ctx.lineWidth = devicePixelRatio;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((data[i] - mn) / (mx - mn)) * (h - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.lineTo(w - 1, h);
  ctx.lineTo(1, h);
  ctx.closePath();
  ctx.fillStyle = up ? 'rgba(46,189,133,.08)' : 'rgba(246,70,93,.08)';
  ctx.fill();
}

function updateRow(re, r, now) {
  const flash = now - r.flashT < 700 ? (r.dir > 0 ? ' fl-up' : ' fl-dn') : '';
  put(re, 'price', U.fmtPrice(r.price), 'num price' + flash);
  for (const k of ['m1', 'm5', 'm15', 'h1', 'oiCh15']) {
    put(re, k, U.fmtPct(r[k]), 'num ' + U.pctCls(r[k]));
  }
  // 24ч — цветная пилюля для быстрого сканирования взглядом
  const p24 = U.fmtPct(r.pct24), c24 = U.pctCls(r.pct24);
  if (re.v.pct24 !== p24 + c24) {
    re.v.pct24 = p24 + c24;
    re.c.pct24.className = 'num';
    re.c.pct24.innerHTML = `<span class="pill ${c24}">${p24}</span>`;
  }
  put(re, 'volq24', U.fmtUsd(r.volq24), 'num');
  put(re, 'spike', r.spike != null && r.spike >= 2 ? '×' + r.spike.toFixed(1) : '·',
    'num' + (r.spike >= 5 ? ' hot' : r.spike >= 3 ? ' warm' : ' dim'));
  put(re, 'natr', r.natr != null ? r.natr.toFixed(2) + '%' : '—', 'num' + (r.natr >= 1 ? ' hot' : ''));
  put(re, 'oiValue', U.fmtUsd(r.oiValue), 'num');

  const fr = r.fundingRate;
  const fTxt = fr == null ? '—' : (fr * 100).toFixed(4) + '%';
  const cd = r.nextFunding ? U.fmtCountdown(r.nextFunding - now) : '';
  const fSig = fTxt + '|' + cd;
  if (re.v.funding !== fSig) {
    re.v.funding = fSig;
    re.c.funding.className = 'num';
    re.c.funding.innerHTML = `<div class="${fr < 0 ? 'down' : Math.abs(fr) > 0.0005 ? 'warn' : ''}">${fTxt}</div><div class="sub">${cd}</div>`;
  }

  const lSig = Math.round(r.liqL5 / 100) + '|' + Math.round(r.liqS5 / 100);
  if (re.v.liq5 !== lSig) {
    re.v.liq5 = lSig;
    re.c.liq5.className = 'num';
    const parts = [];
    if (r.liqL5 > 500) parts.push(`<span class="down">▼${U.fmtUsd(r.liqL5)}</span>`);
    if (r.liqS5 > 500) parts.push(`<span class="up">▲${U.fmtUsd(r.liqS5)}</span>`);
    re.c.liq5.innerHTML = parts.join(' ') || '<span class="dim">·</span>';
  }

  re.c.star.classList.toggle('on', store.watch.has(r.symbol));
  re.tr.classList.toggle('sel', store.sel === r.symbol);
}

export function renderTable(f) {
  tick++;
  const now = Date.now();
  const list = currentList(f);
  const inList = new Set();
  for (const r of list) inList.add(r.symbol);
  for (const [s, re] of rowEls) {
    if (!inList.has(s) && re.tr.isConnected) re.tr.remove();
  }
  let prevTr = null;
  for (const r of list) {
    const re = rowEls.get(r.symbol) || buildRow(r);
    const want = prevTr ? prevTr.nextSibling : tbody.firstChild;
    if (want !== re.tr) tbody.insertBefore(re.tr, want);
    updateRow(re, r, now);
    if (r._vis && (tick % 5 === 0 || !re.sparked)) { drawSpark(re.c.sparkCv, r); re.sparked = true; }
    prevTr = re.tr;
  }
  return list.length;
}

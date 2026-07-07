// Точка входа: выбор биржи с фолбэком, циклы обновления, сигналы, панели, топбар

import { LS, MAX_SYMBOLS, PUMP_1M, PUMP_5M, VOL_SPIKE_X, BIG_LIQ_USD, SIGNAL_COOLDOWN } from './config.js';
import * as U from './util.js';
import { binanceAdapter, bybitAdapter } from './adapters.js';
import { store, applyTickers, applyFunding, addLiq, addSignal, computeDerived, setPrefill, getRow, pushOI } from './store.js';
import { initTable, renderTable, currentList } from './table.js';
import { initChart, openChart, chartHeadTick, resetChartView } from './chart.js';
import { initGrid, renderGrid } from './grid.js';
import { initDensity, renderDensTable, densCfg, setDensCfg } from './density.js';

const state = {
  filter: { q: '', minVol: LS.get('minVol', 5e6), watchOnly: false },
  view: LS.get('view', 'table'),
  sound: LS.get('sound', false),
};

const SIG_LABEL = { pump: 'ПАМП 1м', dump: 'ДАМП 1м', pump5: 'ПАМП 5м', dump5: 'ДАМП 5м', vol: 'ОБЪЁМ', liq: 'ЛИКВ.' };
const lastSig = new Map();
let sigRev = -1, liqRev = -1;
let wsMode = 'ws';

boot().catch(e => {
  console.error(e);
  U.$('#boot').innerHTML = 'Не удалось загрузить данные бирж.<br>Проверьте интернет-соединение (или VPN) и обновите страницу.';
});

async function boot() {
  wireUI();
  const exId = LS.get('exchange', 'binance');
  let adapter;
  try {
    adapter = await initExchange(exId);
  } catch (e) {
    console.warn('primary exchange failed:', e);
    const alt = exId === 'binance' ? 'bybit' : 'binance';
    toast(`${exId === 'binance' ? 'Binance' : 'Bybit'} недоступен (гео-блокировка или сеть) — переключаюсь на ${alt === 'bybit' ? 'Bybit' : 'Binance'}…`, 9000);
    adapter = await initExchange(alt);
    LS.set('exchange', alt);
  }
  U.$('#exchange').value = adapter.id;

  initTable({ onSelect: selectSymbol });
  initChart(adapter);
  initGrid({ onSelect: selectSymbol, adapter, isActive: () => state.view === 'grid' });
  initDensity({ adapter });
  setView(state.view);
  startLoop();
  U.$('#boot').remove();

  // открываем последнюю просмотренную монету, иначе BTC
  const saved = LS.get('sel', null);
  const def = (saved && store.universe.has(saved) ? saved : null)
    || store.sel
    || (store.universe.has('BTCUSDT') ? 'BTCUSDT' : [...store.universe.keys()][0]);
  if (def) openChart(def);

  prefillKlines(adapter);
  if (adapter.id === 'binance') oiLoop(adapter);
}

async function initExchange(id) {
  const adapter = id === 'bybit' ? bybitAdapter() : binanceAdapter();
  const [symbols, tickers] = await Promise.all([adapter.fetchSymbols(), adapter.fetchTickers()]);
  if (!symbols.length) throw new Error(id + ': пустой список инструментов');

  const volMap = new Map(tickers.map(t => [t.symbol, t.volq24 || 0]));
  const sorted = symbols.slice().sort((a, b) => (volMap.get(b.symbol) || 0) - (volMap.get(a.symbol) || 0));
  const uni = sorted.slice(0, MAX_SYMBOLS);
  for (const s of sorted.slice(MAX_SYMBOLS)) if (store.watch.has(s.symbol)) uni.push(s);
  store.universe.clear();
  for (const s of uni) store.universe.set(s.symbol, s);
  store.exchange = adapter.id;

  applyTickers(tickers);
  adapter.start({
    onTicker: applyTickers,
    onFunding: applyFunding,
    onLiq: handleLiq,
    onStatus: ok => { store.connected = ok; setConn(ok); },
    onMode: m => { wsMode = m; setConn(store.connected); },
  });
  const topSyms = uni.slice(0, 50).map(s => s.symbol);
  adapter.watchLiqs?.(topSyms, handleLiq);
  // Binance-стрим ликвидаций может молчать при гео-блоке — через 25с подхватываем ленту с Bybit
  if (adapter.id === 'binance') {
    setTimeout(() => {
      if (store.exchange === 'binance' && wsMode === 'rest' && !store.liqs.length) {
        bybitAdapter().watchLiqs(topSyms, handleLiq);
      }
    }, 25000);
  }
  return adapter;
}

function handleLiq(l) {
  addLiq(l);
  if (l.usd >= BIG_LIQ_USD) trySignal(l.symbol, 'liq', l.usd, l.side);
}

// подкачка истории 1м-свечей для всех пар (сверху — самые ликвидные)
async function prefillKlines(adapter) {
  const syms = [...store.universe.keys()];
  const batch = adapter.id === 'binance' ? 8 : 5;
  const gap = adapter.id === 'binance' ? 500 : 1100;
  for (let i = 0; i < syms.length; i += batch) {
    if (store.exchange !== adapter.id) return;
    await Promise.all(syms.slice(i, i + batch).map(async s => {
      try { setPrefill(s, await adapter.fetchKlines(s, '1m', 130)); } catch {}
    }));
    await U.sleep(gap);
  }
}

// Binance не отдаёт OI в тикерах — опрашиваем REST по топ-парам
async function oiLoop(adapter) {
  const top = n => [...store.rows.values()]
    .filter(r => store.universe.has(r.symbol) && r.volq24)
    .sort((a, b) => b.volq24 - a.volq24)
    .slice(0, n)
    .map(r => r.symbol);

  const seed = top(80);
  for (let i = 0; i < seed.length; i += 6) {
    if (store.exchange !== 'binance') return;
    await Promise.all(seed.slice(i, i + 6).map(async s => {
      try {
        const h = await adapter.fetchOIHist(s);
        const r = getRow(s);
        if (h.length) { r.oiHist = h; const last = h[h.length - 1]; r.oiValue = last.v; pushOI(r, last.v); }
      } catch {}
    }));
    await U.sleep(600);
  }
  while (store.exchange === 'binance') {
    const syms = top(80);
    for (let i = 0; i < syms.length; i += 6) {
      if (store.exchange !== 'binance') return;
      await Promise.all(syms.slice(i, i + 6).map(async s => {
        try {
          const oi = await adapter.fetchOI(s);
          const r = getRow(s);
          r.oi = oi;
          if (r.price) { r.oiValue = oi * r.price; pushOI(r, r.oiValue); }
        } catch {}
      }));
      await U.sleep(700);
    }
    await U.sleep(30000);
  }
}

// ── сигналы ──────────────────────────────────────────────────────────────────

function trySignal(sym, type, val, extra) {
  const key = sym + ':' + type;
  const now = Date.now();
  if (now - (lastSig.get(key) || 0) < SIGNAL_COOLDOWN) return;
  lastSig.set(key, now);
  addSignal({ ts: now, symbol: sym, type, val, extra });
  if (state.sound) beep(type);
}

function detectSignals() {
  const minVol = Math.max(state.filter.minVol, 3e6);
  for (const r of store.rows.values()) {
    if (!store.universe.has(r.symbol)) continue;
    if ((r.volq24 || 0) < minVol) continue;
    if (r.m1 != null && r.m1 >= PUMP_1M) trySignal(r.symbol, 'pump', r.m1);
    else if (r.m1 != null && r.m1 <= -PUMP_1M) trySignal(r.symbol, 'dump', r.m1);
    if (r.m5 != null && r.m5 >= PUMP_5M) trySignal(r.symbol, 'pump5', r.m5);
    else if (r.m5 != null && r.m5 <= -PUMP_5M) trySignal(r.symbol, 'dump5', r.m5);
    if (r.spike != null && r.spike >= VOL_SPIKE_X && r.curQv > 1e5) trySignal(r.symbol, 'vol', r.spike);
  }
}

// ── основной цикл рендера ────────────────────────────────────────────────────

let tick = 0;

function startLoop() {
  setInterval(() => {
    tick++;
    computeDerived();
    if (tick % 3 === 0) detectSignals();
    if (state.view === 'table') {
      const n = renderTable(state.filter);
      U.$('#count').textContent = n + ' пар';
    } else if (state.view === 'grid') {
      const list = currentList(state.filter);
      renderGrid(list, tick);
      U.$('#count').textContent = list.length + ' пар';
    } else if (tick % 3 === 0) {
      const n = renderDensTable();
      U.$('#count').textContent = n + ' плотностей';
    }
    if (store.signalsRev !== sigRev) renderSignals();
    if (store.liqsRev !== liqRev && tick % 2 === 0) renderLiqs();
    topbarTick();
    chartHeadTick();
  }, 600);
}

function renderSignals() {
  sigRev = store.signalsRev;
  const box = U.$('#signals');
  if (!store.signals.length) return;
  box.innerHTML = store.signals.slice(0, 60).map(s => {
    const cls = s.type.startsWith('pump') ? 'up'
      : s.type.startsWith('dump') ? 'down'
      : s.type === 'liq' ? (s.extra === 'long' ? 'down' : 'up') : 'warn';
    const val = s.type === 'vol' ? '×' + s.val.toFixed(1)
      : s.type === 'liq' ? '$' + U.fmtUsd(s.val) + (s.extra === 'long' ? ' лонги' : ' шорты')
      : U.fmtPct(s.val);
    return `<div class="item" data-s="${s.symbol}">
      <span class="t">${U.fmtTime(s.ts)}</span><b>${s.symbol.replace(/USDT$/, '')}</b>
      <span class="badge ${cls}">${SIG_LABEL[s.type]}</span><span class="v ${cls}">${val}</span></div>`;
  }).join('');
}

function renderLiqs() {
  liqRev = store.liqsRev;
  const box = U.$('#liqs');
  const items = store.liqs.filter(l => l.usd >= 3000).slice(0, 60);
  if (!items.length) return;
  box.innerHTML = items.map(l => `<div class="item" data-s="${l.symbol}">
    <span class="t">${U.fmtTime(l.ts)}</span><b>${l.symbol.replace(/USDT$/, '')}</b>
    <span class="badge ${l.side === 'long' ? 'down' : 'up'}">${l.side === 'long' ? 'ЛОНГ' : 'ШОРТ'}</span>
    <span class="v ${l.side === 'long' ? 'down' : 'up'}">$${U.fmtUsd(l.usd)}</span></div>`).join('');
}

function topbarTick() {
  setStat('#st-btc', store.rows.get('BTCUSDT'));
  setStat('#st-eth', store.rows.get('ETHUSDT'));
  const now = Date.now();
  let L = 0, S = 0;
  for (const l of store.liqs) {
    if (l.ts < now - 300000) break;
    if (l.side === 'long') L += l.usd; else S += l.usd;
  }
  const f = v => v > 0 ? '$' + U.fmtUsd(v) : '$0';
  U.$('#st-liq').innerHTML = `Ликв. 5м <b class="down">▼${f(L)}</b> <b class="up">▲${f(S)}</b>`;
  let vol = 0;
  for (const r of store.rows.values()) if (store.universe.has(r.symbol) && r.volq24) vol += r.volq24;
  U.$('#st-vol b').textContent = vol > 0 ? '$' + U.fmtUsd(vol) : '—';
}

function setStat(sel, r) {
  const e = U.$(sel);
  if (!e || !r) return;
  e.querySelector('b').textContent = U.fmtPrice(r.price);
  const i = e.querySelector('i');
  i.textContent = U.fmtPct(r.pct24);
  i.className = U.pctCls(r.pct24);
}

// ── UI ───────────────────────────────────────────────────────────────────────

function selectSymbol(sym) {
  openChart(sym);
  document.body.classList.add('panel-open');
}

function setView(v) {
  state.view = v;
  LS.set('view', v);
  document.body.classList.toggle('view-grid', v === 'grid');
  document.body.classList.toggle('view-dens', v === 'dens');
  U.$('#v-table').classList.toggle('on', v === 'table');
  U.$('#v-grid').classList.toggle('on', v === 'grid');
  U.$('#v-dens').classList.toggle('on', v === 'dens');
}

function wireUI() {
  U.$('#search').addEventListener('input', e => { state.filter.q = e.target.value; });
  const mv = U.$('#minvol');
  mv.value = String(state.filter.minVol);
  if (mv.value === '') mv.value = '5000000';
  mv.onchange = () => { state.filter.minVol = +mv.value; LS.set('minVol', state.filter.minVol); };

  U.$('#watchonly').onclick = e => {
    state.filter.watchOnly = !state.filter.watchOnly;
    e.currentTarget.classList.toggle('on', state.filter.watchOnly);
  };
  const snd = U.$('#sound');
  snd.classList.toggle('on', state.sound);
  snd.onclick = () => {
    state.sound = !state.sound;
    LS.set('sound', state.sound);
    snd.classList.toggle('on', state.sound);
    if (state.sound) beep('pump');
  };
  U.$('#v-table').onclick = () => setView('table');
  U.$('#v-grid').onclick = () => setView('grid');
  U.$('#v-dens').onclick = () => setView('dens');

  const dm = U.$('#densmin');
  dm.value = String(densCfg.minUsd);
  dm.onchange = () => setDensCfg('minUsd', +dm.value);
  const dsrt = U.$('#denssort');
  dsrt.value = densCfg.sortBy;
  dsrt.onchange = () => setDensCfg('sortBy', dsrt.value);
  U.$('#dgrid tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr');
    if (tr?.dataset.s) selectSymbol(tr.dataset.s);
  });

  U.$('#exchange').onchange = e => { LS.set('exchange', e.target.value); location.reload(); };

  for (const b of document.querySelectorAll('#paneltabs button')) {
    b.onclick = () => {
      document.querySelectorAll('#paneltabs button').forEach(x => x.classList.toggle('on', x === b));
      U.$('#signals').classList.toggle('hidden', b.dataset.tab !== 'signals');
      U.$('#liqs').classList.toggle('hidden', b.dataset.tab !== 'liqs');
    };
  }
  for (const id of ['#signals', '#liqs']) {
    U.$(id).addEventListener('click', e => {
      const it = e.target.closest('.item');
      if (it?.dataset.s) selectSymbol(it.dataset.s);
    });
  }
  U.$('#ch-close').onclick = () => {
    if (document.body.classList.contains('chart-max')) {
      document.body.classList.remove('chart-max');
      U.$('#ch-expand').textContent = '⛶';
      setTimeout(resetChartView, 80);
    } else {
      document.body.classList.remove('panel-open');
    }
  };
}

function setConn(ok) {
  const c = U.$('#conn');
  c.classList.toggle('ok', ok);
  const name = store.exchange === 'binance' ? 'Binance' : 'Bybit';
  c.querySelector('span').textContent = ok
    ? `${name} · ${wsMode === 'rest' ? 'REST' : 'live'}`
    : 'переподключение…';
}

let toastT = null;
function toast(msg, ms = 6000) {
  const t = U.$('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}

let actx = null;
function beep(type) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.frequency.value = type.startsWith('pump') ? 880 : type.startsWith('dump') ? 340 : 600;
    g.gain.setValueAtTime(0.07, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + 0.26);
  } catch {}
}

// Состояние приложения: тикеры, свечи 1м, метрики, ликвидации, сигналы

import { KLINE_KEEP, LS } from './config.js';

export const store = {
  exchange: null,
  universe: new Map(),   // symbol -> {symbol, base}
  rows: new Map(),       // symbol -> строка скринера
  liqs: [],              // лента ликвидаций, новые в начале
  liqsRev: 0,
  signals: [],           // лента сигналов, новые в начале
  signalsRev: 0,
  watch: new Set(LS.get('watch', [])),
  sel: null,             // выбранная пара (для графика)
  connected: false,
};

export function toggleWatch(sym) {
  if (store.watch.has(sym)) store.watch.delete(sym); else store.watch.add(sym);
  LS.set('watch', [...store.watch]);
}

export function getRow(sym) {
  let r = store.rows.get(sym);
  if (!r) {
    const meta = store.universe.get(sym);
    r = {
      symbol: sym, base: meta?.base || sym.replace(/USDT$/, ''),
      price: null, pct24: null, high24: null, low24: null, volq24: null, trades24: null,
      fundingRate: null, nextFunding: null, oi: null, oiValue: null, oiCh15: null,
      m1: null, m5: null, m15: null, h1: null, natr: null, spike: null, curQv: 0,
      liqL5: 0, liqS5: 0,
      klines: [], prefilled: false, prevVolq: null, oiHist: [],
      dir: 0, flashT: 0, _vis: true,
    };
    store.rows.set(sym, r);
  }
  return r;
}

// живое достраивание 1м-свечи из потока тикеров
function pushTick(r, price, volq, now) {
  const bucket = Math.floor(now / 60000) * 60000;
  const ks = r.klines;
  const last = ks[ks.length - 1];
  if (!last || last.t < bucket) {
    ks.push({ t: bucket, o: price, h: price, l: price, c: price, qv: 0 });
    if (ks.length > KLINE_KEEP) ks.shift();
  } else {
    last.c = price;
    if (price > last.h) last.h = price;
    if (price < last.l) last.l = price;
  }
  // объём текущей минуты — как приращение 24ч-объёма (скользящее окно даёт погрешность, отрицательные скачки отбрасываем)
  if (volq != null && r.prevVolq != null) {
    const d = volq - r.prevVolq;
    if (d > 0 && ks.length) ks[ks.length - 1].qv += d;
  }
  if (volq != null) r.prevVolq = volq;
}

export function applyTickers(list) {
  const now = Date.now();
  for (const u of list) {
    if (!store.universe.has(u.symbol)) continue;
    const r = getRow(u.symbol);
    if (u.price != null && isFinite(u.price) && u.price > 0) {
      if (r.price != null && u.price !== r.price) { r.dir = u.price > r.price ? 1 : -1; r.flashT = now; }
      pushTick(r, u.price, u.volq24, now);
      r.price = u.price;
    }
    if (u.pct24 != null && isFinite(u.pct24)) r.pct24 = u.pct24;
    if (u.high24) r.high24 = u.high24;
    if (u.low24) r.low24 = u.low24;
    if (u.volq24 != null && isFinite(u.volq24)) r.volq24 = u.volq24;
    if (u.trades24 != null) r.trades24 = u.trades24;
    if (u.fundingRate != null && isFinite(u.fundingRate)) r.fundingRate = u.fundingRate;
    if (u.nextFunding) r.nextFunding = u.nextFunding;
    if (u.oi != null && isFinite(u.oi)) r.oi = u.oi;
    if (u.oiValue != null && isFinite(u.oiValue) && u.oiValue > 0) { r.oiValue = u.oiValue; pushOI(r, u.oiValue, now); }
  }
}

export function applyFunding(list) {
  for (const u of list) {
    if (!store.universe.has(u.symbol)) continue;
    const r = getRow(u.symbol);
    if (isFinite(u.fundingRate)) r.fundingRate = u.fundingRate;
    if (u.nextFunding) r.nextFunding = u.nextFunding;
  }
}

// история OI (точка не чаще раза в ~минуту) + изменение за 15м
export function pushOI(r, value, now = Date.now()) {
  const h = r.oiHist;
  if (!h.length || now - h[h.length - 1].t >= 55000) {
    h.push({ t: now, v: value });
    if (h.length > 60) h.shift();
  }
  const target = now - 15 * 60000;
  let best = null;
  for (const e of h) { if (e.t <= target) best = e; else break; }
  if (!best && h.length && now - h[0].t >= 10 * 60000) best = h[0];
  r.oiCh15 = best && best.v > 0 ? (value / best.v - 1) * 100 : null;
}

// подмена живых свечей историей с REST
export function setPrefill(sym, ks) {
  if (!ks || !ks.length) return;
  const r = getRow(sym);
  r.klines = ks.map(k => ({ t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, qv: k.qv || 0 }));
  if (r.klines.length > KLINE_KEEP) r.klines = r.klines.slice(-KLINE_KEEP);
  r.prefilled = true;
}

export function addLiq(l) {
  if (!store.universe.has(l.symbol) || !isFinite(l.usd) || l.usd <= 0) return;
  store.liqs.unshift(l);
  if (store.liqs.length > 500) store.liqs.length = 400;
  store.liqsRev++;
}

export function addSignal(s) {
  store.signals.unshift(s);
  if (store.signals.length > 100) store.signals.length = 80;
  store.signalsRev++;
}

// производные метрики: изменения за интервалы, NATR, всплеск объёма, ликвидации за 5м
export function computeDerived() {
  const now = Date.now();
  const cut = now - 5 * 60000;
  for (const r of store.rows.values()) { r.liqL5 = 0; r.liqS5 = 0; }
  for (const l of store.liqs) {
    if (l.ts < cut) break;
    const r = store.rows.get(l.symbol);
    if (!r) continue;
    if (l.side === 'long') r.liqL5 += l.usd; else r.liqS5 += l.usd;
  }
  for (const r of store.rows.values()) {
    const ks = r.klines, n = ks.length, p = r.price;
    if (p == null || n < 2) continue;
    const chg = m => {
      const i = n - 1 - m;
      if (i < 0) return null;
      const b = ks[i].c;
      return b > 0 ? (p / b - 1) * 100 : null;
    };
    r.m1 = n > 1 ? chg(1) : null;
    r.m5 = n > 5 ? chg(5) : null;
    r.m15 = n > 15 ? chg(15) : null;
    r.h1 = n > 60 ? chg(60) : null;
    if (n >= 15) {
      let s = 0, c = 0;
      for (let i = n - 15; i < n - 1; i++) { const k = ks[i]; if (k.c > 0) { s += (k.h - k.l) / k.c; c++; } }
      r.natr = c ? (s / c) * 100 : null;
    }
    if (n >= 8) {
      let s = 0, c = 0;
      for (let i = Math.max(0, n - 17); i < n - 2; i++) { s += ks[i].qv; c++; }
      const avg = c ? s / c : 0;
      const cur = Math.max(ks[n - 1].qv, ks[n - 2].qv);
      r.spike = avg > 1000 ? cur / avg : null;
      r.curQv = cur;
    }
  }
}

// Карта плотностей: сканер стаканов топовых пар. Ищем аномально крупные
// лимитные заявки (кратно больше среднего уровня в стакане) недалеко от цены.
// Отдельный быстрый цикл держит свежий стакан выбранной пары для отрисовки
// стен прямо на графике.

import { store } from './store.js';
import { LS } from './config.js';
import * as U from './util.js';

const SCAN_TOP = 40;      // сколько пар сканируем по кругу
const MAX_DIST = 5;       // % от цены — дальше не интересно
const WALL_MULT = 8;      // во сколько раз уровень должен превышать средний
const WALL_MIN = 50e3;    // абсолютный минимум, $

let A = null, running = false;
export const dens = {
  rows: new Map(),        // symbol -> {ts, mid, walls: [{side, price, usd, dist, mult}]}
  selSym: null,
  selWalls: [],
};

export const densCfg = {
  minUsd: LS.get('densMin', 100e3),
  sortBy: LS.get('densSort', 'dist'),
  onChart: LS.get('densChart', true),
};

export function setDensCfg(k, v) {
  densCfg[k] = v;
  LS.set(k === 'minUsd' ? 'densMin' : k === 'sortBy' ? 'densSort' : 'densChart', v);
}

export function initDensity(opts) {
  A = opts.adapter;
  running = true;
  sweepLoop();
  selLoop();
}

function topSymbols(n) {
  const list = [...store.rows.values()]
    .filter(r => store.universe.has(r.symbol) && r.volq24)
    .sort((a, b) => b.volq24 - a.volq24)
    .slice(0, n)
    .map(r => r.symbol);
  for (const w of store.watch) if (store.universe.has(w) && !list.includes(w)) list.push(w);
  return list;
}

function detect(book, minMult, minUsd) {
  const bb = book.bids[0]?.[0], ba = book.asks[0]?.[0];
  if (!bb || !ba) return null;
  const mid = (bb + ba) / 2;
  const walls = [];
  for (const [side, levels] of [['bid', book.bids], ['ask', book.asks]]) {
    let sum = 0;
    for (const [p, q] of levels) sum += p * q;
    const avg = levels.length ? sum / levels.length : 0;
    if (!avg) continue;
    for (const [p, q] of levels) {
      const usd = p * q;
      const dist = Math.abs(p / mid - 1) * 100;
      if (usd >= Math.max(minUsd, avg * minMult) && dist <= MAX_DIST) {
        walls.push({ side, price: p, usd, dist, mult: usd / avg });
      }
    }
  }
  walls.sort((a, b) => b.usd - a.usd);
  return { mid, walls };
}

// медленный круговой скан топ-пар
async function sweepLoop() {
  await U.sleep(4000); // дать тикерам заполниться
  while (running) {
    const syms = topSymbols(SCAN_TOP);
    if (!syms.length) { await U.sleep(3000); continue; }
    for (const s of syms) {
      if (!running) return;
      try {
        const d = detect(await A.fetchDepth(s), WALL_MULT, WALL_MIN);
        if (d) dens.rows.set(s, { ts: Date.now(), mid: d.mid, walls: d.walls.slice(0, 4) });
      } catch {}
      // в фоновой вкладке сканируем реже, чтобы не жечь лимиты API
      await U.sleep(document.hidden ? 2000 : 700);
    }
    await U.sleep(2000);
  }
}

// быстрый цикл для выбранной пары (стены на графике)
async function selLoop() {
  while (running) {
    const sym = store.sel;
    if (sym && densCfg.onChart) {
      try {
        const d = detect(await A.fetchDepth(sym), 5, 25e3);
        if (d && store.sel === sym) {
          dens.selSym = sym;
          dens.selWalls = d.walls.slice(0, 8);
        }
      } catch {}
    }
    await U.sleep(4000);
  }
}

// отрисовка стен на канвасе большого графика (вызывается из draw.js)
export function renderDensityOverlay(ctx, help) {
  if (!densCfg.onChart || !dens.selWalls.length || dens.selSym !== store.sel) return;
  ctx.font = '9.5px Inter, sans-serif';
  for (const w of dens.selWalls) {
    const y = help.yp(w.price);
    if (y == null || y < 0 || y > help.h) continue;
    const color = w.side === 'bid' ? 'rgba(46,189,133,.85)' : 'rgba(246,70,93,.85)';
    const lw = 1 + Math.min(4, w.usd / 400e3);
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(help.w * 0.55, y);
    ctx.lineTo(help.w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const text = '$' + U.fmtUsd(w.usd);
    const tw = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(10,14,23,.85)';
    ctx.fillRect(help.w * 0.55 - tw, y - 7, tw, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, help.w * 0.55 - tw + 4, y + 3.5);
  }
}

// таблица карты плотностей
export function renderDensTable() {
  const tb = U.$('#dgrid tbody');
  const now = Date.now();
  const items = [];
  for (const [sym, d] of dens.rows) {
    if (now - d.ts > 180e3) continue; // протухшее
    const r = store.rows.get(sym);
    for (const w of d.walls) {
      if (w.usd < densCfg.minUsd) continue;
      items.push({ sym, base: r?.base || sym.replace(/USDT$/, ''), price: r?.price, w, age: (now - d.ts) / 1000 });
    }
  }
  items.sort((a, b) => densCfg.sortBy === 'usd' ? b.w.usd - a.w.usd : a.w.dist - b.w.dist);
  const scanned = dens.rows.size;
  if (!items.length) {
    tb.innerHTML = `<tr><td colspan="8" class="dempty">Сканирую стаканы… проверено пар: ${scanned}.<br>Плотности от $${U.fmtUsd(densCfg.minUsd)} появятся здесь автоматически.</td></tr>`;
    return items.length;
  }
  tb.innerHTML = items.slice(0, 200).map(it => {
    const near = it.w.dist < 0.5;
    const hue = U.hueOf(it.base);
    return `<tr data-s="${it.sym}" class="${near ? 'near' : ''}">
      <td class="left"><div class="sym"><i style="background:hsl(${hue} 55% 20%);color:hsl(${hue} 85% 72%)">${it.base.slice(0, 4)}</i><b>${it.base}</b><s>USDT</s></div></td>
      <td class="num">${U.fmtPrice(it.price)}</td>
      <td class="num"><b>${U.fmtPrice(it.w.price)}</b></td>
      <td class="num"><span class="badge ${it.w.side === 'bid' ? 'up' : 'down'}">${it.w.side === 'bid' ? 'БИД' : 'АСК'}</span></td>
      <td class="num ${near ? 'hot' : ''}">${it.w.dist.toFixed(2)}%</td>
      <td class="num"><b>$${U.fmtUsd(it.w.usd)}</b></td>
      <td class="num dim">×${it.w.mult.toFixed(0)}</td>
      <td class="num dim">${it.age < 60 ? Math.round(it.age) + 'с' : Math.round(it.age / 60) + 'м'}</td>
    </tr>`;
  }).join('');
  return items.length;
}

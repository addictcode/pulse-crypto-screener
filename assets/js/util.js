// Форматирование и мелкие DOM-хелперы

function trimZeros(s) {
  return s.indexOf('.') < 0 ? s : s.replace(/\.?0+$/, '');
}

export function fmtPrice(p) {
  if (p == null || !isFinite(p)) return '—';
  const a = Math.abs(p);
  if (a >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return trimZeros(p.toFixed(4));
  if (a >= 0.001) return trimZeros(p.toFixed(6));
  return trimZeros(p.toFixed(10));
}

export function fmtUsd(v) {
  if (v == null || !isFinite(v) || v === 0) return '—';
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(0) + 'K';
  return s + a.toFixed(0);
}

export function fmtPct(v, dp = 2) {
  if (v == null || !isFinite(v)) return '—';
  return (v > 0 ? '+' : '') + v.toFixed(dp) + '%';
}

export function pctCls(v) {
  if (v == null || !isFinite(v) || v === 0) return '';
  return v > 0 ? 'up' : 'down';
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour12: false });
}

export function fmtCountdown(ms) {
  if (ms == null || !isFinite(ms) || ms <= 0) return '';
  const m = Math.floor(ms / 60000);
  return Math.floor(m / 60) + 'ч ' + String(m % 60).padStart(2, '0') + 'м';
}

export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}

export const $ = s => document.querySelector(s);

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

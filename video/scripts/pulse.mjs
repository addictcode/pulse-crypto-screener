// The market around each event, for the "pulse of the market" template: the five minute change of
// 30 coins (the event's own and the 29 most traded others) for every minute of the hour that ends
// ten minutes after the event, kept in public/pulse.json by event id. No names are stored: the
// tiles are anonymous, like the videos.
//   node scripts/pulse.mjs        adds what is missing; scripts/archive-events.mjs runs it too
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { DAY, MINUTE, dayVolume, lastDay, listSymbols, minuteCandles, pool } from './archive.mjs';

export const TILES = 30;
export const MINUTES = 60;
/** the event's minute within the hour: most of the hour leads up to it */
export const AT = 50;

/**
 * Five minute changes, percent with one decimal, for the minutes from..from+59 out of minute
 * bars; null for a minute the coin has no bars for.
 */
export function changes(bars, from) {
  const close = new Map(bars.map((b) => [b.t, b.c]));
  return Array.from({ length: MINUTES }, (_, m) => {
    const t = from + m * MINUTE;
    const now = close.get(t);
    const before = close.get(t - 5 * MINUTE);
    return now && before ? Math.round((now / before - 1) * 1000) / 10 : null;
  });
}

/** A fixed place for the event's tile, different from video to video. */
function place(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TILES;
}

export async function addPulse() {
  const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));
  const file = new URL('../public/pulse.json', import.meta.url);
  const pulse = existsSync(file) ? JSON.parse(readFileSync(file)) : {};
  const missing = events.filter((e) => !pulse[e.id]);
  if (!missing.length) return 0;
  // the most traded coins of the newest archived day: the same neighbours for every event
  const last = await lastDay();
  const symbols = await listSymbols();
  const volumes = await pool(symbols, 16, (s) => dayVolume(s, last));
  const liquid = symbols
    .map((s, k) => ({ s, v: volumes[k] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 45)
    .map((x) => x.s);
  let added = 0;
  await pool(missing, 4, async (e) => {
    const from = e.time - AT * MINUTE;
    const days = [...new Set([from - 5 * MINUTE, from + MINUTES * MINUTE].map((t) => Math.floor(t / DAY) * DAY))];
    const read = async (symbol) => {
      const bars = [];
      for (const d of days) bars.push(...(await minuteCandles(symbol, d)));
      return changes(bars, from);
    };
    const own = await read(e.symbol);
    if (own.some((v) => v === null)) return console.warn(`no full hour for ${e.id}`);
    const others = [];
    for (const s of liquid) {
      if (others.length === TILES - 1) break;
      if (s === e.symbol) continue;
      const c = await read(s);
      // a neighbour without the whole hour (listed later, delisted) is left out
      if (c.every((v) => v !== null)) others.push(c);
    }
    if (others.length < TILES - 1) return console.warn(`not enough neighbours for ${e.id}`);
    const focus = place(e.id);
    others.splice(focus, 0, own);
    pulse[e.id] = { focus, tiles: others };
    added++;
  });
  writeFileSync(file, JSON.stringify(pulse));
  return added;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${await addPulse()} hours added`);
}

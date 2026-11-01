// The day around each event, for the time-lapse template: 24 hours of five minute candles built
// from the archive's minute candles, kept in public/days.json by event id.
//   node scripts/days.mjs        adds the days still missing; events.json itself is not touched
// scripts/archive-events.mjs runs this by itself after adding events.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { DAY, MINUTE, minuteCandles, pool } from './archive.mjs';

const STEP = 5 * MINUTE;
const BARS = 288; // 24 hours
/** where the event sits in its day: two thirds in, so the day leads up to it and goes on after */
const LEAD = 16 * 60 * MINUTE;

const round = (v) => Number(v.toPrecision(6));

/**
 * 24 hours of five minute bars around time t from minute bars, as [o, h, l, c, v] rows. The day
 * slides back when the archive ends sooner. Null without a full day free of gaps.
 */
export function dayAround(minutes, t) {
  if (!minutes.length) return null;
  const last = minutes[minutes.length - 1].t;
  let start = Math.floor((t - LEAD) / STEP) * STEP;
  start = Math.min(start, Math.floor((last + MINUTE - BARS * STEP) / STEP) * STEP);
  if (start < minutes[0].t || t < start || t >= start + BARS * STEP) return null;
  const bars = Array.from({ length: BARS }, () => null);
  for (const m of minutes) {
    const k = Math.floor((m.t - start) / STEP);
    if (k < 0 || k >= BARS) continue;
    const b = bars[k];
    if (!b) bars[k] = [m.o, m.h, m.l, m.c, m.v];
    else {
      b[1] = Math.max(b[1], m.h);
      b[2] = Math.min(b[2], m.l);
      b[3] = m.c;
      b[4] += m.v;
    }
  }
  if (bars.some((b) => !b)) return null;
  return { start, at: Math.floor((t - start) / STEP), bars: bars.map((b) => b.map(round)) };
}

/** Days for every event that has none yet; returns how many were added. */
export async function addDays() {
  const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));
  const file = new URL('../public/days.json', import.meta.url);
  const days = existsSync(file) ? JSON.parse(readFileSync(file)) : {};
  const missing = events.filter((e) => !days[e.id]);
  let added = 0;
  await pool(missing, 6, async (e) => {
    const d = Math.floor(e.time / DAY) * DAY;
    const minutes = [];
    for (const t of [d - DAY, d, d + DAY]) minutes.push(...(await minuteCandles(e.symbol, t)));
    const day = dayAround(minutes, e.time);
    if (day) {
      days[e.id] = day;
      added++;
    } else console.warn(`no full day around ${e.id}`);
  });
  writeFileSync(file, JSON.stringify(days));
  return added;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${await addDays()} days added`);
}

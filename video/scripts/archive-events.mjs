// Finds real sharp moves straight in Binance's archive of minute candles, without the signal
// database, so a new batch of videos can be made anywhere (the cloud, GitHub Actions).
//   node scripts/archive-events.mjs [--days 30] [--pairs 120] [--min 5] [--max 60] [--per-coin 3]
// Takes the most traded USDT perpetuals of the newest archived day, looks through each day of the
// period for minutes where the price moved at least --min percent in five minutes, keeps the
// strongest such minute per coin and day, and adds up to --max of them to public/events.json
// (strongest first, pumps and dumps in turn). Events already in the file stay as they are.
// Zips are cached in .cache/, so a second run downloads only what is new.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { addDays } from './days.mjs';
import { addPulse } from './pulse.mjs';
import { DAY, MINUTE, confirm, dayVolume, findMoves, lastDay, listSymbols, merge, minuteCandles, pool, toEvent } from './archive.mjs';

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '30' },
    pairs: { type: 'string', default: '120' },
    min: { type: 'string', default: '5' },
    max: { type: 'string', default: '60' },
    'per-coin': { type: 'string', default: '3' },
  },
});
const DAYS = Number(values.days);
const PAIRS = Number(values.pairs);
const MIN = Number(values.min);
const MAX = Number(values.max);
const PER_COIN = Number(values['per-coin']);

const file = new URL('../public/events.json', import.meta.url);
const existing = JSON.parse(readFileSync(file));

const last = await lastDay();
const symbols = await listSymbols();
console.log(`${symbols.length} USDT perpetuals in the archive, newest day ${new Date(last).toISOString().slice(0, 10)}`);

// liquidity: turnover on the newest day; a coin without that day is delisted or paused
const volumes = await pool(symbols, 16, (s) => dayVolume(s, last));
const top = symbols
  .map((s, k) => ({ s, v: volumes[k] }))
  .filter((x) => x.v > 0)
  .sort((a, b) => b.v - a.v)
  .slice(0, PAIRS)
  .map((x) => x.s);
console.log(`the ${top.length} most traded, from ${top.slice(0, 5).join(', ')}`);

// the period's days and one more before it, so a move early on the first day has its history
const first = last - (DAYS - 1) * DAY;
const days = Array.from({ length: DAYS + 1 }, (_, k) => first - DAY + k * DAY);

let downloaded = 0;
const found = [];
await pool(top, 8, async (symbol) => {
  const bars = [];
  for (const t of days) bars.push(...(await minuteCandles(symbol, t)));
  downloaded++;
  if (downloaded % 20 === 0) console.log(`${downloaded}/${top.length} coins read`);
  for (const { i, move } of findMoves(bars, { min: MIN, from: first, to: last + DAY })) {
    found.push(toEvent(symbol, bars, i, move));
  }
});
console.log(`${found.length} moves of ${MIN}% or more in five minutes`);

// strongest first, pumps and dumps in turn, so a batch is not all one story; a few per coin at most
const byStrength = (a, b) => Math.abs(b.move) - Math.abs(a.move);
const pumps = found.filter((e) => e.type === 'PUMP').sort(byStrength);
const dumps = found.filter((e) => e.type === 'DUMP').sort(byStrength);
const queue = [];
for (let k = 0; k < Math.max(pumps.length, dumps.length); k++) {
  if (pumps[k]) queue.push(pumps[k]);
  if (dumps[k]) queue.push(dumps[k]);
}
// events already in the file are skipped before counting towards --max, and count towards the
// per-coin limit, so a second run over a longer period adds new moves, not the same ones again
const known = new Set(existing.map((e) => `${e.symbol}@${Math.floor(e.time / MINUTE)}`));
const perCoin = new Map();
for (const e of existing) perCoin.set(e.symbol, (perCoin.get(e.symbol) ?? 0) + 1);
const picked = [];
for (const e of queue) {
  if (picked.length >= MAX) break;
  if (known.has(`${e.symbol}@${Math.floor(e.time / MINUTE)}`)) continue;
  const n = perCoin.get(e.symbol) ?? 0;
  if (n >= PER_COIN) continue;
  // the same check scripts/events.mjs makes of database signals
  const problem = confirm(e);
  if (problem) {
    console.warn(`skip ${e.symbol}: ${problem}`);
    continue;
  }
  perCoin.set(e.symbol, n + 1);
  picked.push(e);
}

const { events, added } = merge(existing, picked);
writeFileSync(file, JSON.stringify(events));
for (const e of added) console.log(`ok ${e.symbol} ${e.type} ${e.move}%`);
console.log(`${added.length} new events, ${events.length} in public/events.json`);
// the day around each new event, for the time-lapse template
console.log(`${await addDays()} days added to public/days.json`);
// the market around each new event, for the pulse template
console.log(`${await addPulse()} hours added to public/pulse.json`);

// Picks real market events for videos: the strongest pumps and dumps Pulse signalled, each checked
// against Binance's own minute candles, so no video is built on a bad price.
//   node scripts/events.mjs [how many]      reads scripts/candidates.json, writes public/events.json
// candidates.json is a query result from the signal table (see README.md).
import { readFileSync, writeFileSync } from 'node:fs';

const WANT = Number(process.argv[2] ?? 40);
const BEFORE = 45; // minutes of chart before the signal
const AFTER = 75; // and after it
/** The candles must show at least this much of the move the signal reported. */
const CONFIRM = 0.6;

const candidates = JSON.parse(readFileSync(new URL('./candidates.json', import.meta.url)));
// strongest first, alternating pumps and dumps so a batch is not all one story
const pumps = candidates.filter((c) => c.type === 'PUMP').sort((a, b) => b.value - a.value);
const dumps = candidates.filter((c) => c.type === 'DUMP').sort((a, b) => b.value - a.value);
const queue = [];
for (let i = 0; i < Math.max(pumps.length, dumps.length); i++) {
  if (pumps[i]) queue.push(pumps[i]);
  if (dumps[i]) queue.push(dumps[i]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function candles(symbol, from, limit) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&startTime=${from}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${symbol}: HTTP ${response.status}`);
  return (await response.json()).map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] }));
}

const events = [];
for (const c of queue) {
  if (events.length >= WANT) break;
  const minute = Math.floor(c.time / 60_000) * 60_000;
  let bars;
  try {
    bars = await candles(c.symbol, minute - BEFORE * 60_000, BEFORE + AFTER);
  } catch (e) {
    console.warn(`skip ${e.message}`);
    continue;
  }
  await sleep(150);
  const at = bars.findIndex((b) => b.t === minute);
  if (at < 10 || bars.length < BEFORE + AFTER - 5) {
    console.warn(`skip ${c.symbol}: not enough history around the signal (a fresh listing?)`);
    continue;
  }
  const up = c.type === 'PUMP';
  // the strongest five minute stretch ending at the signal, as the candles tell it
  const base = up ? Math.min(...bars.slice(at - 5, at + 1).map((b) => b.l)) : Math.max(...bars.slice(at - 5, at + 1).map((b) => b.h));
  const peak = up ? bars[at].h : bars[at].l;
  const move = (peak / base - 1) * 100;
  if (Math.abs(move) < c.value * CONFIRM || Math.sign(move) !== (up ? 1 : -1)) {
    console.warn(`skip ${c.symbol}: candles show ${move.toFixed(1)}%, the signal said ${up ? '+' : '-'}${c.value.toFixed(1)}%`);
    continue;
  }
  const after = bars.slice(at);
  const extreme = up ? Math.max(...after.map((b) => b.h)) : Math.min(...after.map((b) => b.l));
  events.push({
    id: `${c.symbol.replace(/USDT$/, '').toLowerCase()}-${new Date(minute).toISOString().slice(0, 10)}`,
    symbol: c.symbol,
    base: c.symbol.replace(/USDT$/, ''),
    type: c.type,
    time: minute,
    price: c.price,
    move: Math.round(move * 10) / 10,
    // how much further it ran after the signal, in the signal's direction
    further: Math.round(((extreme / c.price - 1) * 100) * 10) / 10,
    ret1h: c.ret_1h,
    at,
    candles: bars,
  });
  console.log(`ok ${c.symbol} ${c.type} ${move.toFixed(1)}%`);
}

writeFileSync(new URL('../public/events.json', import.meta.url), JSON.stringify(events));
console.log(`${events.length} events confirmed by the candles`);

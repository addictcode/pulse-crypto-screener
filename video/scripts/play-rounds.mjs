// Rounds for the "Guess what's next" game on the site (web/play/): real events from
// public/events.json, cut at the signal candle, with the real next hour as the answer.
//   node scripts/play-rounds.mjs                 writes web/public/play/rounds-NN.json and index.json
//   node scripts/play-rounds.mjs --refresh-spot  asks the archive again which coins are crypto
//   node scripts/play-rounds.mjs --events a.json,b.json  rounds from other sets of events
// The site's rounds are made from a bigger set than the videos' (more days of the archive, see
// "Rounds of the game" in video/README.md): five downs per pack run out first.
// A game is one pack of ten rounds, five that went up and five that went down. Only events with a clear answer (the price ended the hour at
// least 1% away from the signal price) are used, as in the Guess videos: "nowhere" is no answer.
// The coin and the day are in the file, because the game shows them after the answer; the page
// keeps them off the screen until then.
//
// Only crypto: Binance also lists perpetuals on shares (INTC, HOOD, AMZN...), which the archive
// search does not tell apart. As in research/archive.py, a coin with a Binance spot market is crypto;
// the list of spot USDT pairs is kept in public/spot-usdt.json and refreshed with --refresh-spot.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { ARCHIVE } from './archive.mjs';
import { fromEvent, isCrypto as cryptoSymbol, problem as unfit } from './clean.mjs';

export const PACK = 10;
/** Candles shown before the question, the signal candle included, and played after it. */
export const BEFORE = 46;
export const AFTER = 60;
const CLEAR = 1;

/** Five significant digits: plenty for a chart, a third of the bytes. */
const round = (v) => Number(v.toPrecision(5));

/**
 * The hour after the question in percent: from the close of the signal candle, the last thing the
 * player sees, to the close 60 minutes later. (The videos count from the signal price inside that
 * minute; the game counts from what is on the screen.)
 */
export function hourAfter(event) {
  const after = event.candles.slice(event.at, event.at + AFTER + 1);
  return (after[after.length - 1].c / after[0].c - 1) * 100;
}

export function toRound(event) {
  const from = event.at - BEFORE + 1;
  const candles = event.candles.slice(from, event.at + AFTER + 1).map((c) => [round(c.o), round(c.h), round(c.l), round(c.c)]);
  return {
    id: event.id,
    coin: event.base,
    day: new Date(event.time).toISOString().slice(0, 10),
    type: event.type,
    // index of the signal candle in `candles`: the question stops after it
    at: BEFORE - 1,
    // the close the question stops on; the answer is counted from it
    price: round(event.candles[event.at].c),
    hour: Math.round(hourAfter(event) * 100) / 100,
    candles,
  };
}

/** A fixed shuffle, so the packs are the same on every run and a new event does not reshuffle them all. */
function shuffled(list, seed) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Spot USDT pairs in Binance's archive, paged through the S3 listing. */
export async function spotUsdt() {
  const prefix = 'data/spot/daily/klines/';
  const found = [];
  let marker = '';
  for (;;) {
    const response = await fetch(`${ARCHIVE}?delimiter=/&prefix=${prefix}${marker ? `&marker=${encodeURIComponent(marker)}` : ''}`);
    if (!response.ok) throw new Error(`spot listing: ${response.status}`);
    const xml = await response.text();
    const page = [...xml.matchAll(/<Prefix>data\/spot\/daily\/klines\/([A-Z0-9]+)\/<\/Prefix>/g)].map((m) => m[1]);
    found.push(...page);
    if (!/<IsTruncated>true/.test(xml) || !page.length) break;
    marker = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/)?.[1] ?? `${prefix}${page[page.length - 1]}/`;
  }
  return found.filter((s) => s.endsWith('USDT')).sort();
}

/** 1000PEPEUSDT on futures is PEPEUSDT on spot. */
export const isCrypto = (event, spot) => cryptoSymbol(event.symbol, spot);

export function packs(events, spot) {
  const clear = events
    .filter((e) => isCrypto(e, spot))
    // the rules of the videos: no move past the cap, no one-candle spike (scripts/clean.mjs)
    .filter((e) => unfit(fromEvent(e), spot) === null)
    .filter((e) => e.candles.length >= e.at + AFTER + 1 && e.at + 1 >= BEFORE)
    .filter((e) => Math.abs(hourAfter(e)) >= CLEAR)
    .map(toRound);
  // Half up, half down in every pack. Most moves in the archive kept going up within the hour, and
  // with an uneven pack "always up" would beat the coin without the player reading anything
  const up = shuffled(clear.filter((r) => r.hour > 0), 20261107);
  const down = shuffled(clear.filter((r) => r.hour < 0), 20261108);
  const half = PACK / 2;
  const out = [];
  for (let i = 0; (i + 1) * half <= Math.min(up.length, down.length); i++) {
    out.push(shuffled([...up.slice(i * half, (i + 1) * half), ...down.slice(i * half, (i + 1) * half)], 7 + i));
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: new URL('../../web/public/play/', import.meta.url).pathname },
      // one or more files, comma separated; an event in two of them counts once
      events: { type: 'string', default: new URL('../public/events.json', import.meta.url).pathname },
      'refresh-spot': { type: 'boolean', default: false },
    },
  });
  const byId = new Map();
  for (const f of values.events.split(',')) for (const e of JSON.parse(readFileSync(f))) byId.set(`${e.symbol}:${e.time}`, e);
  const events = [...byId.values()];
  const spotFile = new URL('../public/spot-usdt.json', import.meta.url);
  if (values['refresh-spot'] || !existsSync(spotFile)) writeFileSync(spotFile, `${JSON.stringify(await spotUsdt())}\n`);
  const spot = new Set(JSON.parse(readFileSync(spotFile)));
  const all = packs(events, spot);
  mkdirSync(values.out, { recursive: true });
  for (const f of readdirSync(values.out)) if (/^rounds-\d+\.json$/.test(f)) rmSync(`${values.out}/${f}`);
  all.forEach((pack, i) => writeFileSync(`${values.out}/rounds-${String(i + 1).padStart(2, '0')}.json`, JSON.stringify(pack)));
  writeFileSync(`${values.out}/index.json`, JSON.stringify({ packs: all.length, rounds: PACK }));
  console.log(`${all.length} packs of ${PACK} rounds in ${values.out}`);
}

// Binance's public archive of futures candles, and the search for sharp moves in it. The pure
// functions here (zip, CSV, the search) are what scripts/archive.test.mjs checks; the network and
// the cache are only in fetchZip and the helpers built on it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/**
 * The archive's own bucket. data.binance.vision is the same bucket behind a CDN, but some networks
 * block it (this cloud's proxy among them) while the bucket answers everywhere.
 */
export const ARCHIVE = process.env.ARCHIVE_URL ?? 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision';
const KLINES = 'data/futures/um/daily/klines';
const CACHE = new URL('../.cache/', import.meta.url).pathname;

export const MINUTE = 60_000;
export const DAY = 1440 * MINUTE;
/** minutes of chart before the event and after it, the same as scripts/events.mjs */
export const BEFORE = 45;
export const AFTER = 75;
/** a move counts from the extreme of the five minutes before the event minute, to the extreme of that minute */
export const WINDOW = 5;
/** fresh listings trade wild and thin; the archive must show this much history before the move */
export const HISTORY = 100;
/** the same slack as SignalRules.RANGE_SLACK: the price before the move sits in the day's range */
export const RANGE_SLACK = 0.02;
/** the candles must show at least this much of the move that was reported, as in scripts/events.mjs */
export const CONFIRM = 0.6;

/** The one file inside a Binance archive zip. Reads the central directory, so a data descriptor does not matter. */
export function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip file');
  const central = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt32LE(central) !== 0x02014b50) throw new Error('broken zip directory');
  const method = buffer.readUInt16LE(central + 10);
  const size = buffer.readUInt32LE(central + 20);
  const local = buffer.readUInt32LE(central + 42);
  const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + size);
  if (method === 0) return data.toString('utf8');
  if (method === 8) return inflateRawSync(data).toString('utf8');
  throw new Error(`zip method ${method} is not supported`);
}

/** Minute candles from an archive CSV, in the shape public/events.json keeps: v is the quote (USDT) volume. */
export function parseKlines(csv) {
  const out = [];
  for (const line of csv.split('\n')) {
    const f = line.split(',');
    // older files have no header line; a header starts with a letter
    if (f.length < 8 || !/^\d/.test(f[0])) continue;
    out.push({ t: +f[0], o: +f[1], h: +f[2], l: +f[3], c: +f[4], v: +f[7] });
  }
  return out;
}

/**
 * The strongest five minute move ending at minute i, signed: from the lowest low (a pump) or the
 * highest high (a dump) of the five minutes before it, or its own open, to its own extreme. The
 * minute's own low cannot be the start of a pump: within a minute nobody knows which came first,
 * and a red candle would read as a rocket.
 */
export function moveAt(bars, i) {
  let lo = bars[i].o;
  let hi = bars[i].o;
  for (let k = i - WINDOW; k < i; k++) {
    lo = Math.min(lo, bars[k].l);
    hi = Math.max(hi, bars[k].h);
  }
  const up = (bars[i].h / lo - 1) * 100;
  const down = (bars[i].l / hi - 1) * 100;
  return up >= -down ? { move: up, base: lo } : { move: down, base: hi };
}

/** No gap in the minutes from a to b, both included. */
function contiguous(bars, a, b) {
  return bars[b].t - bars[a].t === (b - a) * MINUTE;
}

/**
 * The price before the move must sit within the last day's range, as SignalRules.withinDay asks of
 * a live signal: the range is taken from the day before the window, so a broken print in the
 * window itself cannot vouch for itself.
 */
export function withinDay(bars, i, base) {
  const from = Math.max(0, i - 1440);
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = from; k < i - WINDOW; k++) {
    hi = Math.max(hi, bars[k].h);
    lo = Math.min(lo, bars[k].l);
  }
  return base <= hi * (1 + RANGE_SLACK) && base >= lo * (1 - RANGE_SLACK);
}

/**
 * Sharp moves in one coin's minute candles, oldest first: per UTC day the strongest move of at
 * least min percent with a full chart around it, enough history before it and a believable start.
 */
export function findMoves(bars, { min = 5, from = -Infinity, to = Infinity } = {}) {
  const best = new Map();
  for (let i = HISTORY; i + AFTER - 1 < bars.length; i++) {
    if (bars[i].t < from || bars[i].t >= to) continue;
    const { move, base } = moveAt(bars, i);
    if (Math.abs(move) < min) continue;
    // the whole chart and the history before it without a gap: a gap is a fresh listing or a halt
    if (!contiguous(bars, i - HISTORY, i + AFTER - 1)) continue;
    if (!withinDay(bars, i, base)) continue;
    // a V: a crash and a rebound read as a "+49%" over a chart that went down; the five minutes
    // must also end at least half the threshold the move's way
    const net = (bars[i].c / bars[i - WINDOW].o - 1) * 100;
    if (net * Math.sign(move) < min / 2) continue;
    const day = Math.floor(bars[i].t / DAY);
    const kept = best.get(day);
    if (!kept || Math.abs(move) > Math.abs(kept.move)) best.set(day, { i, move });
  }
  return [...best.values()].sort((a, b) => a.i - b.i);
}

/** The event as public/events.json keeps it. */
export function toEvent(symbol, bars, i, move) {
  const candles = bars.slice(i - BEFORE, i + AFTER);
  const at = BEFORE;
  const type = move > 0 ? 'PUMP' : 'DUMP';
  const price = bars[i].c;
  const after = candles.slice(at);
  const extreme = type === 'PUMP' ? Math.max(...after.map((b) => b.h)) : Math.min(...after.map((b) => b.l));
  const base = symbol.replace(/USDT$/, '');
  return {
    id: `${base.toLowerCase()}-${new Date(bars[i].t).toISOString().slice(0, 10)}`,
    symbol,
    base,
    type,
    time: bars[i].t,
    price,
    move: Math.round(move * 10) / 10,
    further: Math.round((extreme / price - 1) * 1000) / 10,
    ret1h: Math.round((candles[at + 60].c / price - 1) * 10000) / 100,
    at,
    candles,
  };
}

/**
 * The check scripts/events.mjs makes of every event: the candles around it show the move it
 * claims, in its direction. Returns the reason it fails, or null.
 */
export function confirm(event, claimed = Math.abs(event.move)) {
  const bars = event.candles;
  const at = event.at;
  if (at < 10 || bars.length < BEFORE + AFTER - 5 || bars[at]?.t !== event.time) return 'not enough history around the event';
  const up = event.type === 'PUMP';
  const window = bars.slice(at - WINDOW, at + 1);
  const base = up ? Math.min(...window.map((b) => b.l)) : Math.max(...window.map((b) => b.h));
  const peak = up ? bars[at].h : bars[at].l;
  const move = (peak / base - 1) * 100;
  if (Math.abs(move) < claimed * CONFIRM || Math.sign(move) !== (up ? 1 : -1)) {
    return `candles show ${move.toFixed(1)}%, the event says ${up ? '+' : '-'}${claimed.toFixed(1)}%`;
  }
  return null;
}

/**
 * Events added to a list without duplicates: the same coin and minute is one event, and ids stay
 * unique (a second event of a coin on the same day gets a suffix).
 */
export function merge(existing, found) {
  const keys = new Set(existing.map((e) => `${e.symbol}@${Math.floor(e.time / MINUTE)}`));
  const ids = new Set(existing.map((e) => e.id));
  const added = [];
  for (const e of found) {
    const key = `${e.symbol}@${Math.floor(e.time / MINUTE)}`;
    if (keys.has(key)) continue;
    keys.add(key);
    let id = e.id;
    for (let n = 2; ids.has(id); n++) id = `${e.id}-${n}`;
    ids.add(id);
    added.push({ ...e, id });
  }
  return { events: [...existing, ...added], added };
}

const day = (t) => new Date(t).toISOString().slice(0, 10);

/** A zip from the archive, cached; null when the archive has no such file (yet). */
export async function fetchZip(path) {
  const file = `${CACHE}${path.replaceAll('/', '_')}`;
  if (existsSync(file)) return readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(`${ARCHIVE}/${path}`);
      if (response.status === 404 || response.status === 403) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, buffer);
      return buffer;
    } catch (e) {
      if (attempt === 4) throw new Error(`${path}: ${e.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
}

export async function minuteCandles(symbol, t) {
  const zip = await fetchZip(`${KLINES}/${symbol}/1m/${symbol}-1m-${day(t)}.zip`);
  return zip ? parseKlines(unzip(zip)) : [];
}

/** USDT turnover of a coin over one UTC day, from the archive's daily candle. */
export async function dayVolume(symbol, t) {
  const zip = await fetchZip(`${KLINES}/${symbol}/1d/${symbol}-1d-${day(t)}.zip`);
  const bar = zip ? parseKlines(unzip(zip))[0] : null;
  return bar ? bar.v : 0;
}

/** Every USDT perpetual the archive has: the bucket listing, page by page, without dated quarterlies. */
export async function listSymbols() {
  const symbols = [];
  let marker = '';
  for (;;) {
    const url = `${ARCHIVE}?delimiter=/&prefix=${KLINES}/&marker=${encodeURIComponent(marker)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`listing: HTTP ${response.status}`);
    const xml = await response.text();
    const names = [...xml.matchAll(/<Prefix>[^<]*\/klines\/([^/<]+)\/<\/Prefix>/g)].map((m) => m[1]);
    symbols.push(...names);
    const next = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/);
    if (!xml.includes('<IsTruncated>true</IsTruncated>') || !next) break;
    marker = next[1];
  }
  return symbols.filter((s) => /^[A-Z0-9]+USDT$/.test(s));
}

/** The newest day the archive already has, looked up on BTC: files appear about a day late. */
export async function lastDay(now = Date.now()) {
  for (let back = 1; back <= 5; back++) {
    const t = Math.floor(now / DAY) * DAY - back * DAY;
    if (await fetchZip(`${KLINES}/BTCUSDT/1d/BTCUSDT-1d-${day(t)}.zip`)) return t;
  }
  throw new Error('the archive has no BTCUSDT day in the last five days');
}

/** Runs task over items, a few at a time. */
export async function pool(items, size, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        results[k] = await task(items[k], k);
      }
    }),
  );
  return results;
}

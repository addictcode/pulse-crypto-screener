// node --test: every event the videos are built on passes the candle check, whichever source it came from.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MINUTE, confirm } from './archive.mjs';
import { MAX_MOVE, fromEvent, problem } from './clean.mjs';

const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));
const spot = new Set(JSON.parse(readFileSync(new URL('../public/spot-usdt.json', import.meta.url))));

test('public/events.json: the candles confirm every event', () => {
  for (const e of events) assert.equal(confirm(e), null, e.id);
});

test('public/events.json: ids are unique and no coin minute is there twice', () => {
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(new Set(events.map((e) => `${e.symbol}@${Math.floor(e.time / MINUTE)}`)).size, events.length);
});

test('public/events.json: only crypto, no move past the cap, no one-candle spikes (scripts/clean.mjs)', () => {
  for (const e of events) assert.equal(problem(fromEvent(e), spot), null, e.id);
});

test('the rules of clean.mjs catch what they are for', () => {
  const flat = (n, p = 100) => Array.from({ length: n }, () => ({ o: p, h: p, l: p, c: p }));
  const pump = (peak, closeAt, closeNext) => [...flat(6), { o: 100, h: peak, l: 100, c: closeAt }, { o: closeAt, h: closeAt, l: closeAt, c: closeNext }];
  const btc = new Set(['BTCUSDT', 'PEPEUSDT']);
  assert.equal(problem({ symbol: 'BTCUSDT', type: 'PUMP', at: 6, bars: pump(110, 108, 109) }, btc), null);
  assert.match(problem({ symbol: 'INTCUSDT', type: 'PUMP', at: 6, bars: pump(110, 108, 109) }, btc), /not crypto/);
  assert.equal(problem({ symbol: '1000PEPEUSDT', type: 'PUMP', at: 6, bars: pump(110, 108, 109) }, btc), null);
  assert.match(problem({ symbol: 'BTCUSDT', type: 'PUMP', at: 6, bars: pump(100 + MAX_MOVE + 5, 120, 125) }, btc), /past/);
  // up 10% within the minute, back to 100.5 by its close and 100.2 a minute later: a wick
  assert.match(problem({ symbol: 'BTCUSDT', type: 'PUMP', at: 6, bars: pump(110, 100.5, 100.2) }, btc), /spike/);
  // a trap that gives back half within the hour is a story, not a spike
  assert.equal(problem({ symbol: 'BTCUSDT', type: 'PUMP', at: 6, bars: pump(110, 105, 104) }, btc), null);
});

// node --test: the rounds of the site's game (scripts/play-rounds.mjs).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

import { fromRound, problem } from './clean.mjs';
import { AFTER, BEFORE, PACK, hourAfter, isCrypto, packs, toRound } from './play-rounds.mjs';

const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));
const spot = new Set(JSON.parse(readFileSync(new URL('../public/spot-usdt.json', import.meta.url))));
// the packs the site serves, made from a bigger set than events.json (see video/README.md)
const served = new URL('../../web/public/play/', import.meta.url);
const committed = readdirSync(served).filter((f) => /^rounds-\d+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(new URL(f, served))));

test('the site has packs of ten rounds with a clear answer, each event once, only crypto', () => {
  const all = committed;
  assert.ok(all.length >= 5);
  assert.equal(JSON.parse(readFileSync(new URL('index.json', served))).packs, all.length);
  for (const r of all.flat()) assert.ok(spot.has(`${r.coin}USDT`) || spot.has(`${r.coin.replace(/^1000+/, '')}USDT`), r.coin);
  const ids = all.flat().map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const pack of all) {
    assert.equal(pack.length, PACK);
    assert.equal(pack.filter((r) => r.hour > 0).length, PACK / 2, 'half the answers up, so "always up" is a coin');
    for (const r of pack) {
      assert.ok(Math.abs(r.hour) >= 1, `${r.id}: ${r.hour}`);
      assert.equal(r.candles.length, BEFORE + AFTER);
      assert.equal(r.at, BEFORE - 1);
    }
  }
});

test('the answer is the real hour after the signal, from the same candles the page plays', () => {
  for (const pack of committed) {
    for (const r of pack) {
      const last = r.candles[r.candles.length - 1][3];
      assert.ok(Math.abs((last / r.price - 1) * 100 - r.hour) < 0.05, r.id);
      assert.equal(r.candles[r.at][3], r.price, `${r.id}: the question stops on the signal candle`);
    }
  }
});

test('a round is cut where the event is and counts its hour from the signal price', () => {
  const candles = Array.from({ length: 120 }, (_, i) => ({ t: i * 60_000, o: 100, h: 101, l: 99, c: i <= 45 ? 100 : 103, v: 1 }));
  const event = { id: 'x', base: 'XYZ', type: 'PUMP', time: Date.UTC(2026, 9, 9), price: 100, at: 45, candles };
  assert.ok(Math.abs(hourAfter(event) - 3) < 1e-9);
  const r = toRound(event);
  assert.equal(r.day, '2026-10-09');
  assert.equal(r.candles.length, BEFORE + AFTER);
  assert.deepEqual(r.candles[r.at], [100, 101, 99, 100]);
  assert.deepEqual(r.candles[r.at + 1], [100, 101, 99, 103]);
});

test('only crypto: perpetuals on shares stay out of the game', () => {
  const coins = new Set(packs(events, spot).flat().map((r) => r.coin));
  for (const share of ['INTC', 'HOOD', 'AMZN', 'MRVL', 'SOXL']) assert.ok(!coins.has(share), share);
  assert.ok(isCrypto({ symbol: '1000PEPEUSDT' }, new Set(['PEPEUSDT'])));
  assert.ok(!isCrypto({ symbol: 'INTCUSDT' }, new Set(['BTCUSDT'])));
});

test('the rounds the site serves keep the rules of the videos (scripts/clean.mjs)', () => {
  for (const r of committed.flat()) assert.equal(problem(fromRound(r), spot), null, r.id);
});

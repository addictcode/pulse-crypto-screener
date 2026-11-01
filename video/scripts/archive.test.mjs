// node --test: the search for sharp moves on a small synthetic archive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { AFTER, BEFORE, DAY, MINUTE, confirm, findMoves, merge, moveAt, parseKlines, toEvent, unzip, withinDay } from './archive.mjs';

const HEADER = 'open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore';
const T0 = Date.UTC(2026, 9, 1);

/** A flat market at 100 with given minutes replaced, as archive CSV. */
function csv(minutes, changes = {}, start = T0) {
  const lines = [HEADER];
  for (let i = 0; i < minutes; i++) {
    const [o, h, l, c] = changes[i] ?? [100, 100.1, 99.9, 100];
    lines.push([start + i * MINUTE, o, h, l, c, 10, start + i * MINUTE + 59_999, 1000, 5, 5, 500, 0].join(','));
  }
  return lines.join('\n');
}

/** A minimal zip with one deflated file, laid out the way Binance's are. */
function zip(name, text) {
  const data = deflateRawSync(Buffer.from(text));
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt32LE(30 + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

test('a zip from the archive reads back to its CSV, header or not', () => {
  const text = csv(3);
  assert.equal(unzip(zip('X-1m.csv', text)), text);
  const bars = parseKlines(text);
  assert.equal(bars.length, 3);
  assert.deepEqual(bars[0], { t: T0, o: 100, h: 100.1, l: 99.9, c: 100, v: 1000 });
  assert.equal(parseKlines(text.split('\n').slice(1).join('\n')).length, 3);
});

test('a pump of 8% in five minutes is found at its top minute', () => {
  const bars = parseKlines(csv(400, { 200: [100, 103, 100, 103], 201: [103, 106, 103, 106], 202: [106, 108, 105, 107] }));
  const moves = findMoves(bars, { min: 5 });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].i, 202);
  assert.ok(Math.abs(moves[0].move - (108 / 99.9 - 1) * 100) < 1e-9);
});

test('a dump is signed down; small moves are ignored', () => {
  const bars = parseKlines(csv(400, { 150: [100, 100, 96, 96], 151: [96, 96, 93, 93.5], 300: [100, 103, 100, 102] }));
  const moves = findMoves(bars, { min: 5 });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].i, 151);
  assert.ok(moves[0].move < -6);
  assert.equal(moveAt(bars, 300).move > 0 && moveAt(bars, 300).move < 5, true);
});

test('one move per coin a day, the strongest', () => {
  const bars = parseKlines(csv(1440 + 400, { 200: [100, 106, 100, 105], 600: [100, 110, 100, 108], 1640: [100, 107, 100, 106] }));
  const moves = findMoves(bars, { min: 5 });
  assert.deepEqual(moves.map((m) => m.i), [600, 1640]);
});

test('no event without 100 minutes of history before it or a full chart after it', () => {
  // a fresh listing: the jump comes 50 minutes after the first candle
  assert.equal(findMoves(parseKlines(csv(300, { 50: [100, 110, 100, 109] })), { min: 5 }).length, 0);
  // too close to the end of the data for 75 minutes after
  assert.equal(findMoves(parseKlines(csv(300, { 260: [100, 110, 100, 109] })), { min: 5 }).length, 0);
  // a gap in the minutes before it: a halt or a relisting
  const bars = parseKlines(csv(400, { 200: [100, 110, 100, 109] }));
  bars.splice(150, 10);
  assert.equal(findMoves(bars, { min: 5 }).length, 0);
});

test('the price before the move must be inside the day so far', () => {
  // the move starts from a print far below anything traded before it: a broken candle
  const changes = { 195: [100, 100, 60, 61], 196: [61, 61, 60, 61], 197: [61, 62, 60, 62], 198: [62, 62, 61, 62], 199: [62, 63, 61, 63], 200: [63, 70, 63, 69] };
  const bars = parseKlines(csv(400, changes));
  assert.equal(withinDay(bars, 200, 60), false);
  assert.equal(findMoves(bars, { min: 5 }).filter((m) => m.i === 200).length, 0);
});

test('an event has the chart around it and passes the check scripts/events.mjs makes', () => {
  const bars = parseKlines(csv(400, { 200: [100, 104, 100, 104], 201: [104, 107, 104, 106] }));
  const [{ i, move }] = findMoves(bars, { min: 5 });
  const e = toEvent('TESTUSDT', bars, i, move);
  assert.equal(e.candles.length, BEFORE + AFTER);
  assert.equal(e.candles[e.at].t, e.time);
  assert.equal(e.type, 'PUMP');
  assert.equal(e.base, 'TEST');
  assert.equal(e.id, 'test-2026-10-01');
  assert.equal(confirm(e), null);
  // a claim the candles do not back is refused
  assert.match(confirm(e, 20), /candles show/);
  assert.match(confirm({ ...e, type: 'DUMP' }), /candles show/);
});

test('merging adds new events once and keeps ids unique', () => {
  const a = { id: 'x-2026-10-01', symbol: 'XUSDT', time: T0 + 5 * MINUTE + 1234 };
  const b = { id: 'x-2026-10-01', symbol: 'XUSDT', time: T0 + 5 * MINUTE }; // same minute: a duplicate
  const c = { id: 'x-2026-10-01', symbol: 'XUSDT', time: T0 + 600 * MINUTE }; // same day, another minute
  const d = { id: 'y-2026-10-02', symbol: 'YUSDT', time: T0 + DAY };
  const { events, added } = merge([a], [b, c, d, c]);
  assert.deepEqual(added.map((e) => e.id), ['x-2026-10-01-2', 'y-2026-10-02']);
  assert.equal(events.length, 3);
});

test('a falling candle is a dump, not a pump from its own low', () => {
  // one long red minute: open 100, high 100.1, low 70; nothing before it moved
  const bars = parseKlines(csv(400, { 200: [100, 100.1, 70, 72] }));
  const { move } = moveAt(bars, 200);
  assert.ok(move < -29, `got ${move}`);
  const [found] = findMoves(bars, { min: 5 });
  assert.equal(toEvent('XUSDT', bars, found.i, found.move).type, 'DUMP');
});

test('a crash and a rebound in the same five minutes is not a pump', () => {
  const bars = parseKlines(csv(400, { 198: [100, 100, 80, 82], 199: [82, 90, 81, 89], 200: [89, 99, 88, 98] }));
  assert.ok(moveAt(bars, 200).move > 20);
  assert.equal(findMoves(bars, { min: 5 }).some((m) => m.i === 200), false);
});

test('the day around an event: 288 five minute bars, the event two thirds in, none without a full day', async () => {
  const { dayAround } = await import('./days.mjs');
  const minutes = parseKlines(csv(3 * 1440, { [1440 + 600]: [100, 108, 100, 107] }));
  const t = T0 + (1440 + 600) * MINUTE;
  const day = dayAround(minutes, t);
  assert.equal(day.bars.length, 288);
  assert.equal(day.at, 192);
  assert.equal(day.bars[day.at][1], 108);
  // late in the data the day slides back to end with it
  const late = dayAround(minutes, T0 + (3 * 1440 - 30) * MINUTE);
  assert.equal(late.start + 288 * 5 * MINUTE, T0 + 3 * 1440 * MINUTE);
  // a gap: no day
  minutes.splice(1500, 30);
  assert.equal(dayAround(minutes, t), null);
});

test('the pulse hour: five minute changes per minute, null where the coin has no bars', async () => {
  const { changes, MINUTES } = await import('./pulse.mjs');
  const bars = parseKlines(csv(200, { 100: [100, 110, 100, 110] }));
  const c = changes(bars, T0 + 60 * MINUTE);
  assert.equal(c.length, MINUTES);
  assert.equal(c[40], 10); // minute 100: 110 against 100 five minutes before
  assert.equal(c[45], -9.1); // minute 105: back to 100 against 110
  assert.equal(c[0], 0);
  assert.equal(changes(bars, T0 + 180 * MINUTE)[30], null);
});

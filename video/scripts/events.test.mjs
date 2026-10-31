// node --test: every event the videos are built on passes the candle check, whichever source it came from.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MINUTE, confirm } from './archive.mjs';

const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));

test('public/events.json: the candles confirm every event', () => {
  for (const e of events) assert.equal(confirm(e), null, e.id);
});

test('public/events.json: ids are unique and no coin minute is there twice', () => {
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
  assert.equal(new Set(events.map((e) => `${e.symbol}@${Math.floor(e.time / MINUTE)}`)).size, events.length);
});

// node --test: the series "I tested 60,329 crypto signals" (src/series.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PARTS, SERIES, beatFrames, episodeFrames, script } from '../src/series.ts';

/** Every number a beat shows, so the two languages can be compared. */
function numbers(beat) {
  switch (beat.kind) {
    case 'stat':
      return [beat.value];
    case 'compare':
      return [beat.a.value, beat.b.value];
    case 'range':
      return [beat.value, beat.low, beat.high];
    case 'halves':
      return [beat.first.value, beat.first.ok, beat.second.value, beat.second.ok];
    case 'versus':
      return [beat.a.value, beat.b.value, beat.result];
    default:
      return [];
  }
}

test('both languages tell the same six parts with the same numbers', () => {
  assert.equal(SERIES.ru.length, PARTS);
  assert.equal(SERIES.en.length, PARTS);
  SERIES.ru.forEach((ru, i) => {
    const en = SERIES.en[i];
    assert.equal(en.slug, ru.slug);
    assert.deepEqual(en.beats.map((b) => b.kind), ru.beats.map((b) => b.kind), `${ru.slug}: scenes differ`);
    assert.deepEqual(en.beats.map(numbers), ru.beats.map(numbers), `${ru.slug}: numbers differ`);
  });
});

test('every part ends on the end card and stays under a minute', () => {
  for (const episode of [...SERIES.ru, ...SERIES.en]) {
    assert.equal(episode.beats.at(-1).kind, 'outro', episode.slug);
    assert.ok(episodeFrames(episode) < 60 * 30, `${episode.slug} is too long`);
    assert.ok(episode.beats.every((b) => b.say.trim().length > 0), `${episode.slug}: a beat has nothing to say`);
  }
});

test('a beat lasts long enough for its narration', () => {
  const long = { kind: 'text', text: 'x', say: Array(30).fill('слово').join(' ') };
  assert.ok(beatFrames(long) >= (30 / 2.5) * 30);
});

test('the voiceover lists every line with its start time', () => {
  const text = script(SERIES.ru[0], 'ru');
  assert.match(text, /^## Я проверил/);
  assert.equal(text.split('\n').filter((l) => /^\d:\d\d {2}/.test(l)).length, SERIES.ru[0].beats.length);
});

test('the headline numbers match the research report', () => {
  const report = readFileSync(new URL('../../research/signals-2026-10.md', import.meta.url), 'utf8');
  assert.match(report, /Сигналов после кулдаунов: 60329 \(PUMP 9956, DUMP 9247/);
  const stats = SERIES.ru.flatMap((e) => e.beats).filter((b) => b.kind === 'stat').map((b) => b.value);
  assert.deepEqual(stats, [60329, 9956, 9247]);
});

test('part 6 says only what the second study found', () => {
  const report = readFileSync(new URL('../../research/oi-funding-2026-11.md', import.meta.url), 'utf8');
  // "almost twice as much": PUMP and OPEN_INTEREST on the checking half, against the usual hour
  assert.match(report, /\| PUMP \| проверочная \| \d+ \| ×1\.8\d/);
  assert.match(report, /\| OPEN_INTEREST \| проверочная \| \d+ \| ×2\.\d+/);
  const said = [...SERIES.ru, ...SERIES.en].find((e) => e.slug === 'signals-6').beats.map((b) => b.say).join(' ');
  assert.doesNotMatch(said, /наверняка|guaranteed|always|всегда/);
});

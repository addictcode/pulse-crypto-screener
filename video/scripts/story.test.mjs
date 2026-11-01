// node --test: how a video tells an event (src/story.ts) and the words it may use (src/text.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { TELLINGS, story } from '../src/story.ts';
import { LANGS, TEXT, pct } from '../src/text.ts';

const events = JSON.parse(readFileSync(new URL('../public/events.json', import.meta.url)));

/** An event at 100 that moved `move` percent in the signal minute, then went along `path` (closes). */
function event(type, move, path) {
  const candles = [];
  for (let i = 0; i < 45; i++) candles.push({ t: i * 60_000, o: 100, h: 100, l: 100, c: 100, v: 1 });
  const price = 100 * (1 + move / 100);
  candles.push({ t: 45 * 60_000, o: 100, h: Math.max(100, price), l: Math.min(100, price), c: price, v: 1 });
  let last = price;
  for (let i = 0; i < 74; i++) {
    const c = path[Math.min(path.length - 1, Math.floor((i * path.length) / 74))];
    candles.push({ t: (46 + i) * 60_000, o: last, h: Math.max(last, c), l: Math.min(last, c), c, v: 1 });
    last = c;
  }
  return { id: 'test-2026-10-01', symbol: 'TESTUSDT', base: 'TEST', type, time: 45 * 60_000, price, move, at: 45, candles };
}

test('a pump that keeps going is a rocket, one that gives a third back is a trap, else flat', () => {
  assert.equal(story(event('PUMP', 10, [112, 116, 115]), 0).plot, 'rocket');
  assert.equal(story(event('PUMP', 10, [108, 104, 105]), 0).plot, 'trap');
  assert.equal(story(event('PUMP', 10, [111, 110, 110.5]), 0).plot, 'flat');
});

test('the same for a dump, mirrored', () => {
  assert.equal(story(event('DUMP', -10, [88, 84, 85]), 0).plot, 'rocket');
  assert.equal(story(event('DUMP', -10, [93, 96, 95]), 0).plot, 'trap');
  assert.equal(story(event('DUMP', -10, [89, 90, 89.5]), 0).plot, 'flat');
});

test('the numbers are the real ones, with their signs', () => {
  const s = story(event('PUMP', 10, [108, 104, 104.5]), 2);
  assert.ok(s.hour < 0 && s.further >= 0 && s.up);
  // a trap's punchline shows the loss with a minus
  assert.match(s.punch, new RegExp(pct(s.hour).replace(/[.+]/g, '\\$&')));
  assert.ok(pct(s.hour).startsWith('−'));
  assert.equal(pct(12.34), '+12%');
  assert.equal(pct(-4.25), '−4.3%');
  assert.equal(pct(0), '0.0%');
  // a rocket's "more" is the run further, in the move's direction
  const r = story(event('DUMP', -10, [88, 84, 85]), 0, 'en');
  assert.match(r.punch, /−/);
});

test('neighbouring tellings of one event differ', () => {
  const e = events[0];
  for (const lang of LANGS) {
    const hooks = Array.from({ length: TELLINGS }, (_, v) => story(e, v, lang).hook);
    assert.equal(new Set(hooks).size, TELLINGS, lang);
  }
});

/** Everything a video of these events could show or post, in one language. */
function allText(lang) {
  const t = TEXT[lang];
  const out = [];
  for (const e of events) {
    for (let v = 0; v < TELLINGS; v++) {
      const s = story(e, v, lang);
      out.push({ e, text: [s.hook, s.punch, s.calm, s.caption].join('\n') });
    }
    const s = story(e, 0, lang);
    out.push({ e, text: [t.guess.answer(s.hour), t.counter.after(s.hour), t.notice(s.up, `${Math.abs(e.move)}%`)].join('\n') });
  }
  const fixed = [t.chartLabel, t.in5, t.now, ...Object.values(t.outro), t.note, t.tags, t.guess.question, t.guess.up, t.guess.down, t.guess.comment];
  for (const list of [t.calm, t.guess.hooks, t.guess.captions, t.top3.hooks, t.top3.captions, t.counter.hooks, t.counter.captions]) fixed.push(...list);
  out.push({ e: null, text: fixed.join('\n') });
  return out;
}

const MONTHS = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|январ|феврал|март|апрел|ма[йя]\b|июн|июл|август|сентябр|октябр|ноябр|декабр/i;
const CLOCK = /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(am|pm)\b|\bв \d+ (ночи|утра|дня|вечера)\b|\b(at night|midnight|morning|tonight|ночью|утром|вечером)\b/i;

for (const lang of LANGS) {
  test(`${lang}: no ticker, no date, no time of day in any text`, () => {
    for (const { e, text } of allText(lang)) {
      // one or two letter tickers (T, ON, BE) are ordinary words; the full symbol is checked always
      if (e && e.base.length >= 3) {
        assert.ok(!new RegExp(`\\b${e.base}\\b`, 'i').test(text), `${e.id}: ticker in ${JSON.stringify(text)}`);
      }
      if (e) assert.ok(!text.includes(e.symbol), `${e.id}: symbol`);
      assert.ok(!/\b20\d\d\b/.test(text), `a year in ${JSON.stringify(text)}`);
      assert.ok(!/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text), `a date in ${JSON.stringify(text)}`);
      assert.ok(!MONTHS.test(text), `a month in ${JSON.stringify(text)}`);
      assert.ok(!CLOCK.test(text), `a time of day in ${JSON.stringify(text)}`);
    }
  });
}

test('en: not a letter of Cyrillic anywhere', () => {
  for (const { text } of allText('en')) assert.ok(!/[Ѐ-ӿ]/.test(text), JSON.stringify(text));
});

test('every post says it is not financial advice', () => {
  assert.match(TEXT.ru.note, /Не финансовый совет/);
  assert.match(TEXT.en.note, /Not financial advice/);
  assert.match(TEXT.ru.outro.note, /Не финансовый совет/);
  assert.match(TEXT.en.outro.note, /Not financial advice/);
});

test('both languages have the same tellings: five per plot and direction, five of each template', () => {
  for (const lang of LANGS) {
    const t = TEXT[lang];
    for (const key of ['rocket-up', 'rocket-down', 'trap-up', 'trap-down', 'flat-up', 'flat-down']) assert.equal(t.pairs[key].length, TELLINGS, `${lang} ${key}`);
    for (const list of [t.calm, t.guess.hooks, t.guess.captions, t.top3.hooks, t.top3.captions, t.counter.hooks, t.counter.captions]) assert.equal(list.length, 5, lang);
  }
});

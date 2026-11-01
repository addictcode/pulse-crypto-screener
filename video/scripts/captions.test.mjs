// Post descriptions for the other platforms: Instagram Reels and YouTube Shorts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LANGS, SHORTS_TITLE_MAX, TEXT, post, postReels, shorts } from '../src/text.ts';
import { plan } from './plan.mjs';

test('every video has a Shorts title YouTube does not cut, and the honesty note under it', () => {
  for (const lang of LANGS) {
    for (const job of plan(lang)) {
      const { title, description } = shorts(lang, job.caption);
      assert.ok(title.length <= SHORTS_TITLE_MAX, `${lang} "${title}" is ${title.length} characters`);
      assert.ok(title.startsWith(job.caption.slice(0, 20)), title);
      assert.ok(description.includes(TEXT[lang].note), description);
      assert.ok(description.includes('#shorts'), description);
    }
  }
});

test('a title that would not fit drops #shorts first, then is cut at a word', () => {
  const ninety = 'слово '.repeat(16).trim(); // 95 characters: with " #shorts" it would be 103
  assert.equal(shorts('ru', ninety).title, ninety);
  const long = 'word '.repeat(30).trim();
  const { title } = shorts('en', long);
  assert.ok(title.length <= SHORTS_TITLE_MAX);
  assert.match(title, /^(word )+word…$/);
});

test('Reels get the same words with their own hashtags', () => {
  for (const lang of LANGS) {
    const caption = plan(lang)[0].caption;
    const reels = postReels(lang, caption);
    assert.equal(reels.split('\n')[0], post(lang, caption).split('\n')[0]);
    assert.ok(reels.endsWith(TEXT[lang].reelsTags));
    assert.notEqual(TEXT[lang].reelsTags, TEXT[lang].tags);
    assert.notEqual(TEXT[lang].shortsTags, TEXT[lang].tags);
  }
});

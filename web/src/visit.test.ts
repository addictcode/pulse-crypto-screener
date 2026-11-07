import { describe, expect, it } from 'vitest';

import { sourceOf, withoutTag } from './visit';

describe('sourceOf', () => {
  it('prefers a tag in the address', () => {
    expect(sourceOf('?utm_source=tiktok&utm_medium=bio', 'https://www.google.com/', 'pulse.example', null)).toBe('tiktok');
    expect(sourceOf('?ref=tg', '', 'pulse.example', 'google')).toBe('tg');
  });

  it('falls back to the site that linked here', () => {
    expect(sourceOf('', 'https://www.tiktok.com/@pulse', 'pulse.example', null)).toBe('www.tiktok.com');
  });

  it('keeps the source of the visit when moving between our own pages', () => {
    expect(sourceOf('', 'https://pulse.example/', 'pulse.example', 'www.tiktok.com')).toBe('www.tiktok.com');
    expect(sourceOf('', 'https://pulse.example/', 'pulse.example', null)).toBe('');
  });

  it('is empty for a typed address', () => {
    expect(sourceOf('', '', 'pulse.example', null)).toBe('');
    expect(sourceOf('', 'not a url', 'pulse.example', null)).toBe('');
  });
});

describe('the address after the tag is read', () => {
  it('loses ref and utm_ tags and keeps everything else', () => {
    expect(withoutTag('https://x.org/app/?utm_source=tiktok&utm_campaign=a&lang=ru#screener:SOLUSDT')).toBe('/app/?lang=ru#screener:SOLUSDT');
    expect(withoutTag('https://x.org/?ref=direct')).toBe('/');
  });

  it('leaves an address without tags alone', () => {
    expect(withoutTag('https://x.org/record/#7')).toBeNull();
  });
});

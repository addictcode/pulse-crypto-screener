import { describe, expect, it } from 'vitest';

import { deeper, headTags, russianTwin, translateHtml, twinOf } from '../seo';

const DICT = { 'Open terminal': 'Открыть терминал', 'Pulse home': 'На главную Pulse', 'Hello & bye': 'Привет и пока', '<em>wakes up</em>.': '<em>просыпается</em>.', Title: 'Заголовок' };

describe('the Russian twin of a page', () => {
  it('carries the Russian text in the HTML itself', () => {
    const html = '<html lang="en"><head><title>Title</title></head><body><a class="cta" href="app/" data-i18n>Open terminal</a>'
      + '<a href="./" data-i18n-attrs="aria-label" aria-label="Pulse home">x</a><span data-i18n>Hello &amp; bye</span>'
      + '<span data-i18n-html><em>wakes up</em>.</span><span data-i18n>Not in the dictionary</span></body></html>';
    const ru = translateHtml(html, DICT);
    expect(ru).toContain('<html lang="ru" data-page-lang="ru">');
    expect(ru).toContain('<title>Заголовок</title>');
    expect(ru).toContain('data-i18n>Открыть терминал</a>');
    expect(ru).toContain('aria-label="На главную Pulse"');
    expect(ru).toContain('>Привет и пока</span>');
    expect(ru).toContain('<em>просыпается</em>.');
    expect(ru).toContain('>Not in the dictionary<');
  });

  it('points one level up for the terminal and the build files, and stays in /ru/ for the twins', () => {
    const html = '<a href="app/">t</a><a href="record/">r</a><a href="../app/">t</a><script src="./assets/x.js"></script>'
      + '<link href="/assets/y.css"><a href="#live">l</a><a href="https://example.org/app/">e</a>';
    expect(deeper(html)).toBe('<a href="../app/">t</a><a href="record/">r</a><a href="../../app/">t</a><script src="../assets/x.js"></script>'
      + '<link href="/assets/y.css"><a href="#live">l</a><a href="https://example.org/app/">e</a>');
  });

  it('links the two languages with addresses Caddy completes, or hides the demo', () => {
    expect(headTags('record/index.html', true, false)).toContain('<link rel="canonical" href="https://{{.Host}}/ru/record/">');
    expect(headTags('index.html', false, false)).toContain('hreflang="ru" href="https://{{.Host}}/ru/"');
    expect(headTags('index.html', false, false)).toContain('"@type":"WebApplication"');
    expect(headTags('index.html', false, true)).toBe('<meta name="robots" content="noindex">');
    expect(twinOf('index.html', false)).toBe('ru/');
    expect(twinOf('index.html', true)).toBe('../');
    expect(twinOf('record/index.html', false)).toBe('../ru/record/');
    expect(twinOf('record/index.html', true)).toBe('../../record/');
  });

  it('swaps the head and the switch on the twin', () => {
    const english = `<html lang="en"><head>${headTags('index.html', false, false)}\n</head><div id="lang" data-twin="ru/"></div></html>`;
    const ru = russianTwin(english, 'index.html', DICT, false);
    expect(ru).toContain('rel="canonical" href="https://{{.Host}}/ru/"');
    expect(ru).toContain('data-twin="../"');
  });
});

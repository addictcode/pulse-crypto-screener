import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ES } from './locale-es';
import { RU } from './locale-ru';
import { TR } from './locale-tr';

const src = import.meta.dirname;
const read = (path: string) => readFileSync(path, 'utf8');
const unescapeHtml = (text: string) =>
  text.replace(/&ge;/g, '≥').replace(/&times;/g, '×').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

/** Every `t('…')` and `t("…")` literal in the source, or in the given files only. */
function codeKeys(only?: string[]): string[] {
  const keys: string[] = [];
  for (const file of only ?? readdirSync(src)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file.startsWith('locale-')) continue;
    const text = read(join(src, file));
    // `tr` is the same function where a module already has a local called `t`
    for (const m of text.matchAll(/\b(?:t|tr)\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.push(m[1].replace(/\\'/g, "'"));
    for (const m of text.matchAll(/\b(?:t|tr)\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.push(m[1]);
  }
  return keys;
}

/** Text of `data-i18n` elements, HTML of `data-i18n-html` ones and the listed attributes. */
function htmlKeys(path: string): string[] {
  const html = read(path);
  const keys: string[] = [];
  for (const m of html.matchAll(/<title>([^<]*)<\/title>/g)) keys.push(m[1]);
  for (const m of html.matchAll(/<[a-z0-9]+\b[^>]*\sdata-i18n(?=[\s>])[^>]*>([^<]*)</g)) keys.push(m[1]);
  for (const m of html.matchAll(/<([a-z0-9]+)\b[^>]*\sdata-i18n-html[^>]*>(.*?)<\/\1>/g)) keys.push(m[2]);
  for (const m of html.matchAll(/<[a-z0-9]+\b([^>]*\sdata-i18n-attrs="([^"]*)"[^>]*)>/g)) {
    for (const name of m[2].split(',')) {
      const value = new RegExp(`\\s${name.trim()}="([^"]*)"`).exec(m[1]);
      if (value) keys.push(value[1]);
    }
  }
  return keys.map((k) => unescapeHtml(k).trim()).filter(Boolean);
}

/** Strings that reach `t()` through a variable: indicator descriptions and labels from the backend. */
function dynamicKeys(): string[] {
  const studies = read(join(src, 'studies.ts'));
  return [
    ...[...studies.matchAll(/hint: '([^']*)'/g)].map((m) => m[1]),
    ...[...studies.matchAll(/group: '([^']*)' \}/g)].map((m) => m[1]),
    // the statistics panes have plain-language names; the indicators keep their own (EMA, RSI, ...)
    ...[...studies.matchAll(/name: '([^']*)', hint: '[^']*', group: 'Positioning'/g)].map((m) => m[1]),
    // dev.pulse.signal.SignalType#label(direction)
    'Pump', 'Dump', 'Volume', 'Open interest', 'Funding', 'Liquidations', 'Near wall',
    'Volume, price up', 'Volume, price down', 'OI climbs', 'OI drops', 'Funding positive', 'Funding negative',
    'Shorts liquidated', 'Longs liquidated', 'Near bid wall', 'Near ask wall',
    // the game's verdict, picked by play-game.ts#verdict
    ...[...read(join(src, 'play-game.ts')).matchAll(/return '([^']*)';/g)].map((m) => m[1]),
  ];
}

describe('Russian locale', () => {
  const keys = [
    ...codeKeys(),
    ...htmlKeys(join(src, '../app/index.html')),
    ...htmlKeys(join(src, '../index.html')),
    ...htmlKeys(join(src, '../record/index.html')),
    ...htmlKeys(join(src, '../play/index.html')),
    ...dynamicKeys(),
  ];

  it('finds the strings it is supposed to check', () => {
    expect(keys.length).toBeGreaterThan(150);
  });

  it('translates every string of the interface', () => {
    const missing = [...new Set(keys)].filter((key) => !(key in RU));
    expect(missing).toEqual([]);
  });

  it('keeps every placeholder of the original', () => {
    const broken = Object.entries(RU).filter(([en, ru]) => {
      const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
      return names(en) !== names(ru);
    });
    expect(broken).toEqual([]);
  });

  it('has no entries left over from removed strings', () => {
    const used = new Set(keys);
    expect(Object.keys(RU).filter((key) => !used.has(key))).toEqual([]);
  });
});

describe('draft translations of the public pages', () => {
  // the landing, the record and the game, with the modules they use; the terminal is English and Russian only
  const keys = [
    ...codeKeys(['landing.ts', 'record.ts', 'play.ts', 'telegram.ts', 'tape.ts', 'format.ts']),
    ...htmlKeys(join(src, '../index.html')),
    ...htmlKeys(join(src, '../record/index.html')),
    ...htmlKeys(join(src, '../play/index.html')),
    ...[...read(join(src, 'play-game.ts')).matchAll(/return '([^']*)';/g)].map((m) => m[1]),
    // signal labels from the backend, on the record page
    'Pump', 'Dump', 'Volume', 'Open interest', 'Funding', 'Liquidations', 'Near wall',
  ];

  for (const [name, dict] of [['Spanish', ES], ['Turkish', TR]] as const) {
    it(`${name} covers every string of those pages`, () => {
      expect([...new Set(keys)].filter((key) => !(key in dict))).toEqual([]);
    });

    it(`${name} has nothing the Russian dictionary does not know`, () => {
      expect(Object.keys(dict).filter((key) => !(key in RU))).toEqual([]);
    });

    it(`${name} keeps the placeholders and the markup`, () => {
      for (const [key, value] of Object.entries(dict)) {
        const holes = (s: string) => [...s.matchAll(/\{\w+\}|<\/?em>/g)].map((m) => m[0]).sort();
        expect(holes(value), key).toEqual(holes(key));
      }
    });
  }
});

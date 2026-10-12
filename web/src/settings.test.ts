import { describe, expect, it } from 'vitest';

import { exportData, importData } from './settings';

/** The slice of Storage the export reads. */
function store(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => entries[k] ?? null };
}

describe('settings file', () => {
  const now = new Date('2026-10-12T10:00:00Z');

  it('carries what Pulse stored and nothing else', () => {
    const text = exportData(store({ 'pulse.lang': '"ru"', 'pulse.watchlists': '[{"id":"a","name":"A","symbols":[]}]', 'other.app': '"x"', 'pulse.broken': '{oops' }), now);
    expect(JSON.parse(text)).toEqual({
      app: 'pulse',
      version: 1,
      saved: '2026-10-12T10:00:00.000Z',
      data: { lang: 'ru', watchlists: [{ id: 'a', name: 'A', symbols: [] }] },
    });
  });

  it('reads its own file back', () => {
    const text = exportData(store({ 'pulse.interval': '"1h"', 'pulse.draw.BTCUSDT': '[]' }), now);
    expect(importData(text)).toEqual({ interval: '1h', 'draw.BTCUSDT': [] });
  });

  it('refuses anything that is not a Pulse settings file', () => {
    expect(importData('not json')).toBeNull();
    expect(importData('[]')).toBeNull();
    expect(importData('{"app":"other","data":{"lang":"ru"}}')).toBeNull();
    expect(importData('{"app":"pulse","data":[]}')).toBeNull();
    expect(importData('{"app":"pulse","data":{}}')).toBeNull();
  });

  it('skips keys that are not plain names', () => {
    expect(importData('{"app":"pulse","data":{"lang":"en","../x":1,"__proto__x y":2}}')).toEqual({ lang: 'en' });
  });
});

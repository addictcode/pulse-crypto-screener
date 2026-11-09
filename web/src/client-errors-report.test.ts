import { describe, expect, it, vi } from 'vitest';

import { MAX_PER_TAB, makeHandler, ignorable, report, type ClientErrorReport } from './client-errors-report';

const where = { pathname: '/app/', search: '?utm_source=tiktok', hash: '#screener:BTCUSDT' } as Location;

describe('client errors', () => {
  it('sends the path only, never the query or the pair in the fragment', () => {
    const r = report(new TypeError('x is undefined'), '', where, 'ru', 'abc123');
    expect(r).toMatchObject({ message: 'TypeError: x is undefined', page: '/app/', build: 'abc123', lang: 'ru' });
    expect(JSON.stringify(r)).not.toContain('tiktok');
    expect(JSON.stringify(r)).not.toContain('BTCUSDT');
  });

  it('cuts long messages and stacks', () => {
    const e = new Error('m'.repeat(2_000));
    e.stack = Array.from({ length: 100 }, (_, i) => `    at f${i} (/assets/main.js:1:${i})`).join('\n');
    const r = report(e, '', where, 'en', 'b');
    expect(r.message.length).toBeLessThanOrEqual(500);
    expect(r.stack.split('\n')).toHaveLength(12);
  });

  it('leaves out what is not ours', () => {
    expect(ignorable('Script error.', '')).toBe(true);
    expect(ignorable('ResizeObserver loop completed with undelivered notifications.', '')).toBe(true);
    expect(ignorable('boom', 'at x (chrome-extension://abc/content.js:1:1)')).toBe(true);
    expect(ignorable('boom', 'at x (/assets/main.js:1:1)')).toBe(false);
  });

  it('sends each error once and at most five a tab', () => {
    vi.stubGlobal('location', where);
    vi.stubGlobal('document', { documentElement: { lang: 'en' } });
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) });
    const sent: ClientErrorReport[] = [];
    const handle = makeHandler((r) => sent.push(r));
    const boom = new Error('boom');
    handle(boom, 'boom');
    handle(boom, 'boom');
    expect(sent).toHaveLength(1);
    for (let i = 0; i < 10; i++) handle(new Error(`other ${i}`), 'Unhandled rejection');
    expect(sent).toHaveLength(MAX_PER_TAB);
    vi.unstubAllGlobals();
  });
});

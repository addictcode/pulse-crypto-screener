import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ago, feedCards, nothingStored, phoneMode } from './feed';
import type { Liquidation, Signal, TapeItem } from './types';

function memoryStorage(entries: Record<string, string> = {}) {
  const data = new Map(Object.entries(entries));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    // Object.keys(localStorage) lists the stored keys in a browser
    ...Object.fromEntries(data),
  };
}

describe('which mode a phone opens in', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

  it('a first visit on a phone gets the feed and keeps it', () => {
    expect(phoneMode(true, true, '')).toBe('feed');
    expect(localStorage.getItem('pulse.phoneMode')).toBe('"feed"');
    expect(phoneMode(true, false, '')).toBe('feed');
  });

  it('a returning phone, a computer and a link to a view get the terminal', () => {
    expect(phoneMode(true, false, '')).toBe('terminal');
    expect(phoneMode(false, true, '')).toBe('terminal');
    expect(phoneMode(true, true, '#heatmap')).toBe('terminal');
    expect(localStorage.getItem('pulse.phoneMode')).toBeNull();
  });

  it('a choice made with the switch wins', () => {
    localStorage.setItem('pulse.phoneMode', '"terminal"');
    expect(phoneMode(true, true, '')).toBe('terminal');
  });

  it('the language and the record period do not make a visit a return', () => {
    vi.stubGlobal('localStorage', memoryStorage({ 'pulse.lang': '"ru"', 'pulse.recordDays': '7', 'other.site': '1' }));
    expect(nothingStored()).toBe(true);
    vi.stubGlobal('localStorage', memoryStorage({ 'pulse.lang': '"ru"', 'pulse.selected': '"SOLUSDT"' }));
    expect(nothingStored()).toBe(false);
  });
});

describe('the cards', () => {
  const now = 1_800_000_000_000;
  const signal = { id: 7, type: 'PUMP', symbol: 'BTCUSDT', time: now - 5_000, price: 1, value: 2.6, title: 'BTC jumps 2.6% in five minutes', detail: '', direction: 1, ret5m: null, ret15m: null, ret1h: null } as Signal;
  const tape: TapeItem = { kind: 'DUMP_5M', symbol: 'SOLUSDT', time: now - 60_000, price: 1, value: -3.2 };
  const big: Liquidation = { symbol: 'ETHUSDT', side: 'LONG', price: 3_000, quantity: 50, time: now - 1_000 };
  const small: Liquidation = { symbol: 'ETHUSDT', side: 'SHORT', price: 3_000, quantity: 1, time: now };

  it('mix signals, the tape and large liquidations, newest first', () => {
    const cards = feedCards({ signals: [signal], tape: [tape], liquidations: [big, small] });
    expect(cards.map((c) => c.symbol)).toEqual(['ETHUSDT', 'BTCUSDT', 'SOLUSDT']);
    expect(cards[0]).toMatchObject({ tone: 'down', text: 'ETH: $150.0K longs liquidated' });
    expect(cards[1].text).toBe('BTC jumps 2.6% in five minutes');
    expect(cards[2].text).toBe('SOL −3.20%');
  });

  it('keep the newest thirty', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...tape, time: now - i * 1_000 }));
    expect(feedCards({ signals: [], tape: many, liquidations: [] })).toHaveLength(30);
  });

  it('say how long ago', () => {
    expect(ago(now - 12_000, now)).toBe('12 s ago');
    expect(ago(now - 125_000, now)).toBe('2 min ago');
    expect(ago(now - 7_300_000, now)).toBe('2 h ago');
  });
});

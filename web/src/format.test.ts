import { describe, expect, it } from 'vitest';

import { age, base, countdown, eatTime, pct, px, tone, usd } from './format';

describe('format', () => {
  it('signs percentages with a real minus', () => {
    expect(pct(2.844)).toBe('+2.84%');
    expect(pct(-0.21, 3)).toBe('−0.210%');
    expect(pct(0)).toBe('0.00%');
    expect(pct(null)).toBe('–');
  });

  it('scales dollar amounts', () => {
    expect(usd(5_440_000_000)).toBe('$5.44B');
    expect(usd(412_600_000)).toBe('$412.6M');
    expect(usd(65_000)).toBe('$65.0K');
    expect(usd(312)).toBe('$312');
  });

  it('shows enough price digits to see a tick on any coin', () => {
    expect(px(86548.2)).toBe('86,548.2');
    expect(px(121.4)).toBe('121.40');
    expect(px(0.8421)).toBe('0.8421');
    expect(px(0.007214)).toBe('0.007214');
  });

  it('treats tiny moves as flat', () => {
    expect(tone(0.5)).toBe('up');
    expect(tone(-0.5)).toBe('down');
    expect(tone(0.01)).toBe('flat');
    expect(tone(null)).toBe('flat');
  });

  it('formats durations for walls and funding', () => {
    expect(age(45)).toBe('45s');
    expect(age(720)).toBe('12m');
    expect(age(7500)).toBe('2h 05m');
    expect(eatTime(0.4)).toBe('<1 min');
    expect(eatTime(6.4)).toBe('~6 min');
    expect(eatTime(null)).toBe('–');
    expect(countdown(10_000_000 + 2 * 3_600_000 + 4 * 60_000, 10_000_000)).toBe('in 2h 04m');
  });

  it('drops the quote asset', () => {
    expect(base('WIFUSDT')).toBe('WIF');
    expect(base('1000PEPEUSDT')).toBe('1000PEPE');
  });
});

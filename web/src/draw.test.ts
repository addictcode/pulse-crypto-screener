import { describe, expect, it } from 'vitest';

import { distanceToSegment, logicalAt, spanText, timeAt } from './draw';

// five 5-minute bars starting at t = 1000
const times = [1000, 1300, 1600, 1900, 2200];
const step = 300;

describe('time axis of the drawings', () => {
  it('maps a bar time to its index', () => {
    expect(logicalAt(times, step, 1000)).toBe(0);
    expect(logicalAt(times, step, 1900)).toBe(3);
  });

  it('interpolates inside a bar', () => {
    expect(logicalAt(times, step, 1450)).toBe(1.5);
  });

  it('continues past both ends at the chart step', () => {
    expect(logicalAt(times, step, 2800)).toBe(6);
    expect(logicalAt(times, step, 400)).toBe(-2);
  });

  it('round-trips through timeAt, so an anchor does not drift when it is redrawn', () => {
    for (const time of [400, 1000, 1450, 2200, 2800]) {
      expect(timeAt(times, step, logicalAt(times, step, time)!)).toBeCloseTo(time, 6);
    }
  });

  it('keeps an anchor on the same moment after a timeframe change', () => {
    // the same hour on 5-minute and on 15-minute bars
    const coarse = [1000, 1900];
    expect(timeAt(coarse, 900, logicalAt(coarse, 900, 1450)!)).toBeCloseTo(1450, 6);
  });

  it('has nothing to say without bars', () => {
    expect(logicalAt([], step, 1000)).toBeNull();
    expect(timeAt([], step, 0)).toBeNull();
  });
});

describe('distanceToSegment', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };

  it('measures to the nearest point of the segment, not of the endless line', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, a, b)).toBe(3);
    expect(distanceToSegment({ x: 14, y: 3 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });
});

describe('spanText', () => {
  it('reads as minutes, hours or days', () => {
    expect(spanText(45 * 60)).toBe('45m');
    expect(spanText(-(3 * 3600 + 45 * 60))).toBe('3h 45m');
    expect(spanText(2 * 86_400 + 5 * 3600)).toBe('2d 5h');
  });
});

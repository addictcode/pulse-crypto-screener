import { describe, expect, it } from 'vitest';

import { alignPoints } from './studies';

describe('alignPoints', () => {
  // one-minute bars at 0, 60, 120, 180, 240 seconds
  const times = [0, 60, 120, 180, 240];

  it('steps a slower statistic along faster bars', () => {
    const points = [{ time: 60, value: 10 }, { time: 180, value: 12 }];
    expect(alignPoints(times, points, true)).toEqual([null, 10, 10, 12, 12]);
  });

  it('starts from the reading before the first bar', () => {
    expect(alignPoints(times, [{ time: -300, value: 7 }], true)).toEqual([7, 7, 7, 7, 7]);
  });

  it('marks an event only on the bar it happened in', () => {
    const payments = [{ time: -300, value: 0.01 }, { time: 130, value: 0.02 }];
    expect(alignPoints(times, payments, false)).toEqual([null, null, 0.02, null, null]);
  });

  it('gives the forming bar the newest reading', () => {
    expect(alignPoints(times, [{ time: 9_999, value: 5 }], true)).toEqual([null, null, null, null, 5]);
  });
});

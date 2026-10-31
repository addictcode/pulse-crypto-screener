import { describe, expect, it } from 'vitest';

import { followed, overall } from './record-math';
import type { OutcomeStats } from './types';

const stats = (direction: number, n: number, avg: number, upShare: number): OutcomeStats => ({
  type: 'PUMP',
  direction,
  label: 'Pump',
  horizons: [{ horizon: '5m', n, avg, upShare }],
});

describe('signal record', () => {
  it('reads an up signal as it is', () => {
    expect(followed(stats(1, 10, 0.4, 0.6), 0)).toEqual({ n: 10, move: 0.4, share: 0.6 });
  });

  it('turns a down signal around: a falling price proves it right', () => {
    expect(followed(stats(-1, 10, -0.4, 0.3), 0)).toEqual({ n: 10, move: 0.4, share: 0.7 });
  });

  it('has nothing to say about signals without a direction or a measurement', () => {
    expect(followed(stats(0, 10, 0.4, 0.6), 0)).toBeNull();
    expect(followed(stats(1, 0, 0, 0), 0)).toBeNull();
    expect(followed(stats(1, 10, 0.4, 0.6), 2)).toBeNull();
  });

  it('weights each kind by how often it fired', () => {
    const all = overall([stats(1, 30, 1, 0.8), stats(-1, 10, 1, 0.8)], 0)!;
    expect(all.n).toBe(40);
    expect(all.move).toBeCloseTo(0.5);
    expect(all.share).toBeCloseTo(0.65);
  });

  it('is empty when nothing was measured', () => {
    expect(overall([stats(0, 5, 1, 0.5)], 0)).toBeNull();
  });
});

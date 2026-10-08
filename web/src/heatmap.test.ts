import { describe, expect, it } from 'vitest';

import { tileColor, treemap } from './heatmap';

describe('treemap', () => {
  const weights = [50, 20, 12, 8, 5, 3, 2];
  const rects = treemap(weights, 400, 300);

  it('gives every weight a rectangle with its share of the area', () => {
    expect(rects).toHaveLength(weights.length);
    rects.forEach((r, i) => expect(r.w * r.h).toBeCloseTo((weights[i] / 100) * 400 * 300, 4));
  });

  it('stays inside the box and leaves no overlaps', () => {
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-6);
      expect(r.y).toBeGreaterThanOrEqual(-1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(400 + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(300 + 1e-6);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i], rects[j]];
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 1e-6 && overlapY > 1e-6).toBe(false);
      }
    }
  });

  it('keeps tiles readable instead of slicing the box into slivers', () => {
    const ratios = rects.map((r) => Math.max(r.w / r.h, r.h / r.w));
    expect(Math.max(...ratios)).toBeLessThan(4);
  });

  it('returns nothing for an empty market or a collapsed box', () => {
    expect(treemap([], 400, 300)).toEqual([]);
    expect(treemap([1, 2], 0, 300)).toEqual([]);
  });
});

describe('tileColor', () => {
  it('is neutral at zero and for missing data', () => {
    expect(tileColor(0, 5)).toBe('rgb(34,40,52)');
    expect(tileColor(null, 5)).toBe('rgb(34,40,52)');
  });

  it('saturates at the full-scale move and not beyond', () => {
    expect(tileColor(5, 5)).toBe(tileColor(50, 5));
    expect(tileColor(-5, 5)).toBe(tileColor(-50, 5));
    expect(tileColor(5, 5)).not.toBe(tileColor(-5, 5));
  });
});

import { describe, expect, it } from 'vitest';

import { clamp } from './layout';

describe('pane sizes', () => {
  it('keeps a dragged border inside its limits', () => {
    expect(clamp(412.6, 260, 900)).toBe(413);
    expect(clamp(40, 260, 900)).toBe(260);
    expect(clamp(1400, 260, 900)).toBe(900);
  });

  it('never lets the upper limit fall under the lower one on a small window', () => {
    expect(clamp(500, 260, 180)).toBe(260);
  });
});

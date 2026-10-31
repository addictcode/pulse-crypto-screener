import { describe, expect, it } from 'vitest';

import { fileName, pickType } from './clip-recorder';

describe('clip recorder', () => {
  it('prefers MP4, which TikTok takes as is', () => {
    expect(pickType(() => true)).toBe('video/mp4;codecs=avc1.42E01E');
  });

  it('falls back to WebM where MP4 cannot be written', () => {
    expect(pickType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
    expect(pickType(() => false)).toBeNull();
  });

  it('names the file after the pair and the minute', () => {
    const at = new Date('2026-10-31T14:22:51Z');
    expect(fileName('WIFUSDT', 'video/mp4', at)).toBe('pulse-WIF-2026-10-31-1422.mp4');
    expect(fileName('1000PEPEUSDT', 'video/webm;codecs=vp9', at)).toBe('pulse-1000PEPE-2026-10-31-1422.webm');
  });
});

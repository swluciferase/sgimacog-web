// src/services/camera/frameStamper.test.ts
import { describe, it, expect } from 'vitest';
import { videoFrameTsToEpochMs, makeFrameStamper } from './frameStamper';

describe('videoFrameTsToEpochMs', () => {
  it('converts μs since timeOrigin to epoch ms', () => {
    // timeOrigin = 1_700_000_000_000 ms (epoch), frame ts = 5_000_000 μs (5 s into doc)
    // → 1_700_000_005_000 ms
    expect(videoFrameTsToEpochMs(5_000_000, 1_700_000_000_000)).toBe(1_700_000_005_000);
  });

  it('handles 0 frame timestamp', () => {
    expect(videoFrameTsToEpochMs(0, 1_000)).toBe(1_000);
  });

  it('rounds to integer ms', () => {
    // 1234 μs = 1.234 ms → 1
    expect(videoFrameTsToEpochMs(1234, 0)).toBe(1);
  });
});

describe('makeFrameStamper', () => {
  it('produces an incrementing index per frame', () => {
    const s = makeFrameStamper(1_000);
    expect(s.stamp(2_000_000)).toEqual({ i: 0, ts_ms: 3_000 });
    expect(s.stamp(2_500_000)).toEqual({ i: 1, ts_ms: 3_500 });
    expect(s.stamp(3_000_000)).toEqual({ i: 2, ts_ms: 4_000 });
  });

  it('reset() restarts the index', () => {
    const s = makeFrameStamper(0);
    s.stamp(1_000_000);
    s.stamp(2_000_000);
    s.reset();
    expect(s.stamp(3_000_000)).toEqual({ i: 0, ts_ms: 3_000 });
  });
});

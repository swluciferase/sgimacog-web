import type { FrameTimestamp } from '../../types/camera';

/**
 * VideoFrame.timestamp is μs in the document timeline (relative to performance.timeOrigin).
 * Convert to epoch ms.
 */
export function videoFrameTsToEpochMs(frameTsUs: number, timeOriginMs: number): number {
  return Math.floor(timeOriginMs + frameTsUs / 1000);
}

export interface FrameStamper {
  stamp(frameTsUs: number): FrameTimestamp;
  reset(): void;
}

export function makeFrameStamper(timeOriginMs: number): FrameStamper {
  let i = 0;
  return {
    stamp(frameTsUs: number): FrameTimestamp {
      const ts_ms = videoFrameTsToEpochMs(frameTsUs, timeOriginMs);
      const out = { i, ts_ms };
      i += 1;
      return out;
    },
    reset() {
      i = 0;
    },
  };
}

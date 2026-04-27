import type { CameraConfig, FrameTimestamp, SegmentMeta } from '../../types/camera';
import { makeFrameStamper, videoFrameTsToEpochMs } from './frameStamper';

export interface SegmentOutput {
  index: number;
  blob: Blob;
  start_ts_ms: number;
  end_ts_ms: number;
  frames: FrameTimestamp[];
}

export interface SegmentedRecorderOptions {
  videoTrack: MediaStreamTrack;
  config: CameraConfig;
  /** Used to convert VideoFrame.timestamp (μs since doc origin) to epoch ms. */
  timeOriginMs: number;
  onSegmentReady(segment: SegmentOutput): void;
  onError(err: Error): void;
}

export interface SegmentedRecorder {
  start(): Promise<void>;
  /** Stop the current segment, flush, and become idle. Caller can call start() again. */
  stop(): Promise<void>;
  isRunning(): boolean;
  currentSegmentIndex(): number;
}

export function makeSegmentedRecorder(opts: SegmentedRecorderOptions): SegmentedRecorder {
  let segIndex = 0;
  let recorder: MediaRecorder | null = null;
  let processor: MediaStreamTrackProcessor<VideoFrame> | null = null;
  let frameStamper = makeFrameStamper(opts.timeOriginMs);
  let frames: FrameTimestamp[] = [];
  let chunks: Blob[] = [];
  let segStartTs = 0;
  let running = false;

  async function readFrames(reader: ReadableStreamDefaultReader<VideoFrame>) {
    while (running) {
      const { value, done } = await reader.read();
      if (done) break;
      const frame = value as VideoFrame;
      try {
        frames.push(frameStamper.stamp(frame.timestamp ?? 0));
      } finally {
        frame.close();
      }
    }
  }

  return {
    async start() {
      if (running) return;
      segIndex += 1;
      frameStamper.reset();
      frames = [];
      chunks = [];
      segStartTs = Date.now();

      const stream = new MediaStream([opts.videoTrack]);
      recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp8',
        videoBitsPerSecond: opts.config.bitrate_bps,
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onerror = (ev: Event) => {
        opts.onError(new Error(`MediaRecorder error: ${(ev as ErrorEvent).message ?? 'unknown'}`));
      };
      const finished = new Promise<void>((resolve) => {
        recorder!.onstop = () => resolve();
      });
      (recorder as unknown as { __finished?: Promise<void> }).__finished = finished;

      // Frame timestamp capture (Chromium-only API)
      if (typeof MediaStreamTrackProcessor !== 'undefined') {
        processor = new MediaStreamTrackProcessor({ track: opts.videoTrack });
        const reader = processor.readable.getReader();
        running = true;
        readFrames(reader).catch((e) => opts.onError(e instanceof Error ? e : new Error(String(e))));
      } else {
        running = true;
      }

      recorder.start(1000); // emit chunks every 1s for streaming write
    },
    async stop() {
      if (!running || !recorder) return;
      running = false;
      const finished = (recorder as unknown as { __finished?: Promise<void> }).__finished;
      recorder.stop();
      await finished;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const segEndTs = Date.now();
      const out: SegmentOutput = {
        index: segIndex,
        blob,
        start_ts_ms: segStartTs,
        end_ts_ms: segEndTs,
        frames,
      };
      opts.onSegmentReady(out);
      recorder = null;
      processor = null;
    },
    isRunning() {
      return running;
    },
    currentSegmentIndex() {
      return segIndex;
    },
  };
}

export function segmentToMeta(seg: SegmentOutput, slot: string): SegmentMeta {
  return {
    index: seg.index,
    file: `${slot}_seg${String(seg.index).padStart(2, '0')}.webm`,
    start_ts_ms: seg.start_ts_ms,
    end_ts_ms: seg.end_ts_ms,
    frame_count: seg.frames.length,
    frames: seg.frames,
  };
}

export { videoFrameTsToEpochMs };

import type {
  CameraConfig,
  CameraSlotId,
  CameraErrorEvent,
  SegmentMeta,
  VideoSidecar,
} from '../../types/camera';
import { hashDeviceId } from './cameraDevices';
import { openCameraStream, type CameraStream } from './cameraStream';
import {
  makeSegmentedRecorder,
  type SegmentedRecorder,
  type SegmentOutput,
  segmentToMeta,
} from './cameraRecorder';
import { writeBlobAsFile, writeSidecar } from './fsWriter';

export interface CameraSlotSessionOptions {
  slot: CameraSlotId;
  deviceId: string;
  deviceLabel: string;
  config: CameraConfig;
  epochOriginMs: number;
  videoDir: FileSystemDirectoryHandle;
  onStatusChange(s: 'ready' | 'recording' | 'paused' | 'error', detail?: string): void;
  onSegmentWritten(meta: SegmentMeta): void;
}

export interface CameraSlotSession {
  startRecording(): Promise<void>;
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  stopAndFinalize(): Promise<VideoSidecar>;
  getStream(): MediaStream | null;
  dispose(): void;
}

export async function openCameraSlotSession(
  opts: CameraSlotSessionOptions,
): Promise<CameraSlotSession> {
  // Declare state BEFORE wiring callbacks that reference it.
  const segments: SegmentMeta[] = [];
  const errors: CameraErrorEvent[] = [];

  let stream: CameraStream | null = await openCameraStream({
    deviceId: opts.deviceId,
    config: opts.config,
  });
  const unsubEnded = stream.onEnded(() => {
    opts.onStatusChange('error', 'Camera disconnected');
    errors.push({
      ts_ms: Date.now(),
      code: 'track_ended',
      message: 'Camera track ended',
    });
  });

  const deviceIdHash = await hashDeviceId(opts.deviceId);

  let recorder: SegmentedRecorder | null = null;

  function makeRecorder(): SegmentedRecorder {
    return makeSegmentedRecorder({
      videoTrack: stream!.videoTrack,
      config: opts.config,
      timeOriginMs: opts.epochOriginMs,
      onSegmentReady: async (seg: SegmentOutput) => {
        const meta = segmentToMeta(seg, opts.slot);
        try {
          await writeBlobAsFile(opts.videoDir, meta.file, seg.blob);
          segments.push(meta);
          opts.onSegmentWritten(meta);
        } catch (e) {
          errors.push({
            ts_ms: Date.now(),
            code: 'fs_write_error',
            message: (e as Error).message,
          });
          opts.onStatusChange('error', `File write failed: ${(e as Error).message}`);
        }
      },
      onError: (err) => {
        errors.push({ ts_ms: Date.now(), code: 'recorder_error', message: err.message });
        opts.onStatusChange('error', err.message);
      },
    });
  }

  opts.onStatusChange('ready');

  return {
    async startRecording() {
      if (!recorder) recorder = makeRecorder();
      await recorder.start();
      opts.onStatusChange('recording');
    },
    async pauseRecording() {
      if (recorder?.isRunning()) {
        await recorder.stop();
      }
      opts.onStatusChange('paused');
    },
    async resumeRecording() {
      // New recorder = new segment; old recorder reference can be reused as it tracks segIndex internally.
      if (recorder) {
        await recorder.start();
        opts.onStatusChange('recording');
      }
    },
    async stopAndFinalize(): Promise<VideoSidecar> {
      if (recorder?.isRunning()) {
        await recorder.stop();
      }
      const sidecar: VideoSidecar = {
        schema_version: '1.0',
        slot: opts.slot,
        device_label: opts.deviceLabel,
        device_id_hash: deviceIdHash,
        epoch_origin_ms: opts.epochOriginMs,
        config: {
          container: 'webm',
          codec: 'vp8',
          resolution: opts.config.resolution,
          fps_target: opts.config.fps,
          bitrate_bps: opts.config.bitrate_bps,
        },
        segments,
        errors,
      };
      await writeSidecar(opts.videoDir, opts.slot, sidecar);
      return sidecar;
    },
    getStream() {
      return stream?.stream ?? null;
    },
    dispose() {
      unsubEnded?.();
      stream?.stop();
      stream = null;
      recorder = null;
    },
  };
}

// Camera recording types — shared across services/camera/*, hooks, and UI

export type CameraSlotId = 'dev1' | 'dev2' | 'dev3' | 'dev4';

export type CameraStatus =
  | 'idle'        // no device picked
  | 'ready'       // device picked, stream not yet open
  | 'recording'   // actively writing a segment
  | 'paused'      // user-paused; current segment flushed; ready to start segN+1
  | 'error';      // disconnected or capture error

export type GlobalRecordState = 'idle' | 'recording' | 'paused' | 'error';

export interface CameraConfig {
  resolution: '640x480' | '1280x720' | '1920x1080';
  fps: 15 | 30 | 60;
  bitrate_bps: 1_000_000 | 2_500_000 | 5_000_000 | 8_000_000;
}

export const DEFAULT_CAMERA_CONFIG: CameraConfig = {
  resolution: '1280x720',
  fps: 30,
  bitrate_bps: 2_500_000,
};

export interface FrameTimestamp {
  i: number;        // frame index within segment (0-based)
  ts_ms: number;    // epoch ms
}

export interface SegmentMeta {
  index: number;
  file: string;                // e.g. "dev1_seg01.webm"
  start_ts_ms: number;
  end_ts_ms: number;
  frame_count: number;
  frames: FrameTimestamp[];
}

export interface CameraErrorEvent {
  ts_ms: number;
  code: 'track_ended' | 'permission_revoked' | 'recorder_error' | 'fs_write_error' | 'other';
  message: string;
}

export interface VideoSidecar {
  schema_version: '1.0';
  slot: CameraSlotId;
  device_label: string;
  device_id_hash: string;       // sha256 prefix
  epoch_origin_ms: number;
  config: {
    container: 'webm';
    codec: 'vp8';
    resolution: string;
    fps_target: number;
    bitrate_bps: number;
  };
  segments: SegmentMeta[];
  errors: CameraErrorEvent[];
}

export interface SessionMeta {
  schema_version: '1.0';
  session_id: string;
  app: 'sgimacog-web';
  app_version: string;
  created_at_iso: string;
  epoch_origin_ms: number;
  duration_ms: number;
  eeg: {
    devices: Array<{ slot: CameraSlotId; csv: string; sample_rate_hz: number }>;
  };
  video: {
    cameras: Array<{ slot: CameraSlotId; sidecar: string }>;
  };
}

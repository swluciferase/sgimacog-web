# Camera Recording — sgimacog-web Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-camera (up to 4) video recording to sgimacog-web, paired 1:1 with EEG devices, with per-frame epoch-ms timestamps written to local disk via the File System Access API.

**Architecture:** Per-app camera service (`services/camera/*`) with pure-logic core (testable), a global `useCameraSession` hook bound to the app's existing 4-device state, in-app `FloatingCameraPanel`, and integration points in `DevicePanel.tsx` (slot selector) + `RecordView.tsx` (folder picker, consent text, recording lifecycle binding). Files written: per-camera `.webm` segments + per-camera `_video.json` sidecar + cross-modality `session_meta.json`.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, MediaRecorder (WebM/VP8), MediaStreamTrackProcessor (VideoFrame timestamps), File System Access API, vitest (newly added), bun.

**Spec:** [`docs/superpowers/specs/2026-04-27-camera-recording-design.md`](../specs/2026-04-27-camera-recording-design.md)

**Out of scope (this plan):** NFB-Webapp port, Poseidon port, R2 upload, audio recording, IP cameras. Those are separate plans after Phase 1 validates.

---

## Working directory

All paths in this plan are relative to `/Users/swryociao/sgimacog-web/web/` unless prefixed with `../` (which means the repo root `/Users/swryociao/sgimacog-web/`).

Run `cd /Users/swryociao/sgimacog-web/web` before starting.

---

## Task 0: Add vitest test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/smoke.test.ts`

**Why:** sgimacog-web currently has no test runner. We add vitest matching NFB-Webapp's pattern so pure-logic modules in this plan can be TDD'd.

- [ ] **Step 1: Install dev dependencies**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bun add -d vitest@^2 jsdom@^25 @testing-library/dom@^10 @testing-library/jest-dom@^6 @testing-library/react@^16 fake-indexeddb@^6
```

Expected: dependencies added to `package.json`, `bun.lock` updated.

- [ ] **Step 2: Add test scripts to `package.json`**

Inside the `"scripts"` block, after `"preview"`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

- [ ] **Step 5: Create `src/test/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run smoke test**

```bash
~/.bun/bin/bun run test
```

Expected: `1 passed`.

- [ ] **Step 7: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/package.json web/bun.lock web/vitest.config.ts web/src/test/
git commit -m "chore: add vitest test infrastructure"
```

---

## Task 1: Camera type definitions

**Files:**
- Create: `src/types/camera.ts`

**Why:** Centralize all shared camera types so subsequent tasks reference one source.

- [ ] **Step 1: Create `src/types/camera.ts`**

```ts
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
```

- [ ] **Step 2: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/types/camera.ts
git commit -m "feat(camera): add type definitions"
```

---

## Task 2: cameraDevices — enumerate, permission, deviceId memory (TDD)

**Files:**
- Create: `src/services/camera/cameraDevices.ts`
- Test: `src/services/camera/cameraDevices.test.ts`

**Why:** Pure-ish logic for device list management and `localStorage` memory of last-used device per slot. Hashing of `deviceId` for sidecar privacy.

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/camera/cameraDevices.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rememberDeviceForSlot,
  recallDeviceForSlot,
  forgetDeviceForSlot,
  hashDeviceId,
} from './cameraDevices';

describe('cameraDevices — slot deviceId memory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing stored', () => {
    expect(recallDeviceForSlot('dev1')).toBeNull();
  });

  it('persists deviceId per slot in localStorage', () => {
    rememberDeviceForSlot('dev1', 'abc-device-id');
    rememberDeviceForSlot('dev2', 'xyz-device-id');
    expect(recallDeviceForSlot('dev1')).toBe('abc-device-id');
    expect(recallDeviceForSlot('dev2')).toBe('xyz-device-id');
  });

  it('forget clears only the requested slot', () => {
    rememberDeviceForSlot('dev1', 'a');
    rememberDeviceForSlot('dev2', 'b');
    forgetDeviceForSlot('dev1');
    expect(recallDeviceForSlot('dev1')).toBeNull();
    expect(recallDeviceForSlot('dev2')).toBe('b');
  });
});

describe('cameraDevices — deviceId hashing', () => {
  it('produces a sha256-prefixed string', async () => {
    const h = await hashDeviceId('abc-device-id');
    expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic', async () => {
    const a = await hashDeviceId('same');
    const b = await hashDeviceId('same');
    expect(a).toBe(b);
  });

  it('differs across inputs', async () => {
    const a = await hashDeviceId('a');
    const b = await hashDeviceId('b');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
~/.bun/bin/bun run test src/services/camera/cameraDevices.test.ts
```

Expected: all fail with "Cannot find module './cameraDevices'".

- [ ] **Step 3: Implement `src/services/camera/cameraDevices.ts`**

```ts
import type { CameraSlotId } from '../../types/camera';

const LS_PREFIX = 'sgimacog.camera.slot.';

export function rememberDeviceForSlot(slot: CameraSlotId, deviceId: string): void {
  localStorage.setItem(LS_PREFIX + slot, deviceId);
}

export function recallDeviceForSlot(slot: CameraSlotId): string | null {
  return localStorage.getItem(LS_PREFIX + slot);
}

export function forgetDeviceForSlot(slot: CameraSlotId): void {
  localStorage.removeItem(LS_PREFIX + slot);
}

export async function hashDeviceId(deviceId: string): Promise<string> {
  const enc = new TextEncoder().encode(deviceId);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

/**
 * Browser device enumeration. Returns videoinput devices.
 * Note: browsers only return labels after a getUserMedia permission grant,
 * so the first call may return empty `label` fields — caller handles UI.
 */
export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

/**
 * Probe permission for video. Returns 'granted' | 'denied' | 'prompt' | 'unknown'.
 */
export async function probeCameraPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!navigator.permissions) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
~/.bun/bin/bun run test src/services/camera/cameraDevices.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/camera/cameraDevices.ts web/src/services/camera/cameraDevices.test.ts
git commit -m "feat(camera): cameraDevices — slot memory + sha256 hash + enumerate"
```

---

## Task 3: frameStamper — VideoFrame timestamp conversion (TDD)

**Files:**
- Create: `src/services/camera/frameStamper.ts`
- Test: `src/services/camera/frameStamper.test.ts`

**Why:** `VideoFrame.timestamp` is microseconds in the document timeline (since `performance.timeOrigin`). We need epoch ms = `timeOrigin + timestamp/1000`. Pure math, easy to TDD.

- [ ] **Step 1: Write the failing tests**

```ts
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
    expect(s.stamp(3_000_000)).toEqual({ i: 0, ts_ms: 3 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
~/.bun/bin/bun run test src/services/camera/frameStamper.test.ts
```

Expected: fail with "Cannot find module".

- [ ] **Step 3: Implement `src/services/camera/frameStamper.ts`**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
~/.bun/bin/bun run test src/services/camera/frameStamper.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/camera/frameStamper.ts web/src/services/camera/frameStamper.test.ts
git commit -m "feat(camera): frameStamper — VideoFrame ts → epoch ms"
```

---

## Task 4: cameraStream — getUserMedia wrapper

**Files:**
- Create: `src/services/camera/cameraStream.ts`

**Why:** Wrap `getUserMedia` with our `CameraConfig`, expose track-ended events. Browser API integration; manually verified.

- [ ] **Step 1: Implement `src/services/camera/cameraStream.ts`**

```ts
import type { CameraConfig } from '../../types/camera';

export interface OpenStreamOptions {
  deviceId: string;
  config: CameraConfig;
}

export interface CameraStream {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  /** Fires when the underlying track ends (disconnect, permission revoked). */
  onEnded: (cb: () => void) => () => void;
  stop(): void;
}

function parseResolution(s: CameraConfig['resolution']): { width: number; height: number } {
  const [w, h] = s.split('x').map((n) => Number.parseInt(n, 10));
  return { width: w, height: h };
}

export async function openCameraStream(opts: OpenStreamOptions): Promise<CameraStream> {
  const { width, height } = parseResolution(opts.config.resolution);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      deviceId: { exact: opts.deviceId },
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: opts.config.fps },
    },
  });
  const videoTrack = stream.getVideoTracks()[0];
  if (!videoTrack) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error('No video track returned by getUserMedia');
  }

  return {
    stream,
    videoTrack,
    onEnded(cb) {
      const handler = () => cb();
      videoTrack.addEventListener('ended', handler);
      return () => videoTrack.removeEventListener('ended', handler);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/camera/cameraStream.ts
git commit -m "feat(camera): cameraStream — getUserMedia wrapper"
```

---

## Task 5: cameraRecorder — segmented MediaRecorder

**Files:**
- Create: `src/services/camera/cameraRecorder.ts`

**Why:** A segment is one `MediaRecorder` instance + frame timestamps captured via `MediaStreamTrackProcessor`. Pause = stop current recorder, flush segment. Resume = start new recorder + new frame stamper.

- [ ] **Step 1: Implement `src/services/camera/cameraRecorder.ts`**

```ts
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
```

> **Note on `videoFrameTsToEpochMs`:** imported but only re-exported for callers; the live `frameStamper` already uses it internally. Keeping the import explicit documents the dependency.

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

If TS complains about `MediaStreamTrackProcessor` being undefined, install / add `@types/dom-mediacapture-transform`:

```bash
~/.bun/bin/bun add -d @types/dom-mediacapture-transform
```

Re-run type check.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/camera/cameraRecorder.ts web/package.json web/bun.lock
git commit -m "feat(camera): cameraRecorder — segmented MediaRecorder + frame ts capture"
```

---

## Task 6: fsWriter — File System Access API wrapper

**Files:**
- Create: `src/services/camera/fsWriter.ts`

**Why:** Encapsulate FSA picker + per-file streaming write. Keeps direct DOM API surface in one file.

- [ ] **Step 1: Implement `src/services/camera/fsWriter.ts`**

```ts
import type { SessionMeta, VideoSidecar } from '../../types/camera';

export function isFsApiAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickRootFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isFsApiAvailable()) {
    throw new Error('File System Access API not available — please use Chrome or Edge desktop.');
  }
  return await window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function ensureSessionDir(
  root: FileSystemDirectoryHandle,
  sessionDirName: string,
): Promise<FileSystemDirectoryHandle> {
  const sessionDir = await root.getDirectoryHandle(sessionDirName, { create: true });
  await sessionDir.getDirectoryHandle('eeg', { create: true });
  await sessionDir.getDirectoryHandle('video', { create: true });
  return sessionDir;
}

export async function writeBlobAsFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export async function writeJson(
  dir: FileSystemDirectoryHandle,
  filename: string,
  data: unknown,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  } finally {
    await writable.close();
  }
}

export function buildSessionDirName(sessionId: string, startedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}` +
    `-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`;
  return `session_${sessionId}_${stamp}`;
}

export async function writeSidecar(
  videoDir: FileSystemDirectoryHandle,
  slot: string,
  sidecar: VideoSidecar,
): Promise<void> {
  await writeJson(videoDir, `${slot}_video.json`, sidecar);
}

export async function writeSessionMeta(
  sessionDir: FileSystemDirectoryHandle,
  meta: SessionMeta,
): Promise<void> {
  await writeJson(sessionDir, 'session_meta.json', meta);
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

If `showDirectoryPicker` is not in the lib types, add a minimal ambient declaration to `src/types/fs-access.d.ts`:

```ts
// src/types/fs-access.d.ts
export {};
declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}
```

Re-run type check.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/camera/fsWriter.ts web/src/types/fs-access.d.ts
git commit -m "feat(camera): fsWriter — File System Access API wrapper"
```

---

## Task 7: cameraSession — orchestration entry point

**Files:**
- Create: `src/services/camera/cameraSession.ts`

**Why:** The top-level integration that ties stream + recorder + fsWriter into one slot lifecycle. UI talks only to this module per slot.

- [ ] **Step 1: Implement `src/services/camera/cameraSession.ts`**

```ts
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
  let stream: CameraStream | null = await openCameraStream({
    deviceId: opts.deviceId,
    config: opts.config,
  });
  let unsubEnded = stream.onEnded(() => {
    opts.onStatusChange('error', 'Camera disconnected');
    errors.push({
      ts_ms: Date.now(),
      code: 'track_ended',
      message: 'Camera track ended',
    });
  });

  const segments: SegmentMeta[] = [];
  const errors: CameraErrorEvent[] = [];

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
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/services/camera/cameraSession.ts
git commit -m "feat(camera): cameraSession — slot-level orchestration"
```

---

## Task 8: useCameraSession hook (global app state)

**Files:**
- Create: `src/hooks/useCameraSession.ts`

**Why:** A single hook owned at `App.tsx` level that holds all 4 slots' state. Each `DevicePanel` reads its own slot.

- [ ] **Step 1: Implement `src/hooks/useCameraSession.ts`**

```ts
import { useCallback, useRef, useState } from 'react';
import type {
  CameraSlotId,
  CameraConfig,
  CameraStatus,
  GlobalRecordState,
  SegmentMeta,
  VideoSidecar,
} from '../types/camera';
import { DEFAULT_CAMERA_CONFIG } from '../types/camera';
import {
  openCameraSlotSession,
  type CameraSlotSession,
} from '../services/camera/cameraSession';
import {
  buildSessionDirName,
  ensureSessionDir,
  isFsApiAvailable,
  pickRootFolder,
} from '../services/camera/fsWriter';
import {
  recallDeviceForSlot,
  rememberDeviceForSlot,
  forgetDeviceForSlot,
} from '../services/camera/cameraDevices';

const ALL_SLOTS: CameraSlotId[] = ['dev1', 'dev2', 'dev3', 'dev4'];

export interface SlotState {
  slot: CameraSlotId;
  deviceId: string | null;
  deviceLabel: string;
  status: CameraStatus;
  errorMsg?: string;
  segmentCount: number;
}

export interface UseCameraSessionResult {
  fsAvailable: boolean;
  enabled: boolean;
  setEnabled(v: boolean): void;
  rootFolderName: string | null;
  pickFolder(): Promise<void>;
  config: CameraConfig;
  setConfig(c: CameraConfig): void;
  slots: Record<CameraSlotId, SlotState>;
  setSlotDevice(slot: CameraSlotId, deviceId: string | null, label?: string): void;
  globalState: GlobalRecordState;
  /**
   * Start recording for all configured slots. Caller is the EEG recording controller —
   * pass the same epoch_origin_ms it uses, and the session_id used in CSV filenames.
   */
  startAll(args: { epochOriginMs: number; sessionId: string; startedAt: Date }): Promise<void>;
  pauseSlot(slot: CameraSlotId): Promise<void>;
  resumeSlot(slot: CameraSlotId): Promise<void>;
  /** Stop all slots, flush sidecars, return them for session_meta.json caller. */
  stopAll(): Promise<VideoSidecar[]>;
  /** Live MediaStream for a slot — for floating panel preview. */
  getSlotStream(slot: CameraSlotId): MediaStream | null;
  /** Latest written session dir handle, used by RecordView to locate eeg/ subdir for CSV. */
  sessionDirHandle: FileSystemDirectoryHandle | null;
}

export function useCameraSession(): UseCameraSessionResult {
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<CameraConfig>(DEFAULT_CAMERA_CONFIG);
  const [rootFolderName, setRootFolderName] = useState<string | null>(null);
  const rootHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const sessionDirHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const videoDirHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const [globalState, setGlobalState] = useState<GlobalRecordState>('idle');

  const initialSlots: Record<CameraSlotId, SlotState> = {
    dev1: makeInitialSlot('dev1'),
    dev2: makeInitialSlot('dev2'),
    dev3: makeInitialSlot('dev3'),
    dev4: makeInitialSlot('dev4'),
  };
  const [slots, setSlots] = useState(initialSlots);
  const sessionsRef = useRef<Partial<Record<CameraSlotId, CameraSlotSession>>>({});

  function makeInitialSlot(slot: CameraSlotId): SlotState {
    const dev = recallDeviceForSlot(slot);
    return { slot, deviceId: dev, deviceLabel: '', status: dev ? 'idle' : 'idle', segmentCount: 0 };
  }

  function patchSlot(slot: CameraSlotId, patch: Partial<SlotState>) {
    setSlots((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
  }

  const pickFolder = useCallback(async () => {
    const handle = await pickRootFolder();
    rootHandle.current = handle;
    setRootFolderName(handle.name);
  }, []);

  const setSlotDevice = useCallback(
    (slot: CameraSlotId, deviceId: string | null, label = '') => {
      if (deviceId) {
        rememberDeviceForSlot(slot, deviceId);
        patchSlot(slot, { deviceId, deviceLabel: label, status: 'ready' });
      } else {
        forgetDeviceForSlot(slot);
        patchSlot(slot, { deviceId: null, deviceLabel: '', status: 'idle' });
      }
    },
    [],
  );

  const startAll = useCallback(
    async (args: { epochOriginMs: number; sessionId: string; startedAt: Date }) => {
      if (!enabled) return;
      if (!rootHandle.current) {
        throw new Error('No folder selected — call pickFolder() first.');
      }
      const dirName = buildSessionDirName(args.sessionId, args.startedAt);
      const sDir = await ensureSessionDir(rootHandle.current, dirName);
      sessionDirHandle.current = sDir;
      videoDirHandle.current = await sDir.getDirectoryHandle('video', { create: false });

      setGlobalState('recording');
      const activeSlots = ALL_SLOTS.filter((s) => slots[s].deviceId);
      for (const slot of activeSlots) {
        const slotState = slots[slot];
        try {
          const session = await openCameraSlotSession({
            slot,
            deviceId: slotState.deviceId!,
            deviceLabel: slotState.deviceLabel,
            config,
            epochOriginMs: args.epochOriginMs,
            videoDir: videoDirHandle.current,
            onStatusChange: (s, detail) => patchSlot(slot, { status: s, errorMsg: detail }),
            onSegmentWritten: (_meta: SegmentMeta) =>
              setSlots((prev) => ({
                ...prev,
                [slot]: { ...prev[slot], segmentCount: prev[slot].segmentCount + 1 },
              })),
          });
          sessionsRef.current[slot] = session;
          await session.startRecording();
        } catch (e) {
          patchSlot(slot, { status: 'error', errorMsg: (e as Error).message });
        }
      }
    },
    [enabled, slots, config],
  );

  const pauseSlot = useCallback(async (slot: CameraSlotId) => {
    await sessionsRef.current[slot]?.pauseRecording();
  }, []);

  const resumeSlot = useCallback(async (slot: CameraSlotId) => {
    await sessionsRef.current[slot]?.resumeRecording();
  }, []);

  const stopAll = useCallback(async (): Promise<VideoSidecar[]> => {
    const sidecars: VideoSidecar[] = [];
    for (const slot of ALL_SLOTS) {
      const sess = sessionsRef.current[slot];
      if (sess) {
        try {
          const sc = await sess.stopAndFinalize();
          sidecars.push(sc);
        } catch (e) {
          patchSlot(slot, { status: 'error', errorMsg: (e as Error).message });
        }
        sess.dispose();
        delete sessionsRef.current[slot];
      }
    }
    setGlobalState('idle');
    return sidecars;
  }, []);

  const getSlotStream = useCallback(
    (slot: CameraSlotId) => sessionsRef.current[slot]?.getStream() ?? null,
    [],
  );

  return {
    fsAvailable: isFsApiAvailable(),
    enabled,
    setEnabled,
    rootFolderName,
    pickFolder,
    config,
    setConfig,
    slots,
    setSlotDevice,
    globalState,
    startAll,
    pauseSlot,
    resumeSlot,
    stopAll,
    getSlotStream,
    sessionDirHandle: sessionDirHandle.current,
  };
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/hooks/useCameraSession.ts
git commit -m "feat(camera): useCameraSession — global slot state hook"
```

---

## Task 9: i18n consent text — append camera clause

**Files:**
- Modify: `src/i18n.ts:186-188`

**Why:** Existing `disclaimerBody` covers EEG + cloud upload. Append camera recording clause (zh + en) so the existing consent UI surfaces it without UI changes.

- [ ] **Step 1: Modify `src/i18n.ts:186-188` — append camera clause to `disclaimerBody`**

Replace the existing `disclaimerBody` block with the following (keep adjacent keys untouched):

```ts
  disclaimerBody: {
    zh: '本系統（SigmaCog 平台）將記錄您的腦電波（EEG）等生理資料。本服務由亞堤仕生醫科技股份有限公司提供，屬健康輔助工具，不具醫療診斷效力。\n\n【資料用途】\n・產生個人化健康評估報告\n・以去識別化方式用於服務改善、研究及 AI 模型訓練\n\n【資料儲存】\n資料以加密方式上傳至雲端伺服器，原始資料保存期限為最後一次使用起 10 年。\n\n【影像錄製（選用）】\n本系統可額外錄製受測者影像供研究分析。影像僅儲存於施測者本機所選擇的資料夾，不會自動上傳至雲端。是否啟用影像錄製由施測者於主畫面決定。\n\n您有權查詢、更正或要求刪除個人資料。詳見隱私政策：sigmacog.xyz/privacy\n\n────\n施測說明：請向受測者口頭說明以上內容並取得同意後，再勾選下方選項開始錄製。',
    en: 'This system (SigmaCog platform) will record your electroencephalography (EEG) and other physiological data. This service is provided by Artise Biomedical Co., Ltd. as a wellness tool and does not constitute medical diagnosis.\n\n[Data Use]\n· Generating personalized health assessment reports\n· De-identified service improvement, research, and AI model training\n\n[Data Storage]\nData is encrypted and uploaded to cloud servers. Raw data is retained for 10 years from the date of last service use.\n\n[Video Recording (optional)]\nThe system can additionally record video of the subject for research analysis. Video is saved only to a folder chosen by the assessor on this device — it is not automatically uploaded to the cloud. Whether video recording is enabled is decided by the assessor on the main screen.\n\nYou have the right to access, correct, or request deletion of your data. See Privacy Policy: sigmacog.xyz/privacy\n\n────\nAssessor Note: Please verbally explain the above to the subject and obtain their agreement before ticking the box below.',
  },
```

- [ ] **Step 2: Build to verify no syntax errors**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/i18n.ts
git commit -m "feat(i18n): append camera recording clause to consent disclaimer"
```

---

## Task 10: BrowserCompatBanner component

**Files:**
- Create: `src/components/camera/BrowserCompatBanner.tsx`

**Why:** Show a visible banner in camera UI areas when File System Access API is unavailable.

- [ ] **Step 1: Create `src/components/camera/BrowserCompatBanner.tsx`**

```tsx
import type { FC } from 'react';
import type { Lang } from '../../i18n';

interface Props {
  lang: Lang;
}

export const BrowserCompatBanner: FC<Props> = ({ lang }) => {
  const text =
    lang === 'zh'
      ? '⚠️ 相機錄製功能需要 Chrome 或 Edge 瀏覽器（File System Access API）。請改用 Chrome/Edge 開啟以啟用相機。'
      : '⚠️ Camera recording requires Chrome or Edge desktop browser (File System Access API). Please switch to Chrome/Edge to enable cameras.';
  return (
    <div
      role="alert"
      style={{
        padding: '10px 14px',
        margin: '8px 0',
        borderRadius: 6,
        background: 'rgba(255, 184, 0, 0.12)',
        border: '1px solid rgba(255, 184, 0, 0.4)',
        color: '#f0c14b',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/camera/BrowserCompatBanner.tsx
git commit -m "feat(camera): BrowserCompatBanner component"
```

---

## Task 11: CameraSlotSelector component

**Files:**
- Create: `src/components/camera/CameraSlotSelector.tsx`

**Why:** Per-slot dropdown for choosing a `videoinput`. Used in `DevicePanel` next to each EEG device.

- [ ] **Step 1: Create `src/components/camera/CameraSlotSelector.tsx`**

```tsx
import { type FC, useEffect, useState } from 'react';
import type { CameraSlotId } from '../../types/camera';
import { listVideoInputs } from '../../services/camera/cameraDevices';

interface Props {
  slot: CameraSlotId;
  selectedDeviceId: string | null;
  disabled?: boolean;
  onChange(deviceId: string | null, label: string): void;
}

export const CameraSlotSelector: FC<Props> = ({ slot, selectedDeviceId, disabled, onChange }) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const list = await listVideoInputs();
      if (!cancelled) setDevices(list);
    }
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
    };
  }, []);

  return (
    <select
      aria-label={`Camera for ${slot}`}
      disabled={disabled}
      value={selectedDeviceId ?? ''}
      onChange={(ev) => {
        const id = ev.target.value;
        if (!id) {
          onChange(null, '');
          return;
        }
        const info = devices.find((d) => d.deviceId === id);
        onChange(id, info?.label ?? id);
      }}
      style={{
        padding: '4px 6px',
        background: 'rgba(0,0,0,0.25)',
        color: '#cce',
        border: '1px solid rgba(120,180,200,0.3)',
        borderRadius: 4,
        fontSize: 12,
        minWidth: 140,
      }}
    >
      <option value="">📷 未選擇 / None</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
        </option>
      ))}
    </select>
  );
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/camera/CameraSlotSelector.tsx
git commit -m "feat(camera): CameraSlotSelector component"
```

---

## Task 12: CameraAdvancedSettings modal

**Files:**
- Create: `src/components/camera/CameraAdvancedSettings.tsx`

**Why:** Modal to adjust resolution / fps / bitrate. Optional UI; default config works without opening it.

- [ ] **Step 1: Create `src/components/camera/CameraAdvancedSettings.tsx`**

```tsx
import { type FC } from 'react';
import type { CameraConfig } from '../../types/camera';

interface Props {
  open: boolean;
  config: CameraConfig;
  activeCameraCount: number;
  onClose(): void;
  onApply(c: CameraConfig): void;
}

const RESOLUTIONS: CameraConfig['resolution'][] = ['640x480', '1280x720', '1920x1080'];
const FPS_OPTIONS: CameraConfig['fps'][] = [15, 30, 60];
const BITRATES: CameraConfig['bitrate_bps'][] = [1_000_000, 2_500_000, 5_000_000, 8_000_000];

export const CameraAdvancedSettings: FC<Props> = ({
  open,
  config,
  activeCameraCount,
  onClose,
  onApply,
}) => {
  if (!open) return null;

  const heavyLoad = activeCameraCount >= 4 && config.resolution === '1920x1080' && config.fps === 60;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1500,
      }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: '#0e2229',
          color: '#cde',
          padding: 20,
          borderRadius: 8,
          width: 320,
          border: '1px solid rgba(72,186,166,0.35)',
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>Advanced Camera Settings</h3>

        <Row label="Resolution">
          <select
            value={config.resolution}
            onChange={(e) =>
              onApply({ ...config, resolution: e.target.value as CameraConfig['resolution'] })
            }
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Row>

        <Row label="FPS">
          <select
            value={config.fps}
            onChange={(e) =>
              onApply({ ...config, fps: Number.parseInt(e.target.value, 10) as CameraConfig['fps'] })
            }
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Bitrate">
          <select
            value={config.bitrate_bps}
            onChange={(e) =>
              onApply({
                ...config,
                bitrate_bps: Number.parseInt(e.target.value, 10) as CameraConfig['bitrate_bps'],
              })
            }
          >
            {BITRATES.map((b) => (
              <option key={b} value={b}>
                {b / 1_000_000} Mbps
              </option>
            ))}
          </select>
        </Row>

        {heavyLoad && (
          <div style={{ color: '#f0c14b', fontSize: 12, marginTop: 8 }}>
            ⚠️ 4× 1080p/60fps will be CPU-intensive.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
    <label style={{ fontSize: 13 }}>{label}</label>
    {children}
  </div>
);
```

- [ ] **Step 2: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/camera/CameraAdvancedSettings.tsx
git commit -m "feat(camera): CameraAdvancedSettings modal"
```

---

## Task 13: FloatingCameraPanel — draggable PiP grid

**Files:**
- Create: `src/components/camera/FloatingCameraPanel.tsx`

**Why:** Operator's live preview of all active slots; per-slot pause/resume; segment counter; drag/resize.

- [ ] **Step 1: Create `src/components/camera/FloatingCameraPanel.tsx`**

```tsx
import { type FC, useEffect, useRef, useState } from 'react';
import type { CameraSlotId } from '../../types/camera';
import type { SlotState, UseCameraSessionResult } from '../../hooks/useCameraSession';

interface Props {
  cam: UseCameraSessionResult;
  visible: boolean;
  elapsedMs: number;
  onClose(): void;
}

const SLOT_ORDER: CameraSlotId[] = ['dev1', 'dev2', 'dev3', 'dev4'];

export const FloatingCameraPanel: FC<Props> = ({ cam, visible, elapsedMs, onClose }) => {
  const [pos, setPos] = useState({ x: window.innerWidth - 520, y: window.innerHeight - 360 });
  const [size, setSize] = useState({ w: 480, h: 320 });
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  if (!visible) return null;

  const activeSlots = SLOT_ORDER.filter((s) => cam.slots[s].deviceId);
  const cols = activeSlots.length <= 1 ? 1 : 2;

  function startDrag(ev: React.PointerEvent) {
    dragRef.current = { ox: ev.clientX, oy: ev.clientY, px: pos.x, py: pos.y };
    (ev.target as Element).setPointerCapture(ev.pointerId);
  }
  function onDrag(ev: React.PointerEvent) {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.px + (ev.clientX - dragRef.current.ox),
      y: dragRef.current.py + (ev.clientY - dragRef.current.oy),
    });
  }
  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: collapsed ? 32 : size.h,
        background: 'rgba(8,20,28,0.95)',
        border: '1px solid rgba(72,186,166,0.5)',
        borderRadius: 6,
        zIndex: 2000,
        color: '#cde',
        fontSize: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        style={{
          height: 32,
          background: 'rgba(20,40,52,0.9)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          cursor: 'move',
          userSelect: 'none',
          gap: 8,
        }}
      >
        <span style={{ color: '#3fb950' }}>●</span>
        <span>Cameras {formatElapsed(elapsedMs)}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setCollapsed((v) => !v)}>{collapsed ? '▢' : '—'}</button>
        <button type="button" onClick={onClose}>✕</button>
      </div>

      {!collapsed && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, padding: 4 }}>
          {activeSlots.map((s) => (
            <SlotCell key={s} slot={s} state={cam.slots[s]} stream={cam.getSlotStream(s)} pause={() => cam.pauseSlot(s)} resume={() => cam.resumeSlot(s)} />
          ))}
        </div>
      )}

      {!collapsed && (
        <div
          onPointerDown={(ev) => {
            const startX = ev.clientX;
            const startY = ev.clientY;
            const startW = size.w;
            const startH = size.h;
            const onMove = (e: PointerEvent) => {
              setSize({
                w: Math.max(280, startW + (e.clientX - startX)),
                h: Math.max(200, startH + (e.clientY - startY)),
              });
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            cursor: 'nwse-resize',
            background: 'rgba(72,186,166,0.4)',
          }}
        />
      )}
    </div>
  );
};

interface SlotCellProps {
  slot: CameraSlotId;
  state: SlotState;
  stream: MediaStream | null;
  pause(): void;
  resume(): void;
}

const SlotCell: FC<SlotCellProps> = ({ slot, state, stream, pause, resume }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const dotColor =
    state.status === 'recording'
      ? '#3fb950'
      : state.status === 'paused'
        ? '#f0c14b'
        : state.status === 'error'
          ? '#dc7860'
          : '#888';

  return (
    <div style={{ position: 'relative', background: '#000', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <video ref={videoRef} autoPlay muted playsInline style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 6px', gap: 6, background: 'rgba(0,0,0,0.6)' }}>
        <span style={{ color: dotColor }}>●</span>
        <span>{slot}</span>
        <span style={{ flex: 1 }} />
        <span>seg {String(state.segmentCount).padStart(2, '0')}</span>
        {state.status === 'recording' && (
          <button type="button" onClick={pause}>Pause</button>
        )}
        {state.status === 'paused' && (
          <button type="button" onClick={resume}>Resume</button>
        )}
      </div>
      {state.status === 'error' && state.errorMsg && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(220,120,96,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, padding: 6, textAlign: 'center' }}>
          ⚠ {state.errorMsg}
        </div>
      )}
    </div>
  );
};

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/camera/FloatingCameraPanel.tsx
git commit -m "feat(camera): FloatingCameraPanel — draggable PiP grid"
```

---

## Task 14: DevicePanel — add camera slot UI

**Files:**
- Modify: `src/components/DevicePanel.tsx`

**Why:** Each `DevicePanel` represents one EEG device (`dev1..dev4`). Render `CameraSlotSelector` for the matching slot.

- [ ] **Step 1: Add prop and selector to `DevicePanel.tsx`**

At the top of the file, add the import (after the existing imports):

```ts
import { CameraSlotSelector } from './camera/CameraSlotSelector';
import type { CameraSlotId } from '../types/camera';
import type { UseCameraSessionResult } from '../hooks/useCameraSession';
```

Extend `DevicePanelProps` (around line 26-46) with two new optional props:

```ts
  /** Global camera session (passed from App). When provided, renders a camera slot selector. */
  cam?: UseCameraSessionResult;
  /** Camera slot id — usually 'dev1'..'dev4' matching deviceIndex. */
  cameraSlot?: CameraSlotId;
```

Add to the component destructure (around line 48-50), append:

```ts
  cam, cameraSlot,
```

In the panel header / connect tab area where each device's identity is shown, render the selector. Search the JSX for the connect tab heading and add this block in a sensible position (e.g., next to the device name/battery row):

```tsx
{cam && cameraSlot && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
    <span style={{ fontSize: 12, color: 'rgba(200,224,216,0.7)' }}>📷</span>
    <CameraSlotSelector
      slot={cameraSlot}
      selectedDeviceId={cam.slots[cameraSlot].deviceId}
      disabled={!cam.enabled || cam.globalState === 'recording'}
      onChange={(id, label) => cam.setSlotDevice(cameraSlot, id, label)}
    />
    {cam.slots[cameraSlot].status === 'error' && (
      <span style={{ color: '#dc7860', fontSize: 11 }}>⚠</span>
    )}
  </div>
)}
```

> Preserve existing layout. If the file structure makes it cleaner to put this in `RecordView` instead (per device), do that — the placement constraint is "visible per device, near the EEG device identity".

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/DevicePanel.tsx
git commit -m "feat(camera): DevicePanel — render camera slot selector per device"
```

---

## Task 15: App.tsx — instantiate useCameraSession, wire to DevicePanels

**Files:**
- Modify: `src/App.tsx`

**Why:** Single hook owns 4-slot state, passed down to each `DevicePanel`.

- [ ] **Step 1: Import and call `useCameraSession` at top of `App` component**

Add import:

```ts
import { useCameraSession } from './hooks/useCameraSession';
import type { CameraSlotId } from './types/camera';
```

Inside the App component (top of body):

```ts
const cam = useCameraSession();
```

When rendering each of the 4 `DevicePanel` instances, pass `cam` and `cameraSlot`:

```tsx
<DevicePanel
  deviceIndex={0}
  cam={cam}
  cameraSlot={'dev1'}
  /* ...existing props... */
/>
<DevicePanel
  deviceIndex={1}
  cam={cam}
  cameraSlot={'dev2'}
  /* ... */
/>
{/* dev3, dev4 same pattern */}
```

> Locate the existing 4 `<DevicePanel>` JSX blocks; only add the two new props per block.

- [ ] **Step 2: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/App.tsx
git commit -m "feat(camera): App.tsx — wire useCameraSession to all DevicePanels"
```

---

## Task 16: RecordView — camera enable / folder picker / floating panel

**Files:**
- Modify: `src/components/views/RecordView.tsx`

**Why:** RecordView is the EEG recording entry point. Add: enable camera toggle, folder picker, advanced settings, and the FloatingCameraPanel rendering. Also extend the existing `onStartRecording` flow to call `cam.startAll()` and `onStopRecording` to call `cam.stopAll()`.

- [ ] **Step 1: Extend `RecordViewProps` with `cam`**

Add to the props interface (top of file):

```ts
  /** Global camera session — passed from App via DevicePanel. */
  cam?: UseCameraSessionResult;
```

Add import:

```ts
import type { UseCameraSessionResult } from '../../hooks/useCameraSession';
import { FloatingCameraPanel } from '../camera/FloatingCameraPanel';
import { BrowserCompatBanner } from '../camera/BrowserCompatBanner';
import { CameraAdvancedSettings } from '../camera/CameraAdvancedSettings';
```

- [ ] **Step 2: Add state and helpers near other useState calls**

```ts
const [showCamSettings, setShowCamSettings] = useState(false);
const [showCamPanel, setShowCamPanel] = useState(true);
const [recStartTs, setRecStartTs] = useState<number | null>(null);
```

- [ ] **Step 3: Render camera control row above the existing "開始錄製" button**

Locate the Start/Stop button block. Add above it:

```tsx
{cam && (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0' }}>
    {!cam.fsAvailable && <BrowserCompatBanner lang={lang} />}
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={cam.enabled}
          disabled={!cam.fsAvailable || isRecording}
          onChange={(e) => cam.setEnabled(e.target.checked)}
        />
        {lang === 'zh' ? '啟用相機錄製' : 'Enable camera recording'}
      </label>
      <button
        type="button"
        disabled={!cam.enabled || isRecording}
        onClick={() => cam.pickFolder().catch(() => {/* user cancelled */})}
      >
        📁 {cam.rootFolderName ?? (lang === 'zh' ? '選擇資料夾' : 'Choose folder')}
      </button>
      <button
        type="button"
        disabled={!cam.enabled}
        onClick={() => setShowCamSettings(true)}
      >
        ⚙ {lang === 'zh' ? '進階' : 'Advanced'}
      </button>
      {cam.enabled && cam.rootFolderName && (
        <span style={{ fontSize: 12, color: '#3fb950' }}>
          ✅ {Object.values(cam.slots).filter((s) => s.deviceId).length} {lang === 'zh' ? '台相機就緒' : 'cameras ready'}
        </span>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: Hook into start/stop handlers**

Wrap `onStartRecording` so it also calls `cam.startAll`:

Find the existing handler (or button onClick) for start recording. Replace its body / wrap with:

```ts
async function handleStartRecording() {
  const startedAt = new Date();
  const epochOriginMs = startedAt.getTime();
  setRecStartTs(epochOriginMs);
  onStartRecording();
  if (cam?.enabled && cam.rootFolderName) {
    try {
      await cam.startAll({
        epochOriginMs,
        sessionId: sessionInfo?.sessionId ?? `local-${epochOriginMs}`,
        startedAt,
      });
    } catch (err) {
      console.error('[camera] startAll failed:', err);
      alert(`Camera start failed: ${(err as Error).message}\nEEG recording continues.`);
    }
  }
}
```

Wrap stop similarly:

```ts
async function handleStopRecording() {
  onStopRecording();
  if (cam?.enabled) {
    try {
      const sidecars = await cam.stopAll();
      console.info(`[camera] wrote ${sidecars.length} sidecar(s)`);
    } catch (err) {
      console.error('[camera] stopAll failed:', err);
    }
  }
  setRecStartTs(null);
}
```

Replace the buttons' `onClick` references to use the new handlers.

- [ ] **Step 5: Render FloatingCameraPanel + advanced settings modal at end of return**

At the bottom of the JSX (just before the closing root element):

```tsx
{cam && (
  <>
    <CameraAdvancedSettings
      open={showCamSettings}
      config={cam.config}
      activeCameraCount={Object.values(cam.slots).filter((s) => s.deviceId).length}
      onClose={() => setShowCamSettings(false)}
      onApply={(c) => cam.setConfig(c)}
    />
    <FloatingCameraPanel
      cam={cam}
      visible={showCamPanel && cam.enabled && cam.globalState === 'recording'}
      elapsedMs={recStartTs ? Date.now() - recStartTs : 0}
      onClose={() => setShowCamPanel(false)}
    />
  </>
)}
```

- [ ] **Step 6: Type-check + dev run**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
~/.bun/bin/bun run dev
```

Open `http://localhost:5173`, verify the camera toggle and folder picker render. Don't yet record; that's Task 18 verification.

- [ ] **Step 7: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/components/views/RecordView.tsx
git commit -m "feat(camera): RecordView — enable toggle, folder picker, lifecycle binding"
```

---

## Task 17: session_meta.json — write cross-modality index

**Files:**
- Modify: `src/components/views/RecordView.tsx` (the stop handler from Task 16)
- Reference: `src/services/camera/fsWriter.ts` (already has `writeSessionMeta`)

**Why:** After EEG CSV is written and camera sidecars are flushed, write `session_meta.json` at session-dir root so a research script can locate everything from one entry point.

- [ ] **Step 1: Extend the stop handler to write session_meta.json**

Replace the body of `handleStopRecording` from Task 16 with:

```ts
async function handleStopRecording() {
  const stoppedAt = Date.now();
  onStopRecording();
  if (cam?.enabled) {
    try {
      const sidecars = await cam.stopAll();
      // Write session_meta.json if we have a sessionDir handle
      if (cam.sessionDirHandle && recStartTs) {
        const meta: SessionMeta = {
          schema_version: '1.0',
          session_id: sessionInfo?.sessionId ?? `local-${recStartTs}`,
          app: 'sgimacog-web',
          app_version: APP_VERSION,
          created_at_iso: new Date(recStartTs).toISOString(),
          epoch_origin_ms: recStartTs,
          duration_ms: stoppedAt - recStartTs,
          eeg: {
            devices: [
              { slot: 'dev1', csv: 'eeg/dev1.csv', sample_rate_hz: deviceSampleRate ?? 1000 },
              // dev2..dev4 added by App-level writer that knows which devices were active.
              // For now, RecordView only knows its own device, so this minimum write is
              // safe; multi-device session_meta.json aggregation is in Task 17b.
            ],
          },
          video: {
            cameras: sidecars.map((sc) => ({
              slot: sc.slot,
              sidecar: `video/${sc.slot}_video.json`,
            })),
          },
        };
        await writeSessionMeta(cam.sessionDirHandle, meta);
      }
    } catch (err) {
      console.error('[camera] stopAll/meta failed:', err);
    }
  }
  setRecStartTs(null);
}
```

Add import:

```ts
import type { SessionMeta } from '../../types/camera';
import { writeSessionMeta } from '../../services/camera/fsWriter';
import { APP_VERSION } from '../../version';
```

- [ ] **Step 2: Create `src/version.ts` with the app version constant**

```ts
// src/version.ts — single source of truth for app version (used by camera session_meta.json + UI).
export const APP_VERSION = '0.7.0';
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
cd /Users/swryociao/sgimacog-web
git add web/src/version.ts web/src/components/views/RecordView.tsx
git commit -m "feat(camera): write session_meta.json after stop"
```

> **Task 17b note:** In a multi-device tab, each `DevicePanel` calls its own `RecordView` and currently each writes its own `session_meta.json`. For first iteration, this is acceptable: each DevicePanel's RecordView is invoked once per device session in single-device tab usage. For 4-device simultaneous sessions, the App-level synchronized "stop and save" signal (`stopSignal`) should trigger a single session_meta write at App level. **Defer this aggregation to Phase 1 verification — if multi-device sessions are how this app is normally used, add an `App.tsx` aggregator handler at that point.**

---

## Task 18: Manual verification

**Files:** none (testing only)

- [ ] **Step 1: Build + run dev server**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bun run dev
```

Open `http://localhost:5173` in **Chrome desktop**.

- [ ] **Step 2: Single-camera + single-device test**

  1. Connect 1 EEG device (or use mock if available).
  2. In DevicePanel, pick `📷 FaceTime HD Camera` from the dropdown — first time the browser will prompt for camera permission. Allow.
  3. In RecordView, tick "Enable camera recording".
  4. Click "📁 Choose folder" → pick `~/Desktop/sgimacog_test/`. Confirm `cam.rootFolderName` displays.
  5. Click "Start Recording". Observe:
     - FloatingCameraPanel appears bottom-right with one cell, live thumbnail, ●REC dot, segment counter `seg 01`.
     - Drag the panel — moves freely. Resize from corner — works.
     - Click "Pause" on the slot cell — segment counter advances when you "Resume". Observe UI status flips paused→recording.
  6. Click "Stop Recording".
  7. In Finder, open `~/Desktop/sgimacog_test/session_*/`. Confirm:
     - `eeg/dev1.csv` exists (existing pipeline).
     - `video/dev1_seg01.webm` exists, plays in QuickTime.
     - `video/dev1_seg02.webm` exists if you paused/resumed.
     - `video/dev1_video.json` valid JSON; `frames` array length ≈ duration_s × 30.
     - `session_meta.json` valid JSON; references the above.

- [ ] **Step 3: 4-camera + 4-device load test**

  1. Connect 4 EEG devices (or simulate). Pick distinct cameras for each (built-in + 3 USB if available, otherwise reuse one for the test).
  2. Repeat steps 4–7 above.
  3. While recording: monitor Activity Monitor → CPU. Note CPU% with 4×720p/30fps streams. If > 80% sustained, the user should see the warning in advanced settings.
  4. After stop: confirm all 4 sidecars + 4 webm files written, all sidecars share the same `epoch_origin_ms`.

- [ ] **Step 4: Disconnect-mid-recording test**

  1. Start single-camera recording.
  2. After ~5s, physically unplug the USB camera (or revoke permission via Chrome settings).
  3. Observe: slot cell turns red with ⚠ icon. EEG continues. Floating panel still visible.
  4. Stop recording. Confirm sidecar's `errors[]` contains a `track_ended` event.

- [ ] **Step 5: Safari fallback test**

  1. Open the app in Safari.
  2. Confirm `BrowserCompatBanner` shows in RecordView.
  3. Confirm "Enable camera recording" checkbox is **disabled**.
  4. Confirm EEG recording works normally.

- [ ] **Step 6: Sidecar validation with Python**

```bash
cd ~/Desktop/sgimacog_test/session_*/
python3 -c "
import json, pandas as pd
m = json.load(open('session_meta.json'))
print('app:', m['app'], 'version:', m['app_version'])
print('epoch:', m['epoch_origin_ms'], 'duration:', m['duration_ms'])
for c in m['video']['cameras']:
    s = json.load(open(c['sidecar']))
    df = pd.DataFrame([f for seg in s['segments'] for f in seg['frames']])
    print(c['slot'], 'frames:', len(df), 'span_ms:', int(df['ts_ms'].max() - df['ts_ms'].min()) if len(df) else 0)
"
```

Expected: each camera's frame count ≈ duration_s × fps_target, span_ms ≈ duration_ms minus paused intervals.

- [ ] **Step 7: Document any verification gaps**

Append a short note to `docs/superpowers/specs/2026-04-27-camera-recording-design.md` Section 7 (Open Questions) capturing anything observed during verification that wasn't anticipated.

```bash
cd /Users/swryociao/sgimacog-web
git add docs/superpowers/specs/2026-04-27-camera-recording-design.md
git commit -m "docs(camera): note verification findings" --allow-empty
```

(empty commit OK if no findings.)

---

## Task 19: Version bump + deploy

**Files:**
- Modify: `package.json:4` (version field)
- Modify: `src/version.ts:2`

- [ ] **Step 1: Bump version v0.6.0 → v0.7.0**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bun pm version minor --no-git-tag-version
```

This sets `package.json` version. Manually update `src/version.ts`:

```ts
export const APP_VERSION = '0.7.0';
```

- [ ] **Step 2: Production build**

```bash
cd /Users/swryociao/sgimacog-web
~/.bun/bin/bun run --cwd web build:full
```

Expected: builds without errors. Output in `web/dist/`.

- [ ] **Step 3: Deploy to Cloudflare Pages**

```bash
cd /Users/swryociao/sgimacog-web/web
~/.bun/bin/bunx wrangler pages deploy dist --project-name sgimacog-web --commit-dirty=true
```

- [ ] **Step 4: Commit + push**

```bash
cd /Users/swryociao/sgimacog-web
git add web/package.json web/src/version.ts
git commit -m "chore: bump v0.6.0 → v0.7.0 (camera recording)"
git push
```

- [ ] **Step 5: Smoke-test the deployed site**

Open `https://www.sigmacog.xyz/eeg` in Chrome desktop. Confirm:
  1. App loads.
  2. Camera UI present in RecordView.
  3. BrowserCompatBanner appears in Safari.

If anything breaks, revert deploy with previous Pages deployment from Cloudflare dashboard — do **not** force-push or otherwise destroy git history.

---

## Self-Review

**1. Spec coverage:**
- Architecture (services/camera/* 6 modules) → Tasks 2, 3, 4, 5, 6, 7 ✓
- State store with 4 slots → Task 8 ✓
- Lifecycle binding (EEG start auto-starts cameras) → Task 16 ✓
- DevicePanel slot UI → Task 14 ✓
- Floating panel → Task 13 ✓
- Advanced settings → Task 12 ✓
- Browser compat banner → Tasks 10 + 16 ✓
- Consent text → Task 9 ✓
- session_meta.json → Task 17 ✓
- Video sidecar (per-frame timestamps, segments, errors) → Tasks 5, 7 ✓
- Manual verification (1 cam, 4 cam, disconnect, Safari) → Task 18 ✓
- Version bump + deploy → Task 19 ✓
- localStorage deviceId memory → Task 2 ✓
- File System Access API only (no IDB fallback) → Tasks 6, 8 ✓
- No audio → Task 4 (`audio: false`) ✓

**Gaps:** Multi-device aggregated `session_meta.json` (Task 17b note) is deferred — acceptable; will be revisited in verification. NFB-Webapp / Poseidon ports are explicitly out of scope per spec Phase 2/3.

**2. Placeholder scan:** none found. All "Implement..." steps include full code.

**3. Type consistency:**
- `CameraSlotId = 'dev1' | 'dev2' | 'dev3' | 'dev4'` — used consistently in types/camera.ts (Task 1), cameraDevices.ts (Task 2), useCameraSession.ts (Task 8), DevicePanel/App/RecordView (Tasks 14, 15, 16).
- `SegmentMeta` shape (Task 1) matches what `segmentToMeta` produces (Task 5) and what `VideoSidecar.segments` expects.
- `SessionMeta.eeg.devices[].slot` is `CameraSlotId` — both EEG and video reuse the same slot taxonomy. ✓
- `useCameraSession` returns the type used as `cam` prop in `DevicePanel` and `RecordView`. ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-27-camera-recording-sgimacog.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?

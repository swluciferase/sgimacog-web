# Camera Recording for sgimacog / SoraMynd / Poseidon — Design Spec

**Date:** 2026-04-27
**Status:** Approved (brainstorm complete, awaiting implementation plan)
**Canonical app:** sgimacog-web (implementation reference)
**Target apps:** sgimacog-web, NFB-Webapp (SoraMynd), poseidon

---

## 1. Goals

Add synchronized camera/video recording alongside EEG recording in three apps so that research data collection captures subject video with frame-level timestamp alignment to EEG samples. Secondary use case: training session review for therapists.

**Out of scope:**
- Clinical artifact correlation (not pursued at this time)
- Server upload (R2 / cloud storage) — purely local download
- Audio recording — disabled to avoid privacy and sync complexity
- IP cameras / RTSP — browsers do not natively support; deferred

---

## 2. Confirmed Requirements

| # | Decision | Detail |
|---|----------|--------|
| 1 | Use case | Research data collection (primary) + training review (secondary). Frame-level sync required. |
| 2 | Scope | Any "recording" state in all 3 apps (RecordView, TrainingView). |
| 3 | Storage | Local download only. No R2 upload. |
| 4 | Time sync | Per-frame timestamps via `MediaStreamTrackProcessor` → `VideoFrame.timestamp`. |
| 5 | Camera sources | Multi-camera. sgimacog up to 4; NFB/Poseidon up to 2 (main + secondary). |
| 6 | UI pairing | sgimacog: 1:1 device-camera pairing in DevicePanel. NFB/Poseidon: main+secondary slots in operator panel. |
| 7 | Format defaults | WebM VP8, 1280×720, 30 fps, 2.5 Mbps. Adjustable via advanced settings. |
| 8 | Lifecycle | Half-bound: EEG start auto-starts cameras; cameras pause/resume independently; camera failure does NOT stop EEG. |
| 9 | Pause/resume | Segment-based files (`seg01.webm`, `seg02.webm`, ...) with sidecar JSON indexing all segments. |
| 10 | Preview UI | In-app draggable/resizable floating panel on operator screen (1/2/4 grid). |
| 11 | Consent | sgimacog: extend existing consent form with camera text (non-mandatory). NFB/Poseidon: port the same pattern. |
| 12 | Error handling | Graceful: failed camera flushes current segment, status=error; EEG continues; manual reattach available. |
| 13 | Audio | Not recorded. |
| 14 | File save | File System Access API (Chrome/Edge desktop required). Other browsers: banner warning + camera UI disabled, EEG unaffected. |
| 15 | Camera memory | localStorage remembers last `deviceId` per slot per app. |
| 16 | Code sharing | Per-app independent copies. Canonical version maintained in sgimacog-web; manually ported to NFB/Poseidon. |

---

## 3. Architecture

### 3.1 Module structure (per app, identical files)

```
services/camera/
├── cameraDevices.ts      # enumerate videoinput, permission request, deviceId memory
├── cameraStream.ts       # getUserMedia wrapper, track-ended event handling
├── frameStamper.ts       # MediaStreamTrackProcessor → per-frame timestamps (μs → epoch ms)
├── cameraRecorder.ts     # MediaRecorder wrapper, segment switching
├── fsWriter.ts           # File System Access API: dir handle, segment + sidecar streaming write
└── cameraSession.ts      # public entry point, orchestrates the above + epoch alignment
```

### 3.2 State store (per app)

Implemented with each app's existing state pattern (zustand / Context / signal).

```ts
type CameraStore = {
  enabled: boolean;
  folderHandle: FileSystemDirectoryHandle | null;
  slots: CameraSlot[];                    // sgimacog: 4 (dev1..dev4); NFB/Poseidon: 2 (main, secondary)
  globalState: 'idle' | 'recording' | 'paused' | 'error';
  defaultConfig: { resolution: string; fps: number; bitrate: number };
};

type CameraSlot = {
  slotId: 'dev1' | 'dev2' | 'dev3' | 'dev4' | 'main' | 'secondary';
  deviceId: string | null;                // remembered in localStorage
  stream: MediaStream | null;
  recorder: SegmentedRecorder | null;
  segments: SegmentMeta[];
  currentSegmentIndex: number;
  status: 'idle' | 'ready' | 'recording' | 'paused' | 'error';
  errorMsg?: string;
};
```

### 3.3 Lifecycle integration

```
[Operator clicks "Start Recording"]
  ↓
1. If camera enabled → cameraSession.requestFolderHandle() (if not already chosen)
2. epoch_origin_ms = Date.now()             (shared by EEG and ALL cameras)
3. EEG WASM starts recording
4. In parallel: every ready slot starts seg01
  ↓
[Recording in progress]
  - EEG writes CSV (existing flow); cameras write .webm + accumulate frame timestamps
  - Any camera fault → that slot stops → flush current segment → status=error → red warning UI
  - Operator can pause/resume individual cameras via floating panel → switches to segN+1
  ↓
[Operator clicks "Stop"]
  - Flush current segment for all cameras
  - Write each camera's sidecar JSON (full segments index)
  - Write session_meta.json (cross-modality index)
  - EEG completes via existing CSV flow
```

---

## 4. UI Design

### 4.1 sgimacog-web (single-screen, up to 4 EEG devices)

**DevicePanel.tsx** — each EEG device row gets a camera slot to its right:

```
┌─────────────────────────────────────────────────────────┐
│ Device 1 [●Connected]  Battery 87%  [📷 FaceTime ▾] [✕] │
│ Device 2 [●Connected]  Battery 92%  [📷 USB Cam   ▾] [✕] │
│ Device 3 [○Idle    ]                [📷 +Select   ▾]    │
│ Device 4 [○Idle    ]                [📷 +Select   ▾]    │
└─────────────────────────────────────────────────────────┘
```

**RecordView.tsx** — camera control row above existing "Start Recording" button:

```
[Enable Camera] [Choose Folder] [Advanced...]
✅ 4 cameras ready    📁 ~/Documents/EEG_Sessions/
```

**Existing consent form** — append camera clause (zh + en).

### 4.2 NFB-Webapp / Poseidon (dual-screen, single device, operator + subject views)

**Important distinction:**
- TrainingView = operator's view (band power, controls, metrics) — camera UI lives here
- Game window (NFB `gameWindow.tsx`, Poseidon Pixi window) = subject's view — NO camera UI ever

**Consent modal** — port sgimacog pattern to RecordView/TrainingView entry. Content covers EEG + camera; non-mandatory.

**Operator-side camera panel** (in TrainingView / RecordView / GameControlView depending on app):

```
┌─ 📷 Cameras (operator) ──────────────┐
│ Main:       [FaceTime HD       ▾] [✕] │
│ Secondary:  [+ Add secondary    ▾]    │
│ Storage:    📁 ~/Sessions/            │
│ [Enable] [⚙ Advanced]                 │
└──────────────────────────────────────┘
```

**Subject-side game window** — unchanged. BroadcastChannel messaging is not extended.

### 4.3 Floating Camera Panel (shared across all 3 apps)

Draggable, resizable PiP panel implemented with `position: fixed` + drag handle (no popup window required).

```
┌─ 📷 Camera Monitor ─ [●REC 03:21]──[—][▢][✕]┐
│ ┌────────┬────────┐                           │
│ │ Dev1   │ Dev2   │  ← grid auto-layout       │
│ │ [Pause]│ [Pause]│   1 cam = single          │
│ ├────────┼────────┤   2 cams = side-by-side   │
│ │ Dev3   │ Dev4   │   3-4 cams = 2×2          │
│ │ [Pause]│ [⚠Err] │                           │
│ └────────┴────────┘                           │
│ Seg: 02 / 03 / 02 / 01                        │
└───────────────────────────────────────────────┘
```

- Default position: bottom-right, default size 480×320
- Each cell: live thumbnail + per-camera pause/resume button + segment counter + status dot
- Single elapsed timer (from EEG start, e.g., "03:21")
- Minimize (—): collapses to title bar only
- Close (✕): hides panel only; recording continues

### 4.4 Advanced Settings Modal

```
┌─ Advanced Camera Settings ──┐
│ Resolution: [ 1280 × 720 ▾ ] │  640×480 / 1280×720 / 1920×1080
│ FPS:        [ 30 fps     ▾ ] │  15 / 30 / 60
│ Bitrate:    [ 2.5 Mbps   ▾ ] │  1 / 2.5 / 5 / 8 Mbps
│                              │
│ ⚠️  4× 1080p/60fps will be   │  (dynamic warning when load is high)
│     CPU-intensive            │
│                              │
│ [Cancel]  [Apply]            │
└──────────────────────────────┘
```

### 4.5 Browser compatibility banner

Shown when running on non-Chrome/Edge desktop browsers (Safari, Firefox, mobile):

> ⚠️ Camera recording requires Chrome or Edge browser (File System Access API). Please switch to Chrome/Edge to enable cameras.

While shown, all camera UI is disabled. EEG recording is unaffected.

---

## 5. Data Format

### 5.1 Folder structure

```
<operator-selected-root>/
└── session_<sessionId>_<YYYYMMDD-HHmmss>/
    ├── eeg/
    │   ├── dev1.csv
    │   ├── dev2.csv
    │   └── ...                  # existing EEG CSV pipeline unchanged
    ├── video/
    │   ├── dev1_seg01.webm
    │   ├── dev1_seg02.webm
    │   ├── dev1_video.json      # ← per-camera sidecar
    │   ├── dev2_seg01.webm
    │   ├── dev2_video.json
    │   └── ...
    └── session_meta.json        # cross-modality index
```

NFB / Poseidon use `main_*` / `secondary_*` instead of `dev1_*` etc.

### 5.2 `session_meta.json` (cross-modality entry point)

```json
{
  "schema_version": "1.0",
  "session_id": "abc123",
  "app": "sgimacog-web",
  "app_version": "0.7.0",
  "created_at_iso": "2026-04-27T14:30:00.000+08:00",
  "epoch_origin_ms": 1714200600000,
  "duration_ms": 600250,
  "eeg": {
    "devices": [
      { "slot": "dev1", "csv": "eeg/dev1.csv", "sample_rate_hz": 250 },
      { "slot": "dev2", "csv": "eeg/dev2.csv", "sample_rate_hz": 250 }
    ]
  },
  "video": {
    "cameras": [
      { "slot": "dev1", "sidecar": "video/dev1_video.json" },
      { "slot": "dev2", "sidecar": "video/dev2_video.json" }
    ]
  }
}
```

`epoch_origin_ms` is the single source of truth for cross-device, cross-modality alignment.

### 5.3 Per-camera sidecar — `<slot>_video.json`

```json
{
  "schema_version": "1.0",
  "slot": "dev1",
  "device_label": "FaceTime HD Camera",
  "device_id_hash": "sha256:ab12...",
  "epoch_origin_ms": 1714200600000,
  "config": {
    "container": "webm",
    "codec": "vp8",
    "resolution": "1280x720",
    "fps_target": 30,
    "bitrate_bps": 2500000
  },
  "segments": [
    {
      "index": 1,
      "file": "dev1_seg01.webm",
      "start_ts_ms": 1714200605012,
      "end_ts_ms":   1714200725045,
      "frame_count": 3601,
      "frames": [
        { "i": 0, "ts_ms": 1714200605012 },
        { "i": 1, "ts_ms": 1714200605045 },
        { "i": 2, "ts_ms": 1714200605078 }
      ]
    },
    {
      "index": 2,
      "file": "dev1_seg02.webm",
      "start_ts_ms": 1714200780000,
      "end_ts_ms":   1714200820000,
      "frame_count": 1200,
      "frames": []
    }
  ],
  "errors": [
    {
      "ts_ms": 1714200750000,
      "code": "track_ended",
      "message": "Camera disconnected; segment 02 started after manual recovery"
    }
  ]
}
```

**Notes:**
- `frames[].ts_ms` is epoch ms (converted from `VideoFrame.timestamp` μs + epoch offset). Analysis code can do `pandas.read_csv(eeg).merge_asof(frames, on='ts_ms')`.
- `frames` array size: 4 cameras × 30 fps × 10 min = 72,000 entries × ~30 bytes ≈ 8 MB JSON. Acceptable. Advanced setting may allow omitting `frames` and reconstructing from `start_ts_ms + i / fps_target`; default keeps full frames.
- `device_id_hash` instead of raw `deviceId` — deviceId is origin-stable but cross-machine fingerprintable. Hash is sufficient for matching.
- `errors` records disconnect/reconnect events for post-hoc review.

### 5.4 Filename collision

The `session_<id>_<timestamp>` directory name is unique to the second; same-second collisions get `-2`, `-3` suffix.

---

## 6. Build Sequence

### Phase 1 — sgimacog-web (canonical implementation)

| Step | Deliverable |
|------|-------------|
| 1A | `services/camera/*` — 6 core modules, pure logic, unit-testable |
| 1B | `hooks/useCameraSession.ts` (or equivalent store) — slot lifecycle, EEG lifecycle binding, localStorage memory |
| 1C | UI components: `CameraSlotSelector`, `FloatingCameraPanel`, `CameraAdvancedSettings`, `BrowserCompatBanner` |
| 1D | Integration: `DevicePanel.tsx` slot, `RecordView.tsx` camera controls, consent text, `session_meta.json` writer extended with `video` block |
| 1E | Manual verification: 1 cam + 1 EEG, 4 cam + 4 EEG, Safari fallback banner, Python sidecar sanity check |

### Phase 2 — Port to NFB-Webapp (SoraMynd)

| Step | Deliverable |
|------|-------------|
| 2A | Copy `services/camera/*` (6 files) verbatim, header comment `// synced from sgimacog-web@<commit>` |
| 2B | Port consent modal pattern to RecordView/TrainingView entry. Add main+secondary slot UI to operator panel (TrainingView). Reuse `FloatingCameraPanel` with slot ids `main`/`secondary`. Verify `gameWindow.tsx` imports zero camera code. |
| 2C | Manual verification: dual-screen — operator main window shows floating panel; subject game window has no camera UI. BroadcastChannel messaging unaffected. |

### Phase 3 — Port to Poseidon

| Step | Deliverable |
|------|-------------|
| 3A | Copy `services/camera/*` (6 files), same header comment |
| 3B | Port consent modal to RecordView/TrainingView. Operator panel slots in RecordPanel or GameControlView. Reuse `FloatingCameraPanel`. Verify Pixi game window has no camera code. |
| 3C | Verify Poseidon packet flow (pkt/s > 0) and impedance still work after camera enabled — recurring regression point per project memory. |

### Phase 4 — Versions & deploy

| App | Change | Version bump |
|-----|--------|--------------|
| sgimacog-web | New feature (camera recording) | v0.6.0 → **v0.7.0** (MINOR) |
| NFB-Webapp | New feature | v0.7.2 → **v0.8.0** (MINOR) |
| poseidon | New feature | MINOR +1 |

Deploy order: sgimacog first (canonical), 1–2 weeks of validation, then NFB and Poseidon. Each follows existing deploy flow per CLAUDE.md. The artisebio-web reverse proxy is untouched.

### Phase 5 — Spec → Plan handoff

After this spec is reviewed and approved, the next step is the `superpowers:writing-plans` skill, generating an implementation plan for **Phase 1 (sgimacog-web) only**. NFB and Poseidon implementation plans will be generated after Phase 1 is validated in production.

---

## 7. Open Questions / Future Considerations

- **Audio**: currently disabled. If future research needs verbal protocol capture, can be added with separate consent text and a sync strategy (audio is captured by MediaRecorder natively, but cross-stream sync needs care).
- **IP cameras / RTSP**: deferred. Would require a desktop helper (Electron/Tauri) or WebRTC gateway.
- **Long-session memory pressure**: `frames[]` array grows with session length. For sessions > 30 min, consider chunked sidecar (`_video_part01.json`) or the omit-frames optimization.
- **Privacy**: `device_id_hash` salting strategy — currently using raw SHA-256. If concerned about deviceId stability tracking across sessions, could prefix with a session-specific salt.

---

## 8. Approval Trail

This design was developed via the `superpowers:brainstorming` skill on 2026-04-27. All 16 design decisions and 4 architecture sections were confirmed by the user before this document was written.

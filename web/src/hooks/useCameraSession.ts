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
  hasFolder: boolean;
  pickFolder(): Promise<void>;
  config: CameraConfig;
  setConfig(c: CameraConfig): void;
  slots: Record<CameraSlotId, SlotState>;
  setSlotDevice(slot: CameraSlotId, deviceId: string | null, label?: string): void;
  globalState: GlobalRecordState;
  /**
   * Create the session directory (and eeg/ + video/ subdirs) under the picked root folder.
   * Used by EEG controller so CSV can be written into the same session even without cameras.
   */
  prepareSession(args: { sessionId: string; startedAt: Date }): Promise<{
    sessionDir: FileSystemDirectoryHandle;
    eegDir: FileSystemDirectoryHandle;
  }>;
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

function makeInitialSlot(slot: CameraSlotId): SlotState {
  const dev = recallDeviceForSlot(slot);
  return { slot, deviceId: dev, deviceLabel: '', status: 'idle', segmentCount: 0 };
}

export function useCameraSession(): UseCameraSessionResult {
  const [enabled, setEnabled] = useState(false);
  const [config, setConfig] = useState<CameraConfig>(DEFAULT_CAMERA_CONFIG);
  const [rootFolderName, setRootFolderName] = useState<string | null>(null);
  const rootHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const sessionDirHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const videoDirHandle = useRef<FileSystemDirectoryHandle | null>(null);
  const [globalState, setGlobalState] = useState<GlobalRecordState>('idle');

  const [slots, setSlots] = useState<Record<CameraSlotId, SlotState>>(() => ({
    dev1: makeInitialSlot('dev1'),
    dev2: makeInitialSlot('dev2'),
    dev3: makeInitialSlot('dev3'),
    dev4: makeInitialSlot('dev4'),
  }));
  const sessionsRef = useRef<Partial<Record<CameraSlotId, CameraSlotSession>>>({});

  const patchSlot = useCallback((slot: CameraSlotId, patch: Partial<SlotState>) => {
    setSlots((prev) => ({ ...prev, [slot]: { ...prev[slot], ...patch } }));
  }, []);

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
    [patchSlot],
  );

  const prepareSession = useCallback(
    async (args: { sessionId: string; startedAt: Date }) => {
      if (!rootHandle.current) {
        throw new Error('No folder selected — call pickFolder() first.');
      }
      const dirName = buildSessionDirName(args.sessionId, args.startedAt);
      const sDir = await ensureSessionDir(rootHandle.current, dirName);
      sessionDirHandle.current = sDir;
      videoDirHandle.current = await sDir.getDirectoryHandle('video', { create: false });
      const eegDir = await sDir.getDirectoryHandle('eeg', { create: false });
      return { sessionDir: sDir, eegDir };
    },
    [],
  );

  const startAll = useCallback(
    async (args: { epochOriginMs: number; sessionId: string; startedAt: Date }) => {
      if (!enabled) return;
      if (!sessionDirHandle.current) {
        await prepareSession({ sessionId: args.sessionId, startedAt: args.startedAt });
      }

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
    [enabled, slots, config, patchSlot, prepareSession],
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
    sessionDirHandle.current = null;
    videoDirHandle.current = null;
    return sidecars;
  }, [patchSlot]);

  const getSlotStream = useCallback(
    (slot: CameraSlotId) => sessionsRef.current[slot]?.getStream() ?? null,
    [],
  );

  return {
    fsAvailable: isFsApiAvailable(),
    enabled,
    setEnabled,
    rootFolderName,
    hasFolder: rootHandle.current !== null,
    pickFolder,
    config,
    setConfig,
    slots,
    setSlotDevice,
    globalState,
    prepareSession,
    startAll,
    pauseSlot,
    resumeSlot,
    stopAll,
    getSlotStream,
    sessionDirHandle: sessionDirHandle.current,
  };
}

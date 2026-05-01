import React, { useEffect, useRef, useState, type FC, type CSSProperties } from 'react';
import type { EventMarker } from '../../hooks/useDevice';
import type { SubjectInfo } from '../../types/eeg';
import { CHANNEL_LABELS, CHANNEL_COUNT } from '../../types/eeg';
import type { RecordedSample } from '../../services/csvWriter';
import { generateCsv, downloadCsv, buildCsvFilename, buildCsvFilenameCustom, generateCsvBlob, downloadCsvBlob } from '../../services/csvWriter';
import { uploadSessionCsv, saveSessionResult, type SessionInfo } from '../../services/sessionApi';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import type { QualityConfig } from '../../hooks/useQualityMonitor';
import { analyzeEeg, SAMPLE_RATE } from '../../services/eegReport';
import { type RppgResults } from '../../services/reportPdf';
import { openHtmlReport, type ReportLang } from '../../services/eegReportHtml';
import { parseCsv } from '../../services/csvParser';
import { serviceStart, NoCreditError } from '../../services/creditApi';
import type { UseCameraSessionResult } from '../../hooks/useCameraSession';
import { FloatingCameraPanel } from '../camera/FloatingCameraPanel';
import { BrowserCompatBanner } from '../camera/BrowserCompatBanner';
import { CameraAdvancedSettings } from '../camera/CameraAdvancedSettings';
import type { SessionMeta } from '../../types/camera';
import { writeBlobAsFile, writeSessionMeta } from '../../services/camera/fsWriter';
import { APP_VERSION } from '../../version';

const VISIOMYND_URL = 'https://www.sigmacog.xyz/visiomynd';
const RPPG_CHANNEL  = 'sgimacog_rppg_sync';

export interface RecordViewProps {
  lang: Lang;
  isConnected: boolean;
  isRecording: boolean;
  subjectInfo: SubjectInfo;
  onSubjectInfoChange: (info: SubjectInfo) => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  recordedSamples: RecordedSample[];
  recordSamplesRef?: React.RefObject<RecordedSample[]>;
  sampleCount?: number;
  deviceId: string | null;
  filterDesc: string;
  notchDesc: string;
  startTime: Date | null;
  onEventMarker: (marker: { id: string; time: number; label: string }) => void;
  eventMarkers: EventMarker[];
  onClearEventMarkers: () => void;
  // Quality monitor props
  qualityConfig: QualityConfig;
  onQualityConfigChange: (config: QualityConfig) => void;
  currentWindowStds: Float32Array;
  goodTimeSec: number;
  goodPercent: number;
  shouldAutoStop: boolean;
  sessionInfo?: SessionInfo | null;
  /** Hide CSV file-report controls (used in multi-device panel) */
  compact?: boolean;
  /** Increment to trigger simultaneous stop+save from outside */
  stopAndSaveSignal?: number;
  /** Custom channel labels (flexible electrode mode) */
  channelLabels?: string[];
  /** True when device is in flexible electrode mode */
  isFlexibleElectrode?: boolean;
  /** True when impedance measurement is active — blocks starting recording */
  isImpedanceActive?: boolean;
  /** Device sample rate — used for CSV header (default 1000) */
  deviceSampleRate?: number;
  /** Global camera session — passed from App via DevicePanel. */
  cam?: UseCameraSessionResult;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p2 = (n: number) => n.toString().padStart(2, '0');
  const p3 = (n: number) => n.toString().padStart(3, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
}

const TARGET_DURATION_OPTIONS = [
  { value: 30,       label: '30'  },
  { value: 60,       label: '60'  },
  { value: 90,       label: '90'  },
  { value: 120,      label: '120' },
  { value: 150,      label: '150' },
  { value: 180,      label: '180' },
  { value: 300,      label: '300' },
  { value: Infinity, label: ''    },
];

function formatGoodTime(sec: number): string {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export const RecordView: FC<RecordViewProps> = ({
  lang,
  isConnected,
  isRecording,
  subjectInfo,
  onSubjectInfoChange,
  onStartRecording,
  onStopRecording,
  recordedSamples,
  recordSamplesRef,
  sampleCount: sampleCountProp,
  deviceId,
  filterDesc,
  notchDesc,
  startTime,
  onEventMarker,
  eventMarkers,
  onClearEventMarkers,
  qualityConfig,
  onQualityConfigChange,
  currentWindowStds,
  goodTimeSec,
  goodPercent,
  shouldAutoStop,
  sessionInfo,
  compact = false,
  stopAndSaveSignal = 0,
  channelLabels,
  isFlexibleElectrode = false,
  isImpedanceActive = false,
  deviceSampleRate,
  cam,
}) => {
  // Use ref-based access when available (avoids full-array copy); fall back to prop
  const getSamples = (): RecordedSample[] => recordSamplesRef?.current ?? recordedSamples;
  const sampleCount = sampleCountProp ?? recordedSamples.length;
  // Report generation allowed as long as all 8 required positions are present in channel labels.
  const defaultLabels = ['Fp1', 'Fp2', 'T7', 'T8', 'O1', 'O2', 'Fz', 'Pz'];
  const activeLabels = channelLabels ?? defaultLabels;
  const canGenerateReport = defaultLabels.every(l => activeLabels.includes(l));
  // Indices of the 8 report channels within the active channel list
  const reportChannelIndices = defaultLabels.map(l => activeLabels.indexOf(l));

  const [saveFilename, setSaveFilename] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [showCamSettings, setShowCamSettings] = useState(false);
  const [showCamPanel, setShowCamPanel] = useState(true);
  const [showFolderError, setShowFolderError] = useState(false);
  const [folderErrorMsg, setFolderErrorMsg] = useState('');
  const [recStartTs, setRecStartTs] = useState<number | null>(null);
  const [reportStatus, setReportStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  const [autoStopMode, setAutoStopMode] = useState<'csv' | 'report'>('csv');
  const [enableRppg, setEnableRppg] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [rppgResults, setRppgResults] = useState<RppgResults | null>(null);
  const [fileStatus, setFileStatus] = useState<'idle' | 'parsing' | 'analyzing' | 'done' | 'error'>('idle');
  const [fileStatusMsg, setFileStatusMsg] = useState('');
  const [fileDob, setFileDob] = useState('');
  const [fileId, setFileId] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSex, setFileSex] = useState<'M' | 'F' | 'Other' | ''>('');
  const [fileReportLang, setFileReportLang] = useState<ReportLang>('zh-TW');
  const [broadcastHardwareMarker, setBroadcastHardwareMarker] = useState(false);
  const broadcastHardwareMarkerRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStoppedRef = useRef(false);
  const rppgChannelRef = useRef<BroadcastChannel | null>(null);
  const markersScrollRef = useRef<HTMLDivElement | null>(null);

  // ── rPPG BroadcastChannel setup ─────────────────────────────────────────
  useEffect(() => {
    const ch = new BroadcastChannel(RPPG_CHANNEL);
    rppgChannelRef.current = ch;
    ch.onmessage = (ev) => {
      if (ev.data?.type === 'rppg_done') {
        setRppgResults(ev.data.results as RppgResults);
      }
    };
    return () => { ch.close(); rppgChannelRef.current = null; };
  }, []);

  // ── Hardware marker broadcast toggle — mirror state to ref ───────────────
  useEffect(() => { broadcastHardwareMarkerRef.current = broadcastHardwareMarker; }, [broadcastHardwareMarker]);

  // ── Hardware marker broadcast re-dispatch ────────────────────────────────
  // Listens for hardware-marker-visual events (fired by useDevice or App.tsx
  // on every TLV Tag-7 byte) and, when the broadcast toggle is on, re-dispatches
  // as hardware-marker-broadcast so sibling useDevice instances queue the value
  // into their pendingHardwareMarkerRef (E4).
  //
  // Bug #2 fix: only re-broadcast events with source === 'packet'.  Events whose
  // source is 'broadcast' originated from a sibling's injected pending value —
  // re-broadcasting them would create an infinite echo loop between devices.
  useEffect(() => {
    const handler = (ev: Event) => {
      if (!broadcastHardwareMarkerRef.current) return;
      const ce = ev as CustomEvent<{ value: number; deviceId: string; timestamp: number; source?: 'packet' | 'broadcast'; originWallclock?: number }>;
      // Only re-broadcast events that originated from a primary packet.
      if (ce.detail.source !== 'packet') return;
      window.dispatchEvent(new CustomEvent('hardware-marker-broadcast', {
        detail: {
          value: ce.detail.value,
          originDeviceId: ce.detail.deviceId,
          originWallclock: ce.detail.originWallclock ?? Date.now(),
        },
      }));
    };
    window.addEventListener('hardware-marker-visual', handler);
    return () => window.removeEventListener('hardware-marker-visual', handler);
  }, []);

  // ── THEMynd event-marker receiver ───────────────────────────────────────
  // Accepts markers from THEMynd via (a) same-origin BroadcastChannel and
  // (b) cross-origin postMessage (when THEMynd is iframed or opened via window.open).
  useEffect(() => {
    const handleMarker = (data: {
      source?: string;
      id?: number;
      event?: string;
      taskId?: number;
      trialIdx?: number;
      rt?: number;
      correct?: boolean;
      wallclock?: number;
    }) => {
      if (!data || data.source !== 'themynd') return;
      const parts = [`#${data.id ?? '?'}`, data.event ?? '?', `task=${data.taskId ?? '?'}`];
      if (data.trialIdx != null) parts.push(`trial=${data.trialIdx}`);
      if (data.rt != null) parts.push(`rt=${data.rt}ms`);
      if (data.correct != null) parts.push(data.correct ? '✓' : '✗');
      const fullLabel = parts.join(' · ');
      // (1) Add to the right-side marker list
      onEventMarker({
        id: `themynd-${data.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: data.wallclock ?? Date.now(),
        label: fullLabel,
      });
      // (2) Also draw a vertical marker on the waveform canvas (short label to fit)
      const shortLabel = `#${data.id ?? '?'}`;
      window.dispatchEvent(new CustomEvent('themynd-marker-visual', {
        detail: { label: shortLabel, fullLabel, wallclock: data.wallclock ?? Date.now() },
      }));
    };

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('sigmacog-markers');
      bc.onmessage = (ev) => handleMarker(ev.data);
    } catch {
      /* some browsers may not support BroadcastChannel */
    }

    const onPostMsg = (ev: MessageEvent) => {
      // Accept from any origin — THEMynd tags messages with source='themynd'
      handleMarker(ev.data);
    };
    window.addEventListener('message', onPostMsg);

    return () => {
      if (bc) bc.close();
      window.removeEventListener('message', onPostMsg);
    };
  }, [onEventMarker]);

  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        if (startTime) {
          setElapsed(Date.now() - startTime.getTime());
        }
      }, 500);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [isRecording, startTime]);

  // Open VisioMynd in a new tab with subject info pre-filled
  const openVisioMynd = () => {
    const params = new URLSearchParams();
    if (subjectInfo.name) params.set('name', subjectInfo.name);
    if (subjectInfo.dob)  params.set('dob',  subjectInfo.dob);
    if (subjectInfo.sex)  params.set('sex',  subjectInfo.sex);
    if (subjectInfo.id)   params.set('id',   subjectInfo.id);
    window.open(`${VISIOMYND_URL}?${params.toString()}`, 'visiomynd_rppg');
    // Also broadcast subject info for tabs already open
    rppgChannelRef.current?.postMessage({ type: 'sgimacog_init', subject: subjectInfo });
  };

  const broadcastEegDone = () => {
    rppgChannelRef.current?.postMessage({ type: 'eeg_done' });
  };

  // ── Session lifecycle helpers ────────────────────────────────────────────
  const handleStartWithCam = async () => {
    const startedAt = new Date();
    const epochOriginMs = startedAt.getTime();
    setRecStartTs(epochOriginMs);
    onStartRecording();
    const sid = sessionInfo?.sessionId ?? `local-${epochOriginMs}`;
    // If a folder is picked, prepare the session dir up-front so EEG CSV can land
    // in the same place even when cameras are disabled.
    if (cam?.hasFolder) {
      try {
        await cam.prepareSession({ sessionId: sid, startedAt });
      } catch (err) {
        console.error('[session] prepareSession failed:', err);
      }
    }
    if (cam?.enabled && cam.rootFolderName) {
      try {
        await cam.startAll({ epochOriginMs, sessionId: sid, startedAt });
      } catch (err) {
        console.error('[camera] startAll failed:', err);
        alert(`Camera start failed: ${(err as Error).message}\nEEG recording continues.`);
      }
    }
  };

  /** Write CSV to the picked folder's eeg/ subdir if available; else download to browser. */
  const saveCsvToFolderOrDownload = async (blob: Blob, filename: string): Promise<void> => {
    if (cam?.hasFolder && cam.sessionDirHandle) {
      try {
        const eegDir = await cam.sessionDirHandle.getDirectoryHandle('eeg', { create: false });
        await writeBlobAsFile(eegDir, filename, blob);
        return;
      } catch (err) {
        console.error('[fsa] EEG CSV write failed, falling back to download:', err);
      }
    }
    downloadCsvBlob(blob, filename);
  };

  const cameraStopAndWriteMeta = async () => {
    if (!cam?.enabled) return;
    const stoppedAt = Date.now();
    try {
      const sidecars = await cam.stopAll();
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
    setRecStartTs(null);
  };

  const handleStop = async () => {
    broadcastEegDone();
    onStopRecording();
    const samples = getSamples();
    if (samples.length > 0 && startTime) {
      const blob = generateCsvBlob(
        samples,
        startTime,
        deviceId ?? 'STEEG_UNKNOWN',
        filterDesc,
        notchDesc,
        channelLabels,
        deviceSampleRate,
      );
      const filename = buildCsvFilenameCustom(saveFilename, deviceId, startTime);
      await saveCsvToFolderOrDownload(blob, filename);
      if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
        blob.text().then(content =>
          uploadSessionCsv(sessionInfo.sessionId!, sessionInfo.sessionToken!, content, filename));
      }
    }
    void cameraStopAndWriteMeta();
  };

  // Plain stop — no download
  const handleStopOnly = () => {
    broadcastEegDone();
    onStopRecording();
    void cameraStopAndWriteMeta();
  };

  // Auto-stop + report: always saves CSV, generates report only if data ≥ 90s (no alert on short data)
  const handleAutoStopReport = async () => {
    broadcastEegDone();
    onStopRecording();
    const samples = getSamples();
    if (samples.length === 0 || !startTime) {
      void cameraStopAndWriteMeta();
      return;
    }
    const blob = generateCsvBlob(samples, startTime, deviceId ?? 'STEEG_UNKNOWN', filterDesc, notchDesc, channelLabels, deviceSampleRate);
    const filename = buildCsvFilenameCustom(saveFilename, deviceId, startTime);
    await saveCsvToFolderOrDownload(blob, filename);
    void cameraStopAndWriteMeta();
    if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
      blob.text().then(content =>
        uploadSessionCsv(sessionInfo.sessionId!, sessionInfo.sessionToken!, content, filename));
    }
    const durationSec = samples.length / SAMPLE_RATE;
    if (durationSec < 90) return; // too short for report; CSV already saved
    // Deduct one session credit before running analysis
    try {
      await serviceStart('sigmacog');
    } catch (e) {
      if (e instanceof NoCreditError) {
        setReportStatus('error');
        return;
      }
    }
    setReportStatus('analyzing');
    try {
      const result = await analyzeEeg(samples, subjectInfo.dob ?? '', reportChannelIndices, deviceSampleRate ?? SAMPLE_RATE);
      if (result.error) { setReportStatus('error'); return; }
      await openHtmlReport(result, subjectInfo, startTime, deviceId, rppgResults ?? undefined, fileReportLang);
      if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
        saveSessionResult(sessionInfo.sessionId, sessionInfo.sessionToken, {
          age:          result.age,
          clean_epochs: result.cleanEpochs,
          total_epochs: result.totalEpochs,
          duration_sec: result.durationSec,
          indices:      result.indices,
          tscores:      result.tscores,
          capability:   result.capability,
        });
      }
      setReportStatus('done');
    } catch (err) {
      console.error('Auto-stop report error:', err);
      setReportStatus('error');
    }
  };

  const handleStopAndReport = async () => {
    const samples = getSamples();
    const durationSec = samples.length / SAMPLE_RATE;
    if (durationSec < 90) {
      alert(T(lang, 'recordReportTooShort'));
      return;
    }
    // Stop recording and save CSV first
    onStopRecording();
    let csvFilename = '';
    if (samples.length > 0 && startTime) {
      const blob = generateCsvBlob(
        samples,
        startTime,
        deviceId ?? 'STEEG_UNKNOWN',
        filterDesc,
        notchDesc,
        channelLabels,
        deviceSampleRate,
      );
      csvFilename = buildCsvFilenameCustom(saveFilename, deviceId, startTime);
      await saveCsvToFolderOrDownload(blob, csvFilename);
      if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
        blob.text().then(content =>
          uploadSessionCsv(sessionInfo.sessionId!, sessionInfo.sessionToken!, content, csvFilename));
      }
    }
    void cameraStopAndWriteMeta();
    // Deduct one session credit before running analysis
    try {
      await serviceStart('sigmacog');
    } catch (e) {
      if (e instanceof NoCreditError) {
        alert(lang === 'zh' ? 'SigmaCog 使用次數已用完，請聯繫管理員補充額度。' : 'No remaining SigmaCog credits. Contact admin.');
        setReportStatus('idle');
        return;
      }
    }
    // Run EEG analysis asynchronously
    broadcastEegDone();
    setReportStatus('analyzing');
    try {
      const result = await analyzeEeg(samples, subjectInfo.dob ?? '', reportChannelIndices, deviceSampleRate ?? SAMPLE_RATE);
      if (result.error) {
        alert(`${T(lang, 'recordReportError')}: ${result.error}`);
        setReportStatus('error');
        return;
      }
      await openHtmlReport(result, subjectInfo, startTime, deviceId, rppgResults ?? undefined, fileReportLang);
      // Save EEG metrics to project session
      if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
        saveSessionResult(sessionInfo.sessionId, sessionInfo.sessionToken, {
          age:          result.age,
          clean_epochs: result.cleanEpochs,
          total_epochs: result.totalEpochs,
          duration_sec: result.durationSec,
          indices:      result.indices,
          tscores:      result.tscores,
          capability:   result.capability,
        });
      }
      setReportStatus('done');
    } catch (err) {
      console.error('Report generation error:', err);
      alert(T(lang, 'recordReportError'));
      setReportStatus('error');
    }
  };

  const handleFileReport = async (file: File) => {
    setFileStatus('parsing');
    setFileStatusMsg('');
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.error || parsed.samples.length === 0) {
        setFileStatus('error');
        setFileStatusMsg(T(lang, 'recordFromFileErrParse') + (parsed.error ? ` (${parsed.error})` : ''));
        return;
      }
      const fileSr = parsed.sampleRate ?? SAMPLE_RATE;
      const dur = parsed.samples.length / fileSr;
      if (dur < 90) {
        setFileStatus('error');
        setFileStatusMsg(T(lang, 'recordFromFileErrShort') + ` (${dur.toFixed(1)} s)`);
        return;
      }
      // Deduct one session credit before running analysis
      try {
        await serviceStart('sigmacog');
      } catch (e) {
        if (e instanceof NoCreditError) {
          setFileStatus('error');
          setFileStatusMsg(lang === 'zh' ? 'SigmaCog 使用次數已用完，請聯繫管理員補充額度。' : 'No remaining SigmaCog credits. Contact admin.');
          return;
        }
      }
      // Compute channel indices for the 8 report positions from the parsed CSV labels
      const fileChIndices = defaultLabels.map(l => {
        const idx = parsed.channelLabels.indexOf(l);
        return idx >= 0 ? idx : defaultLabels.indexOf(l); // fallback to identity
      });
      setFileStatus('analyzing');
      let result;
      try {
        result = await analyzeEeg(parsed.samples, subjectInfo.dob ?? '', fileChIndices, fileSr);
      } catch (wasmErr) {
        console.error('analyzeEeg threw:', wasmErr);
        setFileStatus('error');
        setFileStatusMsg(`WASM 分析錯誤: ${wasmErr instanceof Error ? wasmErr.message : String(wasmErr)}`);
        return;
      }
      if (result.error) {
        setFileStatus('error');
        setFileStatusMsg(T(lang, 'recordFromFileErrAnalysis') + `: ${result.error}`);
        return;
      }
      try {
        await openHtmlReport(result, subjectInfo, parsed.recordDatetime ? new Date(parsed.recordDatetime) : null, parsed.deviceId || deviceId, undefined, fileReportLang);
      } catch (reportErr) {
        console.error('openHtmlReport threw:', reportErr);
        setFileStatus('error');
        setFileStatusMsg(`報告生成錯誤: ${reportErr instanceof Error ? reportErr.message : String(reportErr)}`);
        return;
      }
      setFileStatus('done');
      setFileStatusMsg(
        `${T(lang, 'recordFromFileSamples')}: ${parsed.samples.length.toLocaleString()}  |  ${T(lang, 'recordFromFileDuration')}: ${Math.floor(dur / 60)}m ${Math.floor(dur % 60)}s`,
      );
    } catch (err) {
      console.error('File report error:', err);
      setFileStatus('error');
      setFileStatusMsg(`${T(lang, 'recordFromFileErrAnalysis')}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Simultaneous stop+save from broadcast (同時停止 button)
  // Uses handleAutoStopReport: stops recording, downloads CSV, generates report if ≥ 90s (no alert)
  useEffect(() => {
    if (stopAndSaveSignal === 0) return;
    if (isRecording) void handleAutoStopReport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopAndSaveSignal]);

  // Auto-stop when quality target is reached
  const handleAutoStopRef = useRef<() => void | Promise<void>>(handleStop);
  handleAutoStopRef.current = autoStopMode === 'report' ? handleAutoStopReport : handleStop;
  useEffect(() => {
    if (!isRecording) {
      autoStoppedRef.current = false;
      return;
    }
    if (shouldAutoStop && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      const autoStop = handleAutoStopRef.current;
      void autoStop();
    }
  }, [shouldAutoStop, isRecording]);

  const addMarker = () => {
    const id = Math.random().toString(36).substring(2, 9);
    const time = Date.now();
    const label = `M${eventMarkers.length + 1}`;
    onEventMarker({ id, time, label });
  };

  const inputStyle: CSSProperties = {
    background: 'rgba(13,23,32,0.85)',
    border: '1px solid rgba(40,64,80,0.45)',
    borderRadius: 7,
    color: '#c8e0d8',
    fontSize: 14,
    padding: '9px 12px',
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    color: 'rgba(136,176,168,0.8)',
    fontSize: 13,
    marginBottom: 5,
    fontWeight: 500,
  };

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── Left column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Subject info form */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(72,186,166,0.4)', marginBottom: 0 } as React.CSSProperties}>
        <h3 style={{ margin: '0 0 16px', fontSize: '0.95rem', fontWeight: 600, color: 'rgba(200,224,216,0.85)' }}>
          {T(lang, 'recordTitle')}
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Subject ID */}
          <div>
            <label style={labelStyle}>{T(lang, 'recordSubjectId')}</label>
            <input
              type="text"
              value={subjectInfo.id}
              onChange={e => onSubjectInfoChange({ ...subjectInfo, id: e.target.value })}
              disabled={isRecording}
              style={inputStyle}
              placeholder="e.g. S001"
            />
          </div>

          {/* Name */}
          <div>
            <label style={labelStyle}>{T(lang, 'recordSubjectName')}</label>
            <input
              type="text"
              value={subjectInfo.name}
              onChange={e => onSubjectInfoChange({ ...subjectInfo, name: e.target.value })}
              disabled={isRecording}
              style={inputStyle}
            />
          </div>

          {/* Date of birth */}
          <div>
            <label style={labelStyle}>{T(lang, 'recordDob')}</label>
            <input
              type="date"
              lang="en"
              value={subjectInfo.dob}
              onChange={e => onSubjectInfoChange({ ...subjectInfo, dob: e.target.value })}
              disabled={isRecording}
              style={inputStyle}
            />
          </div>

          {/* Sex */}
          <div>
            <label style={labelStyle}>{T(lang, 'recordSex')}</label>
            <select
              value={subjectInfo.sex}
              onChange={e => onSubjectInfoChange({
                ...subjectInfo,
                sex: e.target.value as SubjectInfo['sex'],
              })}
              disabled={isRecording}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              <option value="">--</option>
              <option value="M">{T(lang, 'recordSexMale')}</option>
              <option value="F">{T(lang, 'recordSexFemale')}</option>
              <option value="Other">{T(lang, 'recordSexOther')}</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div style={{ marginTop: 14 }}>
          <label style={labelStyle}>{T(lang, 'recordNotes')}</label>
          <textarea
            value={subjectInfo.notes}
            onChange={e => onSubjectInfoChange({ ...subjectInfo, notes: e.target.value })}
            disabled={isRecording}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical', minHeight: 52 }}
          />
        </div>
      </div>

      {/* Quality monitor card */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(63,185,80,0.4)', marginBottom: 0 } as React.CSSProperties}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: qualityConfig.enabled ? 14 : 0 }}>
          <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: 'rgba(200,224,216,0.85)' }}>
            {T(lang, 'recordQualityGrid')}
          </h3>
          {/* Toggle */}
          <button
            onClick={() => onQualityConfigChange({ ...qualityConfig, enabled: !qualityConfig.enabled })}
            style={{
              background: qualityConfig.enabled ? 'rgba(63,185,80,0.15)' : 'rgba(13,40,56,0.4)',
              border: `1px solid ${qualityConfig.enabled ? 'rgba(63,185,80,0.5)' : 'rgba(40,64,80,0.4)'}`,
              borderRadius: 6,
              color: qualityConfig.enabled ? '#3fb950' : 'rgba(87,136,136,0.6)',
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s',
              minWidth: 52,
            }}
          >
            {qualityConfig.enabled ? T(lang, 'recordQualityEnabled') : T(lang, 'recordQualityDisabled')}
          </button>
        </div>

        {qualityConfig.enabled && (<>

        {/* Target duration + sensitivity row */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'rgba(136,176,168,0.75)' }}>
              {T(lang, 'recordTargetDuration')}:
            </label>
            <select
              value={isFinite(qualityConfig.targetDurationSec) ? qualityConfig.targetDurationSec : 'Infinity'}
              onChange={e => {
                const raw = e.target.value;
                const val = raw === 'Infinity' ? Infinity : Number(raw);
                onQualityConfigChange({ ...qualityConfig, targetDurationSec: val });
              }}
              disabled={isRecording}
              style={{
                background: 'rgba(13,23,32,0.85)',
                border: '1px solid rgba(40,64,80,0.45)',
                borderRadius: 6,
                color: '#c8e0d8',
                fontSize: 12,
                padding: '4px 8px',
                cursor: isRecording ? 'not-allowed' : 'pointer',
                outline: 'none',
              }}
            >
              {TARGET_DURATION_OPTIONS.map(opt => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {isFinite(opt.value) ? opt.label : T(lang, 'recordDurationManual')}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'rgba(136,176,168,0.6)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>(S)</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'rgba(136,176,168,0.75)' }}>
              {T(lang, 'recordSensitivity')}:
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              {([1, 2, 3, 4, 5] as const).map(level => (
                <button
                  key={level}
                  onClick={() => onQualityConfigChange({ ...qualityConfig, sensitivity: level })}
                  style={{
                    width: 28, height: 28,
                    borderRadius: 5,
                    border: `1px solid ${qualityConfig.sensitivity === level ? 'rgba(72,186,166,0.7)' : 'rgba(40,64,80,0.4)'}`,
                    background: qualityConfig.sensitivity === level ? 'rgba(72,186,166,0.2)' : 'transparent',
                    color: qualityConfig.sensitivity === level ? '#7cd8c0' : 'rgba(136,176,168,0.6)',
                    fontSize: 12, fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'rgba(87,136,136,0.55)' }}>
              {T(lang, 'recordSensitivityLenient')} → {T(lang, 'recordSensitivityStrict')}
            </span>
          </div>

          {/* Auto-stop mode toggle — only shown when a finite target duration is set */}
          {isFinite(qualityConfig.targetDurationSec) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 12, color: 'rgba(136,176,168,0.75)', whiteSpace: 'nowrap' }}>
                {T(lang, 'recordAutoStopMode')}:
              </label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['csv', 'report'] as const).map(mode => {
                  const isReportBlocked = mode === 'report' && !canGenerateReport;
                  return (
                    <button
                      key={mode}
                      onClick={() => !isReportBlocked && setAutoStopMode(mode)}
                      disabled={isRecording || isReportBlocked}
                      title={isReportBlocked ? T(lang, 'electrodeReportBlocked') : undefined}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 5,
                        border: `1px solid ${autoStopMode === mode
                          ? (mode === 'report' ? 'rgba(72,186,166,0.6)' : 'rgba(248,81,73,0.5)')
                          : 'rgba(40,64,80,0.4)'}`,
                        background: autoStopMode === mode
                          ? (mode === 'report' ? 'rgba(72,186,166,0.18)' : 'rgba(248,81,73,0.12)')
                          : 'transparent',
                        color: autoStopMode === mode
                          ? (mode === 'report' ? '#7cd8c0' : '#f85149')
                          : 'rgba(136,176,168,0.5)',
                        fontSize: 12, fontWeight: 600,
                        cursor: (isRecording || isReportBlocked) ? 'not-allowed' : 'pointer',
                        opacity: (isRecording || isReportBlocked) ? 0.35 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mode === 'csv' ? T(lang, 'recordAutoStopCsv') : T(lang, 'recordAutoStopReport')}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Channel STD quality grid (8 or 32 channels) */}
        {(() => {
          const nch = channelLabels?.length ?? CHANNEL_COUNT;
          const cols = nch > 8 ? 8 : nch;
          const cellPad = nch > 8 ? '3px 2px' : '6px 4px';
          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: nch > 8 ? 3 : 6,
              marginBottom: 14,
            }}>
              {Array.from({ length: nch }, (_, ch) => {
                const std = currentWindowStds[ch] ?? 0;
                const thresholds = [200, 150, 100, 60, 30];
                const threshold = thresholds[(qualityConfig.sensitivity - 1)] ?? 100;
                const color = std < threshold
                  ? '#3fb950'
                  : std < threshold * 1.5
                    ? '#e3a030'
                    : '#f85149';
                return (
                  <div key={ch} style={{
                    padding: cellPad,
                    background: `${color}12`,
                    border: `1px solid ${color}44`,
                    borderRadius: nch > 8 ? 4 : 6,
                    textAlign: 'center',
                  }}>
                    <div style={{
                      fontSize: nch > 8 ? 8 : 10, fontWeight: 700,
                      color: 'rgba(136,176,168,0.7)',
                      fontFamily: "'IBM Plex Mono', monospace",
                      marginBottom: 1,
                    }}>
                      {(channelLabels ?? CHANNEL_LABELS)[ch]}
                    </div>
                    <div style={{
                      fontSize: nch > 8 ? 9 : 11, fontWeight: 700,
                      color,
                      fontFamily: "'IBM Plex Mono', monospace",
                    }}>
                      {isRecording ? `${std.toFixed(0)}` : '--'}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Progress bar (only during recording) */}
        {isRecording && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(136,176,168,0.75)' }}>
                {T(lang, 'recordGoodTime')}: <span style={{ color: '#3fb950', fontWeight: 700 }}>{formatGoodTime(goodTimeSec)}</span>
                {isFinite(qualityConfig.targetDurationSec) && (
                  <span style={{ color: 'rgba(87,136,136,0.6)' }}>
                    {' '}/ {formatGoodTime(qualityConfig.targetDurationSec)} ({T(lang, 'recordTargetDuration')})
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12, color: '#7ec8f5', fontWeight: 700 }}>
                {T(lang, 'recordQualityPct')}: {goodPercent}%
              </span>
            </div>
            {isFinite(qualityConfig.targetDurationSec) && (
              <div style={{
                height: 6,
                background: 'rgba(13,40,56,0.7)',
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid rgba(40,64,80,0.3)',
              }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(100, (goodTimeSec / qualityConfig.targetDurationSec) * 100)}%`,
                  background: 'linear-gradient(90deg, #3fb950, #85e89d)',
                  borderRadius: 3,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            )}
          </div>
        )}
        </>)}
      </div>

      {/* Recording controls */}
      <div
        className="nd-card"
        style={{
          '--card-accent': isRecording ? 'rgba(248,81,73,0.5)' : 'rgba(40,64,80,0.3)',
          borderColor: isRecording ? 'rgba(248,81,73,0.25)' : undefined,
          transition: 'border-color 0.3s',
          marginBottom: 0,
        } as React.CSSProperties}
      >
        {/* Header row: title + status + checkboxes */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          {/* Left: title or recording status */}
          {isRecording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: '#f85149',
                animation: 'pulse 1s infinite',
                flexShrink: 0,
              }} />
              <span style={{ color: '#f85149', fontWeight: 700, fontSize: 14 }}>
                {T(lang, 'signalRecording')}
              </span>
              <span style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: 18, fontWeight: 700, color: '#c5d8f0',
                letterSpacing: '0.05em',
              }}>
                {formatDuration(elapsed)}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '0.92rem', fontWeight: 600, color: 'rgba(200,224,216,0.85)' }}>
              {T(lang, 'recordStart')}
            </span>
          )}

          {/* Right: checkboxes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 7,
              cursor: isRecording ? 'not-allowed' : 'pointer', userSelect: 'none', fontSize: 13,
              color: enableRppg ? '#5be0c0' : 'rgba(140,160,185,0.65)',
              opacity: isRecording ? 0.6 : 1,
            }}>
              <input
                type="checkbox"
                checked={enableRppg}
                disabled={isRecording}
                onChange={e => {
                  setEnableRppg(e.target.checked);
                  if (e.target.checked) openVisioMynd();
                }}
                style={{ width: 14, height: 14, cursor: isRecording ? 'not-allowed' : 'pointer', accentColor: '#5be0c0' }}
              />
              同步 rPPG 錄製（VisioMynd）
            </label>

            {rppgResults && (
              <span style={{ fontSize: 11, color: '#5be0c0', background: 'rgba(91,224,192,0.1)', borderRadius: 5, padding: '3px 8px' }}>
                ✓ rPPG 資料已接收
              </span>
            )}

            <label style={{
              display: 'flex', alignItems: 'center', gap: 7,
              cursor: 'pointer', userSelect: 'none', fontSize: 13,
              color: broadcastHardwareMarker ? '#e3a030' : 'rgba(140,160,185,0.65)',
            }}>
              <input
                type="checkbox"
                checked={broadcastHardwareMarker}
                onChange={e => setBroadcastHardwareMarker(e.target.checked)}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#e3a030' }}
              />
              硬體 marker 廣播至所有錄製中的裝置
            </label>
          </div>
        </div>

        {/* Save filename input (only shown before recording starts) */}
        {!isRecording && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'rgba(136,176,168,0.75)', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {lang === 'zh' ? '存檔檔名' : 'Filename'}:
            </label>
            <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
              <input
                type="text"
                value={saveFilename}
                onChange={e => setSaveFilename(e.target.value)}
                placeholder={lang === 'zh'
                  ? `recording${deviceId?.replace(/^STEEG_/, '') ?? ''}_YYYYMMDD_HHmmss`
                  : `recording${deviceId?.replace(/^STEEG_/, '') ?? ''}_YYYYMMDD_HHmmss`}
                style={{
                  ...inputStyle,
                  fontSize: 12,
                  padding: '6px 10px',
                  paddingRight: saveFilename ? 70 : 10,
                  color: saveFilename ? '#c8e0d8' : 'rgba(136,176,168,0.45)',
                }}
              />
              {saveFilename && (
                <span style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  fontSize: 11, color: 'rgba(136,176,168,0.5)',
                  fontFamily: "'IBM Plex Mono', monospace",
                  pointerEvents: 'none',
                }}>
                  _HHmmss
                </span>
              )}
            </div>
            {saveFilename && (
              <button
                onClick={() => setSaveFilename('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(136,176,168,0.45)',
                  fontSize: 14,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  flexShrink: 0,
                }}
                title={lang === 'zh' ? '清除' : 'Clear'}
              >
                ×
              </button>
            )}
          </div>
        )}

        {/* Save folder — controls EEG CSV destination (and camera output when enabled) */}
        {cam && cam.fsAvailable && (
          <div className="cam-rig">
            <div className="cam-rig-head">
              <span className="cam-rig-head-glyph" aria-hidden="true">α</span>
              <span>{lang === 'zh' ? '存檔資料夾' : 'Save Folder'}</span>
            </div>
            <div className="cam-rig-body">
              <button
                type="button"
                className={`cam-pill${cam.rootFolderName ? ' has-folder' : ''}`}
                disabled={isRecording}
                onClick={async () => {
                  try {
                    await cam.pickFolder();
                  } catch (err) {
                    const e = err as DOMException;
                    if (e?.name === 'AbortError') return; // user cancelled
                    setFolderErrorMsg(e?.message ?? String(err));
                    setShowFolderError(true);
                  }
                }}
              >
                <span className="cam-pill-glyph" aria-hidden="true">▦</span>
                {cam.rootFolderName ?? (lang === 'zh' ? '選擇資料夾' : 'Choose folder')}
              </button>
              <span style={{
                fontSize: '.62rem',
                color: cam.rootFolderName ? 'var(--green)' : 'var(--muted)',
                fontFamily: "'IBM Plex Mono', monospace",
                letterSpacing: '.08em',
                lineHeight: 1.5,
              }}>
                {cam.rootFolderName
                  ? (lang === 'zh' ? 'EEG／相機檔將寫入此資料夾' : 'EEG / camera files will be written here')
                  : (lang === 'zh' ? '未選 — EEG 將下載到瀏覽器預設位置' : 'Not set — EEG will download to browser default')}
              </span>
            </div>
          </div>
        )}

        {cam && !cam.fsAvailable && (
          <div style={{ margin: '12px 0' }}>
            <BrowserCompatBanner lang={lang} />
          </div>
        )}

        {/* Camera enable — independent of folder picker */}
        {cam && cam.fsAvailable && (
          <div className="cam-rig">
            <div className="cam-rig-head">
              <span className="cam-rig-head-glyph" aria-hidden="true">α</span>
              <span>{lang === 'zh' ? '相機錄製' : 'Camera Recording'}</span>
            </div>
            <div className="cam-rig-body">
              <label className={`cam-check${isRecording ? ' disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={cam.enabled}
                  disabled={isRecording}
                  onChange={async (e) => {
                    const wantOn = e.target.checked;
                    if (!wantOn) { cam.setEnabled(false); return; }
                    // Ensure a writable folder is granted before enabling cameras
                    if (!cam.hasFolder) {
                      try {
                        await cam.pickFolder();
                      } catch (err) {
                        const ex = err as DOMException;
                        if (ex?.name === 'AbortError') return; // user cancelled, keep unchecked
                        setFolderErrorMsg(ex?.message ?? String(err));
                        setShowFolderError(true);
                        return;
                      }
                    }
                    cam.setEnabled(true);
                  }}
                />
                <span className="cam-check-box" aria-hidden="true" />
                {lang === 'zh' ? '啟用相機錄製' : 'Enable camera recording'}
              </label>
              <button
                type="button"
                className="cam-pill"
                disabled={!cam.enabled}
                onClick={() => setShowCamSettings(true)}
              >
                <span className="cam-pill-glyph" aria-hidden="true">⚙</span>
                {lang === 'zh' ? '進階' : 'Advanced'}
              </button>
              {cam.enabled && cam.rootFolderName && (
                <span className="cam-ready">
                  <span className="cam-ready-count">
                    {Object.values(cam.slots).filter((s) => s.deviceId).length}
                  </span>
                  {lang === 'zh' ? '台相機就緒' : 'cameras ready'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Button row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {isRecording ? (<>
            <button
              onClick={handleStartWithCam}
              disabled
              style={{
                background: 'rgba(63,185,80,0.08)',
                border: '1px solid rgba(63,185,80,0.25)',
                borderRadius: 8,
                color: 'rgba(63,185,80,0.4)',
                fontSize: 13, fontWeight: 700,
                padding: '9px 20px',
                cursor: 'not-allowed',
              }}
            >
              {T(lang, 'recordStart')}
            </button>
            <button
              onClick={addMarker}
              style={{
                background: 'rgba(200,200,0,0.12)',
                border: '1px solid rgba(220,220,0,0.4)',
                borderRadius: 8,
                color: 'rgba(240,230,80,0.9)',
                fontSize: 13, fontWeight: 600,
                padding: '9px 16px',
                cursor: 'pointer',
              }}
            >
              {T(lang, 'recordAddMarker')} [M]
            </button>
            <button
              onClick={handleStopOnly}
              style={{
                background: 'rgba(100,110,130,0.15)',
                border: '1px solid rgba(100,120,150,0.45)',
                borderRadius: 8,
                color: 'rgba(136,176,168,0.8)',
                fontSize: 13, fontWeight: 600,
                padding: '9px 16px',
                cursor: 'pointer',
              }}
            >
              {T(lang, 'recordStopOnly')}
            </button>
            <button
              onClick={handleStop}
              style={{
                background: 'rgba(248,81,73,0.18)',
                border: '1px solid rgba(248,81,73,0.55)',
                borderRadius: 8,
                color: '#f85149',
                fontSize: 13, fontWeight: 700,
                padding: '9px 20px',
                cursor: 'pointer',
              }}
            >
              {T(lang, 'recordStop')}
            </button>
            {canGenerateReport ? (
              <button
                onClick={handleStopAndReport}
                disabled={reportStatus === 'analyzing'}
                style={{
                  background: reportStatus === 'analyzing' ? 'rgba(72,186,166,0.08)' : 'rgba(72,186,166,0.15)',
                  border: '1px solid rgba(72,186,166,0.5)',
                  borderRadius: 8,
                  color: reportStatus === 'analyzing' ? 'rgba(72,186,166,0.5)' : 'var(--teal)',
                  fontSize: 13, fontWeight: 700,
                  padding: '9px 18px',
                  cursor: reportStatus === 'analyzing' ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {reportStatus === 'analyzing'
                  ? T(lang, 'recordGeneratingReport')
                  : T(lang, 'recordStopReport')}
              </button>
            ) : (
              <div style={{
                fontSize: 11, color: 'rgba(216,184,74,.75)',
                fontFamily: "'IBM Plex Mono', monospace",
                border: '1px solid rgba(216,184,74,.25)',
                borderRadius: 6, padding: '6px 10px',
                background: 'rgba(216,184,74,.06)',
                maxWidth: 220, lineHeight: 1.4,
              }}>
                {T(lang, 'electrodeReportBlocked')}
              </div>
            )}
          </>) : (<>
            <button
              onClick={handleStartWithCam}
              disabled={!isConnected || isImpedanceActive}
              title={isImpedanceActive ? (lang === 'zh' ? '阻抗量測中，無法錄製' : 'Stop impedance measurement first') : undefined}
              style={{
                background: (isConnected && !isImpedanceActive) ? 'rgba(63,185,80,0.18)' : 'rgba(60,80,100,0.2)',
                border: `1px solid ${(isConnected && !isImpedanceActive) ? 'rgba(63,185,80,0.5)' : 'rgba(60,80,100,0.3)'}`,
                borderRadius: 8,
                color: (isConnected && !isImpedanceActive) ? '#3fb950' : 'rgba(100,120,140,0.5)',
                fontSize: 13, fontWeight: 700,
                padding: '9px 24px',
                cursor: (isConnected && !isImpedanceActive) ? 'pointer' : 'not-allowed',
              }}
            >
              {T(lang, 'recordStart')}
            </button>
            <button
              onClick={() => setShowDisclaimerModal(true)}
              style={{
                background: consentGiven ? 'rgba(63,185,80,0.1)' : 'rgba(72,186,166,0.1)',
                border: `1px solid ${consentGiven ? 'rgba(63,185,80,0.4)' : 'rgba(72,186,166,0.35)'}`,
                borderRadius: 8,
                color: consentGiven ? '#3fb950' : 'var(--teal)',
                fontSize: 12, fontWeight: 600,
                padding: '9px 14px',
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ fontSize: 14 }}>{consentGiven ? '✓' : '!'}</span>
              {T(lang, 'disclaimerBtn')}
            </button>
          </>)}

          {enableRppg && !isRecording && (
            <button
              onClick={openVisioMynd}
              style={{
                background: 'rgba(91,224,192,0.12)',
                border: '1px solid rgba(91,224,192,0.4)',
                borderRadius: 7,
                color: '#5be0c0',
                fontSize: 12, fontWeight: 600,
                padding: '9px 14px',
                cursor: 'pointer',
              }}
            >
              開啟 VisioMynd ↗
            </button>
          )}
        </div>

        {/* Report language + CSV file report — single device only */}
        {!compact && (<>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'rgba(136,176,168,0.75)', flexShrink: 0 }}>
              {lang === 'zh' ? '報告語言' : 'Report lang'}:
            </label>
            <select
              value={fileReportLang}
              onChange={e => setFileReportLang(e.target.value as ReportLang)}
              disabled={isRecording}
              style={{
                background: 'rgba(13,23,32,0.85)',
                border: '1px solid rgba(40,64,80,0.45)',
                borderRadius: 5,
                color: '#c8e0d8',
                fontSize: 12,
                padding: '4px 8px',
                cursor: isRecording ? 'not-allowed' : 'pointer',
                outline: 'none',
                colorScheme: 'dark',
              }}
            >
              <option value="zh-TW">{lang === 'zh' ? '繁體中文' : 'Traditional Chinese'}</option>
              <option value="zh-CN">{lang === 'zh' ? '简体中文' : 'Simplified Chinese'}</option>
              <option value="en">English</option>
              <option value="ja">{lang === 'zh' ? '日本語' : 'Japanese'}</option>
            </select>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleFileReport(file);
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={fileStatus === 'parsing' || fileStatus === 'analyzing'}
              style={{
                background: (fileStatus === 'parsing' || fileStatus === 'analyzing')
                  ? 'rgba(72,186,166,0.08)' : 'rgba(72,186,166,0.12)',
                border: '1px solid rgba(72,186,166,0.4)',
                borderRadius: 5,
                color: (fileStatus === 'parsing' || fileStatus === 'analyzing')
                  ? 'rgba(72,186,166,0.45)' : 'var(--teal)',
                fontSize: 12, fontWeight: 600,
                padding: '5px 12px',
                cursor: (fileStatus === 'parsing' || fileStatus === 'analyzing') ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {fileStatus === 'parsing'
                ? T(lang, 'recordFromFileParsing')
                : fileStatus === 'analyzing'
                  ? T(lang, 'recordFromFileAnalyzing')
                  : T(lang, 'recordFromFile')}
            </button>
          </div>
          {fileStatus !== 'idle' && (
            <div style={{
              fontSize: 11,
              color: fileStatus === 'done' ? '#3fb950' : fileStatus === 'error' ? '#f85149' : 'rgba(136,176,168,0.7)',
              fontFamily: "'IBM Plex Mono', monospace",
              marginTop: 2,
            }}>
              {fileStatus === 'done'
                ? `✓ ${T(lang, 'recordFromFileSuccess')}  ${fileStatusMsg}`
                : fileStatus === 'error'
                  ? `✗ ${fileStatusMsg}`
                  : '…'}
            </div>
          )}
        </>)}
      </div>

      </div>{/* end left column */}

      {/* Event markers log */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(72,186,166,0.3)', fontFamily: "'IBM Plex Mono', monospace", marginBottom: 0 } as React.CSSProperties}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13, color: 'rgba(240,230,80,0.9)' }}>
            {T(lang, 'recordMarkerLog')}
          </h3>
          <button
            onClick={onClearEventMarkers}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              color: 'rgba(200,210,230,0.6)',
              borderRadius: 4, cursor: 'pointer',
              fontSize: 11, padding: '3px 8px',
            }}
          >
            {T(lang, 'recordClearMarkers')}
          </button>
        </div>

        {eventMarkers.length === 0 ? (
          <div style={{ color: 'rgba(130,150,175,0.45)', fontSize: 12, padding: '4px 0' }}>
            {T(lang, 'recordNoMarkers')}
          </div>
        ) : (
          <div ref={markersScrollRef} style={{ maxHeight: 232, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, textAlign: 'left', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(40,64,80,0.3)' }}>
                  <th style={{ padding: '4px 8px 8px 0', color: 'rgba(140,160,190,0.6)', fontWeight: 500 }}>ID</th>
                  <th style={{ padding: '4px 8px 8px', color: 'rgba(140,160,190,0.6)', fontWeight: 500 }}>Label</th>
                  <th style={{ padding: '4px 0 8px', color: 'rgba(140,160,190,0.6)', fontWeight: 500 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {eventMarkers.slice().reverse().map((m, displayIdx) => {
                  const idx = eventMarkers.length - 1 - displayIdx;
                  const isHw = m.kind === 'hardware';
                  return (
                    <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', borderLeft: `3px solid ${isHw ? '#43a047' : '#e53935'}` }}>
                      <td style={{ padding: '5px 8px 5px 4px', color: 'rgba(120,140,170,0.7)' }}>{idx + 1}</td>
                      <td style={{ padding: '5px 8px', color: isHw ? 'rgba(102,187,106,0.95)' : 'rgba(240,230,80,0.9)' }}>
                        {m.label}
                        {isHw && m.deviceId && (
                          <span style={{ fontSize: '0.75em', opacity: 0.7, marginLeft: '0.4em' }}>
                            {m.deviceId.replace('STEEG_', '')}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '5px 0', color: 'rgba(200,215,235,0.8)' }}>{formatTime(m.time)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

    {/* ── Disclaimer / Consent Modal ── */}
    {showDisclaimerModal && (
      <div
        onClick={() => setShowDisclaimerModal(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.72)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)',
          padding: 20,
        }}
      >
        <div
          onClick={e => e.stopPropagation()}
          style={{
            background: '#0e1825',
            border: '1px solid rgba(72,186,166,0.25)',
            borderRadius: 14,
            padding: '28px 32px',
            maxWidth: 540,
            width: '100%',
            maxHeight: '85vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }}
        >
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem', fontWeight: 700, color: '#c5d8f0' }}>
            {T(lang, 'disclaimerTitle')}
          </h3>
          <pre style={{
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontSize: 13, lineHeight: 1.75,
            color: 'rgba(200,224,216,0.8)',
            fontFamily: 'inherit',
            margin: '0 0 20px',
          }}>
            {T(lang, 'disclaimerBody')}
          </pre>
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            cursor: 'pointer', userSelect: 'none',
            padding: '14px 16px',
            background: consentGiven ? 'rgba(63,185,80,0.08)' : 'rgba(72,186,166,0.06)',
            border: `1px solid ${consentGiven ? 'rgba(63,185,80,0.3)' : 'rgba(72,186,166,0.2)'}`,
            borderRadius: 8,
            marginBottom: 16,
          }}>
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={e => setConsentGiven(e.target.checked)}
              style={{ width: 16, height: 16, marginTop: 2, cursor: 'pointer', accentColor: '#3fb950', flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, color: consentGiven ? '#3fb950' : 'rgba(200,224,216,0.85)', fontWeight: 600, lineHeight: 1.5 }}>
              {T(lang, 'disclaimerConsentLabel')}
            </span>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setShowDisclaimerModal(false)}
              style={{
                background: 'rgba(72,186,166,0.15)',
                border: '1px solid rgba(72,186,166,0.4)',
                borderRadius: 8,
                color: 'var(--teal)',
                fontSize: 13, fontWeight: 700,
                padding: '9px 24px',
                cursor: 'pointer',
              }}
            >
              {lang === 'zh' ? '確認' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    )}

    {showFolderError && (
      <div className="cam-modal-backdrop" onClick={() => setShowFolderError(false)}>
        <div className="cam-modal" onClick={(ev) => ev.stopPropagation()}>
          <h3 className="cam-modal-title">
            <span className="cam-modal-title-glyph" aria-hidden="true">!</span>
            {lang === 'zh' ? '資料夾無法存取' : 'Folder Not Accessible'}
          </h3>
          <div className="cam-modal-warn" style={{ marginTop: 0 }}>
            <span className="cam-modal-warn-glyph" aria-hidden="true">!</span>
            <span style={{ lineHeight: 1.6 }}>
              {lang === 'zh'
                ? '瀏覽器拒絕存取此資料夾（可能含系統檔或受系統保護）。請改選一般使用者資料夾，例如桌面下新建的「sigmacog_data」或「My Documents」內的子資料夾。'
                : 'The browser refused access to this folder (it may contain system files or be system-protected). Please pick a regular user folder — e.g. a freshly created "sigmacog_data" on Desktop, or a subfolder under Documents.'}
            </span>
          </div>
          {folderErrorMsg && (
            <div style={{
              marginTop: 10,
              fontSize: '.58rem',
              color: 'var(--muted)',
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '.04em',
              opacity: .75,
              wordBreak: 'break-word',
            }}>
              {folderErrorMsg}
            </div>
          )}
          <div className="cam-modal-foot">
            <button type="button" className="cam-pill" onClick={() => setShowFolderError(false)}>
              {lang === 'zh' ? '了解' : 'Got it'}
            </button>
          </div>
        </div>
      </div>
    )}

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
    </>
  );
};

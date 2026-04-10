import React, { useEffect, useRef, useState, type FC, type CSSProperties } from 'react';
import type { SubjectInfo } from '../../types/eeg';
import { CHANNEL_LABELS, CHANNEL_COUNT } from '../../types/eeg';
import type { RecordedSample } from '../../services/csvWriter';
import { generateCsv, downloadCsv, buildCsvFilename } from '../../services/csvWriter';
import { uploadSessionCsv, saveSessionResult, type SessionInfo } from '../../services/sessionApi';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import type { QualityConfig } from '../../hooks/useQualityMonitor';
import { analyzeEeg, SAMPLE_RATE } from '../../services/eegReport';
import { type RppgResults } from '../../services/reportPdf';
import { openHtmlReport, type ReportLang } from '../../services/eegReportHtml';
import { parseCsv } from '../../services/csvParser';

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
  deviceId: string | null;
  filterDesc: string;
  notchDesc: string;
  startTime: Date | null;
  onEventMarker: (marker: { id: string; time: number; label: string }) => void;
  eventMarkers: { id: string; time: number; label: string }[];
  onClearEventMarkers: () => void;
  // Quality monitor props
  qualityConfig: QualityConfig;
  onQualityConfigChange: (config: QualityConfig) => void;
  currentWindowStds: Float32Array;
  goodTimeSec: number;
  goodPercent: number;
  shouldAutoStop: boolean;
  sessionInfo?: SessionInfo | null;
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
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [reportStatus, setReportStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  const [useArtifactRemoval, setUseArtifactRemoval] = useState(false);
  const [enableRppg, setEnableRppg] = useState(false);
  const [rppgResults, setRppgResults] = useState<RppgResults | null>(null);
  const [fileStatus, setFileStatus] = useState<'idle' | 'parsing' | 'analyzing' | 'done' | 'error'>('idle');
  const [fileStatusMsg, setFileStatusMsg] = useState('');
  const [fileDob, setFileDob] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSex, setFileSex] = useState<'M' | 'F' | 'Other' | ''>('');
  const [fileReportLang, setFileReportLang] = useState<ReportLang>('zh-TW');
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

  const handleStop = () => {
    broadcastEegDone();
    onStopRecording();
    if (recordedSamples.length > 0 && startTime) {
      const content = generateCsv(
        recordedSamples,
        startTime,
        deviceId ?? 'STEEG_UNKNOWN',
        filterDesc,
        notchDesc,
      );
      const filename = buildCsvFilename(subjectInfo.id || 'recording', startTime);
      downloadCsv(content, filename);
      if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
        uploadSessionCsv(sessionInfo.sessionId, sessionInfo.sessionToken, content, filename);
      }
    }
  };

  // Plain stop — no download
  const handleStopOnly = () => {
    broadcastEegDone();
    onStopRecording();
  };

  const handleStopAndReport = async () => {
    const durationSec = recordedSamples.length / SAMPLE_RATE;
    if (durationSec < 90) {
      alert(T(lang, 'recordReportTooShort'));
      return;
    }
    // Stop recording and download CSV first
    onStopRecording();
    let csvContent = '';
    let csvFilename = '';
    if (recordedSamples.length > 0 && startTime) {
      csvContent = generateCsv(
        recordedSamples,
        startTime,
        deviceId ?? 'STEEG_UNKNOWN',
        filterDesc,
        notchDesc,
      );
      csvFilename = buildCsvFilename(subjectInfo.id || 'recording', startTime);
      downloadCsv(csvContent, csvFilename);
      if (sessionInfo?.sessionId && sessionInfo.sessionToken) {
        uploadSessionCsv(sessionInfo.sessionId, sessionInfo.sessionToken, csvContent, csvFilename);
      }
    }
    // Run EEG analysis asynchronously
    broadcastEegDone();
    setReportStatus('analyzing');
    try {
      const result = await analyzeEeg(recordedSamples, subjectInfo.dob ?? '', useArtifactRemoval);
      if (result.error) {
        alert(`${T(lang, 'recordReportError')}: ${result.error}`);
        setReportStatus('error');
        return;
      }
      await openHtmlReport(result, subjectInfo, startTime, deviceId, rppgResults ?? undefined);
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
      const dur = parsed.samples.length / SAMPLE_RATE;
      if (dur < 90) {
        setFileStatus('error');
        setFileStatusMsg(T(lang, 'recordFromFileErrShort') + ` (${dur.toFixed(1)} s)`);
        return;
      }
      setFileStatus('analyzing');
      let result;
      try {
        result = await analyzeEeg(parsed.samples, fileDob, useArtifactRemoval);
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
      // Build SubjectInfo using the file-section UI fields
      const fileSubject = {
        ...subjectInfo,
        ...(fileName ? { name: fileName } : {}),
        ...(fileSex   ? { sex: fileSex }  : {}),
      };
      try {
        await openHtmlReport(result, fileSubject, parsed.recordDatetime ? new Date(parsed.recordDatetime) : null, parsed.deviceId || deviceId, undefined, fileReportLang);
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

  // Auto-stop when quality target is reached — also downloads CSV
  const onStopRecordingRef = useRef(onStopRecording);
  onStopRecordingRef.current = onStopRecording;
  const handleStopRef = useRef(handleStop);
  handleStopRef.current = handleStop;
  useEffect(() => {
    if (!isRecording) {
      autoStoppedRef.current = false;
      return;
    }
    if (shouldAutoStop && !autoStoppedRef.current) {
      autoStoppedRef.current = true;
      handleStopRef.current();
    }
  }, [shouldAutoStop, isRecording]);

  // Auto-scroll markers list to bottom when new marker added
  useEffect(() => {
    if (markersScrollRef.current) {
      markersScrollRef.current.scrollTop = markersScrollRef.current.scrollHeight;
    }
  }, [eventMarkers.length]);

  const addMarker = () => {
    const id = Math.random().toString(36).substring(2, 9);
    const time = Date.now();
    const label = `M${eventMarkers.length + 1}`;
    onEventMarker({ id, time, label });
  };

  const inputStyle: CSSProperties = {
    background: 'rgba(10,20,35,0.85)',
    border: '1px solid rgba(93,109,134,0.45)',
    borderRadius: 7,
    color: '#cdd6e8',
    fontSize: 14,
    padding: '9px 12px',
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    color: 'rgba(160,180,210,0.8)',
    fontSize: 13,
    marginBottom: 5,
    fontWeight: 500,
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 460px', gap: 18, alignItems: 'start' }}>

      {/* ── Left column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* Subject info form */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(88,166,255,0.4)', marginBottom: 0 } as React.CSSProperties}>
        <h3 style={{ margin: '0 0 16px', fontSize: '0.95rem', fontWeight: 600, color: 'rgba(180,200,230,0.85)' }}>
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
          <h3 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 600, color: 'rgba(180,200,230,0.85)' }}>
            {T(lang, 'recordQualityGrid')}
          </h3>
          {/* Toggle */}
          <button
            onClick={() => onQualityConfigChange({ ...qualityConfig, enabled: !qualityConfig.enabled })}
            style={{
              background: qualityConfig.enabled ? 'rgba(63,185,80,0.15)' : 'rgba(30,50,80,0.4)',
              border: `1px solid ${qualityConfig.enabled ? 'rgba(63,185,80,0.5)' : 'rgba(93,109,134,0.4)'}`,
              borderRadius: 6,
              color: qualityConfig.enabled ? '#3fb950' : 'rgba(130,155,185,0.6)',
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
            <label style={{ fontSize: 12, color: 'rgba(160,180,210,0.75)' }}>
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
                background: 'rgba(10,20,35,0.85)',
                border: '1px solid rgba(93,109,134,0.45)',
                borderRadius: 6,
                color: '#cdd6e8',
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
            <span style={{ fontSize: 12, color: 'rgba(160,180,210,0.6)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}>(S)</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12, color: 'rgba(160,180,210,0.75)' }}>
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
                    border: `1px solid ${qualityConfig.sensitivity === level ? 'rgba(88,166,255,0.7)' : 'rgba(93,109,134,0.4)'}`,
                    background: qualityConfig.sensitivity === level ? 'rgba(88,166,255,0.2)' : 'transparent',
                    color: qualityConfig.sensitivity === level ? '#8ecfff' : 'rgba(160,180,210,0.6)',
                    fontSize: 12, fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {level}
                </button>
              ))}
            </div>
            <span style={{ fontSize: 11, color: 'rgba(130,155,185,0.55)' }}>
              {T(lang, 'recordSensitivityLenient')} → {T(lang, 'recordSensitivityStrict')}
            </span>
          </div>
        </div>

        {/* 8-channel STD grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 6,
          marginBottom: 14,
        }}>
          {Array.from({ length: CHANNEL_COUNT }, (_, ch) => {
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
                padding: '6px 4px',
                background: `${color}12`,
                border: `1px solid ${color}44`,
                borderRadius: 6,
                textAlign: 'center',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700,
                  color: 'rgba(160,180,210,0.7)',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  marginBottom: 2,
                }}>
                  {CHANNEL_LABELS[ch]}
                </div>
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}>
                  {isRecording ? `${std.toFixed(0)}` : '--'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Progress bar (only during recording) */}
        {isRecording && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'rgba(160,180,210,0.75)' }}>
                {T(lang, 'recordGoodTime')}: <span style={{ color: '#3fb950', fontWeight: 700 }}>{formatGoodTime(goodTimeSec)}</span>
                {isFinite(qualityConfig.targetDurationSec) && (
                  <span style={{ color: 'rgba(130,155,185,0.6)' }}>
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
                background: 'rgba(30,50,80,0.7)',
                borderRadius: 3,
                overflow: 'hidden',
                border: '1px solid rgba(93,109,134,0.3)',
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
          '--card-accent': isRecording ? 'rgba(248,81,73,0.5)' : 'rgba(93,109,134,0.3)',
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
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 18, fontWeight: 700, color: '#c5d8f0',
                letterSpacing: '0.05em',
              }}>
                {formatDuration(elapsed)}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '0.92rem', fontWeight: 600, color: 'rgba(180,200,230,0.85)' }}>
              {T(lang, 'recordStart')}
            </span>
          )}

          {/* Right: checkboxes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <label style={{
              display: 'flex', alignItems: 'center', gap: 7,
              cursor: 'pointer', userSelect: 'none', fontSize: 13,
              color: useArtifactRemoval ? '#58a6ff' : 'rgba(140,160,185,0.65)',
            }}>
              <input
                type="checkbox"
                checked={useArtifactRemoval}
                onChange={e => setUseArtifactRemoval(e.target.checked)}
                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#58a6ff' }}
              />
              {T(lang, 'recordArtifactRemoval')}
            </label>

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
          </div>
        </div>

        {/* Button row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {isRecording ? (<>
            <button
              onClick={onStartRecording}
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
                color: 'rgba(160,180,210,0.8)',
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
            <button
              onClick={handleStopAndReport}
              disabled={reportStatus === 'analyzing'}
              style={{
                background: reportStatus === 'analyzing' ? 'rgba(88,166,255,0.08)' : 'rgba(88,166,255,0.15)',
                border: '1px solid rgba(88,166,255,0.5)',
                borderRadius: 8,
                color: reportStatus === 'analyzing' ? 'rgba(88,166,255,0.5)' : '#58a6ff',
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
          </>) : (
            <button
              onClick={onStartRecording}
              disabled={!isConnected}
              style={{
                background: isConnected ? 'rgba(63,185,80,0.18)' : 'rgba(60,80,100,0.2)',
                border: `1px solid ${isConnected ? 'rgba(63,185,80,0.5)' : 'rgba(60,80,100,0.3)'}`,
                borderRadius: 8,
                color: isConnected ? '#3fb950' : 'rgba(100,120,140,0.5)',
                fontSize: 13, fontWeight: 700,
                padding: '9px 24px',
                cursor: isConnected ? 'pointer' : 'not-allowed',
              }}
            >
              {T(lang, 'recordStart')}
            </button>
          )}

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
      </div>

      </div>{/* end left column */}

      {/* ── Right column ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* File report card */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(227,160,48,0.4)', marginBottom: 0 } as React.CSSProperties}>
        <h3 style={{ margin: '0 0 14px', fontSize: '0.92rem', fontWeight: 600, color: 'rgba(180,200,230,0.85)' }}>
          {T(lang, 'recordFromFile')}
        </h3>

        {/* Name */}
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>姓名</label>
          <input
            type="text"
            value={fileName}
            onChange={e => setFileName(e.target.value)}
            placeholder="受測者姓名"
            style={inputStyle}
          />
        </div>

        {/* Sex + DOB row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>性別</label>
            <select
              value={fileSex}
              onChange={e => setFileSex(e.target.value as 'M' | 'F' | 'Other' | '')}
              style={{ ...inputStyle, cursor: 'pointer', colorScheme: 'dark' }}
            >
              <option value="">—</option>
              <option value="M">男 (M)</option>
              <option value="F">女 (F)</option>
              <option value="Other">第三性</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>{T(lang, 'recordDob')}</label>
            <input
              type="date"
              value={fileDob}
              onChange={e => setFileDob(e.target.value)}
              style={{ ...inputStyle, colorScheme: 'dark' }}
            />
          </div>
        </div>

        {/* Report language */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>報告語言</label>
          <select
            value={fileReportLang}
            onChange={e => setFileReportLang(e.target.value as ReportLang)}
            style={{ ...inputStyle, cursor: 'pointer', colorScheme: 'dark' }}
          >
            <option value="zh-TW">繁體中文</option>
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </select>
        </div>

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
            width: '100%',
            background: (fileStatus === 'parsing' || fileStatus === 'analyzing')
              ? 'rgba(88,166,255,0.12)'
              : 'rgba(88,166,255,0.22)',
            border: '1px solid rgba(88,166,255,0.55)',
            borderRadius: 8,
            color: (fileStatus === 'parsing' || fileStatus === 'analyzing')
              ? 'rgba(88,166,255,0.5)'
              : '#58a6ff',
            fontSize: 14,
            fontWeight: 700,
            padding: '11px 0',
            cursor: (fileStatus === 'parsing' || fileStatus === 'analyzing') ? 'not-allowed' : 'pointer',
          }}
        >
          {fileStatus === 'parsing'
            ? T(lang, 'recordFromFileParsing')
            : fileStatus === 'analyzing'
              ? T(lang, 'recordFromFileAnalyzing')
              : T(lang, 'recordFromFile')}
        </button>

        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'rgba(120,140,165,0.55)', textAlign: 'center' }}>
          {T(lang, 'recordFromFileHint')} · {T(lang, 'recordArtifactRemoval')}: {useArtifactRemoval ? '✓' : '✗'}
        </p>

        {/* Status message */}
        {fileStatus !== 'idle' && (
          <div style={{
            marginTop: 8,
            fontSize: 11,
            color: fileStatus === 'done' ? '#3fb950' : fileStatus === 'error' ? '#f85149' : 'rgba(160,180,210,0.7)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}>
            {fileStatus === 'done'
              ? `✓ ${T(lang, 'recordFromFileSuccess')}  ${fileStatusMsg}`
              : fileStatus === 'error'
                ? `✗ ${fileStatusMsg}`
                : fileStatusMsg || '…'}
          </div>
        )}
      </div>

      {/* Event markers log */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(88,166,255,0.3)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', marginBottom: 0 } as React.CSSProperties}>
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
                <tr style={{ borderBottom: '1px solid rgba(93,109,134,0.3)' }}>
                  <th style={{ padding: '4px 8px 8px 0', color: 'rgba(140,160,190,0.6)', fontWeight: 500 }}>ID</th>
                  <th style={{ padding: '4px 8px 8px', color: 'rgba(140,160,190,0.6)', fontWeight: 500 }}>Label</th>
                  <th style={{ padding: '4px 0 8px', color: 'rgba(140,160,190,0.6)', fontWeight: 500 }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {eventMarkers.map((m, idx) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '5px 8px 5px 0', color: 'rgba(120,140,170,0.7)' }}>{idx + 1}</td>
                    <td style={{ padding: '5px 8px', color: 'rgba(240,230,80,0.9)' }}>{m.label}</td>
                    <td style={{ padding: '5px 0', color: 'rgba(200,215,235,0.8)' }}>{formatTime(m.time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      </div>{/* end right column */}
    </div>
  );
};

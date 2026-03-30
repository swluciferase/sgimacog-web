import { useEffect, useRef, useState, type FC, type CSSProperties } from 'react';
import type { SubjectInfo } from '../../types/eeg';
import { CHANNEL_LABELS, CHANNEL_COUNT } from '../../types/eeg';
import type { RecordedSample } from '../../services/csvWriter';
import { generateCsv, downloadCsv, buildCsvFilename } from '../../services/csvWriter';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import type { QualityConfig } from '../../hooks/useQualityMonitor';
import { analyzeEeg, SAMPLE_RATE } from '../../services/eegReport';
import { generateReportPdf } from '../../services/reportPdf';

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
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [reportStatus, setReportStatus] = useState<'idle' | 'analyzing' | 'done' | 'error'>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStoppedRef = useRef(false);

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

  const handleStop = () => {
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
    }
  };

  // Plain stop — no download
  const handleStopOnly = () => {
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
    }
    // Run EEG analysis asynchronously
    setReportStatus('analyzing');
    try {
      const result = await analyzeEeg(recordedSamples, subjectInfo.dob ?? '');
      if (result.error) {
        alert(`${T(lang, 'recordReportError')}: ${result.error}`);
        setReportStatus('error');
        return;
      }
      generateReportPdf(result, subjectInfo, startTime, deviceId);
      setReportStatus('done');
    } catch (err) {
      console.error('Report generation error:', err);
      alert(T(lang, 'recordReportError'));
      setReportStatus('error');
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>

      {/* Subject info form */}
      <div style={{
        background: 'rgba(8,17,30,0.85)',
        border: '1px solid rgba(93,109,134,0.3)',
        borderRadius: 14,
        padding: '20px 24px',
      }}>
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
      <div style={{
        background: 'rgba(8,17,30,0.85)',
        border: '1px solid rgba(93,109,134,0.3)',
        borderRadius: 14,
        padding: '18px 24px',
      }}>
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
      <div style={{
        background: 'rgba(8,17,30,0.85)',
        border: `1px solid ${isRecording ? 'rgba(248,81,73,0.35)' : 'rgba(93,109,134,0.3)'}`,
        borderRadius: 14,
        padding: '18px 24px',
        transition: 'border-color 0.3s',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>

          {/* Status */}
          {isRecording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: '#f85149',
                  animation: 'pulse 1s infinite',
                }} />
                <span style={{ color: '#f85149', fontWeight: 700, fontSize: 14 }}>
                  {T(lang, 'signalRecording')}
                </span>
              </div>
              <span style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 18, fontWeight: 700, color: '#c5d8f0',
                letterSpacing: '0.05em',
              }}>
                {formatDuration(elapsed)}
              </span>
            </div>
          ) : (
            <div style={{ color: 'rgba(140,160,185,0.65)', fontSize: 13 }}>
              {!isConnected
                ? T(lang, 'recordNotConnected')
                : recordedSamples.length > 0
                  ? `${T(lang, 'recordSamples')}: ${recordedSamples.length.toLocaleString()}`
                  : T(lang, 'recordStart')}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/* Event marker button (during recording) */}
            {isRecording && (
              <button
                onClick={addMarker}
                style={{
                  background: 'rgba(200,200,0,0.12)',
                  border: '1px solid rgba(220,220,0,0.4)',
                  borderRadius: 8,
                  color: 'rgba(240,230,80,0.9)',
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '8px 14px',
                  cursor: 'pointer',
                }}
              >
                {T(lang, 'recordAddMarker')} [M]
              </button>
            )}

            {/* Start / Stop */}
            {isRecording ? (<>
              <button
                onClick={handleStopOnly}
                style={{
                  background: 'rgba(100,110,130,0.15)',
                  border: '1px solid rgba(100,120,150,0.45)',
                  borderRadius: 8,
                  color: 'rgba(160,180,210,0.8)',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '10px 16px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
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
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '10px 24px',
                  cursor: 'pointer',
                  transition: 'background 0.15s',
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
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '10px 20px',
                  cursor: reportStatus === 'analyzing' ? 'not-allowed' : 'pointer',
                  transition: 'background 0.15s',
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
                  fontSize: 14,
                  fontWeight: 700,
                  padding: '10px 24px',
                  cursor: isConnected ? 'pointer' : 'not-allowed',
                  transition: 'background 0.15s',
                }}
              >
                {T(lang, 'recordStart')}
              </button>
            )}
          </div>
        </div>

        {/* Stats during recording */}
        {isRecording && (
          <div style={{
            marginTop: 14,
            display: 'flex', gap: 20,
            padding: '10px 14px',
            background: 'rgba(5,14,23,0.7)',
            borderRadius: 8,
            border: '1px solid rgba(60,80,100,0.3)',
          }}>
            <div>
              <span style={{ fontSize: 11, color: 'rgba(140,160,185,0.6)' }}>
                {T(lang, 'recordSamples')}
              </span>
              <div style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 16, fontWeight: 700, color: '#7ec8f5',
              }}>
                {recordedSamples.length.toLocaleString()}
              </div>
            </div>
            <div>
              <span style={{ fontSize: 11, color: 'rgba(140,160,185,0.6)' }}>
                {T(lang, 'recordPackets')}
              </span>
              <div style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 16, fontWeight: 700, color: '#7ec8f5',
              }}>
                {eventMarkers.length}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Event markers log */}
      <div style={{
        background: 'rgba(8,17,30,0.85)',
        border: '1px solid rgba(93,109,134,0.25)',
        borderRadius: 12,
        padding: '14px 18px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      }}>
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
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
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
    </div>
  );
};

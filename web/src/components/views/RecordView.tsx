import { useEffect, useRef, useState, type FC, type CSSProperties } from 'react';
import type { SubjectInfo } from '../../types/eeg';
import type { RecordedSample } from '../../services/csvWriter';
import { generateCsv, downloadCsv, buildCsvFilename } from '../../services/csvWriter';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

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
}) => {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        subjectInfo,
        startTime,
        deviceId ?? 'STEEG_UNKNOWN',
        filterDesc,
        notchDesc,
      );
      const filename = buildCsvFilename(subjectInfo.id, startTime);
      downloadCsv(content, filename);
    }
  };

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

          {/* Age */}
          <div>
            <label style={labelStyle}>{T(lang, 'recordAge')}</label>
            <input
              type="number"
              min="1" max="120"
              value={subjectInfo.age}
              onChange={e => onSubjectInfoChange({ ...subjectInfo, age: e.target.value })}
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
            {isRecording ? (
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
            ) : (
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

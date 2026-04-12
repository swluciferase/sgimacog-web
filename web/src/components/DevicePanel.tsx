import { useState, useEffect, type FC } from 'react';
import type { Lang } from '../i18n';
import { T } from '../i18n';
import { HomeView } from './views/HomeView';
import { ImpedanceView } from './views/ImpedanceView';
import { WaveformView } from './views/WaveformView';
import { RecordView } from './views/RecordView';
import { ConnectModal } from './modals/ConnectModal';
import { useDevice } from '../hooks/useDevice';
import type { SessionInfo } from '../services/sessionApi';

// Per-device color accents
const DEVICE_COLORS = ['#52b8d8', '#80c854', '#dc7860', '#b060c8'];

function computeFilterDesc(fp: { hpFreq: number; lpFreq: number; bandpassEnabled: boolean }): string {
  if (!fp.bandpassEnabled) return 'None';
  return `${fp.hpFreq}–${fp.lpFreq} Hz`;
}
function computeNotchDesc(fp: { notchFreq: number }): string {
  if (fp.notchFreq === 0) return 'None';
  return `${fp.notchFreq} Hz`;
}

type TabId = 'connect' | 'signal' | 'record';

export interface DevicePanelProps {
  deviceIndex: number; // 0-based
  lang: Lang;
  sessionInfo?: SessionInfo | null;
  /** Increment to broadcast a simultaneous-record command */
  recordSignal?: number;
  /** Increment to broadcast a simultaneous-disconnect command */
  disconnectSignal?: number;
  /** Increment to broadcast a simultaneous-event-marker command */
  eventSignal?: number;
  /** Increment to broadcast a simultaneous-stop-recording command (also triggers save) */
  stopSignal?: number;
  /** When true, Space/M key in WaveformView is suppressed (handled globally by App) */
  syncMarkerOn?: boolean;
  /** Whether this panel is the currently focused one (receives keyboard markers when sync is OFF) */
  isFocused?: boolean;
  /** Called when user interacts with this panel (sets it as focused) */
  onFocus?: () => void;
  /** Called whenever this device's impedance-active state changes */
  onImpedanceActiveChange?: (active: boolean) => void;
}

export const DevicePanel: FC<DevicePanelProps> = ({
  deviceIndex, lang, sessionInfo, recordSignal = 0, disconnectSignal = 0, eventSignal = 0, stopSignal = 0, syncMarkerOn = false, isFocused, onFocus, onImpedanceActiveChange,
}) => {
  const d = useDevice(sessionInfo);
  const [activeTab, setActiveTab] = useState<TabId>('connect');

  // Broadcast: simultaneous record (skipped if impedance active)
  useEffect(() => {
    if (recordSignal === 0) return;
    if (d.isConnected && !d.isRecording && !d.isImpedanceActive) d.handleStartRecording();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordSignal]);

  // Broadcast: simultaneous disconnect
  useEffect(() => {
    if (disconnectSignal === 0) return;
    if (d.isConnected) d.handleDisconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disconnectSignal]);

  // Report impedance-active state changes up to parent (for multi-device Rec All blocking)
  useEffect(() => {
    onImpedanceActiveChange?.(d.isImpedanceActive);
  }, [d.isImpedanceActive, onImpedanceActiveChange]);

  // stopSignal is forwarded to RecordView as stopAndSaveSignal so it handles stop+save together

  const deviceColor = DEVICE_COLORS[deviceIndex % DEVICE_COLORS.length];
  const deviceLabel = `D${deviceIndex + 1}`;

  const statusClass = d.isRecording ? 'rec' : d.isConnected ? 'conn' : '';

  const elapsedMs = d.isRecording && d.recordStartTime
    ? Date.now() - d.recordStartTime.getTime()
    : 0;
  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m.toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  };

  const statusTxt = d.isRecording
    ? `${lang === 'zh' ? '錄製中' : 'REC'} ${fmt(elapsedMs)}`
    : d.isImpedanceActive
      ? (lang === 'zh' ? '阻抗量測中' : 'Measuring')
      : d.isConnected
        ? (lang === 'zh' ? '已連線' : 'Connected')
        : (lang === 'zh' ? '未連線' : 'Disconnected');

  return (
    <div
      className={`dev-panel ${statusClass}`}
      style={{ '--dp-color': deviceColor } as React.CSSProperties}
      onMouseDown={() => onFocus?.()}
    >
      {/* ── Panel Header ── */}
      <div className="dp-head">
        <div className="dp-dot" />
        <div className="dp-id">{deviceLabel}</div>
        {d.isConnected && d.subjectInfo.name && (
          <div className="dp-name">{d.subjectInfo.name}</div>
        )}
        {d.isConnected && (
          <div className="dp-pktrate">{d.deviceStats.packetRate} <span>pkt/s</span></div>
        )}
        <div className="dp-status">· {statusTxt}</div>
        <div className="dp-head-btns">
          {d.isRecording && (
            <button className="dp-btn dp-btn-red" onClick={d.handleStopRecording}>
              ■ {lang === 'zh' ? '停止' : 'Stop'}
            </button>
          )}
          {d.isConnected && !d.isRecording && (
            <button
              className="dp-btn dp-btn-green"
              onClick={d.handleStartRecording}
              disabled={d.isImpedanceActive}
              title={d.isImpedanceActive ? (lang === 'zh' ? '阻抗量測中，無法錄製' : 'Stop impedance measurement first') : undefined}
              style={{ opacity: d.isImpedanceActive ? 0.35 : 1, cursor: d.isImpedanceActive ? 'not-allowed' : 'pointer' }}
            >
              ⬤ {lang === 'zh' ? '錄製' : 'Rec'}
            </button>
          )}
          {!d.isConnected && (
            <button className="dp-btn dp-btn-teal" onClick={d.handleConnect}>
              {lang === 'zh' ? '連線' : 'Connect'}
            </button>
          )}
          {d.isConnected && !d.isRecording && (
            <button className="dp-btn dp-btn-dim" onClick={d.handleDisconnect}>
              {lang === 'zh' ? '斷開' : 'Disc.'}
            </button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="dp-tabs">
        {(['connect', 'signal', 'record'] as TabId[]).map(tab => (
          <button
            key={tab}
            className={`dp-tab${activeTab === tab ? ' active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'connect'
              ? T(lang, 'tabConnect')
              : tab === 'signal'
                ? T(lang, 'tabSignal')
                : T(lang, 'tabRecord')}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="dp-content">

        {/* Connect + Impedance pane */}
        <div className={`dp-pane${activeTab === 'connect' ? ' active' : ''}`}>
          <div style={{ flexShrink: 0, padding: '.3rem .5rem .05rem' }}>
            <HomeView
              status={d.status}
              stats={d.deviceStats}
              deviceId={d.deviceId}
              lang={lang}
              onConnect={d.handleConnect}
              onDisconnect={d.handleDisconnect}
              compact
            />
          </div>
          {d.isConnected && (<>
            <div className="sh" style={{ flexShrink: 0, margin: '.2rem .5rem .1rem', paddingBottom: '.15rem' }}>
              <span className="sh-g">~</span>
              {lang === 'zh' ? '電極阻抗' : 'Impedance'}
            </div>
            <ImpedanceView
              impedanceResults={d.latestImpedance ?? undefined}
              isConnected={d.isConnected}
              isRecording={d.isRecording}
              lang={lang}
              onEnterImpedanceMode={d.handleEnterImpedance}
              onExitImpedanceMode={d.handleExitImpedance}
              deviceMode={d.deviceMode}
              channelLabels={d.channelLabels}
              onChannelLabelsChange={d.setChannelLabels}
            />
          </>)}
          {!d.isConnected && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--faint)', fontSize: '.72rem', gap: 6,
            }}>
              <div style={{ fontFamily: "'Crimson Pro', serif", fontStyle: 'italic', fontSize: '2rem', color: 'var(--dim)', lineHeight: 1 }}>○</div>
              <div>{lang === 'zh' ? '請先連線裝置' : 'Connect a device first'}</div>
            </div>
          )}
        </div>

        {/* Signal pane */}
        <div className={`dp-pane${activeTab === 'signal' ? ' active' : ''}`}>
          <WaveformView
            packets={d.latestPackets}
            filterParams={d.filterParams}
            filterBiquadRef={d.filterBiquadRef}
            onFilterChange={d.handleFilterChange}
            lang={lang}
            isRecording={d.isRecording}
            onEventMarker={d.handleEventMarker}
            externalMarkerSignal={eventSignal}
            syncMarkerMode={syncMarkerOn}
            isFocused={isFocused}
            devicePalette={deviceIndex}
            channelLabels={d.channelLabels}
          />
        </div>

        {/* Record pane */}
        <div className={`dp-pane${activeTab === 'record' ? ' active' : ''}`} style={{ overflowY: 'auto' }}>
          <RecordView
            lang={lang}
            isConnected={d.isConnected}
            isRecording={d.isRecording}
            subjectInfo={d.subjectInfo}
            onSubjectInfoChange={d.setSubjectInfo}
            onStartRecording={d.handleStartRecording}
            onStopRecording={d.handleStopRecording}
            recordedSamples={d.recordedSamples}
            deviceId={d.deviceId}
            filterDesc={computeFilterDesc(d.filterParams)}
            notchDesc={computeNotchDesc(d.filterParams)}
            startTime={d.recordStartTime}
            onEventMarker={d.handleEventMarker}
            eventMarkers={d.eventMarkers}
            onClearEventMarkers={() => d.setEventMarkers([])}
            qualityConfig={d.qualityConfig}
            onQualityConfigChange={d.setQualityConfig}
            currentWindowStds={d.currentWindowStds}
            goodTimeSec={d.goodTimeSec}
            goodPercent={d.goodPercent}
            shouldAutoStop={d.shouldAutoStop}
            sessionInfo={sessionInfo ?? null}
            stopAndSaveSignal={stopSignal}
            channelLabels={d.channelLabels}
            isFlexibleElectrode={d.deviceMode === 'flexible'}
            isImpedanceActive={d.isImpedanceActive}
            compact
          />
        </div>

      </div>

      {/* Connect Modal (per-device) */}
      {d.showConnectModal && (
        <ConnectModal
          lang={lang}
          onConnect={(port, displayId, usbSerial) => d.handleModalConnect(port, displayId, usbSerial)}
          onConnectUsb={(device, displayId) => d.handleModalConnectUsb(device, displayId)}
          onClose={() => d.setShowConnectModal(false)}
        />
      )}
    </div>
  );
};

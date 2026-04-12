import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { Header } from './components/layout/Header';
import { HomeView } from './components/views/HomeView';
import { ImpedanceView } from './components/views/ImpedanceView';
import { WaveformView } from './components/views/WaveformView';
import { RecordView } from './components/views/RecordView';
import { ConnectModal } from './components/modals/ConnectModal';
import { DevicePanel } from './components/DevicePanel';
import { useDevice } from './hooks/useDevice';
import { serialService } from './services/serial';
import type { ConnectionStatus } from './services/serial';
import { ftdiUsbService, type UsbDeviceLike } from './services/ftdiUsb';
import { getAuthorizedFtdiDevices } from './services/ftdiScanner';
import {
  registerConnected,
  registerDisconnected,
  updateRegistrySteegId,
} from './services/deviceRegistry';
import { wasmService } from './services/wasm';
import type {
  SubjectInfo,
  FilterParams,
  FilterBiquadState,
  DeviceConfig,
} from './types/eeg';
import {
  DEFAULT_FILTER_PARAMS,
  makeFilterBiquadState,
  DEFAULT_CONFIG,
  SAMPLE_RATE_HZ,
} from './types/eeg';
import type { RecordedSample } from './services/csvWriter';
import type { Lang } from './i18n';
import { getSessionTokenFromUrl, fetchSessionInfo, type SessionInfo } from './services/sessionApi';
import { useEegStream } from './hooks/useEegStream';
import { useQualityMonitor } from './hooks/useQualityMonitor';
import type { QualityConfig } from './hooks/useQualityMonitor';

// ── WASM interface types ──

interface SteegParser {
  feed(data: Uint8Array): unknown;
  packets_received(): number;
  packets_lost(): number;
  decode_errors(): number;
  enable_impedance(windowSize: number, sampleRate: number): void;
  disable_impedance(): void;
  free(): void;
}

interface WasmCommands {
  cmd_adc_on(): Uint8Array;
  cmd_adc_off(): Uint8Array;
  cmd_impedance_ac_on(code_set: string): Uint8Array;
  cmd_impedance_ac_off(): Uint8Array;
  cmd_machine_info(): Uint8Array;
}

function computeFilterDesc(fp: FilterParams): string {
  if (!fp.bandpassEnabled) return 'None';
  return `${fp.hpFreq}–${fp.lpFreq} Hz`;
}

function computeNotchDesc(fp: FilterParams): string {
  if (fp.notchFreq === 0) return 'None';
  return `${fp.notchFreq} Hz`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-device view — uses the existing singleton services (device slot 0)
// ─────────────────────────────────────────────────────────────────────────────
function SingleDeviceLayout({ lang, sessionInfo }: { lang: Lang; sessionInfo: SessionInfo | null }) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [showConnectModal, setShowConnectModal] = useState(false);

  type AnyService = typeof serialService | typeof ftdiUsbService;
  const [serial, setSerial] = useState<AnyService | null>(null);
  const activeServiceRef = useRef<AnyService>(serialService);
  const [parser, setParser] = useState<SteegParser | null>(null);

  const [config] = useState<DeviceConfig>(DEFAULT_CONFIG);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const deviceIdSeenRef = useRef(false);
  const expectedSerialRef = useRef<string>('');
  const impedanceModeActiveRef = useRef(false);
  const [isImpedanceActive, setIsImpedanceActive] = useState(false);

  const [filterParams, setFilterParams] = useState<FilterParams>(DEFAULT_FILTER_PARAMS);
  const filterBiquadRef = useRef<FilterBiquadState>(makeFilterBiquadState());

  const [subjectInfo, setSubjectInfo] = useState<SubjectInfo>({
    id: '', name: '', dob: '', sex: '', notes: '',
  });

  const [isRecording, setIsRecording] = useState(false);
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [recordStartTime, setRecordStartTime] = useState<Date | null>(null);
  const recordSamplesRef = useRef<RecordedSample[]>([]);
  const recordTimestampRef = useRef<number>(0);

  const [qualityConfig, setQualityConfig] = useState<QualityConfig>({
    enabled: true, sensitivity: 3, targetDurationSec: 60, windowSec: 2,
  });

  const [eventMarkers, setEventMarkers] = useState<{ id: string; time: number; label: string }[]>([]);
  const pendingMarkerRef = useRef<{ id: string; time: number; label: string } | null>(null);

  // Init WASM + wire serial callbacks
  useEffect(() => {
    wasmService.init().then(() => {
      const api = wasmService.api as Record<string, unknown>;
      const P = api.SteegParser as new (ch: number, sr: number) => SteegParser;
      setParser(new P(config.channels, config.sampleRate));
    }).catch(console.error);

    const onStatusChange = (svc: AnyService) => (s: ConnectionStatus) => {
      setStatus(s);
      if (s === 'connected') {
        setSerial(svc);
        registerConnected(null);
      } else if (s === 'disconnected' || s === 'error') {
        setSerial(null);
        setDeviceId(null);
        deviceIdSeenRef.current = false;
        expectedSerialRef.current = '';
        registerDisconnected();
      }
    };

    serialService.onStatusChange = onStatusChange(serialService);
    ftdiUsbService.onStatusChange = onStatusChange(ftdiUsbService);

    return () => {
      serialService.onStatusChange = () => {};
      ftdiUsbService.onStatusChange = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleParserError = useCallback(() => {
    if (!wasmService.isInitialized) return;
    const api = wasmService.api as Record<string, unknown>;
    const P = api.SteegParser as new (ch: number, sr: number) => SteegParser;
    setParser(new P(config.channels, config.sampleRate));
  }, [config.channels, config.sampleRate]);

  const { stats: deviceStats, latestPackets, latestImpedance } = useEegStream(
    serial, parser, handleParserError,
  );

  const { currentWindowStds, goodTimeSec, goodPercent, shouldAutoStop } =
    useQualityMonitor(latestPackets, isRecording, qualityConfig);

  // Session info pre-fill
  useEffect(() => {
    if (!sessionInfo) return;
    setSubjectInfo(prev => ({
      id:    prev.id    || sessionInfo.subject_id || '',
      name:  prev.name  || sessionInfo.name       || '',
      dob:   prev.dob   || sessionInfo.birth_date || '',
      sex:   prev.sex   || (sessionInfo.gender === 'M' ? 'M' : sessionInfo.gender === 'F' ? 'F' : sessionInfo.gender === 'O' ? 'Other' : '') as SubjectInfo['sex'],
      notes: prev.notes || sessionInfo.notes || '',
    }));
  }, [sessionInfo]);

  // WebUSB fallback device ID
  useEffect(() => {
    if (status !== 'connected') return;
    if (deviceIdSeenRef.current) return;
    getAuthorizedFtdiDevices().then(devices => {
      if (deviceIdSeenRef.current) return;
      const dev = devices.find(d => d.serialNumber) ?? devices[0];
      if (!dev) return;
      const GENERIC = ['USB Serial', 'USB Serial Port', 'FT232R USB UART', ''];
      const label = GENERIC.includes(dev.productName.trim()) ? dev.serialNumber : dev.productName.trim();
      if (!label) return;
      const id = `STEEG_${label}`;
      setDeviceId(id);
      updateRegistrySteegId(id);
      deviceIdSeenRef.current = true;
    }).catch(() => {});
  }, [status]);

  // Process machineInfo
  useEffect(() => {
    for (const pkt of latestPackets) {
      if (!pkt.machineInfo) continue;
      const rawSerial = pkt.machineInfo.startsWith('STEEG_')
        ? pkt.machineInfo.slice(6) : pkt.machineInfo;
      if (expectedSerialRef.current) {
        if (rawSerial !== expectedSerialRef.current) {
          const badSerial = rawSerial;
          const expectedSerial = expectedSerialRef.current;
          expectedSerialRef.current = '';
          deviceIdSeenRef.current = false;
          setDeviceId(null);
          void serialService.disconnect();
          setTimeout(() => {
            window.alert(`⚠️ Wrong COM port!\n\nExpected: ${expectedSerial}\nConnected: ${badSerial}\n\nPlease select the correct COM port.`);
          }, 200);
          return;
        }
        expectedSerialRef.current = '';
      }
      if (!deviceIdSeenRef.current) {
        const id = pkt.machineInfo.startsWith('STEEG_') ? pkt.machineInfo : `STEEG_${pkt.machineInfo}`;
        setDeviceId(id);
        deviceIdSeenRef.current = true;
        updateRegistrySteegId(id);
      }
      return;
    }
  }, [latestPackets]);

  // Recording: collect raw samples
  useEffect(() => {
    if (!isRecording) return;
    for (const pkt of latestPackets) {
      if (!pkt.eegChannels || pkt.eegChannels.length < 8) continue;
      recordTimestampRef.current += 1 / SAMPLE_RATE_HZ;
      let eventId: string | undefined;
      let eventName: string | undefined;
      if (pendingMarkerRef.current) {
        eventId = pendingMarkerRef.current.id;
        eventName = pendingMarkerRef.current.label;
        pendingMarkerRef.current = null;
      }
      recordSamplesRef.current.push({
        timestamp: recordTimestampRef.current,
        serialNumber: pkt.serialNumber,
        channels: new Float32Array(pkt.eegChannels),
        eventId,
        eventName,
      });
    }
  }, [latestPackets, isRecording]);

  const getCommands = useCallback((): WasmCommands | null => {
    if (!wasmService.isInitialized) return null;
    return wasmService.api as unknown as WasmCommands;
  }, []);

  // On connect: request machine info then start ADC
  useEffect(() => {
    if (status !== 'connected') return;
    const cmds = getCommands();
    if (!cmds) return;
    const svc = activeServiceRef.current;
    const t = setTimeout(async () => {
      try {
        await svc.write(cmds.cmd_machine_info());
        await new Promise(r => setTimeout(r, 100));
        await svc.write(cmds.cmd_adc_on());
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [status, getCommands]);

  // Sync recordedSamples every 2s
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      setRecordedSamples([...recordSamplesRef.current]);
    }, 2000);
    return () => clearInterval(id);
  }, [isRecording]);

  const handleConnect = useCallback(() => setShowConnectModal(true), []);

  const handleModalConnect = useCallback(async (
    port: SerialPort | null, displayId?: string, usbSerial?: string,
  ) => {
    setShowConnectModal(false);
    if (!port) return;
    activeServiceRef.current = serialService;
    if (displayId) {
      setDeviceId(displayId);
      deviceIdSeenRef.current = true;
      updateRegistrySteegId(displayId);
    }
    if (usbSerial) expectedSerialRef.current = usbSerial;
    try {
      await serialService.connectToPort(port, { baudRate: config.baudRate });
    } catch (e) {
      console.error('Connect failed:', e);
    }
  }, [config.baudRate]);

  const handleModalConnectUsb = useCallback(async (
    device: UsbDeviceLike, displayId: string,
  ) => {
    setShowConnectModal(false);
    activeServiceRef.current = ftdiUsbService;
    if (displayId) {
      setDeviceId(displayId);
      deviceIdSeenRef.current = true;
      updateRegistrySteegId(displayId);
    }
    try {
      await ftdiUsbService.connectToDevice(device, config.baudRate);
    } catch (e) {
      console.error('FTDI USB connect failed:', e);
    }
  }, [config.baudRate]);

  const handleDisconnect = useCallback(async () => {
    const svc = activeServiceRef.current;
    try {
      if (impedanceModeActiveRef.current) {
        const cmds = getCommands();
        if (cmds) await svc.write(cmds.cmd_impedance_ac_off());
        impedanceModeActiveRef.current = false;
      }
      await svc.disconnect();
    } catch { /* ignore */ }
  }, [getCommands]);

  const handleEnterImpedance = useCallback(async () => {
    if (isRecording) return;
    const cmds = getCommands();
    if (!serial || !cmds) return;
    impedanceModeActiveRef.current = true;
    setIsImpedanceActive(true);
    await serial.write(cmds.cmd_impedance_ac_on('reference'));
    parser?.enable_impedance(config.impedanceWindow, config.sampleRate);
  }, [isRecording, serial, getCommands, parser, config.impedanceWindow, config.sampleRate]);

  const handleExitImpedance = useCallback(async () => {
    const cmds = getCommands();
    if (!serial || !cmds) return;
    await serial.write(cmds.cmd_impedance_ac_off());
    impedanceModeActiveRef.current = false;
    setIsImpedanceActive(false);
    parser?.disable_impedance?.();
    setTimeout(async () => {
      try {
        if (serial.isConnected) await serial.write(cmds.cmd_adc_on());
      } catch { /* ignore */ }
    }, 100);
  }, [serial, getCommands, parser]);

  const handleStartRecording = useCallback(() => {
    recordSamplesRef.current = [];
    recordTimestampRef.current = 0;
    setRecordStartTime(new Date());
    setRecordedSamples([]);
    setIsRecording(true);
  }, []);

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordedSamples([...recordSamplesRef.current]);
  }, []);

  const autoStopFiredRef = useRef(false);
  useEffect(() => {
    if (!isRecording) { autoStopFiredRef.current = false; return; }
    if (shouldAutoStop && !autoStopFiredRef.current) {
      autoStopFiredRef.current = true;
      handleStopRecording();
    }
  }, [shouldAutoStop, isRecording, handleStopRecording]);

  const handleEventMarker = useCallback((marker: { id: string; time: number; label: string }) => {
    setEventMarkers(prev => [...prev, marker]);
    if (isRecording) pendingMarkerRef.current = marker;
  }, [isRecording]);

  // Keyboard M key for event markers
  useEffect(() => {
    if (!isRecording) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        handleEventMarker({
          id: Math.random().toString(36).substring(2, 9),
          time: Date.now(),
          label: `M${eventMarkers.length + 1}`,
        });
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isRecording, handleEventMarker, eventMarkers.length]);

  const isConnected = status === 'connected';

  const handleFilterChange = useCallback((
    updated: Partial<FilterParams>, resetStates?: string[],
  ) => {
    setFilterParams(prev => ({ ...prev, ...updated }));
    if (resetStates) {
      const biquad = filterBiquadRef.current;
      if (resetStates.includes('hp')) {
        biquad.hpState1.fill(0); biquad.hpState2.fill(0); biquad.dcState.fill(0);
      }
      if (resetStates.includes('lp')) {
        biquad.lpState1.fill(0); biquad.lpState2.fill(0);
      }
      if (resetStates.includes('notch')) { biquad.notchState.fill(0); }
    }
  }, []);

  return (
    <>
      <div className="main-layout">
        {/* Col 1: Connect + Impedance */}
        <div className="layout-col" style={{ maxWidth: 300 }}>
          <div className="layout-col-inner">
            <div className="sh"><span className="sh-g">⊕</span>{lang === 'zh' ? '裝置連線' : 'Device'}</div>
            <HomeView
              status={status}
              stats={deviceStats}
              deviceId={deviceId}
              lang={lang}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              compact
            />
            <div className="sh" style={{ marginTop: 10 }}>
              <span className="sh-g">~</span>{lang === 'zh' ? '電極阻抗' : 'Impedance'}
            </div>
            <ImpedanceView
              impedanceResults={latestImpedance ?? undefined}
              isConnected={isConnected}
              isRecording={isRecording}
              lang={lang}
              onEnterImpedanceMode={handleEnterImpedance}
              onExitImpedanceMode={handleExitImpedance}
            />
          </div>
        </div>

        {/* Col 2: Signal */}
        <div className="layout-col-signal">
          <WaveformView
            packets={latestPackets}
            filterParams={filterParams}
            filterBiquadRef={filterBiquadRef}
            onFilterChange={handleFilterChange}
            lang={lang}
            isRecording={isRecording}
            onEventMarker={handleEventMarker}
          />
        </div>

        {/* Col 3: Record */}
        <div className="layout-col" style={{ maxWidth: 340 }}>
          <div className="layout-col-inner">
            <RecordView
              lang={lang}
              isConnected={isConnected}
              isRecording={isRecording}
              subjectInfo={subjectInfo}
              onSubjectInfoChange={setSubjectInfo}
              onStartRecording={handleStartRecording}
              onStopRecording={handleStopRecording}
              recordedSamples={recordedSamples}
              deviceId={deviceId}
              filterDesc={computeFilterDesc(filterParams)}
              notchDesc={computeNotchDesc(filterParams)}
              startTime={recordStartTime}
              onEventMarker={handleEventMarker}
              eventMarkers={eventMarkers}
              onClearEventMarkers={() => setEventMarkers([])}
              qualityConfig={qualityConfig}
              onQualityConfigChange={setQualityConfig}
              currentWindowStds={currentWindowStds}
              goodTimeSec={goodTimeSec}
              goodPercent={goodPercent}
              shouldAutoStop={shouldAutoStop}
              sessionInfo={sessionInfo}
            />
          </div>
        </div>
      </div>

      {showConnectModal && (
        <ConnectModal
          lang={lang}
          onConnect={(port, displayId, usbSerial) => handleModalConnect(port, displayId, usbSerial)}
          onConnectUsb={(device, displayId) => handleModalConnectUsb(device, displayId)}
          onClose={() => setShowConnectModal(false)}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-device layout — renders DevicePanel × n
// ─────────────────────────────────────────────────────────────────────────────
function MultiDeviceLayout({ deviceCount, lang, sessionInfo }: {
  deviceCount: number;
  lang: Lang;
  sessionInfo: SessionInfo | null;
}) {
  const layoutClass = `multi-layout n${deviceCount}`;
  return (
    <div className={layoutClass}>
      {Array.from({ length: deviceCount }, (_, i) => (
        <DevicePanel
          key={i}
          deviceIndex={i}
          lang={lang}
          sessionInfo={sessionInfo}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// App root
// ─────────────────────────────────────────────────────────────────────────────
function App() {
  const [lang, setLang] = useState<Lang>('zh');
  const [deviceCount, setDeviceCount] = useState(1);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const sessionTokenRef = useRef<string | null>(getSessionTokenFromUrl());

  useEffect(() => {
    const token = sessionTokenRef.current;
    if (!token) return;
    fetchSessionInfo(token).then(info => {
      if (!info) return;
      setSessionInfo(info);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-container">
      <Header
        lang={lang}
        onLangToggle={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
        deviceCount={deviceCount}
        onAddDevice={() => setDeviceCount(n => Math.min(n + 1, 4))}
        onRemoveDevice={() => setDeviceCount(n => Math.max(n - 1, 1))}
      />

      {deviceCount === 1
        ? <SingleDeviceLayout key="single" lang={lang} sessionInfo={sessionInfo} />
        : <MultiDeviceLayout deviceCount={deviceCount} lang={lang} sessionInfo={sessionInfo} />
      }
    </div>
  );
}

export default App;

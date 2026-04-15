import { useState, useEffect, useRef, useCallback } from 'react';
import { serviceStart, NoCreditError } from './services/creditApi';
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
  CHANNEL_LABELS,
  CH32_LABELS,
  CH32_COUNT,
  CH32_SAMPLE_RATE,
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
  const [channelLabels, setChannelLabels] = useState<string[]>([...CHANNEL_LABELS]);
  const deviceIdSeenRef = useRef(false);
  const expectedSerialRef = useRef<string>('');
  const impedanceModeActiveRef = useRef(false);
  const [isImpedanceActive, setIsImpedanceActive] = useState(false);

  // Effective device config — updated when device ID is known (ch32 vs standard)
  const deviceConfigRef = useRef({ channels: DEFAULT_CONFIG.channels, sampleRate: DEFAULT_CONFIG.sampleRate });

  const [filterParams, setFilterParams] = useState<FilterParams>(DEFAULT_FILTER_PARAMS);
  const filterBiquadRef = useRef<FilterBiquadState>(makeFilterBiquadState());

  const [subjectInfo, setSubjectInfo] = useState<SubjectInfo>({
    id: '', name: '', dob: '', sex: '', notes: '',
  });

  const [isRecording, setIsRecording] = useState(false);
  const [sampleCount, setSampleCount] = useState(0);
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
        setChannelLabels([...CHANNEL_LABELS]);
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

  // Re-create parser when device ID is detected (ch32 vs standard)
  useEffect(() => {
    if (!deviceId || !wasmService.isInitialized) return;
    const api = wasmService.api as Record<string, unknown>;
    const P = api.SteegParser as new (ch: number, sr: number) => SteegParser;
    if (deviceId.startsWith('STEEG_DG32')) {
      deviceConfigRef.current = { channels: CH32_COUNT, sampleRate: CH32_SAMPLE_RATE };
      setParser(new P(CH32_COUNT, CH32_SAMPLE_RATE));
      filterBiquadRef.current = makeFilterBiquadState(CH32_COUNT);
      setChannelLabels([...CH32_LABELS]);
    } else {
      deviceConfigRef.current = { channels: DEFAULT_CONFIG.channels, sampleRate: DEFAULT_CONFIG.sampleRate };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  const handleParserError = useCallback(() => {
    if (!wasmService.isInitialized) return;
    const api = wasmService.api as Record<string, unknown>;
    const P = api.SteegParser as new (ch: number, sr: number) => SteegParser;
    setParser(new P(deviceConfigRef.current.channels, deviceConfigRef.current.sampleRate));
  }, []);

  const { stats: deviceStats, latestPackets, latestImpedance } = useEegStream(
    serial, parser, handleParserError,
  );

  const effectiveSampleRate = deviceId?.startsWith('STEEG_DG32') ? CH32_SAMPLE_RATE : SAMPLE_RATE_HZ;
  const effectiveChannelCount = deviceId?.startsWith('STEEG_DG32') ? CH32_COUNT : DEFAULT_CONFIG.channels;
  const deviceMode = deviceId?.startsWith('STEEG_DG32') ? 'ch32' as const
    : deviceId?.startsWith('STEEG_DG819') ? 'flexible' as const
    : 'standard' as const;

  const { currentWindowStds, goodTimeSec, goodPercent, shouldAutoStop } =
    useQualityMonitor(latestPackets, isRecording, qualityConfig, effectiveChannelCount);

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
      if (!pkt.eegChannels || pkt.eegChannels.length < deviceConfigRef.current.channels) continue;
      recordTimestampRef.current += 1 / deviceConfigRef.current.sampleRate;
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

  // Sync sample count every 2s (no full-array copy — prevents OOM on long recordings)
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      setSampleCount(recordSamplesRef.current.length);
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
    parser?.enable_impedance(config.impedanceWindow, deviceConfigRef.current.sampleRate);
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

  const handleStartRecording = useCallback(async () => {
    try {
      await serviceStart('sigmacog');
    } catch (e) {
      if (e instanceof NoCreditError) {
        alert('SigmaCog 使用次數已用完，請聯繫管理員補充額度。');
        return;
      }
    }
    recordSamplesRef.current = [];
    recordTimestampRef.current = 0;
    setRecordStartTime(new Date());
    setSampleCount(0);
    setIsRecording(true);
  }, []);

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    setSampleCount(recordSamplesRef.current.length);
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
              deviceMode={deviceMode}
              channelLabels={channelLabels}
              onChannelLabelsChange={setChannelLabels}
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
            channelLabels={channelLabels}
            sampleRate={effectiveSampleRate}
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
              recordedSamples={[]}
              recordSamplesRef={recordSamplesRef}
              sampleCount={sampleCount}
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
              channelLabels={channelLabels}
              isFlexibleElectrode={deviceMode === 'flexible'}
              isImpedanceActive={isImpedanceActive}
              deviceSampleRate={effectiveSampleRate}
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
function MultiDeviceLayout({ deviceCount, lang, sessionInfo, recordSignal, stopSignal, disconnectSignal, eventSignal, syncMarkerOn, onAnyImpedanceActiveChange }: {
  deviceCount: number;
  lang: Lang;
  sessionInfo: SessionInfo | null;
  recordSignal: number;
  stopSignal: number;
  disconnectSignal: number;
  eventSignal: number;
  syncMarkerOn: boolean;
  onAnyImpedanceActiveChange: (active: boolean) => void;
}) {
  const [focusedDevice, setFocusedDevice] = useState(0);
  const [impedanceActiveSet, setImpedanceActiveSet] = useState<Set<number>>(new Set());

  const handleImpedanceActiveChange = (idx: number, active: boolean) => {
    setImpedanceActiveSet(prev => {
      const next = new Set(prev);
      if (active) next.add(idx); else next.delete(idx);
      onAnyImpedanceActiveChange(next.size > 0);
      return next;
    });
  };

  const layoutClass = `multi-layout n${deviceCount}`;
  return (
    <div className={layoutClass}>
      {Array.from({ length: deviceCount }, (_, i) => (
        <DevicePanel
          key={i}
          deviceIndex={i}
          lang={lang}
          sessionInfo={sessionInfo}
          recordSignal={recordSignal}
          stopSignal={stopSignal}
          disconnectSignal={disconnectSignal}
          eventSignal={eventSignal}
          syncMarkerOn={syncMarkerOn}
          isFocused={focusedDevice === i}
          onFocus={() => setFocusedDevice(i)}
          onImpedanceActiveChange={active => handleImpedanceActiveChange(i, active)}
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
  const [recordSignal, setRecordSignal] = useState(0);
  const [stopSignal, setStopSignal] = useState(0);
  const [disconnectSignal, setDisconnectSignal] = useState(0);
  const [eventSignal, setEventSignal] = useState(0);
  const [syncMarkerOn, setSyncMarkerOn] = useState(false);
  const [anyImpedanceActive, setAnyImpedanceActive] = useState(false);
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

  // Global sync-marker keyboard handler: when sync mode is ON, Space/M triggers all devices
  useEffect(() => {
    if (!syncMarkerOn || deviceCount <= 1) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        setEventSignal(n => n + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [syncMarkerOn, deviceCount]);

  return (
    <div className="app-container">
      <Header
        lang={lang}
        onLangToggle={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
        deviceCount={deviceCount}
        onAddDevice={() => setDeviceCount(n => Math.min(n + 1, 4))}
        onRemoveDevice={() => setDeviceCount(n => Math.max(n - 1, 1))}
        showMultiControls={deviceCount > 1}
        onSimultaneousRecord={() => setRecordSignal(n => n + 1)}
        onSimultaneousStop={() => setStopSignal(n => n + 1)}
        onSimultaneousDisconnect={() => setDisconnectSignal(n => n + 1)}
        syncMarkerOn={syncMarkerOn}
        onToggleSyncMarker={() => setSyncMarkerOn(v => !v)}
        anyImpedanceActive={anyImpedanceActive}
      />

      {deviceCount === 1
        ? <SingleDeviceLayout key="single" lang={lang} sessionInfo={sessionInfo} />
        : <MultiDeviceLayout
            deviceCount={deviceCount}
            lang={lang}
            sessionInfo={sessionInfo}
            recordSignal={recordSignal}
            stopSignal={stopSignal}
            disconnectSignal={disconnectSignal}
            eventSignal={eventSignal}
            syncMarkerOn={syncMarkerOn}
            onAnyImpedanceActiveChange={setAnyImpedanceActive}
          />
      }
    </div>
  );
}

export default App;

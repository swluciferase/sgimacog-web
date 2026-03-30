import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import type { TabType } from './components/layout/Sidebar';
import { HomeView } from './components/views/HomeView';
import { ImpedanceView } from './components/views/ImpedanceView';
import { WaveformView } from './components/views/WaveformView';
import { FftView } from './components/views/FftView';
import { RecordView } from './components/views/RecordView';
import { ConnectModal } from './components/modals/ConnectModal';
import { useEegStream } from './hooks/useEegStream';
import { useQualityMonitor } from './hooks/useQualityMonitor';
import type { QualityConfig } from './hooks/useQualityMonitor';
import { serialService } from './services/serial';
import type { ConnectionStatus } from './services/serial';
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
import { T } from './i18n';

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

// ── App-level filter param helpers ──

function computeFilterDesc(fp: FilterParams): string {
  if (!fp.bandpassEnabled) return 'None';
  return `${fp.hpFreq}–${fp.lpFreq} Hz`;
}

function computeNotchDesc(fp: FilterParams): string {
  if (fp.notchFreq === 0) return 'None';
  return `${fp.notchFreq} Hz`;
}

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [lang, setLang] = useState<Lang>('zh');
  const [showConnectModal, setShowConnectModal] = useState(false);

  // Serial + parser (reactive refs drive useEegStream)
  const [serial, setSerial] = useState<typeof serialService | null>(null);
  const [parser, setParser] = useState<SteegParser | null>(null);

  const [config] = useState<DeviceConfig>(DEFAULT_CONFIG);

  // Device ID extracted from first serial number packet
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const deviceIdSeenRef = useRef(false);
  /** USB serialNumber of the device selected in ConnectModal (e.g. "AV0KHCQP").
   *  Compared with machineInfo from firmware to verify the correct COM port was picked. */
  const expectedSerialRef = useRef<string>('');

  // Impedance mode tracking
  const impedanceModeActiveRef = useRef(false);
  const [isImpedanceActive, setIsImpedanceActive] = useState(false);

  // ── Shared filter state ──
  // filterParams is React state (drives UI re-renders)
  // filterBiquadRef is a ref (not React state) — internal IIR delay values
  // Both live in App so they survive tab switching
  const [filterParams, setFilterParams] = useState<FilterParams>(DEFAULT_FILTER_PARAMS);
  const filterBiquadRef = useRef<FilterBiquadState>(makeFilterBiquadState());

  // When filter params change, reset the appropriate biquad states
  const handleFilterChange = useCallback((
    updated: Partial<FilterParams>,
    resetStates?: string[],
  ) => {
    setFilterParams(prev => ({ ...prev, ...updated }));
    if (resetStates) {
      const biquad = filterBiquadRef.current;
      if (resetStates.includes('hp')) {
        biquad.hpState1.fill(0);
        biquad.hpState2.fill(0);
        biquad.dcState.fill(0);
      }
      if (resetStates.includes('lp')) {
        biquad.lpState1.fill(0);
        biquad.lpState2.fill(0);
      }
      if (resetStates.includes('notch')) {
        biquad.notchState.fill(0);
      }
    }
  }, []);

  // ── Subject info ──
  const [subjectInfo, setSubjectInfo] = useState<SubjectInfo>({
    id: '', name: '', dob: '', sex: '', notes: '',
  });

  // ── Recording state ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [recordStartTime, setRecordStartTime] = useState<Date | null>(null);
  const recordSamplesRef = useRef<RecordedSample[]>([]);
  const recordTimestampRef = useRef<number>(0); // seconds from start

  // ── Quality monitor config ──
  const [qualityConfig, setQualityConfig] = useState<QualityConfig>({
    enabled: true,
    sensitivity: 3,
    targetDurationSec: 60,
    windowSec: 2,
  });

  // ── Event markers (shared between signal + record views) ──
  const [eventMarkers, setEventMarkers] = useState<{ id: string; time: number; label: string }[]>([]);
  const pendingMarkerRef = useRef<{ id: string; time: number; label: string } | null>(null);

  // ── Initialize WASM and wire serial callbacks ──
  useEffect(() => {
    wasmService.init().then(() => {
      const api = wasmService.api as Record<string, unknown>;
      const P = api.SteegParser as new (ch: number, sr: number) => SteegParser;
      setParser(new P(config.channels, config.sampleRate));
    }).catch(console.error);

    serialService.onStatusChange = (s: ConnectionStatus) => {
      setStatus(s);
      if (s === 'connected') {
        setSerial(serialService);
        registerConnected(null);
      } else if (s === 'disconnected' || s === 'error') {
        setSerial(null);
        setDeviceId(null);
        deviceIdSeenRef.current = false;
        expectedSerialRef.current = '';
        registerDisconnected();
      }
    };

    return () => {
      serialService.onStatusChange = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recreate parser after WASM trap (poisoned WasmRefCell)
  const handleParserError = useCallback(() => {
    if (!wasmService.isInitialized) return;
    const api = wasmService.api as Record<string, unknown>;
    const P = api.SteegParser as new (ch: number, sr: number) => SteegParser;
    console.warn('[App] Recreating SteegParser after crash');
    setParser(new P(config.channels, config.sampleRate));
  }, [config.channels, config.sampleRate]);

  const { stats: deviceStats, latestPackets, latestImpedance } = useEegStream(
    serial, parser, handleParserError,
  );

  const {
    currentWindowStds,
    goodTimeSec,
    goodPercent,
    shouldAutoStop,
  } = useQualityMonitor(latestPackets, isRecording, qualityConfig);

  // After connection: set device ID from WebUSB productName (only if not already set by modal)
  useEffect(() => {
    if (status !== 'connected') return;
    if (deviceIdSeenRef.current) return;   // handleModalConnect already set it
    getAuthorizedFtdiDevices().then(devices => {
      if (deviceIdSeenRef.current) return; // double-check after async gap
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

  // Process machineInfo: validate COM port selection and extract device ID
  useEffect(() => {
    for (const pkt of latestPackets) {
      if (!pkt.machineInfo) continue;

      // Normalize: strip STEEG_ prefix to get the raw USB serial (e.g. "AV0KHCQP")
      const rawSerial = pkt.machineInfo.startsWith('STEEG_')
        ? pkt.machineInfo.slice(6)
        : pkt.machineInfo;

      // Validate: if we have an expected serial, confirm the COM port is correct
      if (expectedSerialRef.current) {
        if (rawSerial !== expectedSerialRef.current) {
          // Wrong COM port selected — disconnect immediately
          const badSerial = rawSerial;
          const expectedSerial = expectedSerialRef.current;
          expectedSerialRef.current = '';
          deviceIdSeenRef.current = false;
          setDeviceId(null);
          void serialService.disconnect();
          setTimeout(() => {
            window.alert(
              `⚠️ Wrong COM port!\n\nExpected device serial: ${expectedSerial}\nConnected port serial:  ${badSerial}\n\nPlease disconnect and select the correct COM port.`
            );
          }, 200);
          return;
        }
        expectedSerialRef.current = ''; // validation passed
      }

      // Set device ID from productName (already set by modal), or fallback to machineInfo
      if (!deviceIdSeenRef.current) {
        const id = pkt.machineInfo.startsWith('STEEG_') ? pkt.machineInfo : `STEEG_${pkt.machineInfo}`;
        setDeviceId(id);
        deviceIdSeenRef.current = true;
        updateRegistrySteegId(id);
      }
      return;
    }
  }, [latestPackets]);

  // Recording: collect raw samples each frame
  useEffect(() => {
    if (!isRecording) return;
    for (const pkt of latestPackets) {
      if (!pkt.eegChannels || pkt.eegChannels.length < 8) continue;
      recordTimestampRef.current += 1 / SAMPLE_RATE_HZ;

      // Check for pending event marker (set during this recording session)
      let eventId: string | undefined;
      let eventName: string | undefined;
      if (pendingMarkerRef.current) {
        eventId = pendingMarkerRef.current.id;
        eventName = pendingMarkerRef.current.label;
        pendingMarkerRef.current = null;
      }

      const sample: RecordedSample = {
        timestamp: recordTimestampRef.current,
        serialNumber: pkt.serialNumber,
        channels: new Float32Array(pkt.eegChannels),
        eventId,
        eventName,
      };
      recordSamplesRef.current.push(sample);
    }
    // Update UI count every batch (don't setRecordedSamples on every packet — too slow)
    // Use length for display only
  }, [latestPackets, isRecording]);

  // WASM commands helper
  const getCommands = useCallback((): WasmCommands | null => {
    if (!wasmService.isInitialized) return null;
    return wasmService.api as unknown as WasmCommands;
  }, []);

  // On connect: request machine info then start ADC
  useEffect(() => {
    if (status !== 'connected') return;
    const cmds = getCommands();
    if (!cmds) return;
    const t = setTimeout(async () => {
      try {
        // Request device ID — response arrives as machineInfo in next packet
        await serialService.write(cmds.cmd_machine_info());
        // Small gap before ADC on so device processes info request first
        await new Promise(r => setTimeout(r, 100));
        await serialService.write(cmds.cmd_adc_on());
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [status, getCommands]);

  // ── Connection handlers ──
  const handleConnect = useCallback(() => {
    setShowConnectModal(true);
  }, []);

  const handleModalConnect = useCallback(async (
    port: SerialPort | null,
    displayId?: string,   // productName as-is, e.g. "STEEG_DG085134"
    usbSerial?: string,   // raw USB serialNumber, e.g. "AV0KHCQP" — for post-connect validation
  ) => {
    setShowConnectModal(false);
    if (!port) return;
    if (displayId) {
      // Use productName directly — it already contains the full identifier
      setDeviceId(displayId);
      deviceIdSeenRef.current = true;
      updateRegistrySteegId(displayId);
    }
    if (usbSerial) {
      // Store for validation against machineInfo received after connection
      expectedSerialRef.current = usbSerial;
    }
    try {
      await serialService.connectToPort(port, { baudRate: config.baudRate });
    } catch (e) {
      console.error('Connect failed:', e);
    }
  }, [config.baudRate]);

  const handleDisconnect = useCallback(async () => {
    try {
      if (impedanceModeActiveRef.current) {
        const cmds = getCommands();
        if (cmds) await serialService.write(cmds.cmd_impedance_ac_off());
        impedanceModeActiveRef.current = false;
      }
      await serialService.disconnect();
    } catch { /* ignore */ }
  }, [getCommands]);

  // ── Impedance handlers ──
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

  // ── Recording handlers ──
  const handleStartRecording = useCallback(() => {
    recordSamplesRef.current = [];
    recordTimestampRef.current = 0;
    const now = new Date();
    setRecordStartTime(now);
    setRecordedSamples([]);
    setIsRecording(true);
  }, []);

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordedSamples([...recordSamplesRef.current]);
  }, []);

  // Periodically sync recordedSamples length for display (every 2s)
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      setRecordedSamples([...recordSamplesRef.current]);
    }, 2000);
    return () => clearInterval(id);
  }, [isRecording]);

  // Auto-stop recording when quality monitor signals target reached
  // (RecordView also calls onStopRecording, but we guard here too)
  const autoStopFiredRef = useRef(false);
  useEffect(() => {
    if (!isRecording) {
      autoStopFiredRef.current = false;
      return;
    }
    if (shouldAutoStop && !autoStopFiredRef.current) {
      autoStopFiredRef.current = true;
      handleStopRecording();
    }
  }, [shouldAutoStop, isRecording, handleStopRecording]);

  // ── Event marker handler (from waveform OR record views) ──
  const handleEventMarker = useCallback((marker: { id: string; time: number; label: string }) => {
    setEventMarkers(prev => [...prev, marker]);
    if (isRecording) {
      pendingMarkerRef.current = marker;
    }
  }, [isRecording]);

  // Keyboard M key for event markers (global, when recording)
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

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <HomeView
            status={status}
            stats={deviceStats}
            deviceId={deviceId}
            lang={lang}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />
        );

      case 'impedance':
        return (
          <ImpedanceView
            impedanceResults={latestImpedance ?? undefined}
            isConnected={isConnected}
            isRecording={isRecording}
            lang={lang}
            onEnterImpedanceMode={handleEnterImpedance}
            onExitImpedanceMode={handleExitImpedance}
          />
        );

      case 'signal':
      case 'fft':
        return (
          <div style={{ display: 'flex', height: '100%', gap: 8, overflow: 'hidden' }}>
            <div style={{ flex: 2, minWidth: 0, overflow: 'hidden' }}>
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
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <FftView
                packets={latestPackets}
                filterParams={filterParams}
                filterBiquadRef={filterBiquadRef}
                onFilterChange={handleFilterChange}
                lang={lang}
              />
            </div>
          </div>
        );

      case 'record':
        return (
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
          />
        );

      default:
        return null;
    }
  };

  // Tab switching guards
  const handleTabChange = (tab: TabType) => {
    // All non-home tabs require connection
    const restricted = ['impedance', 'signal', 'fft', 'record'] as TabType[];
    if (restricted.includes(tab) && !isConnected) return;
    // Impedance blocked during recording
    if (tab === 'impedance' && isRecording) return;
    // Signal blocked while impedance measurement is active
    if (tab === 'signal' && isImpedanceActive) return;
    setActiveTab(tab);
  };

  return (
    <div className="app-container">
      <Header
        status={status}
        packetRate={deviceStats.packetRate}
        deviceId={deviceId}
        lang={lang}
        onLangToggle={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
      />
      <div className="main-layout">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          lang={lang}
          isConnected={isConnected}
          isImpedanceActive={isImpedanceActive}
          isRecording={isRecording}
        />
        <main className="content-area">
          {renderContent()}
        </main>
      </div>

      {/* Recording indicator overlay badge (visible from any tab) */}
      {isRecording && activeTab !== 'signal' && activeTab !== 'record' && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          background: 'rgba(248,81,73,0.18)',
          border: '1px solid rgba(248,81,73,0.5)',
          borderRadius: 10,
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          zIndex: 100,
          backdropFilter: 'blur(8px)',
        }}>
          <div style={{
            width: 9, height: 9, borderRadius: '50%',
            background: '#f85149',
            animation: 'pulse 1s infinite',
          }} />
          <span style={{ fontSize: 13, color: '#f85149', fontWeight: 600 }}>
            {T(lang, 'signalRecording')} — {recordedSamples.length.toLocaleString()} samples
          </span>
        </div>
      )}

      {/* Connect Modal */}
      {showConnectModal && (
        <ConnectModal
          lang={lang}
          onConnect={(port, displayId, usbSerial) => handleModalConnect(port, displayId, usbSerial)}
          onClose={() => setShowConnectModal(false)}
        />
      )}
    </div>
  );
}

export default App;

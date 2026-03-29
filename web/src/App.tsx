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
import { useEegStream } from './hooks/useEegStream';
import { serialService } from './services/serial';
import type { ConnectionStatus } from './services/serial';
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

  // Serial + parser (reactive refs drive useEegStream)
  const [serial, setSerial] = useState<typeof serialService | null>(null);
  const [parser, setParser] = useState<SteegParser | null>(null);

  const [config] = useState<DeviceConfig>(DEFAULT_CONFIG);

  // Device ID extracted from first serial number packet
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const deviceIdSeenRef = useRef(false);

  // Impedance mode tracking
  const impedanceModeActiveRef = useRef(false);

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
    id: '', name: '', age: '', sex: '', notes: '',
  });

  // ── Recording state ──
  const [isRecording, setIsRecording] = useState(false);
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [recordStartTime, setRecordStartTime] = useState<Date | null>(null);
  const recordSamplesRef = useRef<RecordedSample[]>([]);
  const recordTimestampRef = useRef<number>(0); // seconds from start

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
      } else {
        setSerial(null);
        setDeviceId(null);
        deviceIdSeenRef.current = false;
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

  // Extract device ID from first packet that has a serial number
  useEffect(() => {
    if (deviceIdSeenRef.current) return;
    for (const pkt of latestPackets) {
      if (pkt.serialNumber !== null) {
        const hexId = `STEEG_${pkt.serialNumber.toString(16).toUpperCase().padStart(8, '0')}`;
        setDeviceId(hexId);
        deviceIdSeenRef.current = true;
        break;
      }
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

  // Send ADC on when connected (after brief delay to let device stabilize)
  useEffect(() => {
    if (status !== 'connected') return;
    const cmds = getCommands();
    if (!cmds) return;
    const t = setTimeout(async () => {
      try {
        await serialService.write(cmds.cmd_adc_on());
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [status, getCommands]);

  // ── Connection handlers ──
  const handleConnect = useCallback(async () => {
    try {
      await serialService.connect({ baudRate: config.baudRate });
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
    const cmds = getCommands();
    if (!serial || !cmds) return;
    impedanceModeActiveRef.current = true;
    await serial.write(cmds.cmd_impedance_ac_on('reference'));
    parser?.enable_impedance(config.sampleRate, config.sampleRate);
  }, [serial, getCommands, parser, config.sampleRate]);

  const handleExitImpedance = useCallback(async () => {
    const cmds = getCommands();
    if (!serial || !cmds) return;
    await serial.write(cmds.cmd_impedance_ac_off());
    impedanceModeActiveRef.current = false;
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
            lang={lang}
            onEnterImpedanceMode={handleEnterImpedance}
            onExitImpedanceMode={handleExitImpedance}
          />
        );

      case 'signal':
        return (
          <WaveformView
            packets={latestPackets}
            filterParams={filterParams}
            filterBiquadRef={filterBiquadRef}
            onFilterChange={handleFilterChange}
            lang={lang}
            isRecording={isRecording}
            onEventMarker={handleEventMarker}
          />
        );

      case 'fft':
        return (
          <FftView
            packets={latestPackets}
            filterParams={filterParams}
            filterBiquadRef={filterBiquadRef}
            onFilterChange={handleFilterChange}
            lang={lang}
          />
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
          />
        );

      default:
        return null;
    }
  };

  // Tab switching: redirect to home if switching to restricted tab while disconnected
  const handleTabChange = (tab: TabType) => {
    const restricted = ['impedance', 'signal', 'fft', 'record'] as TabType[];
    if (restricted.includes(tab) && !isConnected) return;
    setActiveTab(tab);
  };

  return (
    <div className="app-container">
      <Header
        status={status}
        packetRate={deviceStats.packetRate}
        lang={lang}
        onLangToggle={() => setLang(l => l === 'zh' ? 'en' : 'zh')}
      />
      <div className="main-layout">
        <Sidebar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          lang={lang}
          isConnected={isConnected}
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
    </div>
  );
}

export default App;

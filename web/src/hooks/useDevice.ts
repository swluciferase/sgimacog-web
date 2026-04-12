import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConnectionStatus } from '../services/serial';
import { SerialService } from '../services/serial';
import { FtdiUsbService, type UsbDeviceLike } from '../services/ftdiUsb';
import { wasmService } from '../services/wasm';
import { useEegStream } from './useEegStream';
import { useQualityMonitor } from './useQualityMonitor';
import type { QualityConfig } from './useQualityMonitor';
import type {
  SubjectInfo,
  FilterParams,
  FilterBiquadState,
} from '../types/eeg';
import {
  DEFAULT_FILTER_PARAMS,
  makeFilterBiquadState,
  DEFAULT_CONFIG,
  SAMPLE_RATE_HZ,
} from '../types/eeg';
import type { RecordedSample } from '../services/csvWriter';
import {
  registerConnected,
  registerDisconnected,
  updateRegistrySteegId,
} from '../services/deviceRegistry';
import type { SessionInfo } from '../services/sessionApi';

export interface SteegParserIface {
  feed(data: Uint8Array): unknown;
  packets_received(): number;
  packets_lost(): number;
  decode_errors(): number;
  enable_impedance(windowSize: number, sampleRate: number): void;
  disable_impedance(): void;
  free(): void;
}

export interface WasmCommandsIface {
  cmd_adc_on(): Uint8Array;
  cmd_adc_off(): Uint8Array;
  cmd_impedance_ac_on(code_set: string): Uint8Array;
  cmd_impedance_ac_off(): Uint8Array;
  cmd_machine_info(): Uint8Array;
}

export type EventMarker = { id: string; time: number; label: string };

export function useDevice(sessionInfo?: SessionInfo | null) {
  // ── Services (one instance per device) ──
  const serialRef  = useRef<SerialService>(new SerialService());
  const ftdiRef    = useRef<FtdiUsbService>(new FtdiUsbService());
  type AnyService  = SerialService | FtdiUsbService;
  const activeServiceRef = useRef<AnyService>(serialRef.current);

  // ── Core state ──
  const [status,   setStatus]   = useState<ConnectionStatus>('disconnected');
  const [serial,   setSerial]   = useState<AnyService | null>(null);
  const [parser,   setParser]   = useState<SteegParserIface | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const deviceIdSeenRef   = useRef(false);
  const expectedSerialRef = useRef('');

  // ── Impedance ──
  const impedanceModeActiveRef = useRef(false);
  const [isImpedanceActive, setIsImpedanceActive] = useState(false);

  // ── Filter ──
  const [filterParams, setFilterParams] = useState<FilterParams>(DEFAULT_FILTER_PARAMS);
  const filterBiquadRef = useRef<FilterBiquadState>(makeFilterBiquadState());

  // ── Subject ──
  const [subjectInfo, setSubjectInfo] = useState<SubjectInfo>({
    id: '', name: '', dob: '', sex: '', notes: '',
  });

  // ── Recording ──
  const [isRecording, setIsRecording]         = useState(false);
  const [recordedSamples, setRecordedSamples] = useState<RecordedSample[]>([]);
  const [recordStartTime, setRecordStartTime] = useState<Date | null>(null);
  const recordSamplesRef    = useRef<RecordedSample[]>([]);
  const recordTimestampRef  = useRef(0);

  // ── Quality ──
  const [qualityConfig, setQualityConfig] = useState<QualityConfig>({
    enabled: true, sensitivity: 3, targetDurationSec: 60, windowSec: 2,
  });

  // ── Event markers ──
  const [eventMarkers, setEventMarkers] = useState<EventMarker[]>([]);
  const pendingMarkerRef = useRef<EventMarker | null>(null);

  // ── Connect modal ──
  const [showConnectModal, setShowConnectModal] = useState(false);

  // ── Init WASM + wire service callbacks ──
  useEffect(() => {
    wasmService.init().then(() => {
      const api = wasmService.api as Record<string, unknown>;
      const P = api.SteegParser as new (ch: number, sr: number) => SteegParserIface;
      setParser(new P(DEFAULT_CONFIG.channels, DEFAULT_CONFIG.sampleRate));
    }).catch(console.error);

    const makeStatusHandler = (svc: AnyService) => (s: ConnectionStatus) => {
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

    serialRef.current.onStatusChange  = makeStatusHandler(serialRef.current);
    ftdiRef.current.onStatusChange    = makeStatusHandler(ftdiRef.current);

    return () => {
      serialRef.current.onStatusChange = () => {};
      ftdiRef.current.onStatusChange   = () => {};
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-create parser after WASM trap ──
  const handleParserError = useCallback(() => {
    if (!wasmService.isInitialized) return;
    const api = wasmService.api as Record<string, unknown>;
    const P = api.SteegParser as new (ch: number, sr: number) => SteegParserIface;
    setParser(new P(DEFAULT_CONFIG.channels, DEFAULT_CONFIG.sampleRate));
  }, []);

  const { stats: deviceStats, latestPackets, latestImpedance } = useEegStream(
    serial, parser, handleParserError,
  );

  const { currentWindowStds, goodTimeSec, goodPercent, shouldAutoStop } =
    useQualityMonitor(latestPackets, isRecording, qualityConfig);

  // ── On connect: send machine_info + adc_on ──
  useEffect(() => {
    if (status !== 'connected') return;
    if (!wasmService.isInitialized) return;
    const cmds = wasmService.api as unknown as WasmCommandsIface;
    const svc = activeServiceRef.current;
    const t = setTimeout(async () => {
      try {
        await svc.write(cmds.cmd_machine_info());
        await new Promise(r => setTimeout(r, 100));
        await svc.write(cmds.cmd_adc_on());
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(t);
  }, [status]);

  // ── Process machineInfo packets ──
  useEffect(() => {
    for (const pkt of latestPackets) {
      if (!pkt.machineInfo) continue;
      const rawSerial = pkt.machineInfo.startsWith('STEEG_')
        ? pkt.machineInfo.slice(6)
        : pkt.machineInfo;
      if (expectedSerialRef.current) {
        if (rawSerial !== expectedSerialRef.current) {
          const expected = expectedSerialRef.current;
          expectedSerialRef.current = '';
          deviceIdSeenRef.current = false;
          setDeviceId(null);
          void serialRef.current.disconnect();
          setTimeout(() => {
            window.alert(
              `⚠️ Wrong COM port!\n\nExpected: ${expected}\nConnected: ${rawSerial}\n\nPlease select the correct COM port.`
            );
          }, 200);
          return;
        }
        expectedSerialRef.current = '';
      }
      if (!deviceIdSeenRef.current) {
        const id = pkt.machineInfo.startsWith('STEEG_')
          ? pkt.machineInfo : `STEEG_${pkt.machineInfo}`;
        setDeviceId(id);
        deviceIdSeenRef.current = true;
        updateRegistrySteegId(id);
      }
      return;
    }
  }, [latestPackets]);

  // ── Collect recording samples ──
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

  // ── Sync recordedSamples for display ──
  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => {
      setRecordedSamples([...recordSamplesRef.current]);
    }, 2000);
    return () => clearInterval(id);
  }, [isRecording]);

  // ── Auto-stop guard ──
  const autoStopFiredRef = useRef(false);

  // ── Session info pre-fill ──
  useEffect(() => {
    if (!sessionInfo) return;
    setSubjectInfo(prev => ({
      id:    prev.id    || sessionInfo.subject_id || '',
      name:  prev.name  || sessionInfo.name       || '',
      dob:   prev.dob   || sessionInfo.birth_date || '',
      sex:   prev.sex   || (
        sessionInfo.gender === 'M' ? 'M' :
        sessionInfo.gender === 'F' ? 'F' :
        sessionInfo.gender === 'O' ? 'Other' : ''
      ) as SubjectInfo['sex'],
      notes: prev.notes || sessionInfo.notes || '',
    }));
  }, [sessionInfo]);

  // ── Helpers ──
  const getCommands = useCallback((): WasmCommandsIface | null => {
    if (!wasmService.isInitialized) return null;
    return wasmService.api as unknown as WasmCommandsIface;
  }, []);

  const handleFilterChange = useCallback((
    updated: Partial<FilterParams>,
    resetStates?: string[],
  ) => {
    setFilterParams(prev => ({ ...prev, ...updated }));
    if (resetStates) {
      const bq = filterBiquadRef.current;
      if (resetStates.includes('hp')) {
        bq.hpState1.fill(0); bq.hpState2.fill(0); bq.dcState.fill(0);
      }
      if (resetStates.includes('lp')) {
        bq.lpState1.fill(0); bq.lpState2.fill(0);
      }
      if (resetStates.includes('notch')) {
        bq.notchState.fill(0);
      }
    }
  }, []);

  const handleConnect = useCallback(() => setShowConnectModal(true), []);

  const handleModalConnect = useCallback(async (
    port: SerialPort | null,
    displayId?: string,
    usbSerial?: string,
  ) => {
    setShowConnectModal(false);
    if (!port) return;
    activeServiceRef.current = serialRef.current;
    if (displayId) {
      setDeviceId(displayId);
      deviceIdSeenRef.current = true;
      updateRegistrySteegId(displayId);
    }
    if (usbSerial) expectedSerialRef.current = usbSerial;
    try {
      await serialRef.current.connectToPort(port, { baudRate: DEFAULT_CONFIG.baudRate });
    } catch (e) {
      console.error('Connect failed:', e);
    }
  }, []);

  const handleModalConnectUsb = useCallback(async (
    device: UsbDeviceLike,
    displayId: string,
  ) => {
    setShowConnectModal(false);
    activeServiceRef.current = ftdiRef.current;
    if (displayId) {
      setDeviceId(displayId);
      deviceIdSeenRef.current = true;
      updateRegistrySteegId(displayId);
    }
    try {
      await ftdiRef.current.connectToDevice(device, DEFAULT_CONFIG.baudRate);
    } catch (e) {
      console.error('FTDI USB connect failed:', e);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    const svc = activeServiceRef.current;
    try {
      if (impedanceModeActiveRef.current) {
        const cmds = getCommands();
        if (cmds) await svc.write(cmds.cmd_impedance_ac_off());
        impedanceModeActiveRef.current = false;
        setIsImpedanceActive(false);
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
    parser?.enable_impedance(DEFAULT_CONFIG.impedanceWindow, DEFAULT_CONFIG.sampleRate);
  }, [isRecording, serial, getCommands, parser]);

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
    autoStopFiredRef.current = false;
  }, []);

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    setRecordedSamples([...recordSamplesRef.current]);
  }, []);

  // Wire auto-stop here (stable ref approach)
  const handleStopRef = useRef(handleStopRecording);
  handleStopRef.current = handleStopRecording;

  useEffect(() => {
    if (!isRecording) {
      autoStopFiredRef.current = false;
      return;
    }
    if (shouldAutoStop && !autoStopFiredRef.current) {
      autoStopFiredRef.current = true;
      handleStopRef.current();
    }
  }, [shouldAutoStop, isRecording]);

  const handleEventMarker = useCallback((marker: EventMarker) => {
    setEventMarkers(prev => [...prev, marker]);
    if (isRecording) pendingMarkerRef.current = marker;
  }, [isRecording]);

  return {
    // connection
    status,
    isConnected: status === 'connected',
    deviceId,
    showConnectModal,
    setShowConnectModal,
    handleConnect,
    handleModalConnect,
    handleModalConnectUsb,
    handleDisconnect,
    // data streams
    deviceStats,
    latestPackets,
    latestImpedance,
    // impedance
    isImpedanceActive,
    handleEnterImpedance,
    handleExitImpedance,
    // filter
    filterParams,
    filterBiquadRef,
    handleFilterChange,
    // recording
    isRecording,
    recordedSamples,
    recordStartTime,
    handleStartRecording,
    handleStopRecording,
    // subject
    subjectInfo,
    setSubjectInfo,
    // quality
    qualityConfig,
    setQualityConfig,
    currentWindowStds,
    goodTimeSec,
    goodPercent,
    shouldAutoStop,
    // events
    eventMarkers,
    setEventMarkers,
    handleEventMarker,
  } as const;
}

export type DeviceHandle = ReturnType<typeof useDevice>;

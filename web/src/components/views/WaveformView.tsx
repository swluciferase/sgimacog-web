import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import { ColorRGBA, WebglAux, WebglLine, WebglPlot } from 'webgl-plot';
import type { EegPacket, FilterParams, FilterBiquadState } from '../../types/eeg';
import { CHANNEL_LABELS, CHANNEL_COUNT, SAMPLE_RATE_HZ } from '../../types/eeg';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface EventMarker {
  id: string;
  time: number;         // Date.now() at the moment of placement
  label: string;
  sweepPos: number;     // canvas write position (0 to windowPoints-1) at placement time
  totalSweep: number;  // monotonically increasing sample counter at placement
  /** 'software' (red dashed, default) or 'hardware' (green solid). */
  kind?: 'software' | 'hardware';
}

export interface WaveformViewProps {
  packets?: EegPacket[];
  filterParams: FilterParams;
  filterBiquadRef: MutableRefObject<FilterBiquadState>;
  onFilterChange: (updated: Partial<FilterParams>, resetStates?: string[]) => void;
  lang: Lang;
  isRecording: boolean;
  onEventMarker: (marker: { id: string; time: number; label: string }) => void;
  /** Increment to trigger an event marker from outside (broadcast) */
  externalMarkerSignal?: number;
  /** When true, suppress local Space/M key handler (App handles it globally in sync mode) */
  syncMarkerMode?: boolean;
  /**
   * In multi-device mode (when defined): only respond to keyboard when true.
   * In single-device mode (undefined): fall back to offsetParent visibility check.
   */
  isFocused?: boolean;
  /** 0-based device index — selects per-device color palette (0=teal, 1=green, 2=rose, 3=plum) */
  devicePalette?: number;
  /** Custom channel labels (flexible electrode mode); falls back to CHANNEL_LABELS */
  channelLabels?: readonly string[];
  /** Device sample rate — used for filter coefficients and window size (default 1001) */
  sampleRate?: number;
  /** Device ID string (e.g. 'STEEG_A1B2C3') — used to filter hardware-marker-visual events */
  deviceId?: string | null;
}

// Per-device palettes: 4 devices × 8 channels (RGBA float)
// Theme anchors: --teal #5cc4a8, --cyan #52b8d8, --green #80c854,
//                --amber #d8b84a, --rose #dc7860, --plum #9870b8, --mauve #bca8dc
const DEVICE_PALETTES: [number, number, number, number][][] = [
  // Palette 0 — teal/cyan (D1)
  [
    [0.32, 0.77, 0.66, 1],   // #52c4a8 teal
    [0.32, 0.72, 0.85, 1],   // #52b8d8 cyan
    [0.45, 0.88, 0.78, 1],   // #72e0c7 mint
    [0.22, 0.60, 0.78, 1],   // #3899c8 steel-blue
    [0.55, 0.95, 0.88, 1],   // #8cf2e0 seafoam
    [0.20, 0.84, 0.90, 1],   // #32d6e6 sky-cyan
    [0.38, 0.65, 0.96, 1],   // #60a6f5 periwinkle
    [0.68, 0.95, 0.95, 1],   // #adf2f2 ice
  ],
  // Palette 1 — green/lime (D2)
  [
    [0.50, 0.78, 0.33, 1],   // #80c854 green
    [0.70, 0.92, 0.28, 1],   // #b2eb47 lime
    [0.38, 0.88, 0.50, 1],   // #60e080 jade
    [0.80, 0.70, 0.18, 1],   // #ccb32e olive-gold
    [0.55, 0.95, 0.40, 1],   // #8cf266 yellow-green
    [0.30, 0.75, 0.42, 1],   // #4dbf6b forest
    [0.85, 0.88, 0.22, 1],   // #d9e038 chartreuse
    [0.42, 0.95, 0.70, 1],   // #6bf2b3 spring-green
  ],
  // Palette 2 — rose/amber (D3)
  [
    [0.86, 0.47, 0.38, 1],   // #dc7860 rose
    [0.85, 0.72, 0.29, 1],   // #d8b84a amber
    [0.95, 0.55, 0.28, 1],   // #f28c47 orange
    [0.92, 0.30, 0.38, 1],   // #eb4d60 coral-red
    [0.95, 0.80, 0.45, 1],   // #f2cc72 warm-yellow
    [0.75, 0.38, 0.30, 1],   // #bf614d terracotta
    [0.98, 0.65, 0.52, 1],   // #faa685 peach
    [0.88, 0.55, 0.70, 1],   // #e08cb3 rose-pink
  ],
  // Palette 3 — plum/mauve (D4)
  [
    [0.60, 0.44, 0.72, 1],   // #9870b8 plum
    [0.74, 0.66, 0.86, 1],   // #bca8dc mauve
    [0.72, 0.30, 0.85, 1],   // #b84dd9 violet
    [0.45, 0.32, 0.78, 1],   // #7252c8 indigo
    [0.88, 0.55, 0.92, 1],   // #e08ceb lavender
    [0.52, 0.52, 0.95, 1],   // #8585f2 blue-violet
    [0.80, 0.40, 0.60, 1],   // #cc6699 dusty-rose
    [0.65, 0.72, 0.98, 1],   // #a6b8fa cornflower
  ],
];

const SCALE_OPTIONS = [
  { value: 50,     label: '±50 µV'  },
  { value: 100,    label: '±100 µV' },
  { value: 200,    label: '±200 µV' },
  { value: 500,    label: '±500 µV' },
  { value: 1000,   label: '±1 mV'   },
  { value: 5000,   label: '±5 mV'   },
  { value: 50000,  label: '±50 mV'  },
  { value: 500000, label: '±500 mV' },
];

const TIME_OPTIONS = [
  { value: 2,  label: '2 s'  },
  { value: 5,  label: '5 s'  },
  { value: 10, label: '10 s' },
  { value: 20, label: '20 s' },
];

const toClipY = (rawUv: number, ch: number, scale: number, chCount: number): number => {
  const yOffset = 1 - (2 * ch + 1) / chCount;
  const yScale = 1 / (chCount * scale);
  return rawUv * yScale + yOffset;
};

const toCssColor = (rgba: [number, number, number, number], alpha?: number): string => {
  const [r, g, b, a] = rgba;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha ?? a})`;
};

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h * 6) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 1/6)      { r = c; g = x; }
  else if (h < 2/6) { r = x; g = c; }
  else if (h < 3/6) { g = c; b = x; }
  else if (h < 4/6) { g = x; b = c; }
  else if (h < 5/6) { r = x; b = c; }
  else              { r = c; b = x; }
  return [r + m, g + m, b + m];
}

const formatTime = (ts: number): string => {
  const d = new Date(ts);
  const p2 = (n: number) => n.toString().padStart(2, '0');
  const p3 = (n: number) => n.toString().padStart(3, '0');
  return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
};

// ── Filter coefficient helpers ──

// 4th-order Butterworth biquad coefficients (one stage of two)
// Q factors for 4th-order Butterworth: stage1=1.3066, stage2=0.5412
const BW_Q = [1.3066, 0.5412] as const;

function computeButterHP(f0: number, fs: number, q: number) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW) / 2 / a0,
    b1: -(1 + cosW) / a0,
    b2: (1 + cosW) / 2 / a0,
    a1: -2 * cosW / a0,
    a2: (1 - alpha) / a0,
  };
}

function computeButterLP(f0: number, fs: number, q: number) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosW) / 2 / a0,
    b1: (1 - cosW) / a0,
    b2: (1 - cosW) / 2 / a0,
    a1: -2 * cosW / a0,
    a2: (1 - alpha) / a0,
  };
}

// 3-stage cascaded notch biquad coefficients
const NOTCH_Q = 35;
function computeNotchStages(f0: number, fs: number) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * NOTCH_Q);
  const cosW = Math.cos(w0);
  const a0 = 1 + alpha;
  const c = { b0: 1/a0, b1: -2*cosW/a0, b2: 1/a0, a1: -2*cosW/a0, a2: (1-alpha)/a0 };
  return [c, c, c] as const; // same coefficients for all 3 stages
}

// Apply a single biquad stage (Direct Form II transposed)
function applyBiquad(
  x: number,
  stateArr: Float64Array,
  stateBase: number,
  b0: number, b1: number, b2: number, a1: number, a2: number,
): number {
  const y = b0 * x + stateArr[stateBase];
  stateArr[stateBase]     = b1 * x - a1 * y + stateArr[stateBase + 1];
  stateArr[stateBase + 1] = b2 * x - a2 * y;
  return y;
}

// Apply full filter chain to one sample of one channel
// Returns filtered sample. Uses shared FilterBiquadState refs.
function applyFilterChain(
  x: number,
  ch: number,
  biquad: FilterBiquadState,
  params: FilterParams,
  hpCoeffs: ReturnType<typeof computeButterHP>[],
  lpCoeffs: ReturnType<typeof computeButterLP>[],
  notchCoeffs: ReturnType<typeof computeNotchStages>,
): number {
  let s = x;

  // DC removal (always on): single-pole IIR, α=0.9985
  // On first sample, seed dcState from x so the initial output ≈ 0 (no startup transient).
  const dcAlpha = 0.9985;
  if (!biquad.dcInitialized[ch]) {
    biquad.dcState[ch] = s;
    biquad.dcInitialized[ch] = 1;
  }
  const dcPrev = biquad.dcState[ch];
  const dcOut = s - dcPrev;
  biquad.dcState[ch] = dcAlpha * dcPrev + (1 - dcAlpha) * s;
  s = dcOut;

  if (params.bandpassEnabled) {
    // HP stage 1
    s = applyBiquad(s, biquad.hpState1, ch * 2, hpCoeffs[0].b0, hpCoeffs[0].b1, hpCoeffs[0].b2, hpCoeffs[0].a1, hpCoeffs[0].a2);
    // HP stage 2
    s = applyBiquad(s, biquad.hpState2, ch * 2, hpCoeffs[1].b0, hpCoeffs[1].b1, hpCoeffs[1].b2, hpCoeffs[1].a1, hpCoeffs[1].a2);
    // LP stage 1
    s = applyBiquad(s, biquad.lpState1, ch * 2, lpCoeffs[0].b0, lpCoeffs[0].b1, lpCoeffs[0].b2, lpCoeffs[0].a1, lpCoeffs[0].a2);
    // LP stage 2
    s = applyBiquad(s, biquad.lpState2, ch * 2, lpCoeffs[1].b0, lpCoeffs[1].b1, lpCoeffs[1].b2, lpCoeffs[1].a1, lpCoeffs[1].a2);
  }

  if (params.notchFreq !== 0) {
    // 3 cascaded notch stages, each stage uses 2 state values
    for (let stage = 0; stage < 3; stage++) {
      const base = ch * 6 + stage * 2;
      const c = notchCoeffs[stage];
      s = applyBiquad(s, biquad.notchState, base, c.b0, c.b1, c.b2, c.a1, c.a2);
    }
  }

  return s;
}

export const WaveformView = ({
  packets,
  filterParams,
  filterBiquadRef,
  onFilterChange,
  lang,
  isRecording,
  onEventMarker,
  externalMarkerSignal = 0,
  syncMarkerMode = false,
  isFocused,
  devicePalette = 0,
  channelLabels,
  sampleRate,
  deviceId,
}: WaveformViewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wglpRef = useRef<WebglPlot | null>(null);
  const auxRef = useRef<WebglAux | null>(null);
  const linesRef = useRef<WebglLine[]>([]);
  const sweepPosRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const packetQueueRef = useRef<EegPacket[]>([]);
  const latestUvRef = useRef<Float32Array | null>(null);

  const [windowSeconds, setWindowSeconds] = useState(5);
  const [fullScaleUv, setFullScaleUv] = useState(100);
  const [visibleChannels, setVisibleChannels] = useState<boolean[]>(() => Array(channelLabels?.length ?? CHANNEL_COUNT).fill(true));

  // Local HP/LP freq input state (for text inputs)
  const [hpInput, setHpInput] = useState(filterParams.hpFreq.toString());
  const [lpInput, setLpInput] = useState(filterParams.lpFreq.toString());

  const fullScaleUvRef = useRef(fullScaleUv);
  const visibleChannelsRef = useRef(visibleChannels);
  const filterParamsRef = useRef(filterParams);

  const [markers, setMarkers] = useState<EventMarker[]>([]);
  const markersRef = useRef<EventMarker[]>([]);
  const markerDivsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const sweepCursorRef = useRef<HTMLDivElement | null>(null);
  const totalSweepRef = useRef<number>(0);
  const lappedMarkersRef = useRef<Set<string>>(new Set());
  const timeLabelDivsRef = useRef<HTMLDivElement[]>([]);
  const timeGridDivsRef = useRef<HTMLDivElement[]>([]);

  const labels = useMemo(
    () => channelLabels ? Array.from(channelLabels) : Array.from(CHANNEL_LABELS),
    [channelLabels],
  );
  const chCount = labels.length;
  const effectiveSampleRate = sampleRate ?? SAMPLE_RATE_HZ;
  const chCountRef = useRef(chCount);
  const effectiveSampleRateRef = useRef(effectiveSampleRate);
  useEffect(() => { chCountRef.current = chCount; }, [chCount]);
  useEffect(() => { effectiveSampleRateRef.current = effectiveSampleRate; }, [effectiveSampleRate]);

  // Reset visible channels when channel count changes
  useEffect(() => {
    setVisibleChannels(Array(chCount).fill(true));
  }, [chCount]);

  // Per-device channel colors — extended rainbow palette for >8 channels
  const channelColors = useMemo(() => {
    const palette = DEVICE_PALETTES[devicePalette % DEVICE_PALETTES.length] ?? DEVICE_PALETTES[0]!;
    if (chCount <= palette.length) return palette as [number, number, number, number][];
    // For >8 channels: generate a spectral rainbow (hue 160°→340°, 200° span)
    return Array.from({ length: chCount }, (_, i) => {
      const h = ((160 + (i * 200 / chCount)) % 360) / 360;
      const [r, g, b] = hslToRgb(h, 0.72, 0.55);
      return [r, g, b, 1.0] as [number, number, number, number];
    });
  }, [devicePalette, chCount]);

  // Precompute filter coefficients from filterParams
  const filterCoeffs = useMemo(() => {
    const hp = BW_Q.map(q => computeButterHP(filterParams.hpFreq, effectiveSampleRate, q));
    const lp = BW_Q.map(q => computeButterLP(filterParams.lpFreq, effectiveSampleRate, q));
    const notch = filterParams.notchFreq !== 0
      ? computeNotchStages(filterParams.notchFreq, effectiveSampleRate)
      : computeNotchStages(50, effectiveSampleRate); // placeholder, won't be used when notchFreq=0
    return { hp, lp, notch };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParams.hpFreq, filterParams.lpFreq, filterParams.notchFreq, effectiveSampleRate]);

  const filterCoeffsRef = useRef(filterCoeffs);
  useEffect(() => { filterCoeffsRef.current = filterCoeffs; }, [filterCoeffs]);

  // Keep refs in sync with state/props
  useEffect(() => { fullScaleUvRef.current = fullScaleUv; }, [fullScaleUv]);
  useEffect(() => { visibleChannelsRef.current = visibleChannels; }, [visibleChannels]);
  useEffect(() => { filterParamsRef.current = filterParams; }, [filterParams]);

  // Sync text inputs when filterParams changes from outside
  useEffect(() => {
    setHpInput(filterParams.hpFreq.toString());
    setLpInput(filterParams.lpFreq.toString());
  }, [filterParams.hpFreq, filterParams.lpFreq]);

  const handleAutoScale = useCallback(() => {
    const latest = latestUvRef.current;
    if (!latest) return;
    let maxAbs = 1;
    for (let i = 0; i < latest.length; i++) {
      const abs = Math.abs(latest[i]!);
      if (abs > maxAbs) maxAbs = abs;
    }
    const niceScales = [50, 100, 200, 500, 1000, 5000, 50000, 500000];
    const fit = niceScales.find(s => s >= maxAbs * 1.2) ?? 500000;
    setFullScaleUv(fit);
  }, []);

  const toggleChannel = useCallback((index: number) => {
    setVisibleChannels(prev => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  const addMarker = useCallback(() => {
    const id = Math.random().toString(36).substring(2, 9);
    const time = Date.now();
    const label = `M${markersRef.current.length + 1}`;
    const newMarker: EventMarker = { id, time, label, sweepPos: sweepPosRef.current, totalSweep: totalSweepRef.current };
    markersRef.current = [...markersRef.current, newMarker];
    setMarkers(markersRef.current);
    onEventMarker({ id, time, label });
  }, [onEventMarker]);

  // Visual-only marker draw — used when the marker list is already being
  // maintained elsewhere (e.g. THEMynd broadcast). Skips onEventMarker so the
  // right-side list isn't double-populated.
  const drawMarkerVisualOnly = useCallback((label: string, originWallclock?: number) => {
    const id = Math.random().toString(36).substring(2, 9);
    const now = Date.now();
    const time = originWallclock ?? now;
    let markerSweepPos = sweepPosRef.current;
    if (originWallclock != null && originWallclock < now) {
      const offsetMs = now - originWallclock;
      const sr = effectiveSampleRateRef.current ?? 1000;
      const offsetUnits = offsetMs * (sr / 1000);
      const total = totalSweepRef.current || 1;
      const raw = sweepPosRef.current - offsetUnits;
      markerSweepPos = ((raw % total) + total) % total;
    }
    const newMarker: EventMarker = {
      id, time, label,
      sweepPos: markerSweepPos,
      totalSweep: totalSweepRef.current,
    };
    markersRef.current = [...markersRef.current, newMarker];
    setMarkers(markersRef.current);
  }, []);

  // Hardware-event visual-only marker draw — same structure as drawMarkerVisualOnly
  // but sets kind: 'hardware' so the overlay renders a green solid line.
  // When originWallclock is provided (broadcast path), sweepPos is shifted backward
  // by the broadcast offset so the green line lands at the same relative position
  // on the signal as it does on the source device's canvas.
  const drawHardwareMarkerVisualOnly = useCallback((label: string, originWallclock?: number) => {
    const id = Math.random().toString(36).substring(2, 9);
    const now = Date.now();
    const time = originWallclock ?? now;
    // Visual sync: when this marker came from a broadcast (originWallclock < now),
    // shift sweepPos backward so the line lands at the source's time point on this
    // device's signal, matching the CSV Event Date semantic introduced in Option B.
    let markerSweepPos = sweepPosRef.current;
    if (originWallclock != null && originWallclock < now) {
      const offsetMs = now - originWallclock;
      const sr = effectiveSampleRateRef.current ?? 1000;
      const offsetUnits = offsetMs * (sr / 1000);
      const total = totalSweepRef.current || 1;
      const raw = sweepPosRef.current - offsetUnits;
      markerSweepPos = ((raw % total) + total) % total;
    }
    const newMarker: EventMarker = {
      id, time, label,
      sweepPos: markerSweepPos,
      totalSweep: totalSweepRef.current,
      kind: 'hardware',
    };
    markersRef.current = [...markersRef.current, newMarker];
    setMarkers(markersRef.current);
  }, []);

  // Listen for THEMynd visual-only marker events (fired from RecordView when
  // a BroadcastChannel/postMessage marker arrives).
  // No isFocused gate — markers must accumulate into markersRef even when the
  // waveform tab is not focused, so switching back still shows markers that
  // arrived while hidden (mirrors hardware-marker listener behaviour).
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ label?: string; fullLabel?: string; wallclock?: number }>;
      drawMarkerVisualOnly(ce.detail?.label || `M${markersRef.current.length + 1}`, ce.detail?.wallclock);
    };
    window.addEventListener('themynd-marker-visual', handler);
    return () => window.removeEventListener('themynd-marker-visual', handler);
  }, [drawMarkerVisualOnly]);

  // Listen for hardware-event marker visual events (dispatched by useDevice — Task E3).
  // Filters by deviceId so each WaveformView only draws its own device's hardware markers.
  // Note: no isFocused/visibility gate — markers must accumulate into markersRef even
  // when this tab is hidden, otherwise switching back to 訊號 shows missing events
  // that landed while the user was on the 記錄 tab. Canvas redraw runs on its own
  // schedule and will paint the markers when the tab becomes visible again.
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ value: number; deviceId: string; timestamp: number; originWallclock?: number }>;
      // Source filter — multi-device safety: only draw for this view's own device.
      if (deviceId && ce.detail.deviceId !== deviceId) return;
      drawHardwareMarkerVisualOnly(`H${ce.detail.value}`, ce.detail.originWallclock);
    };
    window.addEventListener('hardware-marker-visual', handler);
    return () => window.removeEventListener('hardware-marker-visual', handler);
  }, [drawHardwareMarkerVisualOnly, deviceId]);

  // Ingest packets
  useEffect(() => {
    if (!packets || packets.length === 0) return;
    packetQueueRef.current.push(...packets);
    if (packetQueueRef.current.length > 4096)
      packetQueueRef.current.splice(0, packetQueueRef.current.length - 4096);
    const last = packets[packets.length - 1];
    if (last?.eegChannels) latestUvRef.current = last.eegChannels;
  }, [packets]);

  // Keyboard markers — sync mode OFF only.
  // Multi-device (isFocused defined): fires only when this panel is focused.
  // Single-device (isFocused undefined): fires when canvas is visible (offsetParent check).
  useEffect(() => {
    if (syncMarkerMode) return; // sync ON: global App handler fires eventSignal instead
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== 'm' && e.key !== 'M') return;
      // Skip if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Multi-device: only fire for the focused panel
      // Single-device: fire when canvas is visible
      const shouldFire = isFocused !== undefined
        ? isFocused
        : (canvasRef.current?.offsetParent !== null);
      if (shouldFire) {
        e.preventDefault();
        addMarker();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [addMarker, syncMarkerMode, isFocused]);

  // External broadcast marker (sync-ON global key or simultaneous-event button).
  // No isRecording guard here — addMarker is always safe to call; CSV-save guard lives in useDevice.
  useEffect(() => {
    if (externalMarkerSignal === 0) return;
    addMarker();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalMarkerSignal]);

  // WebGL setup — recreated when windowSeconds, channel count, or palette changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const nCh = chCountRef.current;
    const sr = effectiveSampleRateRef.current;
    const windowPoints = windowSeconds * sr;

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    resizeCanvas();

    const wglp = new WebglPlot(canvas, {
      antialias: true,
      backgroundColor: [0.02, 0.035, 0.07, 1],
    });

    // Sweep (scan) mode: pre-allocate full window for each channel.
    const aux = new WebglAux(wglp.gl);

    const lines: WebglLine[] = Array.from({ length: nCh }, (_, ch) => {
      const color = channelColors[ch] ?? channelColors[ch % channelColors.length] ?? [0.5, 0.8, 0.7, 1] as [number,number,number,number];
      const [r, g, b, a] = color;
      const line = new WebglLine(undefined, new ColorRGBA(r, g, b, a));
      line.lineSpaceX(windowPoints);
      const baseline = toClipY(0, ch, fullScaleUvRef.current, nCh);
      for (let i = 0; i < windowPoints; i++) {
        line.xy[i * 2 + 1] = baseline;
      }
      aux.addLine(line);
      return line;
    });

    wglpRef.current = wglp;
    auxRef.current = aux;
    linesRef.current = lines;
    sweepPosRef.current = 0;

    const ro = new ResizeObserver(() => {
      resizeCanvas();
      const gl = wglp.gl as WebGL2RenderingContext;
      gl.viewport(0, 0, canvas.width, canvas.height);
    });
    ro.observe(canvas);

    const CURSOR_GAP = 20;

    const renderFrame = () => {
      const plot = wglpRef.current;
      const renderer = auxRef.current;
      const lines = linesRef.current;
      if (!plot || !renderer || lines.length === 0) {
        rafRef.current = requestAnimationFrame(renderFrame);
        return;
      }

      const scale = fullScaleUvRef.current;
      const visible = visibleChannelsRef.current;
      const fp = filterParamsRef.current;
      const biquad = filterBiquadRef.current;
      const { hp, lp, notch } = filterCoeffsRef.current;
      const numCh = chCountRef.current;
      const effSr = effectiveSampleRateRef.current;
      const wPts = windowSeconds * effSr;

      const pendingPackets = packetQueueRef.current.splice(0, packetQueueRef.current.length);
      let sweepPos = sweepPosRef.current;

      for (const packet of pendingPackets) {
        const channels = packet.eegChannels;
        if (!channels || channels.length < numCh) continue;

        for (let ch = 0; ch < numCh; ch++) {
          let uv = 0;
          if (visible[ch]) {
            uv = channels[ch] ?? 0;
            uv = applyFilterChain(uv, ch, biquad, fp, hp, lp, notch);
          }
          lines[ch]!.xy[sweepPos * 2 + 1] = toClipY(uv, ch, scale, numCh);
        }

        // Cursor gap: blank points ahead of the pen
        for (let k = 0; k < CURSOR_GAP; k++) {
          const gapPos = (sweepPos + 1 + k) % wPts;
          for (let ch = 0; ch < numCh; ch++) {
            lines[ch]!.xy[gapPos * 2 + 1] = toClipY(0, ch, scale, numCh);
          }
        }

        sweepPos = (sweepPos + 1) % wPts;
        totalSweepRef.current++;
      }

      sweepPosRef.current = sweepPos;

      if (sweepCursorRef.current) {
        sweepCursorRef.current.style.left = `${(sweepPos / wPts) * 100}%`;
      }

      const nowTotal = totalSweepRef.current;
      markersRef.current.forEach(marker => {
        if (!lappedMarkersRef.current.has(marker.id) &&
            nowTotal - marker.totalSweep >= wPts) {
          lappedMarkersRef.current.add(marker.id);
        }
      });

      markersRef.current.forEach(marker => {
        const div = markerDivsRef.current.get(marker.id);
        if (!div) return;
        const leftPct = (marker.sweepPos / wPts) * 100;
        div.style.left = `${leftPct}%`;
        if (lappedMarkersRef.current.has(marker.id)) {
          div.style.opacity = '0';
        } else {
          const dist = (sweepPos - marker.sweepPos + wPts) % wPts;
          div.style.opacity = dist < CURSOR_GAP + 4 ? '0' : '1';
        }
      });

      const numTicks = windowSeconds;
      const p2 = (n: number) => n.toString().padStart(2, '0');
      for (let k = 0; k < MAX_TIME_TICKS; k++) {
        const labelDiv = timeLabelDivsRef.current[k];
        const gridDiv = timeGridDivsRef.current[k];
        const vis = k < numTicks;
        if (labelDiv) labelDiv.style.display = vis ? 'block' : 'none';
        if (gridDiv) gridDiv.style.display = vis ? 'block' : 'none';
        if (!vis) continue;

        const canvasPos = Math.round((k / numTicks) * wPts);
        const leftPct = `${(k / numTicks) * 100}%`;
        if (labelDiv) labelDiv.style.left = leftPct;
        if (gridDiv) gridDiv.style.left = leftPct;

        const samplesAgo = (sweepPos - canvasPos + wPts) % wPts;
        const t = new Date(Date.now() - (samplesAgo / effSr) * 1000);
        if (labelDiv) labelDiv.textContent = `${p2(t.getHours())}:${p2(t.getMinutes())}:${p2(t.getSeconds())}`;
      }

      plot.clear();
      renderer.draw();

      rafRef.current = requestAnimationFrame(renderFrame);
    };

    rafRef.current = requestAnimationFrame(renderFrame);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      wglp.clear();
      wglpRef.current = null;
      auxRef.current = null;
      linesRef.current = [];
      sweepPosRef.current = 0;
      totalSweepRef.current = 0;
      lappedMarkersRef.current = new Set();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSeconds, filterBiquadRef, channelColors, chCount, effectiveSampleRate]);

  const hasData = packets && packets.length > 0;

  const MAX_TIME_TICKS = 20;

  const selectStyle: CSSProperties = {
    background: 'rgba(10, 20, 35, 0.9)',
    border: '1px solid rgba(93, 109, 134, 0.5)',
    borderRadius: 6,
    color: '#cdd6e8',
    fontSize: 12,
    padding: '4px 8px',
    cursor: 'pointer',
    outline: 'none',
  };

  const btnStyle = (active: boolean): CSSProperties => ({
    background: active ? 'rgba(60, 130, 220, 0.35)' : 'transparent',
    border: `1px solid ${active ? 'rgba(60,130,220,0.6)' : 'rgba(93,109,134,0.4)'}`,
    borderRadius: 5,
    color: active ? '#cdd6e8' : 'rgba(180,190,210,0.5)',
    fontSize: 11,
    padding: '3px 7px',
    cursor: 'pointer',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    letterSpacing: '0.04em',
  });

  const inputStyle: CSSProperties = {
    width: 52,
    background: 'rgba(10,20,35,0.9)',
    border: '1px solid rgba(93,109,134,0.5)',
    borderRadius: 5,
    color: '#cdd6e8',
    fontSize: 12,
    padding: '3px 6px',
    outline: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>

      {/* Controls toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 10px',
        background: 'rgba(5, 14, 23, 0.8)',
        border: '1px solid rgba(93, 109, 134, 0.35)',
        borderRadius: 10,
        gap: 8,
        flexWrap: 'wrap',
      }}>
        {/* Channel toggles */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {labels.map((label, i) => (
            <button
              key={label}
              onClick={() => toggleChannel(i)}
              style={{
                ...btnStyle(visibleChannels[i] ?? true),
                color: (visibleChannels[i] ?? true) ? toCssColor(channelColors[i]!) : 'rgba(120,130,150,0.4)',
                borderColor: (visibleChannels[i] ?? true) ? toCssColor(channelColors[i]!, 0.5) : 'rgba(93,109,134,0.3)',
                background: (visibleChannels[i] ?? true) ? toCssColor(channelColors[i]!, 0.1) : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Time window */}
          <label style={{ color: 'rgba(180,195,215,0.7)', fontSize: 12 }}>{T(lang, 'signalTime')}:</label>
          <select value={windowSeconds} onChange={e => setWindowSeconds(Number(e.target.value))} style={selectStyle}>
            {TIME_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          {/* Scale */}
          <label style={{ color: 'rgba(180,195,215,0.7)', fontSize: 12, marginLeft: 4 }}>{T(lang, 'signalScale')}:</label>
          <select value={fullScaleUv} onChange={e => setFullScaleUv(Number(e.target.value))} style={selectStyle}>
            {SCALE_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>

          {/* Auto scale */}
          <button
            onClick={handleAutoScale}
            style={{
              background: 'rgba(40,100,60,0.4)',
              border: '1px solid rgba(60,180,100,0.5)',
              borderRadius: 6,
              color: 'rgba(100,220,140,0.9)',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            {T(lang, 'signalAuto')}
          </button>

          {/* Bandpass toggle + HP/LP inputs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 11, color: filterParams.bandpassEnabled ? 'rgba(120,195,255,0.9)' : 'rgba(180,200,230,0.5)' }}>
              {T(lang, 'signalBandpass')}
            </span>
            <div
              onClick={() => onFilterChange({ bandpassEnabled: !filterParams.bandpassEnabled }, ['hp', 'lp'])}
              style={{
                width: 34, height: 18, borderRadius: 9,
                background: filterParams.bandpassEnabled ? 'rgba(50,120,220,0.75)' : 'rgba(30,42,60,0.75)',
                border: `1px solid ${filterParams.bandpassEnabled ? 'rgba(80,150,255,0.6)' : 'rgba(93,109,134,0.4)'}`,
                position: 'relative', cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute',
                top: 2, left: filterParams.bandpassEnabled ? 17 : 2,
                width: 12, height: 12, borderRadius: 6,
                background: filterParams.bandpassEnabled ? '#8ecfff' : '#6a7a90',
                transition: 'left 0.15s',
              }} />
            </div>
          </div>

          {/* HP freq input */}
          {filterParams.bandpassEnabled && (
            <>
              <label style={{ fontSize: 11, color: 'rgba(160,180,210,0.7)' }}>{T(lang, 'signalHpFreq')}:</label>
              <input
                type="number"
                min="0.1" max="20" step="0.5"
                value={hpInput}
                onChange={e => setHpInput(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(hpInput);
                  if (!isNaN(v) && v > 0 && v < filterParams.lpFreq) {
                    onFilterChange({ hpFreq: v }, ['hp']);
                  } else {
                    setHpInput(filterParams.hpFreq.toString());
                  }
                }}
                style={inputStyle}
              />
              <label style={{ fontSize: 11, color: 'rgba(160,180,210,0.7)' }}>{T(lang, 'signalLpFreq')}:</label>
              <input
                type="number"
                min="5" max="490" step="1"
                value={lpInput}
                onChange={e => setLpInput(e.target.value)}
                onBlur={() => {
                  const v = parseFloat(lpInput);
                  if (!isNaN(v) && v > filterParams.hpFreq && v < effectiveSampleRate / 2) {
                    onFilterChange({ lpFreq: v }, ['lp']);
                  } else {
                    setLpInput(filterParams.lpFreq.toString());
                  }
                }}
                style={inputStyle}
              />
            </>
          )}

          {/* Notch button */}
          <button
            onClick={() => onFilterChange(
              { notchFreq: filterParams.notchFreq === 0 ? 50 : filterParams.notchFreq === 50 ? 60 : 0 },
              ['notch'],
            )}
            style={{
              background: filterParams.notchFreq !== 0 ? 'rgba(180,80,20,0.4)' : 'transparent',
              border: `1px solid ${filterParams.notchFreq !== 0 ? 'rgba(255,140,60,0.7)' : 'rgba(93,109,134,0.4)'}`,
              borderRadius: 6,
              color: filterParams.notchFreq !== 0 ? 'rgba(255,180,80,0.95)' : 'rgba(180,190,210,0.5)',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            {filterParams.notchFreq === 0
              ? T(lang, 'signalNotchOff')
              : filterParams.notchFreq === 50
                ? T(lang, 'signalNotch50')
                : T(lang, 'signalNotch60')}
          </button>

          {/* Event marker button */}
          <button
            onClick={addMarker}
            style={{
              background: 'rgba(200,200,0,0.12)',
              border: '1px solid rgba(220,220,0,0.4)',
              borderRadius: 6,
              color: 'rgba(240,230,80,0.9)',
              fontSize: 12,
              padding: '4px 10px',
              cursor: 'pointer',
            }}
          >
            {T(lang, 'signalMarker')} [M]
          </button>

          {/* Recording indicator */}
          {isRecording && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(248,81,73,0.15)',
              border: '1px solid rgba(248,81,73,0.4)',
              borderRadius: 6,
              padding: '3px 10px',
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: '#f85149',
                animation: 'pulse 1s infinite',
              }} />
              <span style={{ fontSize: 11, color: '#f85149', fontWeight: 600 }}>
                {T(lang, 'signalRecording')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Waveform canvas */}
      <div style={{
        position: 'relative',
        flex: 1,
        minHeight: 360,
        border: '1px solid rgba(93,109,134,0.35)',
        borderRadius: 12,
        background:
          'radial-gradient(circle at 15% 18%, rgba(39,81,138,0.2), rgba(8,16,28,0.95) 48%), ' +
          'linear-gradient(160deg, rgba(5,14,23,1), rgba(8,12,20,1))',
        overflow: 'hidden',
      }}>
        {/* Not connected overlay */}
        {!hasData && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 20,
            background: 'rgba(5,12,22,0.65)',
          }}>
            <div style={{
              fontSize: 42, marginBottom: 12,
              color: 'rgba(88,130,180,0.35)',
            }}>〜</div>
            <div style={{
              fontSize: 15, color: 'rgba(140,165,200,0.65)',
              fontWeight: 500,
            }}>
              {T(lang, 'signalNotConnected')}
            </div>
          </div>
        )}

        {/* Channel labels */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0, width: 64,
          borderRight: '1px solid rgba(93,109,134,0.25)',
          background: 'linear-gradient(180deg, rgba(9,21,38,0.8), rgba(7,15,27,0.8))',
          zIndex: 10,
        }}>
          {labels.map((label, i) => (
            <div
              key={label}
              onClick={() => toggleChannel(i)}
              style={{
                position: 'absolute',
                left: 6,
                top: `${((i + 0.5) / chCount) * 100}%`,
                transform: 'translateY(-50%)',
                color: (visibleChannels[i] ?? true)
                  ? toCssColor(channelColors[i]!)
                  : 'rgba(100,110,130,0.3)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: 11,
                letterSpacing: '0.04em',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              {label}
            </div>
          ))}
          {/* Amplitude scale markers */}
          {labels.map((label, i) => {
            const formatAmp = (uv: number): string => {
              if (uv >= 500000) return '±500m';
              if (uv >= 50000) return '±50m';
              if (uv >= 5000) return '±5m';
              if (uv >= 1000) return '±1m';
              if (uv >= 500) return '±500';
              if (uv >= 200) return '±200';
              if (uv >= 100) return '±100';
              if (uv >= 50) return '±50';
              return `±${uv}`;
            };
            return (
              <div key={`amp-${label}`} style={{
                position: 'absolute',
                right: 2,
                top: `${((i + 0.5) / chCount) * 100}%`,
                transform: 'translateY(-50%)',
                color: 'rgba(140,160,185,0.5)',
                fontSize: 8,
                lineHeight: '9px',
                textAlign: 'right',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}>
                {formatAmp(fullScaleUv)}
              </div>
            );
          })}
        </div>

        {/* WebGL canvas */}
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 64 }}>
          {/* Scan cursor line */}
          <div
            ref={sweepCursorRef}
            style={{
              position: 'absolute',
              top: 0, bottom: 0,
              width: 2,
              background: 'rgba(255, 255, 255, 0.45)',
              boxShadow: '0 0 5px rgba(255,255,255,0.3)',
              pointerEvents: 'none',
              zIndex: 4,
              left: '0%',
            }}
          />
          <canvas
            ref={canvasRef}
            style={{ width: '100%', height: '100%', display: 'block', borderRadius: '0 10px 10px 0' }}
          />
        </div>

        {/* Marker overlays */}
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 0, left: 64,
          pointerEvents: 'none', overflow: 'hidden', zIndex: 5,
        }}>
          {markers.map(m => {
            const isHw = m.kind === 'hardware';
            return (
              <div
                key={m.id}
                ref={el => {
                  if (el) markerDivsRef.current.set(m.id, el);
                  else markerDivsRef.current.delete(m.id);
                }}
                style={{
                  position: 'absolute', top: 0, bottom: 0, width: 0,
                  borderLeft: isHw
                    ? '1.5px solid rgba(67,160,71,0.85)'
                    : '2px dashed rgba(229,57,53,0.75)',
                  left: '0%',
                  display: 'block',
                }}
              >
                <div style={{
                  position: 'absolute', top: 4, left: 4,
                  color: isHw ? 'rgba(102,187,106,0.95)' : 'rgba(239,108,99,0.95)',
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  background: 'rgba(0,0,0,0.5)', padding: '2px 4px', borderRadius: 3,
                  whiteSpace: 'nowrap',
                }}>
                  {m.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Time grid lines (fixed positions, full-height) */}
        <div style={{
          position: 'absolute', top: 0, right: 0, bottom: 20, left: 64,
          pointerEvents: 'none', overflow: 'hidden', zIndex: 3,
        }}>
          {Array.from({ length: MAX_TIME_TICKS }, (_, k) => (
            <div
              key={k}
              ref={el => { timeGridDivsRef.current[k] = el!; }}
              style={{
                position: 'absolute',
                top: 0, bottom: 0,
                width: 1,
                borderLeft: '1px solid rgba(180,200,235,0.10)',
                display: 'none',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>

        {/* Time axis labels (fixed positions, at bottom) */}
        <div style={{
          position: 'absolute', bottom: 0, right: 0, height: 20, left: 64,
          pointerEvents: 'none', overflow: 'hidden', zIndex: 6,
          borderTop: '1px solid rgba(93,109,134,0.2)',
          background: 'rgba(5,12,22,0.5)',
        }}>
          {Array.from({ length: MAX_TIME_TICKS }, (_, k) => (
            <div
              key={k}
              ref={el => { timeLabelDivsRef.current[k] = el!; }}
              style={{
                position: 'absolute',
                top: 3,
                transform: 'translateX(-50%)',
                color: 'rgba(160,185,220,0.65)',
                fontSize: 10,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                whiteSpace: 'nowrap',
                display: 'none',
                userSelect: 'none',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      </div>

      {/* Event markers list moved to 記錄 tab — see RecordView/DevicePanel for the canonical list. */}
    </div>
  );
};

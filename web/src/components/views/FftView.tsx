import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react';
import type { EegPacket, FilterParams, FilterBiquadState } from '../../types/eeg';
import { CHANNEL_LABELS, CHANNEL_COUNT, SAMPLE_RATE_HZ } from '../../types/eeg';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface FftViewProps {
  packets?: EegPacket[];
  filterParams: FilterParams;
  filterBiquadRef: MutableRefObject<FilterBiquadState>;
  onFilterChange: (updated: Partial<FilterParams>, resetStates?: string[]) => void;
  lang: Lang;
}

const FFT_SIZE = 1024;

const MAX_FREQ_OPTIONS = [30, 60, 100] as const;
type MaxFreq = 30 | 60 | 100;

const DB_RANGE_OPTIONS = [
  { minDb: -30, maxDb: 10,  label: 'Narrow' },
  { minDb: -40, maxDb: 20,  label: 'Normal' },
  { minDb: -60, maxDb: 40,  label: 'Wide'   },
] as const;

const CHANNEL_COLORS = [
  'rgba(255, 51, 51, 0.85)',
  'rgba(51, 102, 255, 0.85)',
  'rgba(51, 255, 102, 0.85)',
  'rgba(255, 255, 51, 0.85)',
  'rgba(51, 255, 255, 0.85)',
  'rgba(255, 51, 255, 0.85)',
  'rgba(255, 153, 51, 0.85)',
  'rgba(178, 51, 255, 0.85)',
];

// ── Filter helpers ──

const BW_Q = [1.3066, 0.5412] as const;
const NOTCH_Q = 35;

function computeButterHP(f0: number, fs: number, q: number) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 + cosW) / 2 / a0, b1: -(1 + cosW) / a0, b2: (1 + cosW) / 2 / a0,
    a1: -2 * cosW / a0, a2: (1 - alpha) / a0,
  };
}

function computeButterLP(f0: number, fs: number, q: number) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cosW = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: (1 - cosW) / 2 / a0, b1: (1 - cosW) / a0, b2: (1 - cosW) / 2 / a0,
    a1: -2 * cosW / a0, a2: (1 - alpha) / a0,
  };
}

function computeNotchStages(f0: number, fs: number) {
  const w0 = 2 * Math.PI * f0 / fs;
  const alpha = Math.sin(w0) / (2 * NOTCH_Q);
  const cosW = Math.cos(w0);
  const a0 = 1 + alpha;
  const c = { b0: 1/a0, b1: -2*cosW/a0, b2: 1/a0, a1: -2*cosW/a0, a2: (1-alpha)/a0 };
  return [c, c, c] as const;
}

function applyBiquad(
  x: number,
  stateArr: Float64Array,
  stateBase: number,
  b0: number, b1: number, b2: number, a1: number, a2: number,
): number {
  const y = b0 * x + stateArr[stateBase]!;
  stateArr[stateBase]     = b1 * x - a1 * y + stateArr[stateBase + 1]!;
  stateArr[stateBase + 1] = b2 * x - a2 * y;
  return y;
}

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
  const dcAlpha = 0.9985;
  const dcPrev = biquad.dcState[ch] ?? 0;
  const dcOut = s - dcPrev;
  biquad.dcState[ch] = dcAlpha * dcPrev + (1 - dcAlpha) * s;
  s = dcOut;

  if (params.bandpassEnabled) {
    s = applyBiquad(s, biquad.hpState1, ch * 2, hpCoeffs[0]!.b0, hpCoeffs[0]!.b1, hpCoeffs[0]!.b2, hpCoeffs[0]!.a1, hpCoeffs[0]!.a2);
    s = applyBiquad(s, biquad.hpState2, ch * 2, hpCoeffs[1]!.b0, hpCoeffs[1]!.b1, hpCoeffs[1]!.b2, hpCoeffs[1]!.a1, hpCoeffs[1]!.a2);
    s = applyBiquad(s, biquad.lpState1, ch * 2, lpCoeffs[0]!.b0, lpCoeffs[0]!.b1, lpCoeffs[0]!.b2, lpCoeffs[0]!.a1, lpCoeffs[0]!.a2);
    s = applyBiquad(s, biquad.lpState2, ch * 2, lpCoeffs[1]!.b0, lpCoeffs[1]!.b1, lpCoeffs[1]!.b2, lpCoeffs[1]!.a1, lpCoeffs[1]!.a2);
  }

  if (params.notchFreq !== 0) {
    for (let stage = 0; stage < 3; stage++) {
      const base = ch * 6 + stage * 2;
      const c = notchCoeffs[stage]!;
      s = applyBiquad(s, biquad.notchState, base, c.b0, c.b1, c.b2, c.a1, c.a2);
    }
  }

  return s;
}

// ── FFT ──

function bitReverse(value: number, bits: number): number {
  let reversed = 0;
  for (let bit = 0; bit < bits; bit++) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

function fftReal(input: Float64Array): { re: Float64Array; im: Float64Array } {
  const size = input.length;
  const bits = Math.log2(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    re[bitReverse(i, bits)] = input[i]!;
  }
  for (let blockSize = 2; blockSize <= size; blockSize <<= 1) {
    const half = blockSize >> 1;
    const step = (-2 * Math.PI) / blockSize;
    for (let start = 0; start < size; start += blockSize) {
      for (let k = 0; k < half; k++) {
        const ei = start + k, oi = ei + half;
        const angle = step * k;
        const tRe = Math.cos(angle), tIm = Math.sin(angle);
        const oRe = re[oi]!, oIm = im[oi]!;
        const tmpRe = tRe * oRe - tIm * oIm;
        const tmpIm = tRe * oIm + tIm * oRe;
        re[oi] = re[ei]! - tmpRe; im[oi] = im[ei]! - tmpIm;
        re[ei] = re[ei]! + tmpRe; im[ei] = im[ei]! + tmpIm;
      }
    }
  }
  return { re, im };
}

function computePsdWithSize(samples: number[], fftSize: number, windowFn: Float64Array): Float64Array {
  const padded = new Float64Array(fftSize);
  const offset = Math.max(0, fftSize - samples.length);
  const readStart = Math.max(0, samples.length - fftSize);
  for (let i = 0; i < fftSize - offset; i++) {
    padded[i + offset] = (samples[readStart + i] ?? 0) * (windowFn[i + offset] ?? 1);
  }
  const { re, im } = fftReal(padded);
  const limit = fftSize / 2;
  const psd = new Float64Array(limit + 1);
  for (let bin = 0; bin <= limit; bin++) {
    psd[bin] = (re[bin]! * re[bin]! + im[bin]! * im[bin]!) / fftSize;
  }
  return psd;
}

// ── Per-panel histogram draw ──

function drawPanelHistogram(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spectrum: Float64Array,
  maxFreq: number,
  minDb: number,
  maxDb: number,
  chColor: string,
  chLabel: string,
) {
  ctx.fillStyle = 'rgba(8,17,30,0.97)';
  ctx.fillRect(0, 0, width, height);

  const PAD_LEFT = 6, PAD_RIGHT = 6, PAD_TOP = 20, PAD_BOTTOM = 18;
  const cw = width - PAD_LEFT - PAD_RIGHT;
  const ch = height - PAD_TOP - PAD_BOTTOM;

  const MIN_DB = minDb, MAX_DB = maxDb, DB_RANGE = MAX_DB - MIN_DB;

  const freqToX = (hz: number) => PAD_LEFT + (Math.min(hz, maxFreq) / maxFreq) * cw;
  const dbToY = (db: number) => PAD_TOP + ch - ((Math.max(MIN_DB, Math.min(MAX_DB, db)) - MIN_DB) / DB_RANGE) * ch;
  const frequencyToBin = (hz: number) =>
    Math.max(0, Math.min(FFT_SIZE / 2, Math.round((hz / SAMPLE_RATE_HZ) * FFT_SIZE)));

  const EEG_BANDS = [
    { name: 'δ', startHz: 0.5, endHz: 4,  tint: 'rgba(102,153,255,0.10)' },
    { name: 'θ', startHz: 4,   endHz: 8,  tint: 'rgba(179,120,255,0.09)' },
    { name: 'α', startHz: 8,   endHz: 13, tint: 'rgba(92,214,130,0.09)'  },
    { name: 'β', startHz: 13,  endHz: 30, tint: 'rgba(255,221,102,0.08)' },
    { name: 'γ', startHz: 30,  endHz: 60, tint: 'rgba(255,128,128,0.08)' },
  ];
  for (const band of EEG_BANDS) {
    if (band.startHz >= maxFreq) continue;
    const x0 = freqToX(band.startHz);
    const x1 = freqToX(Math.min(band.endHz, maxFreq));
    ctx.fillStyle = band.tint;
    ctx.fillRect(x0, PAD_TOP, Math.max(1, x1 - x0), ch);
    ctx.fillStyle = 'rgba(200,215,235,0.55)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(band.name, x0 + (x1 - x0) / 2, PAD_TOP - 3);
  }

  const startBin = frequencyToBin(0);
  const endBin = frequencyToBin(maxFreq);
  const totalBins = endBin - startBin;
  if (totalBins > 0) {
    const groupSize = Math.max(1, Math.ceil(totalBins / 80));
    let groupStart = startBin;
    while (groupStart < endBin) {
      const groupEnd = Math.min(groupStart + groupSize, endBin);
      let maxPower = 0;
      for (let bin = groupStart; bin < groupEnd; bin++) {
        if (spectrum[bin] !== undefined) maxPower = Math.max(maxPower, spectrum[bin]!);
      }
      const db = 10 * Math.log10(Math.max(maxPower, 1e-10));
      const startHz = (groupStart * SAMPLE_RATE_HZ) / FFT_SIZE;
      const endHz = (groupEnd * SAMPLE_RATE_HZ) / FFT_SIZE;
      const x0 = freqToX(startHz);
      const x1 = freqToX(endHz);
      const barW = Math.max(1, x1 - x0 - 1);
      const barH = Math.max(0, dbToY(MIN_DB) - dbToY(db));
      const barY = dbToY(db);
      ctx.fillStyle = chColor;
      ctx.fillRect(x0, barY, barW, barH);
      groupStart = groupEnd;
    }
  }

  ctx.fillStyle = 'rgba(160,180,210,0.7)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  const hzStep = maxFreq <= 30 ? 5 : maxFreq <= 60 ? 10 : 20;
  for (let hz = 0; hz <= maxFreq; hz += hzStep) {
    const x = freqToX(hz);
    ctx.fillText(`${hz}`, x, height - 3);
  }

  ctx.fillStyle = chColor;
  ctx.font = 'bold 12px ui-monospace, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(chLabel, PAD_LEFT + 2, PAD_TOP - 4);
}

// ── Component ──

export const FftView = ({
  packets,
  filterParams,
  filterBiquadRef,
  onFilterChange,
  lang,
}: FftViewProps) => {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>(Array(CHANNEL_COUNT).fill(null));
  const packetQueueRef = useRef<EegPacket[]>([]);
  const channelBuffersRef = useRef<number[][]>(Array.from({ length: CHANNEL_COUNT }, () => []));

  const [maxFreq, setMaxFreq] = useState<MaxFreq>(60);
  const maxFreqRef = useRef<MaxFreq>(60);

  const [dbRangeIdx, setDbRangeIdx] = useState(1); // 0=Narrow, 1=Normal, 2=Wide
  const dbRangeIdxRef = useRef(1);

  const filterParamsRef = useRef(filterParams);
  useEffect(() => { filterParamsRef.current = filterParams; }, [filterParams]);

  const windowFnRef = useRef<Float64Array>(new Float64Array(0));

  const filterCoeffs = useMemo(() => ({
    hp: BW_Q.map(q => computeButterHP(filterParams.hpFreq, SAMPLE_RATE_HZ, q)),
    lp: BW_Q.map(q => computeButterLP(filterParams.lpFreq, SAMPLE_RATE_HZ, q)),
    notch: filterParams.notchFreq !== 0
      ? computeNotchStages(filterParams.notchFreq, SAMPLE_RATE_HZ)
      : computeNotchStages(50, SAMPLE_RATE_HZ),
  }), [filterParams.hpFreq, filterParams.lpFreq, filterParams.notchFreq]);

  const filterCoeffsRef = useRef(filterCoeffs);
  useEffect(() => { filterCoeffsRef.current = filterCoeffs; }, [filterCoeffs]);

  useEffect(() => {
    if (!packets || packets.length === 0) return;
    packetQueueRef.current.push(...packets);
    if (packetQueueRef.current.length > 8192)
      packetQueueRef.current.splice(0, packetQueueRef.current.length - 8192);
  }, [packets]);

  // Initialize windowFn on mount (fixed FFT_SIZE = 1024)
  useEffect(() => {
    windowFnRef.current = Float64Array.from({ length: FFT_SIZE }, (_, i) =>
      0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))),
    );
  }, []);

  // Render loop
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    const render = () => {
      const queue = packetQueueRef.current.splice(0, packetQueueRef.current.length);
      const fp = filterParamsRef.current;
      const biquad = filterBiquadRef.current;
      const { hp, lp, notch } = filterCoeffsRef.current;
      const windowFn = windowFnRef.current;
      const dbRange = DB_RANGE_OPTIONS[dbRangeIdxRef.current] ?? DB_RANGE_OPTIONS[1]!;

      for (const packet of queue) {
        const channels = packet.eegChannels;
        if (!channels || channels.length < CHANNEL_COUNT) continue;
        for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
          let sample = channels[ch] ?? 0;
          sample = applyFilterChain(sample, ch, biquad, fp, hp, lp, notch);
          const buf = channelBuffersRef.current[ch]!;
          buf.push(sample);
          if (buf.length > FFT_SIZE * 2) buf.splice(0, buf.length - FFT_SIZE * 2);
        }
      }

      for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
        const canvas = canvasRefs.current[ch];
        if (!canvas) continue;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const buf = channelBuffersRef.current[ch]!;
        const psd = computePsdWithSize(buf, FFT_SIZE, windowFn);

        drawPanelHistogram(
          ctx,
          canvas.clientWidth,
          canvas.clientHeight,
          psd,
          maxFreqRef.current,
          dbRange.minDb,
          dbRange.maxDb,
          CHANNEL_COLORS[ch] ?? 'rgba(255,255,255,0.8)',
          CHANNEL_LABELS[ch]!,
        );
      }
    };

    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
      const canvas = canvasRefs.current[ch];
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;

      const resize = () => {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      cleanups.push(() => ro.disconnect());
    }

    render();
    const id = window.setInterval(render, 250);
    return () => {
      window.clearInterval(id);
      cleanups.forEach(fn => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterBiquadRef]);

  const hasData = packets && packets.length > 0;

  const btnStyle = (active: boolean): CSSProperties => ({
    background: active ? 'rgba(60,130,220,0.35)' : 'transparent',
    border: `1px solid ${active ? 'rgba(60,130,220,0.6)' : 'rgba(93,109,134,0.4)'}`,
    borderRadius: 5,
    color: active ? '#8ecfff' : 'rgba(160,180,210,0.5)',
    fontSize: 11,
    padding: '3px 9px',
    cursor: 'pointer',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 12px',
        background: 'rgba(5,14,23,0.8)',
        border: '1px solid rgba(93,109,134,0.35)',
        borderRadius: 10,
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Y-axis dB range */}
          <span style={{ fontSize: 12, color: 'rgba(160,180,210,0.7)' }}>Y:</span>
          {DB_RANGE_OPTIONS.map((opt, idx) => (
            <button
              key={idx}
              onClick={() => { dbRangeIdxRef.current = idx; setDbRangeIdx(idx); }}
              style={btnStyle(dbRangeIdx === idx)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Max freq */}
          <span style={{ fontSize: 12, color: 'rgba(160,180,210,0.7)' }}>{T(lang, 'fftMaxFreq')}:</span>
          {MAX_FREQ_OPTIONS.map(f => (
            <button key={f} onClick={() => { maxFreqRef.current = f; setMaxFreq(f); }} style={btnStyle(maxFreq === f)}>
              {f} Hz
            </button>
          ))}

          {/* Bandpass toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
            <span style={{
              fontSize: 11,
              color: filterParams.bandpassEnabled ? 'rgba(120,195,255,0.9)' : 'rgba(180,200,230,0.5)',
            }}>
              BP
            </span>
            <div
              onClick={() => onFilterChange({ bandpassEnabled: !filterParams.bandpassEnabled }, ['hp', 'lp'])}
              style={{
                width: 34, height: 18, borderRadius: 9,
                background: filterParams.bandpassEnabled ? 'rgba(50,120,220,0.75)' : 'rgba(30,42,60,0.75)',
                border: `1px solid ${filterParams.bandpassEnabled ? 'rgba(80,150,255,0.6)' : 'rgba(93,109,134,0.4)'}`,
                position: 'relative', cursor: 'pointer', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 2,
                left: filterParams.bandpassEnabled ? 17 : 2,
                width: 12, height: 12, borderRadius: 6,
                background: filterParams.bandpassEnabled ? '#8ecfff' : '#6a7a90',
                transition: 'left 0.15s',
              }} />
            </div>
          </div>

          {/* Notch */}
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
        </div>
      </div>

      {/* 8 panel grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, minHeight: 0 }}>
        {Array.from({ length: CHANNEL_COUNT }, (_, ch) => (
          <div key={ch} style={{
            position: 'relative',
            border: '1px solid rgba(93,109,134,0.3)',
            borderRadius: 8,
            overflow: 'hidden',
            minHeight: 120,
          }}>
            {!hasData && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(5,12,22,0.7)',
                zIndex: 10,
              }}>
                <span style={{ fontSize: 12, color: 'rgba(140,165,200,0.5)' }}>
                  {CHANNEL_LABELS[ch]}
                </span>
              </div>
            )}
            <canvas
              ref={el => { canvasRefs.current[ch] = el; }}
              style={{ width: '100%', height: '100%', display: 'block' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

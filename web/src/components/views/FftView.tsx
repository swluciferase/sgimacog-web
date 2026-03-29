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
const UPDATE_INTERVAL_MS = 250;
const MIN_DB = -45;
const MAX_DB = 35;

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

const EEG_BANDS = [
  { name: 'Delta', startHz: 0.5, endHz: 4,  tint: 'rgba(102,153,255,0.09)' },
  { name: 'Theta', startHz: 4,   endHz: 8,  tint: 'rgba(179,120,255,0.08)' },
  { name: 'Alpha', startHz: 8,   endHz: 13, tint: 'rgba(92,214,130,0.08)'  },
  { name: 'Beta',  startHz: 13,  endHz: 30, tint: 'rgba(255,221,102,0.07)' },
  { name: 'Gamma', startHz: 30,  endHz: 60, tint: 'rgba(255,128,128,0.08)' },
];

const WINDOW_FN = Float64Array.from({ length: FFT_SIZE }, (_, i) =>
  0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))),
);

const MAX_FREQ_OPTIONS = [30, 60, 100] as const;
type MaxFreq = 30 | 60 | 100;

// ── Filter helpers (same formulas as WaveformView) ──

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

function computePsd(samples: number[]): Float64Array {
  const padded = new Float64Array(FFT_SIZE);
  const offset = Math.max(0, FFT_SIZE - samples.length);
  const readStart = Math.max(0, samples.length - FFT_SIZE);
  for (let i = 0; i < FFT_SIZE - offset; i++) {
    padded[i + offset] = (samples[readStart + i] ?? 0) * WINDOW_FN[i + offset]!;
  }
  const { re, im } = fftReal(padded);
  const limit = FFT_SIZE / 2;
  const psd = new Float64Array(limit + 1);
  for (let bin = 0; bin <= limit; bin++) {
    psd[bin] = (re[bin]! * re[bin]! + im[bin]! * im[bin]!) / FFT_SIZE;
  }
  return psd;
}

// ── Canvas draw ──

function drawSpectrum(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spectra: Float64Array[],
  maxFreq: number,
) {
  const chart = { left: 64, right: width - 16, top: 36, bottom: height - 48 };
  const cw = Math.max(1, chart.right - chart.left);
  const ch = Math.max(1, chart.bottom - chart.top);
  const dbRange = MAX_DB - MIN_DB;

  const hzToX = (hz: number) =>
    chart.left + (Math.max(0, Math.min(maxFreq, hz)) / maxFreq) * cw;
  const dbToY = (db: number) =>
    chart.bottom - ((db - MIN_DB) / dbRange) * ch;
  const frequencyToBin = (hz: number) =>
    Math.max(0, Math.min(FFT_SIZE / 2, Math.round((hz / SAMPLE_RATE_HZ) * FFT_SIZE)));

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, 'rgba(8,17,30,0.95)');
  bg.addColorStop(1, 'rgba(3,9,16,0.98)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (const band of EEG_BANDS) {
    if (band.startHz > maxFreq) continue;
    const x0 = hzToX(band.startHz), x1 = hzToX(Math.min(band.endHz, maxFreq));
    ctx.fillStyle = band.tint;
    ctx.fillRect(x0, chart.top, Math.max(1, x1 - x0), ch);
    ctx.fillStyle = 'rgba(200,215,235,0.7)';
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(band.name, x0 + (x1 - x0) / 2, chart.top - 10);
  }

  ctx.strokeStyle = 'rgba(140,155,180,0.3)';
  ctx.lineWidth = 1;
  const hzStep = maxFreq <= 30 ? 5 : maxFreq <= 60 ? 10 : 20;
  for (let hz = 0; hz <= maxFreq; hz += hzStep) {
    const x = hzToX(hz);
    ctx.beginPath(); ctx.moveTo(x, chart.top); ctx.lineTo(x, chart.bottom); ctx.stroke();
    ctx.fillStyle = 'rgba(170,185,210,0.8)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${hz}`, x, chart.bottom + 16);
  }

  for (const tick of [-40, -30, -20, -10, 0, 10, 20, 30]) {
    const y = dbToY(tick);
    ctx.strokeStyle = 'rgba(90,108,132,0.35)';
    ctx.beginPath(); ctx.moveTo(chart.left, y); ctx.lineTo(chart.right, y); ctx.stroke();
    ctx.fillStyle = 'rgba(170,185,210,0.8)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${tick}`, chart.left - 8, y + 3);
  }

  ctx.strokeStyle = 'rgba(180,198,220,0.65)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(chart.left, chart.top);
  ctx.lineTo(chart.left, chart.bottom);
  ctx.lineTo(chart.right, chart.bottom);
  ctx.stroke();

  const startBin = frequencyToBin(0);
  const endBin = frequencyToBin(maxFreq);
  spectra.forEach((spectrum, chIdx) => {
    if (spectrum.length === 0) return;
    ctx.beginPath();
    ctx.strokeStyle = CHANNEL_COLORS[chIdx] ?? 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.4;
    let moved = false;
    for (let bin = startBin; bin <= endBin; bin++) {
      const hz = (bin * SAMPLE_RATE_HZ) / FFT_SIZE;
      const db = 10 * Math.log10(Math.max(spectrum[bin]!, 1e-10));
      const x = hzToX(hz);
      const y = dbToY(Math.max(MIN_DB, Math.min(MAX_DB, db)));
      if (!moved) { ctx.moveTo(x, y); moved = true; }
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  ctx.fillStyle = 'rgba(205,219,240,0.9)';
  ctx.font = '12px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Frequency (Hz)', chart.left + cw / 2, height - 14);
  ctx.save();
  ctx.translate(16, chart.top + ch / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Power (dB µV²/Hz)', 0, 0);
  ctx.restore();
}

// ── Component ──

export const FftView = ({
  packets,
  filterParams,
  filterBiquadRef,
  onFilterChange,
  lang,
}: FftViewProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const packetQueueRef = useRef<EegPacket[]>([]);
  // FftView has its own accumulation buffers for FFT (independent of waveform scroll buffer)
  const channelBuffersRef = useRef<number[][]>(
    Array.from({ length: CHANNEL_COUNT }, () => []),
  );

  // maxFreq: kept in both state (for UI) and ref (for render loop read without closure stale)
  const [maxFreq, setMaxFreq] = useState<MaxFreq>(60);
  const maxFreqRef = useRef<MaxFreq>(60);

  const filterParamsRef = useRef(filterParams);
  useEffect(() => { filterParamsRef.current = filterParams; }, [filterParams]);

  const filterCoeffs = useMemo(() => ({
    hp: BW_Q.map(q => computeButterHP(filterParams.hpFreq, SAMPLE_RATE_HZ, q)),
    lp: BW_Q.map(q => computeButterLP(filterParams.lpFreq, SAMPLE_RATE_HZ, q)),
    notch: filterParams.notchFreq !== 0
      ? computeNotchStages(filterParams.notchFreq, SAMPLE_RATE_HZ)
      : computeNotchStages(50, SAMPLE_RATE_HZ),
  }), [filterParams.hpFreq, filterParams.lpFreq, filterParams.notchFreq]);

  const filterCoeffsRef = useRef(filterCoeffs);
  useEffect(() => { filterCoeffsRef.current = filterCoeffs; }, [filterCoeffs]);

  // Ingest packets
  useEffect(() => {
    if (!packets || packets.length === 0) return;
    packetQueueRef.current.push(...packets);
    if (packetQueueRef.current.length > 4096)
      packetQueueRef.current.splice(0, packetQueueRef.current.length - 4096);
  }, [packets]);

  // Canvas render loop (setInterval, not rAF — FFT update rate is 4 Hz)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const render = () => {
      const queue = packetQueueRef.current.splice(0, packetQueueRef.current.length);
      const fp = filterParamsRef.current;
      const biquad = filterBiquadRef.current;
      const { hp, lp, notch } = filterCoeffsRef.current;

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

      const spectra = channelBuffersRef.current.map(computePsd);
      drawSpectrum(ctx, canvas.clientWidth, canvas.clientHeight, spectra, maxFreqRef.current);
    };

    render();
    const id = window.setInterval(render, UPDATE_INTERVAL_MS);
    return () => { window.clearInterval(id); ro.disconnect(); };
    // filterBiquadRef is a stable ref object — intentionally excluded
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>

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
        {/* Channel legend */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {Array.from(CHANNEL_LABELS).map((label, i) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 12, height: 3, borderRadius: 2,
                background: CHANNEL_COLORS[i],
                boxShadow: `0 0 4px ${CHANNEL_COLORS[i]}`,
              }} />
              <span style={{
                color: CHANNEL_COLORS[i],
                fontSize: 11,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'rgba(160,180,210,0.7)' }}>{T(lang, 'fftMaxFreq')}:</span>
          {MAX_FREQ_OPTIONS.map(f => (
            <button
              key={f}
              onClick={() => { maxFreqRef.current = f; setMaxFreq(f); }}
              style={btnStyle(maxFreq === f)}
            >
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

      {/* Canvas */}
      <div style={{
        position: 'relative',
        flex: 1,
        minHeight: 360,
        border: '1px solid rgba(93,109,134,0.35)',
        borderRadius: 12,
        background:
          'radial-gradient(circle at 15% 20%, rgba(45,88,148,0.2), rgba(8,16,28,0.96) 44%), ' +
          'linear-gradient(160deg, rgba(4,11,20,1), rgba(7,12,20,1))',
        overflow: 'hidden',
      }}>
        {!hasData && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            zIndex: 10,
            background: 'rgba(5,12,22,0.6)',
          }}>
            <div style={{ fontSize: 38, marginBottom: 10, color: 'rgba(88,130,180,0.3)' }}>≋</div>
            <div style={{ fontSize: 14, color: 'rgba(140,165,200,0.6)', fontWeight: 500 }}>
              {T(lang, 'fftNotConnected')}
            </div>
          </div>
        )}
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      </div>
    </div>
  );
};

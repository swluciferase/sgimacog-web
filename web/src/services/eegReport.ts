/**
 * eegReport.ts
 * Client-side EEG brain health analysis pipeline.
 * Implements: epoching → bad-epoch removal → band power (Welch/Hann) →
 * spectral coherence → permutation entropy → 7 brain health indices → T-scores
 */

import type { RecordedSample } from './csvWriter';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SAMPLE_RATE = 1001; // Hz (device rate)
const EPOCH_LEN_SEC = 2.0;
const EPOCH_STEP_SEC = 0.5;      // overlap = 1.5 s
const CUTOFF_TRAIL = 2;          // drop first and last N epochs
const MIN_CLEAN_EPOCHS = 5;
const MIN_DURATION_SEC = 90;

// Channel indices: Fp1=0, Fp2=1, T7=2, T8=3, O1=4, O2=5, Fz=6, Pz=7
const CH = { Fp1: 0, Fp2: 1, T7: 2, T8: 3, O1: 4, O2: 5, Fz: 6, Pz: 7 };

// Frequency bands [lo, hi] Hz
const BANDS = {
  delta:  [1.5,  4.0],
  theta:  [4.0,  8.0],
  alpha1: [8.0, 10.0],
  alpha2: [10.0, 12.0],
  beta1:  [12.0, 20.0],
  beta2:  [20.0, 30.0],
  gamma:  [30.0, 45.0],
} as const;
type BandName = keyof typeof BANDS;

export interface BrainIndices {
  TBR:  number;
  APR:  number;
  FAA:  number;
  PAF:  number;
  RSA:  number;
  COH:  number;
  EnTP: number;
}

export interface TScores {
  TBR:  number;
  APR:  number;
  FAA:  number;
  PAF:  number;
  RSA:  number;
  COH:  number;
  EnTP: number;
}

export interface ReportResult {
  indices: BrainIndices;
  tscores: TScores;
  age: number;
  cleanEpochs: number;
  totalEpochs: number;
  durationSec: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// FFT (Cooley-Tukey, radix-2, in-place)
// ---------------------------------------------------------------------------

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place FFT. re and im arrays must be length power-of-2. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]!;
        const uIm = im[i + k]!;
        const vRe = re[i + k + len / 2]! * curRe - im[i + k + len / 2]! * curIm;
        const vIm = re[i + k + len / 2]! * curIm + im[i + k + len / 2]! * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PSD (one-sided, Hann-windowed FFT per epoch)
// ---------------------------------------------------------------------------

interface PsdResult {
  freqs: Float64Array;   // frequency bins (Hz)
  power: Float64Array;   // one-sided PSD (µV² / Hz)
}

function computePsd(signal: Float64Array, fs: number): PsdResult {
  const n = signal.length;
  const nfft = nextPow2(n);
  // Hann window
  const win = new Float64Array(n);
  let winPow = 0;
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    winPow += win[i]! * win[i]!;
  }

  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  for (let i = 0; i < n; i++) re[i] = signal[i]! * win[i]!;

  fft(re, im);

  const nPos = Math.floor(nfft / 2) + 1;
  const freqs = new Float64Array(nPos);
  const power = new Float64Array(nPos);
  const scale = 1.0 / (winPow * fs);

  for (let k = 0; k < nPos; k++) {
    freqs[k] = (k * fs) / nfft;
    const mag2 = re[k]! * re[k]! + im[k]! * im[k]!;
    power[k] = mag2 * scale;
  }
  // Double non-DC, non-Nyquist bins (one-sided)
  for (let k = 1; k < nPos - 1; k++) power[k]! && (power[k] *= 2);

  return { freqs, power };
}

// ---------------------------------------------------------------------------
// Band-power integration (Simpson's rule)
// ---------------------------------------------------------------------------

function bandPower(freqs: Float64Array, power: Float64Array, lo: number, hi: number): number {
  // Collect indices within band
  const idx: number[] = [];
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k]! >= lo && freqs[k]! <= hi) idx.push(k);
  }
  if (idx.length < 2) return 0;
  // Simpson's composite rule
  let sum = 0;
  for (let i = 0; i + 1 < idx.length; i++) {
    const k0 = idx[i]!;
    const k1 = idx[i + 1]!;
    const df = freqs[k1]! - freqs[k0]!;
    sum += 0.5 * (power[k0]! + power[k1]!) * df;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Filtering (2nd-order Butterworth IIR, forward+backward for zero-phase)
// ---------------------------------------------------------------------------

function butterworthCoeffs(fc: number, fs: number, type: 'highpass' | 'lowpass'): [number[], number[]] {
  // 2nd-order Butterworth via bilinear transform
  const w0 = 2 * Math.PI * fc / fs;
  const k = Math.tan(w0 / 2);
  const k2 = k * k;
  const sqrt2 = Math.SQRT2;
  let b: number[], a: number[];
  if (type === 'lowpass') {
    const norm = 1 + sqrt2 * k + k2;
    b = [k2 / norm, 2 * k2 / norm, k2 / norm];
    a = [1, (2 * (k2 - 1)) / norm, (1 - sqrt2 * k + k2) / norm];
  } else {
    const norm = 1 + sqrt2 * k + k2;
    b = [1 / norm, -2 / norm, 1 / norm];
    a = [1, (2 * (k2 - 1)) / norm, (1 - sqrt2 * k + k2) / norm];
  }
  return [b, a];
}

function filterOnce(signal: Float64Array, b: number[], a: number[]): Float64Array {
  const out = new Float64Array(signal.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i]!;
    const y0 = b[0]! * x0 + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    out[i] = y0;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
  }
  return out;
}

function filterZeroPhase(signal: Float64Array, b: number[], a: number[]): Float64Array {
  const fwd = filterOnce(signal, b, a);
  const rev = fwd.slice().reverse();
  const bwd = filterOnce(new Float64Array(rev), b, a);
  return new Float64Array(bwd.slice().reverse());
}

function bandpassFilter(signal: Float64Array, lo: number, hi: number, fs: number): Float64Array {
  const [bh, ah] = butterworthCoeffs(lo, fs, 'highpass');
  const [bl, al] = butterworthCoeffs(hi, fs, 'lowpass');
  return filterZeroPhase(filterZeroPhase(signal, bh, ah), bl, al);
}

// ---------------------------------------------------------------------------
// Epoching
// ---------------------------------------------------------------------------

function epochSignal(signal: Float64Array, fs: number): Float64Array[] {
  const epochLen = Math.round(EPOCH_LEN_SEC * fs);
  const stepLen = Math.round(EPOCH_STEP_SEC * fs);
  const epochs: Float64Array[] = [];
  for (let start = 0; start + epochLen <= signal.length; start += stepLen) {
    epochs.push(signal.slice(start, start + epochLen));
  }
  return epochs;
}

// ---------------------------------------------------------------------------
// IQR helpers
// ---------------------------------------------------------------------------

function iqr(arr: number[]): { q1: number; q3: number; iqrVal: number; median: number } {
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const q1 = sorted[Math.floor(n * 0.25)]!;
  const q3 = sorted[Math.floor(n * 0.75)]!;
  const median = sorted[Math.floor(n * 0.5)]!;
  return { q1, q3, iqrVal: q3 - q1, median };
}

function epochStd(epoch: Float64Array): number {
  let sum = 0, sum2 = 0;
  for (const v of epoch) { sum += v; sum2 += v * v; }
  const mean = sum / epoch.length;
  return Math.sqrt(sum2 / epoch.length - mean * mean);
}

function epochPeakToPeak(epoch: Float64Array): number {
  let lo = Infinity, hi = -Infinity;
  for (const v of epoch) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi - lo;
}

/**
 * Bad-epoch removal based on SDK epoch_fun.py:
 * - std IQR: remove epochs where std > Q3 + 1.8×IQR (computed across all channels pooled)
 * - amplitude IQR: remove where p2p > min(IQR_p2p, 195µV)  — actually > Q3+1.8×IQR of p2p
 * We apply per-channel then keep epoch only if ALL channels pass.
 */
function removeBadEpochs(allChanEpochs: Float64Array[][]): boolean[] {
  // allChanEpochs[ch][ep]
  const nCh = allChanEpochs.length;
  const nEp = allChanEpochs[0]!.length;
  const keep = new Array<boolean>(nEp).fill(true);

  for (let ch = 0; ch < nCh; ch++) {
    const epochs = allChanEpochs[ch]!;
    const stds = epochs.map(epochStd);
    const p2ps = epochs.map(epochPeakToPeak);

    const { q3: q3Std, iqrVal: iqrStd } = iqr(stds);
    const stdThresh = q3Std + 1.8 * iqrStd;

    const { q3: q3P2p, iqrVal: iqrP2p } = iqr(p2ps);
    const p2pThresh = Math.min(q3P2p + 1.8 * iqrP2p, 195);

    for (let ep = 0; ep < nEp; ep++) {
      if (stds[ep]! > stdThresh || p2ps[ep]! > p2pThresh) {
        keep[ep] = false;
      }
    }
  }
  return keep;
}

// ---------------------------------------------------------------------------
// Spectral coherence between two channels (single pair, one band)
// ---------------------------------------------------------------------------

function spectralCoherence(
  _sig1: Float64Array,
  _sig2: Float64Array,
  epochs: number[],
  allEpochs1: Float64Array[],
  allEpochs2: Float64Array[],
  lo: number,
  hi: number,
  fs: number,
): number {
  // Average cross-spectrum and auto-spectra across clean epochs
  const nfft = nextPow2(Math.round(EPOCH_LEN_SEC * fs));
  const nPos = Math.floor(nfft / 2) + 1;
  const crossRe = new Float64Array(nPos);
  const crossIm = new Float64Array(nPos);
  const auto1 = new Float64Array(nPos);
  const auto2 = new Float64Array(nPos);

  for (const ep of epochs) {
    const e1 = allEpochs1[ep]!;
    const e2 = allEpochs2[ep]!;
    const n = e1.length;

    const win = new Float64Array(n);
    for (let i = 0; i < n; i++) win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));

    const re1 = new Float64Array(nfft);
    const im1 = new Float64Array(nfft);
    const re2 = new Float64Array(nfft);
    const im2 = new Float64Array(nfft);
    for (let i = 0; i < n; i++) {
      re1[i] = e1[i]! * win[i]!;
      re2[i] = e2[i]! * win[i]!;
    }
    fft(re1, im1);
    fft(re2, im2);

    for (let k = 0; k < nPos; k++) {
      // cross = conj(X1) * X2
      crossRe[k] += re1[k]! * re2[k]! + im1[k]! * im2[k]!;
      crossIm[k] += re1[k]! * im2[k]! - im1[k]! * re2[k]!;
      auto1[k] += re1[k]! * re1[k]! + im1[k]! * im1[k]!;
      auto2[k] += re2[k]! * re2[k]! + im2[k]! * im2[k]!;
    }
  }

  const freqRes = fs / nfft;
  let numSum = 0, den1Sum = 0, den2Sum = 0;
  for (let k = 0; k < nPos; k++) {
    const f = k * freqRes;
    if (f >= lo && f <= hi) {
      numSum += crossRe[k]! * crossRe[k]! + crossIm[k]! * crossIm[k]!;
      den1Sum += auto1[k]!;
      den2Sum += auto2[k]!;
    }
  }
  if (den1Sum === 0 || den2Sum === 0) return 0;
  return Math.sqrt(numSum) / Math.sqrt(den1Sum * den2Sum);
}

// ---------------------------------------------------------------------------
// Permutation entropy (order=3)
// ---------------------------------------------------------------------------

function permEntropy(signal: Float64Array, order = 3): number {
  const n = signal.length;
  const counts = new Map<string, number>();
  let total = 0;
  for (let i = 0; i + order <= n; i++) {
    const seg = Array.from({ length: order }, (_, k) => signal[i + k]!) as number[];
    // Get rank pattern
    const idx = seg.map((_, j) => j).sort((a, b) => seg[a]! - seg[b]!);
    const key = idx.join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total++;
  }
  let H = 0;
  for (const c of counts.values()) {
    const p = c / total;
    H -= p * Math.log2(p);
  }
  // Normalize by log2(order!)
  let fact = 1;
  for (let i = 2; i <= order; i++) fact *= i;
  return H / Math.log2(fact);
}

// IQR-based outlier removal for a numeric array
function iqrFilter(vals: number[], r = 1.2): number[] {
  const { q1, q3, iqrVal } = iqr(vals);
  return vals.filter(v => v >= q1 - r * iqrVal && v <= q3 + r * iqrVal);
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

// ---------------------------------------------------------------------------
// Age from DOB string (YYYY-MM-DD)
// ---------------------------------------------------------------------------

export function ageFromDob(dob: string): number {
  if (!dob) return 25;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  ) age--;
  return Math.max(0, age);
}

// ---------------------------------------------------------------------------
// T-score normative tables (from brain_index.py)
// ---------------------------------------------------------------------------

interface Norm { mean: number; sd: number }

function tbrNorm(age: number): Norm {
  if (age < 6)  return { mean: 4.0,  sd: 0.667 };
  if (age < 13) return { mean: 3.25, sd: 0.833 };
  if (age < 19) return { mean: 2.25, sd: 0.5   };
  return              { mean: 1.65, sd: 0.433 };
}

function aprNorm(age: number): Norm {
  if (age < 6)  return { mean: 0.2,   sd: 0.067 };
  if (age < 13) return { mean: 0.225, sd: 0.05  };
  if (age < 19) return { mean: 0.275, sd: 0.05  };
  if (age < 36) return { mean: 0.3,   sd: 0.067 };
  if (age < 61) return { mean: 0.265, sd: 0.057 };
  return              { mean: 0.225, sd: 0.05  };
}

function faaNorm(_age: number): Norm {
  return { mean: 0, sd: 0.067 };
}

function pafNorm(age: number): Norm {
  if (age < 6)  return { mean: 6.75, sd: 0.5   };
  if (age < 13) return { mean: 8.25, sd: 0.5   };
  if (age < 19) return { mean: 9.25, sd: 0.5   };
  return              { mean: 10.0, sd: 0.667 };
}

function rsaNorm(age: number): Norm {
  if (age < 6)  return { mean: 25.0,  sd: 16.0  };
  if (age < 13) return { mean: 13.0,  sd: 6.67  };
  if (age < 19) return { mean: 8.5,   sd: 5.0   };
  if (age < 36) return { mean: 18.5,  sd: 11.67 };
  if (age < 61) return { mean: 13.0,  sd: 8.0   };
  return              { mean: 32.25, sd: 21.17 };
}

function cohNorm(age: number): Norm {
  if (age < 6)  return { mean: 0.35, sd: 0.1 };
  if (age < 13) return { mean: 0.55, sd: 0.1 };
  return              { mean: 0.65, sd: 0.1 };
}

function entpNorm(age: number): Norm {
  if (age < 6)  return { mean: 0.75, sd: 0.167 };
  if (age < 13) return { mean: 1.15, sd: 0.233 };
  return              { mean: 1.5,  sd: 0.333 };
}

function toTScore(value: number, norm: Norm): number {
  const z = (value - norm.mean) / norm.sd;
  return Math.min(99, Math.max(1, Math.round(z * 10 + 50)));
}

// ---------------------------------------------------------------------------
// Main analysis entry point
// ---------------------------------------------------------------------------

export async function analyzeEeg(
  samples: RecordedSample[],
  dob: string,
): Promise<ReportResult> {
  const fs = SAMPLE_RATE;
  const nSamples = samples.length;
  const durationSec = nSamples / fs;

  if (durationSec < MIN_DURATION_SEC) {
    return {
      indices: {} as BrainIndices,
      tscores: {} as TScores,
      age: ageFromDob(dob),
      cleanEpochs: 0,
      totalEpochs: 0,
      durationSec,
      error: `too_short:${durationSec.toFixed(1)}`,
    };
  }

  const age = ageFromDob(dob);
  const nCh = 8;

  // Extract per-channel signals
  const rawSignals: Float64Array[] = Array.from({ length: nCh }, (_, ch) => {
    const sig = new Float64Array(nSamples);
    for (let i = 0; i < nSamples; i++) sig[i] = samples[i]!.channels[ch] ?? 0;
    return sig;
  });

  // ----- Bandpass filter 1.5–45 Hz (main analysis) -----
  const filteredMain: Float64Array[] = rawSignals.map(s => bandpassFilter(s, 1.5, 45, fs));

  // ----- Bandpass filter 4–30 Hz (for EnTP) -----
  const filteredEntp: Float64Array[] = rawSignals.map(s => bandpassFilter(s, 4, 30, fs));

  // ----- Epoch all channels -----
  const allChanEpochs: Float64Array[][] = filteredMain.map(s => epochSignal(s, fs));
  const allChanEpochsEntp: Float64Array[][] = filteredEntp.map(s => epochSignal(s, fs));

  // Total epochs from first channel
  const rawEpochCount = allChanEpochs[0]!.length;

  // ----- Drop first and last CUTOFF_TRAIL epochs -----
  const validIdxAll = Array.from({ length: rawEpochCount }, (_, i) => i)
    .slice(CUTOFF_TRAIL, rawEpochCount - CUTOFF_TRAIL);

  if (validIdxAll.length === 0) {
    return {
      indices: {} as BrainIndices,
      tscores: {} as TScores,
      age,
      cleanEpochs: 0,
      totalEpochs: rawEpochCount,
      durationSec,
      error: 'too_few_epochs',
    };
  }

  // Slice to valid range
  const validEpochs: Float64Array[][] = allChanEpochs.map(chEps =>
    validIdxAll.map(i => chEps[i]!),
  );

  // ----- Bad-epoch removal -----
  const keepMask = removeBadEpochs(validEpochs);
  const cleanIdxLocal = keepMask.map((k, i) => k ? i : -1).filter(i => i >= 0);

  if (cleanIdxLocal.length < MIN_CLEAN_EPOCHS) {
    return {
      indices: {} as BrainIndices,
      tscores: {} as TScores,
      age,
      cleanEpochs: cleanIdxLocal.length,
      totalEpochs: rawEpochCount,
      durationSec,
      error: 'too_few_clean_epochs',
    };
  }

  // Map clean local indices back to global epoch indices (for coherence)
  const cleanGlobalIdx = cleanIdxLocal.map(i => validIdxAll[i]!);

  // ---------------------------------------------------------------------------
  // Per-channel, per-epoch band powers
  // bandPow[ch][ep][band]
  // ---------------------------------------------------------------------------
  const bandNames = Object.keys(BANDS) as BandName[];
  const bandPowAllCh: number[][][] = validEpochs.map((chEps) => {
    return cleanIdxLocal.map(epIdx => {
      const epoch = chEps[epIdx]!;
      const { freqs, power } = computePsd(epoch, fs);
      return bandNames.map(b => bandPower(freqs, power, BANDS[b][0], BANDS[b][1]));
    });
  });

  // Helper: mean band power for given channel set and band
  function meanBandPow(chIdxList: number[], bandIdx: number): number {
    const vals: number[] = [];
    for (const ch of chIdxList) {
      for (const epPow of bandPowAllCh[ch]!) {
        vals.push(epPow[bandIdx]!);
      }
    }
    if (vals.length === 0) return 0;
    const clean = iqrFilter(vals);
    return mean(clean.length > 0 ? clean : vals);
  }

  const bIdx = (name: BandName) => bandNames.indexOf(name);

  // ---------------------------------------------------------------------------
  // TBR — Theta/(Beta1+Beta2), at Fz+Pz
  // ---------------------------------------------------------------------------
  const tbrChannels = [CH.Fz, CH.Pz];
  const theta = meanBandPow(tbrChannels, bIdx('theta'));
  const beta1 = meanBandPow(tbrChannels, bIdx('beta1'));
  const beta2 = meanBandPow(tbrChannels, bIdx('beta2'));
  const TBR = theta / (beta1 + beta2 + 1e-12);

  // ---------------------------------------------------------------------------
  // APR — (Alpha1+Alpha2)/TotalPower, at T7+T8+Fz+Pz
  // ---------------------------------------------------------------------------
  const aprChannels = [CH.T7, CH.T8, CH.Fz, CH.Pz];
  const alpha1 = meanBandPow(aprChannels, bIdx('alpha1'));
  const alpha2 = meanBandPow(aprChannels, bIdx('alpha2'));
  const delta  = meanBandPow(aprChannels, bIdx('delta'));
  const theta2 = meanBandPow(aprChannels, bIdx('theta'));
  const b1     = meanBandPow(aprChannels, bIdx('beta1'));
  const b2     = meanBandPow(aprChannels, bIdx('beta2'));
  const gamma  = meanBandPow(aprChannels, bIdx('gamma'));
  const totalPow = delta + theta2 + alpha1 + alpha2 + b1 + b2 + gamma;
  const APR = (alpha1 + alpha2) / (totalPow + 1e-12);

  // ---------------------------------------------------------------------------
  // FAA — log10(F4_alpha / F3_alpha)
  // F3 ≈ (Fp1+Fz)/2, F4 ≈ (Fp2+Fz)/2
  // We compute per-epoch average
  // ---------------------------------------------------------------------------
  function epochAlpha(chIdx: number, epIdx: number): number {
    const pow = bandPowAllCh[chIdx]![epIdx]!;
    return (pow[bIdx('alpha1')]! + pow[bIdx('alpha2')]!) * 0.5;
  }
  const faaVals: number[] = cleanIdxLocal.map(ep => {
    const fp1A = epochAlpha(CH.Fp1, ep);
    const fp2A = epochAlpha(CH.Fp2, ep);
    const fzA  = epochAlpha(CH.Fz,  ep);
    const f3 = (fp1A + fzA) / 2;
    const f4 = (fp2A + fzA) / 2;
    return Math.log10((f4 + 1e-12) / (f3 + 1e-12));
  });
  const faaClean = iqrFilter(faaVals);
  const FAA = mean(faaClean.length > 0 ? faaClean : faaVals);

  // ---------------------------------------------------------------------------
  // PAF (Peak Alpha Frequency) — center of gravity at O1+O2
  // ---------------------------------------------------------------------------
  function pafRange(age: number): [number, number] {
    if (age < 6)  return [5,  9];
    if (age < 13) return [6, 10];
    if (age < 19) return [8, 12];
    return              [8, 13];
  }
  const [pafLo, pafHi] = pafRange(age);
  const pafChannels = [CH.O1, CH.O2];

  // Accumulate mean PSD across clean epochs × channels
  const nfftPaf = nextPow2(Math.round(EPOCH_LEN_SEC * fs));
  const nPosPaf = Math.floor(nfftPaf / 2) + 1;
  const avgPsd = new Float64Array(nPosPaf);
  let pafCount = 0;
  for (const ch of pafChannels) {
    for (const ep of cleanIdxLocal) {
      const epoch = validEpochs[ch]![ep]!;
      const { power } = computePsd(epoch, fs);
      for (let k = 0; k < nPosPaf; k++) avgPsd[k] += power[k]!;
      pafCount++;
    }
  }
  const freqRes = fs / nfftPaf;
  let cogNum = 0, cogDen = 0;
  for (let k = 0; k < nPosPaf; k++) {
    const f = k * freqRes;
    if (f >= pafLo && f <= pafHi) {
      cogNum += f * (avgPsd[k]! / pafCount);
      cogDen += avgPsd[k]! / pafCount;
    }
  }
  const PAF = cogDen > 1e-12 ? cogNum / cogDen : (pafLo + pafHi) / 2;

  // ---------------------------------------------------------------------------
  // RSA — Alpha1/Alpha2, O1+O2
  // ---------------------------------------------------------------------------
  const rsaChannels = [CH.O1, CH.O2];
  const rsaA1 = meanBandPow(rsaChannels, bIdx('alpha1'));
  const rsaA2 = meanBandPow(rsaChannels, bIdx('alpha2'));
  const RSA = rsaA1 / (rsaA2 + 1e-12);

  // ---------------------------------------------------------------------------
  // COH — spectral coherence, 4 channels × 5 bands
  // Channels: Fp1, Fp2, Fz, Pz; bands: theta, alpha1, alpha2, beta1, beta2
  // All pairs (4 choose 2 = 6) × 5 bands = 30 total; sum / 30
  // ---------------------------------------------------------------------------
  const cohChannels = [CH.Fp1, CH.Fp2, CH.Fz, CH.Pz];
  const cohBands: BandName[] = ['theta', 'alpha1', 'alpha2', 'beta1', 'beta2'];
  const cohPairs: [number, number][] = [];
  for (let i = 0; i < cohChannels.length; i++)
    for (let j = i + 1; j < cohChannels.length; j++)
      cohPairs.push([cohChannels[i]!, cohChannels[j]!]);

  let cohSum = 0;
  let cohN = 0;
  for (const [c1, c2] of cohPairs) {
    const eps1 = allChanEpochs[c1]!;
    const eps2 = allChanEpochs[c2]!;
    for (const band of cohBands) {
      const [lo, hi] = BANDS[band];
      const coh = spectralCoherence(
        filteredMain[c1]!,
        filteredMain[c2]!,
        cleanGlobalIdx,
        eps1,
        eps2,
        lo,
        hi,
        fs,
      );
      cohSum += coh;
      cohN++;
    }
  }
  const COH = cohN > 0 ? cohSum / cohN : 0;

  // ---------------------------------------------------------------------------
  // EnTP — permutation entropy (order=3), channels: O1,O2,Fz,Pz,T7,T8
  // ---------------------------------------------------------------------------
  const entpChList = [CH.O1, CH.O2, CH.Fz, CH.Pz, CH.T7, CH.T8];
  const entpValsByChannel: number[] = entpChList.map(ch => {
    const chEpsEntp = allChanEpochsEntp[ch]!;
    const epEntp = cleanGlobalIdx.map(i => chEpsEntp[i]!);
    const epVals = epEntp.map(ep => permEntropy(ep, 3));
    const clean = iqrFilter(epVals);
    return mean(clean.length > 0 ? clean : epVals);
  });
  const entpAllClean = iqrFilter(entpValsByChannel);
  const EnTP = mean(entpAllClean.length > 0 ? entpAllClean : entpValsByChannel);

  // ---------------------------------------------------------------------------
  // Assemble results
  // ---------------------------------------------------------------------------
  const indices: BrainIndices = { TBR, APR, FAA, PAF, RSA, COH, EnTP };

  const tscores: TScores = {
    TBR:  toTScore(TBR,  tbrNorm(age)),
    APR:  toTScore(APR,  aprNorm(age)),
    FAA:  toTScore(FAA,  faaNorm(age)),
    PAF:  toTScore(PAF,  pafNorm(age)),
    RSA:  toTScore(RSA,  rsaNorm(age)),
    COH:  toTScore(COH,  cohNorm(age)),
    EnTP: toTScore(EnTP, entpNorm(age)),
  };

  return {
    indices,
    tscores,
    age,
    cleanEpochs: cleanIdxLocal.length,
    totalEpochs: rawEpochCount,
    durationSec,
  };
}

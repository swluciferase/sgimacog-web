/**
 * eegArtifactRemoval.ts
 *
 * Sliding-window CCA-based EEG artifact removal.
 * Matches NoiseRemoval.EEG_AR from eeg_health SDK:
 *   windowsize=2 s, stepsize=0.5 s, eyeblinkTime=0.8 s, muscleNoiseLevel=0.9
 *
 * Algorithm (De Clercq et al. 2006 CCA approach):
 *   1. Pre-filter 0.5–45 Hz (applied to raw signal)
 *   2. Sliding 2-s window (step 0.5 s)
 *   3. CCA decomposition – maximise lag-1 temporal autocorrelation
 *   4. Remove components: autocorr < 0.9  (muscle noise)
 *                         delta ratio > 0.5 AND large peak (eye blink)
 *   5. Reconstruct & overlap-add with Hann weights
 */

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------
const WIN_SEC          = 2.0;
const STEP_SEC         = 0.5;
const MUSCLE_THRESHOLD = 0.9;     // lag-1 autocorr below this → remove
const BLINK_DELTA_THR  = 0.65;    // delta / total power fraction
const BLINK_PEAK_FACTOR = 6.0;    // peak > factor × RMS → confirm blink

// ---------------------------------------------------------------------------
// Minimal matrix library (row-major, dense, for ≤ 8×8)
// ---------------------------------------------------------------------------
type M = number[][];

function mz(r: number, c: number): M {
  return Array.from({ length: r }, () => new Array<number>(c).fill(0));
}
function mCopy(A: M): M { return A.map(r => [...r]); }
function mt(A: M): M {
  const T = mz(A[0].length, A.length);
  for (let i = 0; i < A.length; i++)
    for (let j = 0; j < A[0].length; j++) T[j][i] = A[i][j]!;
  return T;
}
function mm(A: M, B: M): M {
  const R = mz(A.length, B[0].length);
  for (let i = 0; i < A.length; i++)
    for (let k = 0; k < B.length; k++)
      for (let j = 0; j < B[0].length; j++)
        R[i][j] += A[i][k]! * B[k][j]!;
  return R;
}
// ---------------------------------------------------------------------------
// Cholesky L L^T (A must be symmetric positive semi-definite)
// ---------------------------------------------------------------------------
function chol(A: M): M {
  const n = A.length;
  const L = mz(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j]!;
      for (let k = 0; k < j; k++) s -= L[i][k]! * L[j][k]!;
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-16)) : s / (L[j][j]! || 1e-16);
    }
  }
  return L;
}

// Forward substitution  L x = b
function fwd(L: M, b: number[]): number[] {
  const n = b.length, x = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i][k]! * x[k]!;
    x[i] = s / (L[i][i]! || 1e-16);
  }
  return x;
}
// Backward substitution  L^T x = b
function bwd(L: M, b: number[]): number[] {
  const n = b.length, x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k][i]! * x[k]!;
    x[i] = s / (L[i][i]! || 1e-16);
  }
  return x;
}
// Solve  L X = B  (forward substitution only) for every column of B → returns L^{-1} B
function fwdSolveM(L: M, B: M): M {
  const n = L.length, nc = B[0].length;
  const X = mz(n, nc);
  for (let j = 0; j < nc; j++) {
    const bj = Array.from({ length: n }, (_, i) => B[i][j]!);
    const xj = fwd(L, bj);
    for (let i = 0; i < n; i++) X[i][j] = xj[i]!;
  }
  return X;
}

// ---------------------------------------------------------------------------
// Jacobi eigendecomposition for symmetric matrix
// Returns eigenvalues and eigenvectors (columns of vecs)
// ---------------------------------------------------------------------------
function jacobiSym(Ain: M): { vals: number[]; vecs: M } {
  const n = Ain.length;
  const D = mCopy(Ain);
  const V = mz(n, n);
  for (let i = 0; i < n; i++) V[i][i] = 1;
  for (let iter = 0; iter < 300 * n; iter++) {
    let maxAbs = 0, p = 0, q = 1;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = Math.abs(D[i][j]!);
        if (a > maxAbs) { maxAbs = a; p = i; q = j; }
      }
    if (maxAbs < 1e-12) break;
    const th = 0.5 * Math.atan2(2 * D[p][q]!, D[p][p]! - D[q][q]!);
    const c = Math.cos(th), s = Math.sin(th);
    const Dpp = c * c * D[p][p]! + 2 * s * c * D[p][q]! + s * s * D[q][q]!;
    const Dqq = s * s * D[p][p]! - 2 * s * c * D[p][q]! + c * c * D[q][q]!;
    D[p][p] = Dpp; D[q][q] = Dqq; D[p][q] = D[q][p] = 0;
    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const ip = c * D[i][p]! + s * D[i][q]!;
        const iq = -s * D[i][p]! + c * D[i][q]!;
        D[i][p] = D[p][i] = ip; D[i][q] = D[q][i] = iq;
      }
      const vip = c * V[i][p]! + s * V[i][q]!;
      const viq = -s * V[i][p]! + c * V[i][q]!;
      V[i][p] = vip; V[i][q] = viq;
    }
  }
  return { vals: D.map((r, i) => r[i]!), vecs: V };
}


// ---------------------------------------------------------------------------
// Simple FFT (Cooley-Tukey) + Hann-windowed PSD for band-power ratio
// ---------------------------------------------------------------------------
function nextPow2(n: number): number { let p = 1; while (p < n) p <<= 1; return p; }

function fftR2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
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
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k]!, ui = im[i + k]!;
        const vr = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci;
        const vi = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const tmp = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = tmp;
      }
    }
  }
}

/** Fraction of signal power in delta band (0.5–4 Hz) relative to 0.5–45 Hz */
function deltaFraction(signal: number[], fs: number): number {
  const n = signal.length;
  const nfft = nextPow2(n);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let winSum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    re[i] = signal[i]! * w;
    winSum += w * w;
  }
  fftR2(re, im);
  const freqRes = fs / nfft;
  const nPos = Math.floor(nfft / 2) + 1;
  let deltaPow = 0, totalPow = 0;
  for (let k = 0; k < nPos; k++) {
    const f = k * freqRes;
    const p = (re[k]! * re[k]! + im[k]! * im[k]!) / winSum;
    if (f >= 0.5 && f <= 45) totalPow += p;
    if (f >= 0.5 && f <= 4)  deltaPow += p;
  }
  return totalPow > 0 ? deltaPow / totalPow : 0;
}

/** RMS of signal */
function rms(signal: number[]): number {
  let s = 0;
  for (const v of signal) s += v * v;
  return Math.sqrt(s / signal.length);
}

/** Peak-to-median-absolute ratio (eye-blink indicator) */
function peakRmsRatio(signal: number[]): number {
  const r = rms(signal);
  if (r < 1e-12) return 0;
  const maxAbs = signal.reduce((mx, v) => Math.max(mx, Math.abs(v)), 0);
  return maxAbs / r;
}

// ---------------------------------------------------------------------------
// Pre-filter: 2nd-order Butterworth bandpass 0.5–45 Hz (zero-phase)
// (Inlined here so this file is self-contained)
// ---------------------------------------------------------------------------
function bwCoeffs(fc: number, fs: number, hp: boolean): [number[], number[]] {
  const k = Math.tan(Math.PI * fc / fs);
  const k2 = k * k, s2 = Math.SQRT2;
  const norm = 1 + s2 * k + k2;
  if (!hp) {
    return [[k2 / norm, 2 * k2 / norm, k2 / norm],
            [1, 2 * (k2 - 1) / norm, (1 - s2 * k + k2) / norm]];
  }
  return [[1 / norm, -2 / norm, 1 / norm],
          [1, 2 * (k2 - 1) / norm, (1 - s2 * k + k2) / norm]];
}
function iirOnce(x: Float64Array, b: number[], a: number[]): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = b[0]! * xi + b[1]! * x1 + b[2]! * x2 - a[1]! * y1 - a[2]! * y2;
    y[i] = yi; x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}
function zpFilter(x: Float64Array, b: number[], a: number[]): Float64Array {
  const fwd2 = iirOnce(x, b, a);
  const rev  = new Float64Array(fwd2.slice().reverse());
  const bk   = iirOnce(rev, b, a);
  return new Float64Array(bk.slice().reverse());
}
function prefilter(sig: Float64Array, fs: number): Float64Array {
  const [bh, ah] = bwCoeffs(0.5, fs, true);
  const [bl, al] = bwCoeffs(45,  fs, false);
  return zpFilter(zpFilter(sig, bh, ah), bl, al);
}

// ---------------------------------------------------------------------------
// CCA decomposition for a single window
// Returns unmixing W, inverse Winv, and sorted autocorrelations
// ---------------------------------------------------------------------------
function ccaWindow(
  X: Float64Array[],   // X[ch][t], all channels, all samples of this window
  nCh: number,
  nSamp: number,
): { W: M; Winv: M; autocorrs: number[] } | null {
  if (nSamp < nCh + 2) return null;

  // Center each channel
  const Xc: M = mz(nSamp, nCh);
  for (let ch = 0; ch < nCh; ch++) {
    let mu = 0;
    for (let t = 0; t < nSamp; t++) mu += X[ch][t]!;
    mu /= nSamp;
    for (let t = 0; t < nSamp; t++) Xc[t][ch] = X[ch][t]! - mu;
  }

  const n1 = nSamp - 1;
  const Cxx  = mz(nCh, nCh);
  const Csym = mz(nCh, nCh);
  for (let t = 0; t < n1; t++) {
    for (let i = 0; i < nCh; i++) {
      for (let j = 0; j < nCh; j++) {
        Cxx[i][j]  += Xc[t][i]! * Xc[t][j]!;
        const lag   = (Xc[t][i]! * Xc[t + 1][j]! + Xc[t + 1][i]! * Xc[t][j]!) * 0.5;
        Csym[i][j] += lag;
      }
    }
  }
  const scale = 1 / n1;
  for (let i = 0; i < nCh; i++)
    for (let j = 0; j < nCh; j++) {
      Cxx[i][j]  *= scale;
      Csym[i][j] *= scale;
    }

  // Regularise
  let tr = 0;
  for (let i = 0; i < nCh; i++) tr += Cxx[i][i]!;
  const reg = tr / nCh * 1e-5;
  for (let i = 0; i < nCh; i++) Cxx[i][i] += reg;

  // Cholesky of Cxx = L L^T
  const L = chol(Cxx);

  // Whitened symmetric problem: A = L^{-1} Csym L^{-T}
  // Step 1: C1 = L^{-1} Csym  (fwd only — NOT the full Cholesky solve)
  // Step 2: A  = L^{-1} C1^T  = L^{-1} (L^{-1} Csym)^T = L^{-1} Csym L^{-T}  (A is symmetric)
  const C1 = fwdSolveM(L, Csym);
  const A  = fwdSolveM(L, mt(C1));

  const { vals, vecs: V } = jacobiSym(A);

  // Sort descending by eigenvalue (≈ autocorrelation)
  const order = vals.map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v)
    .map(x => x.i);
  const autocorrs = order.map(i => vals[i]!);

  // Sorted eigenvectors
  const Vs = mz(nCh, nCh);
  for (let j = 0; j < nCh; j++)
    for (let i = 0; i < nCh; i++) Vs[i][j] = V[i][order[j]!]!;

  // Unmixing matrix: W = L^{-T} Vs  (solve L^T W[:,j] = Vs[:,j])
  const W = mz(nCh, nCh);
  for (let j = 0; j < nCh; j++) {
    const vs = Array.from({ length: nCh }, (_, i) => Vs[i][j]!);
    const wj = bwd(L, vs);
    for (let i = 0; i < nCh; i++) W[i][j] = wj[i]!;
  }

  // Analytical inverse: W = L^{-T} Vs  →  W^{-1} = Vs^T L^T  (stable, avoids Gauss–Jordan)
  const Winv = mm(mt(Vs), mt(L));
  return { W, Winv, autocorrs };
}

// ---------------------------------------------------------------------------
// Main: removeArtifacts
// ---------------------------------------------------------------------------

/**
 * Remove eye-blink and muscle artifacts using sliding-window CCA.
 *
 * @param signals  Per-channel signal arrays [ch][sample] (µV, raw/pre-filtered).
 * @param fs       Sample rate in Hz.
 * @returns        Cleaned signals in the same format.
 */
export function removeArtifacts(signals: Float64Array[], fs: number): Float64Array[] {
  const nCh   = signals.length;
  const nSamp = signals[0]!.length;
  if (nCh === 0 || nSamp === 0) return signals;

  // Step 1: Pre-filter each channel 0.5–45 Hz
  const filtered: Float64Array[] = signals.map(s => prefilter(s, fs));

  // Step 2: Prepare overlap-add accumulators
  const outSum    = Array.from({ length: nCh }, () => new Float64Array(nSamp));
  const weightSum = new Float64Array(nSamp);

  const winLen  = Math.round(WIN_SEC  * fs);
  const stepLen = Math.round(STEP_SEC * fs);

  // Hann window weights (for smooth blending)
  const hannWin = new Float64Array(winLen);
  for (let i = 0; i < winLen; i++)
    hannWin[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winLen - 1)));

  // Step 3: Process each window
  for (let start = 0; start + winLen <= nSamp; start += stepLen) {
    const end = start + winLen;

    // Extract window data per channel
    const winData: Float64Array[] = filtered.map(ch => ch.slice(start, end));

    // CCA decomposition
    const cca = ccaWindow(winData, nCh, winLen);
    if (!cca) {
      // fallback: keep raw window
      for (let ch = 0; ch < nCh; ch++)
        for (let t = 0; t < winLen; t++) {
          outSum[ch]![start + t]  += winData[ch]![t]! * hannWin[t]!;
          if (ch === 0) weightSum[start + t] += hannWin[t]!;
        }
      continue;
    }

    const { W, Winv, autocorrs } = cca;

    // Compute component time-series: S[t][j] = sum_ch Xc[t][ch] * W[ch][j]
    // Use centred data
    const compData: number[][] = Array.from({ length: nCh }, () => []);
    for (let t = 0; t < winLen; t++) {
      for (let j = 0; j < nCh; j++) {
        let s = 0;
        for (let ch = 0; ch < nCh; ch++) s += winData[ch]![t]! * W[ch][j]!;
        compData[j]!.push(s);
      }
    }

    // Identify artifact components
    const remove = new Array<boolean>(nCh).fill(false);
    for (let j = 0; j < nCh; j++) {
      const comp = compData[j]!;
      // Muscle noise: autocorrelation < threshold
      if (autocorrs[j]! < MUSCLE_THRESHOLD) {
        remove[j] = true;
        continue;
      }
      // Eye blink: high delta fraction + large peak (only first 2 components)
      if (j < 2) {
        if (rms(comp) < 0.1) continue;  // skip near-zero components
        const df = deltaFraction(comp, fs);
        if (df > BLINK_DELTA_THR && peakRmsRatio(comp) > BLINK_PEAK_FACTOR) {
          remove[j] = true;
        }
      }
    }

    // Zero artifact components
    const compClean: number[][] = compData.map((c, j) =>
      remove[j] ? new Array<number>(winLen).fill(0) : c,
    );

    // Reconstruct: X_clean[t][ch] = sum_j S_clean[t][j] * Winv[j][ch]
    // Winv rows = components, cols = channels
    for (let ch = 0; ch < nCh; ch++) {
      for (let t = 0; t < winLen; t++) {
        let val = 0;
        for (let j = 0; j < nCh; j++) val += compClean[j]![t]! * Winv[j][ch]!;
        outSum[ch]![start + t] += val * hannWin[t]!;
      }
    }
    for (let t = 0; t < winLen; t++) weightSum[start + t] += hannWin[t]!;
  }

  // Step 4: Normalise by overlap weights; fall back to filtered for edges
  const result: Float64Array[] = Array.from({ length: nCh }, (_, ch) => {
    const out = new Float64Array(nSamp);
    for (let t = 0; t < nSamp; t++) {
      const w = weightSum[t]!;
      out[t] = w > 1e-9 ? outSum[ch]![t]! / w : filtered[ch]![t]!;
    }
    return out;
  });

  return result;
}

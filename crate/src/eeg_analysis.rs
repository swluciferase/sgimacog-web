/// eeg_analysis.rs
/// Full EEG analysis pipeline compiled into WASM.
/// Normative tables and algorithm are not exposed in any public JS API.
#[allow(clippy::needless_range_loop)]

use crate::capability::compute_capability;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FS: f64          = 1001.0;
const EPOCH_LEN_SEC: f64 = 2.0;
const EPOCH_STEP_SEC: f64 = 0.5;
const CUTOFF_TRAIL: usize = 2;
const MIN_CLEAN_EPOCHS: usize = 5;
const MIN_DURATION_SEC: f64 = 90.0;
const N_CH: usize = 8;

const CH_FP1: usize = 0;
const CH_FP2: usize = 1;
const CH_T7:  usize = 2;
const CH_T8:  usize = 3;
const CH_O1:  usize = 4;
const CH_O2:  usize = 5;
const CH_FZ:  usize = 6;
const CH_PZ:  usize = 7;

// Band limits [lo, hi] Hz
const DELTA:  (f64,f64) = (1.5,  4.0);
const THETA:  (f64,f64) = (4.0,  8.0);
const ALPHA1: (f64,f64) = (8.0, 10.0);
const ALPHA2: (f64,f64) = (10.0,12.0);
const BETA1:  (f64,f64) = (12.0,20.0);
const BETA2:  (f64,f64) = (20.0,30.0);
const GAMMA:  (f64,f64) = (30.0,45.0);

const BANDS: [(f64,f64); 7] = [DELTA, THETA, ALPHA1, ALPHA2, BETA1, BETA2, GAMMA];
const B_DELTA:  usize = 0;
const B_THETA:  usize = 1;
const B_ALPHA1: usize = 2;
const B_ALPHA2: usize = 3;
const B_BETA1:  usize = 4;
const B_BETA2:  usize = 5;
const B_GAMMA:  usize = 6;

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------
pub struct BrainIndices {
    pub tbr:  f64,
    pub apr:  f64,
    pub faa:  f64,
    pub paf:  f64,
    pub rsa:  f64,
    pub coh:  f64,
    pub entp: f64,
}

pub struct TScores {
    pub tbr:  u32,
    pub apr:  u32,
    pub faa:  u32,
    pub paf:  u32,
    pub rsa:  u32,
    pub coh:  u32,
    pub entp: u32,
}

pub struct AnalysisResult {
    pub indices:      BrainIndices,
    pub tscores:      TScores,
    pub age:          u32,
    pub clean_epochs: usize,
    pub total_epochs: usize,
    pub duration_sec: f64,
    pub error:        Option<String>,
}

// ---------------------------------------------------------------------------
// FFT — in-place Cooley-Tukey radix-2 (DIT)
// ---------------------------------------------------------------------------
fn next_pow2(n: usize) -> usize {
    let mut p = 1usize;
    while p < n { p <<= 1; }
    p
}

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    // Bit-reversal permutation
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 { j ^= bit; bit >>= 1; }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    // Butterfly
    let mut len = 2usize;
    while len <= n {
        let ang = -2.0 * core::f64::consts::PI / len as f64;
        let w_re = ang.cos();
        let w_im = ang.sin();
        let mut i = 0;
        while i < n {
            let (mut cur_re, mut cur_im) = (1.0f64, 0.0f64);
            for k in 0..len/2 {
                let u_re = re[i+k];
                let u_im = im[i+k];
                let v_re = re[i+k+len/2]*cur_re - im[i+k+len/2]*cur_im;
                let v_im = re[i+k+len/2]*cur_im + im[i+k+len/2]*cur_re;
                re[i+k]        = u_re + v_re;
                im[i+k]        = u_im + v_im;
                re[i+k+len/2]  = u_re - v_re;
                im[i+k+len/2]  = u_im - v_im;
                let nr = cur_re*w_re - cur_im*w_im;
                cur_im = cur_re*w_im + cur_im*w_re;
                cur_re = nr;
            }
            i += len;
        }
        len <<= 1;
    }
}

// ---------------------------------------------------------------------------
// PSD — Hann-windowed, one-sided
// Returns (freqs, power)
// ---------------------------------------------------------------------------
fn compute_psd(signal: &[f64], fs: f64) -> (Vec<f64>, Vec<f64>) {
    let n = signal.len();
    let nfft = next_pow2(n);
    let mut win = vec![0.0f64; n];
    let mut win_pow = 0.0f64;
    for i in 0..n {
        win[i] = 0.5 * (1.0 - (2.0 * core::f64::consts::PI * i as f64 / (n - 1) as f64).cos());
        win_pow += win[i] * win[i];
    }
    let mut re = vec![0.0f64; nfft];
    let im = vec![0.0f64; nfft];
    for i in 0..n { re[i] = signal[i] * win[i]; }
    let mut re_fft = re;
    let mut im_fft = im;
    fft(&mut re_fft, &mut im_fft);

    let n_pos = nfft / 2 + 1;
    let mut freqs = vec![0.0f64; n_pos];
    let mut power = vec![0.0f64; n_pos];
    let scale = 1.0 / (win_pow * fs);
    for k in 0..n_pos {
        freqs[k] = (k as f64 * fs) / nfft as f64;
        let mag2 = re_fft[k]*re_fft[k] + im_fft[k]*im_fft[k];
        power[k] = mag2 * scale;
    }
    for k in 1..n_pos-1 { power[k] *= 2.0; }
    (freqs, power)
}

// ---------------------------------------------------------------------------
// Band power — trapezoidal rule with linearly-interpolated band edges.
// Interior bins use strict (lo, hi) to avoid double-counting boundary bins.
// End-points at exactly `lo` and `hi` are inserted via linear PSD
// interpolation so narrow bands (e.g. 2 Hz alpha sub-bands) are not
// systematically under-integrated at coarse frequency resolution.
// ---------------------------------------------------------------------------
fn band_power(freqs: &[f64], power: &[f64], lo: f64, hi: f64) -> f64 {
    let n = freqs.len();
    if n < 2 || hi <= lo { return 0.0; }
    let interp = |f: f64| -> f64 {
        if f <= freqs[0] { return power[0]; }
        if f >= freqs[n - 1] { return power[n - 1]; }
        for k in 0..n - 1 {
            if freqs[k + 1] >= f {
                let t = (f - freqs[k]) / (freqs[k + 1] - freqs[k]);
                return power[k] * (1.0 - t) + power[k + 1] * t;
            }
        }
        power[n - 1]
    };
    let mut xs: Vec<f64> = Vec::with_capacity(n + 2);
    let mut ys: Vec<f64> = Vec::with_capacity(n + 2);
    xs.push(lo);
    ys.push(interp(lo));
    for k in 0..n {
        if freqs[k] > lo && freqs[k] < hi {
            xs.push(freqs[k]);
            ys.push(power[k]);
        }
    }
    xs.push(hi);
    ys.push(interp(hi));
    let mut sum = 0.0;
    for i in 0..xs.len() - 1 {
        sum += 0.5 * (ys[i] + ys[i + 1]) * (xs[i + 1] - xs[i]);
    }
    sum
}

// ---------------------------------------------------------------------------
// 2nd-order Butterworth IIR via bilinear transform
// ---------------------------------------------------------------------------
fn butterworth_coeffs(fc: f64, fs: f64, highpass: bool) -> ([f64;3],[f64;3]) {
    let w0 = 2.0 * core::f64::consts::PI * fc / fs;
    let k  = (w0 / 2.0).tan();
    let k2 = k * k;
    let sqrt2 = core::f64::consts::SQRT_2;
    let (b, a) = if !highpass {
        let norm = 1.0 + sqrt2*k + k2;
        (
            [k2/norm, 2.0*k2/norm, k2/norm],
            [1.0, (2.0*(k2-1.0))/norm, (1.0-sqrt2*k+k2)/norm],
        )
    } else {
        let norm = 1.0 + sqrt2*k + k2;
        (
            [1.0/norm, -2.0/norm, 1.0/norm],
            [1.0, (2.0*(k2-1.0))/norm, (1.0-sqrt2*k+k2)/norm],
        )
    };
    (b, a)
}

fn filter_once(signal: &[f64], b: &[f64;3], a: &[f64;3]) -> Vec<f64> {
    let mut out = vec![0.0f64; signal.len()];
    let (mut x1, mut x2, mut y1, mut y2) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
    for i in 0..signal.len() {
        let x0 = signal[i];
        let y0 = b[0]*x0 + b[1]*x1 + b[2]*x2 - a[1]*y1 - a[2]*y2;
        out[i] = y0;
        x2=x1; x1=x0; y2=y1; y1=y0;
    }
    out
}

fn filter_zero_phase(signal: &[f64], b: &[f64;3], a: &[f64;3]) -> Vec<f64> {
    let fwd = filter_once(signal, b, a);
    let mut rev: Vec<f64> = fwd.iter().rev().cloned().collect();
    let bwd = filter_once(&rev.clone(), b, a);
    rev = bwd.iter().rev().cloned().collect();
    rev
}

fn bandpass_filter(signal: &[f64], lo: f64, hi: f64, fs: f64) -> Vec<f64> {
    let (bh, ah) = butterworth_coeffs(lo, fs, true);
    let (bl, al) = butterworth_coeffs(hi, fs, false);
    filter_zero_phase(&filter_zero_phase(signal, &bh, &ah), &bl, &al)
}

// ---------------------------------------------------------------------------
// Epoching
// ---------------------------------------------------------------------------
fn epoch_signal(signal: &[f64], fs: f64) -> Vec<Vec<f64>> {
    let epoch_len = (EPOCH_LEN_SEC * fs).round() as usize;
    let step_len  = (EPOCH_STEP_SEC * fs).round() as usize;
    let mut epochs = Vec::new();
    let mut start = 0;
    while start + epoch_len <= signal.len() {
        epochs.push(signal[start..start+epoch_len].to_vec());
        start += step_len;
    }
    epochs
}

// ---------------------------------------------------------------------------
// IQR helpers
// ---------------------------------------------------------------------------
fn iqr_stats(arr: &[f64]) -> (f64, f64, f64, f64) {
    let mut sorted = arr.to_vec();
    sorted.sort_by(|a,b| a.partial_cmp(b).unwrap());
    let n = sorted.len();
    let q1  = sorted[n / 4];
    let q3  = sorted[n * 3 / 4];
    let med = sorted[n / 2];
    (q1, q3, q3 - q1, med)
}

fn epoch_std(epoch: &[f64]) -> f64 {
    let n = epoch.len() as f64;
    let mean = epoch.iter().sum::<f64>() / n;
    let var  = epoch.iter().map(|&v| (v-mean)*(v-mean)).sum::<f64>() / n;
    var.sqrt()
}

fn epoch_p2p(epoch: &[f64]) -> f64 {
    let lo = epoch.iter().cloned().fold(f64::INFINITY, f64::min);
    let hi = epoch.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    hi - lo
}

fn remove_bad_epochs(chan_epochs: &[Vec<Vec<f64>>]) -> Vec<bool> {
    let n_ch = chan_epochs.len();
    let n_ep = chan_epochs[0].len();
    let mut keep = vec![true; n_ep];
    for ch in 0..n_ch {
        let epochs = &chan_epochs[ch];
        let stds: Vec<f64> = epochs.iter().map(|e| epoch_std(e)).collect();
        let p2ps: Vec<f64> = epochs.iter().map(|e| epoch_p2p(e)).collect();
        let (_, q3s, iqrs, _) = iqr_stats(&stds);
        let (_, q3p, iqrp, _) = iqr_stats(&p2ps);
        let std_thresh = q3s + 1.8 * iqrs;
        let p2p_thresh = (q3p + 1.8 * iqrp).min(195.0);
        for ep in 0..n_ep {
            if stds[ep] > std_thresh || p2ps[ep] > p2p_thresh {
                keep[ep] = false;
            }
        }
    }
    keep
}

// ---------------------------------------------------------------------------
// Spectral coherence — multi-epoch averaged
// ---------------------------------------------------------------------------
fn spectral_coherence(
    clean_idx: &[usize],
    eps1: &[Vec<f64>],
    eps2: &[Vec<f64>],
    lo: f64, hi: f64, fs: f64,
) -> f64 {
    let nfft = next_pow2((EPOCH_LEN_SEC * fs).round() as usize);
    let n_pos = nfft / 2 + 1;
    let mut cross_re = vec![0.0f64; n_pos];
    let mut cross_im = vec![0.0f64; n_pos];
    let mut auto1    = vec![0.0f64; n_pos];
    let mut auto2    = vec![0.0f64; n_pos];

    for &ep in clean_idx {
        let e1 = &eps1[ep];
        let e2 = &eps2[ep];
        let n = e1.len();
        let mut win = vec![0.0f64; n];
        for i in 0..n {
            win[i] = 0.5 * (1.0 - (2.0*core::f64::consts::PI*i as f64/(n-1) as f64).cos());
        }
        let mut r1 = vec![0.0f64; nfft]; let mut i1 = vec![0.0f64; nfft];
        let mut r2 = vec![0.0f64; nfft]; let mut i2 = vec![0.0f64; nfft];
        for i in 0..n { r1[i] = e1[i]*win[i]; r2[i] = e2[i]*win[i]; }
        fft(&mut r1, &mut i1);
        fft(&mut r2, &mut i2);
        for k in 0..n_pos {
            cross_re[k] += r1[k]*r2[k] + i1[k]*i2[k];
            cross_im[k] += r1[k]*i2[k] - i1[k]*r2[k];
            auto1[k]    += r1[k]*r1[k] + i1[k]*i1[k];
            auto2[k]    += r2[k]*r2[k] + i2[k]*i2[k];
        }
    }
    let freq_res = fs / nfft as f64;
    let (mut num, mut d1, mut d2) = (0.0f64, 0.0f64, 0.0f64);
    for k in 0..n_pos {
        let f = k as f64 * freq_res;
        if f >= lo && f <= hi {
            num += cross_re[k]*cross_re[k] + cross_im[k]*cross_im[k];
            d1  += auto1[k];
            d2  += auto2[k];
        }
    }
    if d1 == 0.0 || d2 == 0.0 { return 0.0; }
    num.sqrt() / (d1 * d2).sqrt()
}

// ---------------------------------------------------------------------------
// Sample Entropy (Richman & Moorman 2000) — m=2, r=0.2·SD of the epoch.
// `decimate` subsamples the signal by a fixed stride before the pair
// comparisons (pre-filtered 4–30 Hz, so ≥60 Hz effective rate is aliasing-
// safe). At 1001 Hz a stride of 4 brings the effective rate to ≈250 Hz,
// matching the rate at which the normative table was established.
// Returns SampEn = -ln(A/B) where B counts m-length template matches and
// A counts (m+1)-length matches, both at Chebyshev tolerance r.
// ---------------------------------------------------------------------------
fn sample_entropy(signal: &[f64], m: usize, decimate: usize) -> f64 {
    let stride = decimate.max(1);
    let ds: Vec<f64> = signal.iter().step_by(stride).copied().collect();
    let n = ds.len();
    if n <= m + 1 { return 0.0; }

    let mean = ds.iter().sum::<f64>() / n as f64;
    let var = ds.iter().map(|&v| (v - mean) * (v - mean)).sum::<f64>() / n as f64;
    let sd = var.sqrt();
    if sd < 1e-12 { return 0.0; }
    let r = 0.2 * sd;

    let n_vec = n - m;
    let mut b_count: u64 = 0;
    let mut a_count: u64 = 0;

    for i in 0..n_vec {
        for j in (i + 1)..n_vec {
            let mut max_d = 0.0f64;
            let mut exceeded = false;
            for k in 0..m {
                let d = (ds[i + k] - ds[j + k]).abs();
                if d > max_d {
                    max_d = d;
                    if max_d > r { exceeded = true; break; }
                }
            }
            if exceeded { continue; }
            b_count += 1;
            let d_extra = (ds[i + m] - ds[j + m]).abs();
            if d_extra <= r { a_count += 1; }
        }
    }

    if b_count == 0 || a_count == 0 { return 0.0; }
    -((a_count as f64) / (b_count as f64)).ln()
}

fn iqr_filter(vals: &[f64], r: f64) -> Vec<f64> {
    if vals.is_empty() { return vec![]; }
    let (q1, q3, iqrv, _) = iqr_stats(vals);
    vals.iter().cloned().filter(|&v| v >= q1 - r*iqrv && v <= q3 + r*iqrv).collect()
}

fn mean(arr: &[f64]) -> f64 {
    if arr.is_empty() { return 0.0; }
    arr.iter().sum::<f64>() / arr.len() as f64
}

fn mean_filtered(arr: &[f64]) -> f64 {
    let clean = iqr_filter(arr, 1.2);
    mean(if clean.is_empty() { arr } else { &clean })
}

// ---------------------------------------------------------------------------
// T-score normative tables (private — compiled into WASM binary)
// ---------------------------------------------------------------------------
// Norms below assume eyes-closed (EC) resting-state recording.
// Means from the reference summary table (APR EC / COH F-P); SDs set as
// range/3 ≈ ±1.5σ to match the document's "normal range" convention.
fn tbr_norm(age: u32) -> (f64, f64) {
    if age < 6  { (4.0,  0.667) }
    else if age < 13 { (3.0,  0.667) }
    else if age < 19 { (2.25, 0.5)   }
    else             { (1.75, 0.5)   }
}
fn apr_norm(age: u32) -> (f64, f64) {
    if age < 6  { (0.20, 0.067) }
    else if age < 13 { (0.30, 0.067) }
    else if age < 19 { (0.35, 0.067) }
    else             { (0.40, 0.067) }
}
fn faa_norm(age: u32) -> (f64, f64) {
    if age < 13 { (0.0, 0.067) }    // doc ±0.1 for 3-12 y/o
    else        { (0.0, 0.033) }    // doc ±0.05 for ≥13 y/o
}
fn paf_norm(age: u32) -> (f64, f64) {
    if age < 6  { (6.75, 0.5)   }
    else if age < 13 { (8.25, 0.5)   }
    else if age < 19 { (9.25, 0.5)   }
    else             { (10.0, 0.667) }
}
fn rsa_norm(age: u32) -> (f64, f64) {
    if age < 6  { (25.0,  16.0)  }
    else if age < 13 { (13.0,  6.67)  }
    else if age < 19 { (8.5,   5.0)   }
    else if age < 36 { (18.5,  11.67) }
    else if age < 61 { (13.0,  8.0)   }
    else             { (32.25, 21.17) }
}
// COH: frontal-parietal pairs only (Fp1-Pz, Fp2-Pz, Fz-Pz) — see coh_pairs.
fn coh_norm(age: u32) -> (f64, f64) {
    if age < 6  { (0.30, 0.067) }
    else if age < 13 { (0.50, 0.067) }
    else             { (0.60, 0.067) }
}
fn entp_norm(age: u32) -> (f64, f64) {
    if age < 6  { (0.75, 0.167) }
    else if age < 13 { (1.15, 0.233) }
    else             { (1.5,  0.333) }
}

fn to_t(value: f64, norm: (f64, f64)) -> u32 {
    let z = (value - norm.0) / norm.1;
    let t = z * 10.0 + 50.0;
    t.round().clamp(1.0, 99.0) as u32
}

fn paf_range(age: u32) -> (f64, f64) {
    if age < 6  { (5.0,  9.0) }
    else if age < 13 { (6.0, 10.0) }
    else if age < 19 { (8.0, 12.0) }
    else             { (8.0, 13.0) }
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------
pub fn analyze_eeg_internal(
    samples_flat: &[f32],
    age: u32,
) -> AnalysisResult {
    let n_samples = samples_flat.len() / N_CH;
    let duration_sec = n_samples as f64 / FS;

    let error_result = |err: &str, clean: usize, total: usize| AnalysisResult {
        indices: BrainIndices { tbr:0.0,apr:0.0,faa:0.0,paf:0.0,rsa:0.0,coh:0.0,entp:0.0 },
        tscores: TScores      { tbr:50,apr:50,faa:50,paf:50,rsa:50,coh:50,entp:50 },
        age, clean_epochs: clean, total_epochs: total,
        duration_sec, error: Some(err.to_string()),
    };

    if duration_sec < MIN_DURATION_SEC {
        let s = format!("too_short:{:.1}", duration_sec);
        return error_result(&s, 0, 0);
    }

    // ── Extract per-channel signals ──────────────────────────────
    let mut raw: Vec<Vec<f64>> = (0..N_CH)
        .map(|ch| (0..n_samples).map(|i| samples_flat[i*N_CH+ch] as f64).collect())
        .collect();

    // ── Bandpass filter: 1.5–45 Hz (main), 4–30 Hz (EnTP) ───────
    let filt_main: Vec<Vec<f64>> = raw.iter_mut()
        .map(|s| bandpass_filter(s, 1.5, 45.0, FS))
        .collect();
    let filt_entp: Vec<Vec<f64>> = raw.iter()
        .map(|s| bandpass_filter(s, 4.0, 30.0, FS))
        .collect();

    // ── Epoch all channels ───────────────────────────────────────
    let chan_epochs: Vec<Vec<Vec<f64>>> = filt_main.iter()
        .map(|s| epoch_signal(s, FS))
        .collect();
    let chan_epochs_entp: Vec<Vec<Vec<f64>>> = filt_entp.iter()
        .map(|s| epoch_signal(s, FS))
        .collect();

    let raw_epoch_count = chan_epochs[0].len();
    let total_epochs = raw_epoch_count;

    // ── Drop CUTOFF_TRAIL from start and end ─────────────────────
    if raw_epoch_count <= CUTOFF_TRAIL * 2 {
        return error_result("too_few_epochs", 0, total_epochs);
    }
    let valid_idx: Vec<usize> = (CUTOFF_TRAIL..raw_epoch_count - CUTOFF_TRAIL).collect();

    let valid_epochs: Vec<Vec<Vec<f64>>> = chan_epochs.iter()
        .map(|ch_eps| valid_idx.iter().map(|&i| ch_eps[i].clone()).collect())
        .collect();

    // ── Bad-epoch removal ────────────────────────────────────────
    let keep_mask = remove_bad_epochs(&valid_epochs);
    let clean_local: Vec<usize> = keep_mask.iter().enumerate()
        .filter(|(_,&k)| k).map(|(i,_)| i).collect();

    if clean_local.len() < MIN_CLEAN_EPOCHS {
        return error_result("too_few_clean_epochs", clean_local.len(), total_epochs);
    }

    // Map back to global epoch indices (for coherence)
    let clean_global: Vec<usize> = clean_local.iter().map(|&i| valid_idx[i]).collect();

    // ── Per-channel, per-epoch band powers ───────────────────────
    // band_pow[ch][ep][band]
    let band_pow: Vec<Vec<[f64;7]>> = valid_epochs.iter().map(|ch_eps| {
        clean_local.iter().map(|&ep| {
            let epoch = &ch_eps[ep];
            let (freqs, power) = compute_psd(epoch, FS);
            let mut bp = [0.0f64; 7];
            for b in 0..7 {
                bp[b] = band_power(&freqs, &power, BANDS[b].0, BANDS[b].1);
            }
            bp
        }).collect()
    }).collect();

    // Helper: mean band power over a set of channels
    let mean_band = |chs: &[usize], band: usize| -> f64 {
        let vals: Vec<f64> = chs.iter().flat_map(|&ch| {
            band_pow[ch].iter().map(|bp| bp[band])
        }).collect();
        mean_filtered(&vals)
    };

    // ── TBR (Fz + Pz) ───────────────────────────────────────────
    let tbr_ch = [CH_FZ, CH_PZ];
    let theta  = mean_band(&tbr_ch, B_THETA);
    let beta1  = mean_band(&tbr_ch, B_BETA1);
    let beta2  = mean_band(&tbr_ch, B_BETA2);
    let TBR    = theta / (beta1 + beta2 + 1e-12);

    // ── APR (T7 + T8 + Fz + Pz) ─────────────────────────────────
    let apr_ch  = [CH_T7, CH_T8, CH_FZ, CH_PZ];
    let a1      = mean_band(&apr_ch, B_ALPHA1);
    let a2      = mean_band(&apr_ch, B_ALPHA2);
    let delta   = mean_band(&apr_ch, B_DELTA);
    let theta2  = mean_band(&apr_ch, B_THETA);
    let b1      = mean_band(&apr_ch, B_BETA1);
    let b2      = mean_band(&apr_ch, B_BETA2);
    let gamma   = mean_band(&apr_ch, B_GAMMA);
    let total_pow = delta + theta2 + a1 + a2 + b1 + b2 + gamma;
    let APR     = (a1 + a2) / (total_pow + 1e-12);

    // ── FAA — log10(F4 alpha / F3 alpha) ─────────────────────────
    // F3 ≈ (Fp1 + Fz) / 2,  F4 ≈ (Fp2 + Fz) / 2
    let epoch_alpha = |ch: usize, pos: usize| -> f64 {
        let bp = &band_pow[ch][pos];
        (bp[B_ALPHA1] + bp[B_ALPHA2]) * 0.5
    };
    let faa_vals: Vec<f64> = (0..clean_local.len()).map(|pos| {
        let fp1_a = epoch_alpha(CH_FP1, pos);
        let fp2_a = epoch_alpha(CH_FP2, pos);
        let fz_a  = epoch_alpha(CH_FZ,  pos);
        let f3 = (fp1_a + fz_a) / 2.0;
        let f4 = (fp2_a + fz_a) / 2.0;
        ((f4 + 1e-12) / (f3 + 1e-12)).log10()
    }).collect();
    let FAA = mean_filtered(&faa_vals);

    // ── PAF — center of gravity in alpha band, O1 + O2 ───────────
    let (paf_lo, paf_hi) = paf_range(age);
    let paf_ch = [CH_O1, CH_O2];
    let nfft_paf = next_pow2((EPOCH_LEN_SEC * FS).round() as usize);
    let n_pos_paf = nfft_paf / 2 + 1;
    let mut avg_psd = vec![0.0f64; n_pos_paf];
    let mut paf_count = 0usize;
    for &ch in &paf_ch {
        for &loc in &clean_local {
            let epoch = &valid_epochs[ch][loc];
            let (_, power) = compute_psd(epoch, FS);
            for k in 0..n_pos_paf { avg_psd[k] += power[k]; }
            paf_count += 1;
        }
    }
    let freq_res = FS / nfft_paf as f64;
    let (mut cog_num, mut cog_den) = (0.0f64, 0.0f64);
    for k in 0..n_pos_paf {
        let f = k as f64 * freq_res;
        if f >= paf_lo && f <= paf_hi {
            let p = avg_psd[k] / paf_count as f64;
            cog_num += f * p;
            cog_den += p;
        }
    }
    let PAF = if cog_den > 1e-12 { cog_num / cog_den } else { (paf_lo + paf_hi) / 2.0 };

    // ── RSA — alpha1/alpha2, O1 + O2 ────────────────────────────
    let rsa_ch = [CH_O1, CH_O2];
    let rsa_a1 = mean_band(&rsa_ch, B_ALPHA1);
    let rsa_a2 = mean_band(&rsa_ch, B_ALPHA2);
    let RSA    = rsa_a1 / (rsa_a2 + 1e-12);

    // ── COH — 3 frontal–parietal pairs × 5 bands ───────────────
    // Fp1-Pz, Fp2-Pz, Fz-Pz  (doc: 前-頂葉同調性, F-P column).
    // Intra-frontal pairs (Fp1-Fp2, Fp1-Fz, Fp2-Fz) and language (Broca-
    // Wernicke) pairs are intentionally excluded.
    let coh_pairs = [(CH_FP1, CH_PZ), (CH_FP2, CH_PZ), (CH_FZ, CH_PZ)];
    let coh_bands = [THETA, ALPHA1, ALPHA2, BETA1, BETA2];
    let mut coh_sum = 0.0f64;
    let mut coh_n   = 0u32;
    for &(c1, c2) in &coh_pairs {
        for &(lo, hi) in &coh_bands {
            let c = spectral_coherence(
                &clean_global,
                &chan_epochs[c1], &chan_epochs[c2],
                lo, hi, FS,
            );
            coh_sum += c;
            coh_n   += 1;
        }
    }
    let COH = if coh_n > 0 { coh_sum / coh_n as f64 } else { 0.0 };

    // ── EnTP — sample entropy (m=2, r=0.2·SD), 6 channels, 4-30 Hz filtered,
    //     decimated 4× (≈250 Hz) to match the normative table's convention ─
    let entp_ch = [CH_O1, CH_O2, CH_FZ, CH_PZ, CH_T7, CH_T8];
    let entp_by_ch: Vec<f64> = entp_ch.iter().map(|&ch| {
        let ep_entp: Vec<Vec<f64>> = chan_epochs_entp[ch].clone();
        let vals: Vec<f64> = clean_global.iter()
            .map(|&gi| sample_entropy(&ep_entp[gi], 2, 4))
            .collect();
        mean_filtered(&vals)
    }).collect();
    let EnTP = mean_filtered(&entp_by_ch);

    // ── T-scores ─────────────────────────────────────────────────
    let t_tbr  = to_t(TBR,  tbr_norm(age));
    let t_apr  = to_t(APR,  apr_norm(age));
    let t_faa  = to_t(FAA,  faa_norm(age));
    let t_paf  = to_t(PAF,  paf_norm(age));
    let t_rsa  = to_t(RSA,  rsa_norm(age));
    // COH: raw T then sqrt transform
    let t_coh_raw = to_t(COH, coh_norm(age));
    let t_coh = ((t_coh_raw as f64).sqrt() * 10.0).round().clamp(1.0, 99.0) as u32;
    let t_entp = to_t(EnTP, entp_norm(age));

    AnalysisResult {
        indices: BrainIndices { tbr: TBR, apr: APR, faa: FAA, paf: PAF, rsa: RSA, coh: COH, entp: EnTP },
        tscores: TScores      { tbr: t_tbr, apr: t_apr, faa: t_faa, paf: t_paf, rsa: t_rsa, coh: t_coh, entp: t_entp },
        age,
        clean_epochs: clean_local.len(),
        total_epochs,
        duration_sec,
        error: None,
    }
}

// ---------------------------------------------------------------------------
// JSON serialisation (no serde dependency)
// ---------------------------------------------------------------------------
pub fn result_to_json(r: &AnalysisResult) -> String {
    if let Some(ref err) = r.error {
        return format!(
            r#"{{"error":"{}","age":{},"cleanEpochs":{},"totalEpochs":{},"durationSec":{:.2}}}"#,
            err, r.age, r.clean_epochs, r.total_epochs, r.duration_sec
        );
    }
    let i = &r.indices;
    let t = &r.tscores;

    // Capability profile
    let cap_opt = compute_capability(
        t.tbr, t.apr, t.faa, t.paf, t.rsa, t.coh, t.entp, r.age,
    );
    let cap_json = if let Some(dims) = cap_opt {
        let fields: Vec<String> = dims.iter()
            .map(|d| format!(r#""{}": {:.2}"#, d.name, d.score))
            .collect();
        format!("{{{}}}", fields.join(","))
    } else {
        "{}".to_string()
    };

    format!(
        r#"{{"indices":{{"TBR":{:.4},"APR":{:.4},"FAA":{:.4},"PAF":{:.2},"RSA":{:.4},"COH":{:.4},"EnTP":{:.4}}},"tscores":{{"TBR":{},"APR":{},"FAA":{},"PAF":{},"RSA":{},"COH":{},"EnTP":{}}},"capability":{},"age":{},"cleanEpochs":{},"totalEpochs":{},"durationSec":{:.2}}}"#,
        i.tbr, i.apr, i.faa, i.paf, i.rsa, i.coh, i.entp,
        t.tbr, t.apr, t.faa, t.paf, t.rsa, t.coh, t.entp,
        cap_json,
        r.age, r.clean_epochs, r.total_epochs, r.duration_sec,
    )
}

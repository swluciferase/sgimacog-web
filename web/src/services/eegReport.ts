/**
 * eegReport.ts
 * EEG analysis pipeline — thin TypeScript wrapper around the WASM module.
 * Algorithm, normative data, and capability formulas are compiled into WASM.
 */

import type { RecordedSample } from './csvWriter';
import { wasmService } from './wasm';
import { removeArtifacts } from './eegArtifactRemoval';

// ---------------------------------------------------------------------------
// Public interfaces (unchanged — callers see the same types)
// ---------------------------------------------------------------------------

export const SAMPLE_RATE = 1001; // Hz

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
  indices:     BrainIndices;
  tscores:     TScores;
  capability:  Record<string, number>; // dim name → score (age-dependent, from WASM)
  age:         number;
  cleanEpochs: number;
  totalEpochs: number;
  durationSec: number;
  error?:      string;
}

// ---------------------------------------------------------------------------
// Age helper (needed by callers that pass DOB)
// ---------------------------------------------------------------------------

/**
 * Fractional age in years (precision to days) — required by GAMLSS continuous
 * normative models. e.g. a child born 2013-06-15 on 2026-04-20 → 12.85 years.
 */
export function ageFromDob(dob: string): number {
  if (!dob) return 25;
  const birth = new Date(dob);
  const now   = new Date();
  const ms    = now.getTime() - birth.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const years = ms / (365.2425 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(years * 100) / 100);
}

// ---------------------------------------------------------------------------
// Main entry — delegates to WASM
// ---------------------------------------------------------------------------

/**
 * Linear-interpolation resampling of 8-channel flat buffer.
 * inRate → SAMPLE_RATE (1001 Hz).
 */
function resampleFlat(flat: Float32Array, nIn: number, inRate: number): Float32Array {
  const nOut = Math.round(nIn * SAMPLE_RATE / inRate);
  const out = new Float32Array(nOut * 8);
  for (let i = 0; i < nOut; i++) {
    const srcF = i * inRate / SAMPLE_RATE;
    const srcLo = Math.min(Math.floor(srcF), nIn - 1);
    const srcHi = Math.min(srcLo + 1, nIn - 1);
    const frac = srcF - srcLo;
    for (let ch = 0; ch < 8; ch++) {
      out[i * 8 + ch] =
        flat[srcLo * 8 + ch]! * (1 - frac) +
        flat[srcHi * 8 + ch]! * frac;
    }
  }
  return out;
}

export async function analyzeEeg(
  samples: RecordedSample[],
  dob: string,
  channelIndices: number[] = [0, 1, 2, 3, 4, 5, 6, 7],
  inputSampleRate: number = SAMPLE_RATE,
): Promise<ReportResult> {
  await wasmService.init();

  const age      = ageFromDob(dob);
  const nSamples = samples.length;

  // Build flat interleaved Float32Array using the specified channel indices
  let flat = new Float32Array(nSamples * 8);
  for (let i = 0; i < nSamples; i++) {
    const chs = samples[i]!.channels;
    for (let ch = 0; ch < 8; ch++) {
      flat[i * 8 + ch] = chs[channelIndices[ch]!] ?? 0;
    }
  }

  // Resample to SAMPLE_RATE if input rate differs
  if (inputSampleRate !== SAMPLE_RATE) {
    flat = resampleFlat(flat, nSamples, inputSampleRate);
  }

  // CCA-based artifact removal (eye-blink + muscle) before WASM analysis.
  // Applied unconditionally for every report — both live-stream and offline CSV.
  const nResampled = flat.length / 8;
  const perCh: Float64Array[] = [];
  for (let ch = 0; ch < 8; ch++) {
    const arr = new Float64Array(nResampled);
    for (let i = 0; i < nResampled; i++) arr[i] = flat[i * 8 + ch]!;
    perCh.push(arr);
  }
  const cleaned = removeArtifacts(perCh, SAMPLE_RATE);
  for (let i = 0; i < nResampled; i++) {
    for (let ch = 0; ch < 8; ch++) {
      flat[i * 8 + ch] = cleaned[ch]![i]!;
    }
  }

  // Call WASM
  const jsonStr: string = (wasmService.api as unknown as {
    analyze_eeg: (samples: Float32Array, age: number) => string;
  }).analyze_eeg(flat, age);

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch {
    return {
      indices: {} as BrainIndices, tscores: {} as TScores, capability: {},
      age, cleanEpochs: 0, totalEpochs: 0,
      durationSec: nSamples / SAMPLE_RATE, error: 'wasm_parse_error',
    };
  }

  if (parsed['error']) {
    return {
      indices: {} as BrainIndices, tscores: {} as TScores,
      capability: (parsed['capability'] as Record<string, number>) ?? {},
      age:         (parsed['age']         as number) ?? age,
      cleanEpochs: (parsed['cleanEpochs'] as number) ?? 0,
      totalEpochs: (parsed['totalEpochs'] as number) ?? 0,
      durationSec: (parsed['durationSec'] as number) ?? nSamples / SAMPLE_RATE,
      error:        parsed['error'] as string,
    };
  }

  // NOTE: WASM already applies the sqrt·10 transform to COH inside to_t().
  // A previous post-processing step here applied sqrt again to COH and also
  // (incorrectly) to EnTP, inflating both T-scores (a normal z=0 subject
  // landed at ~84 for COH, ~71 for EnTP instead of 50). The transform is now
  // authoritatively handled in WASM, so just pass the scores through.
  const tscores = parsed['tscores'] as TScores;

  return {
    indices:     parsed['indices']     as BrainIndices,
    tscores,
    capability:  (parsed['capability'] as Record<string, number>) ?? {},
    age:         (parsed['age']        as number) ?? age,
    cleanEpochs:  parsed['cleanEpochs'] as number,
    totalEpochs:  parsed['totalEpochs'] as number,
    durationSec:  parsed['durationSec'] as number,
  };
}

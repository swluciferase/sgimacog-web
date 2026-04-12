/**
 * eegReport.ts
 * EEG analysis pipeline — thin TypeScript wrapper around the WASM module.
 * Algorithm, normative data, and capability formulas are compiled into WASM.
 */

import type { RecordedSample } from './csvWriter';
import { wasmService } from './wasm';

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

export function ageFromDob(dob: string): number {
  if (!dob) return 25;
  const birth = new Date(dob);
  const now   = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  ) age--;
  return Math.max(0, age);
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
  _useArtifactRemoval = false,
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

  const tscores = parsed['tscores'] as TScores;
  tscores.COH  = Math.round(Math.sqrt(tscores.COH)  * 10);
  tscores.EnTP = Math.round(Math.sqrt(tscores.EnTP) * 10);

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

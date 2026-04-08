/**
 * csvParser.ts
 * Parse the Cygnus/sgimacog CSV format back into RecordedSample[].
 *
 * CSV format (from csvWriter.ts):
 *   Lines 1-10: header metadata
 *   Line 11:    column headers
 *   Lines 12+:  data rows
 *
 * Columns: Timestamp, Serial Number, Fp1, Fp2, T7, T8, O1, O2, Fz, Pz,
 *          Event Id, Event Date, Event Duration, Software Marker, Software Marker Name
 */

import type { RecordedSample } from './csvWriter';

export interface CsvParseResult {
  samples: RecordedSample[];
  deviceId: string;
  recordDatetime: string;
  filterDesc: string;
  notchDesc: string;
  sampleRate: number;
  name: string;
  sex: string;
  error?: string;
}

/**
 * Parse CSV text (as produced by generateCsv) into samples + metadata.
 */
export function parseCsv(text: string): CsvParseResult {
  // Normalise line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length < 12) {
    return { samples: [], deviceId: '', recordDatetime: '', filterDesc: '', notchDesc: '', sampleRate: 1000, name: '', sex: '', error: 'csv_too_short' };
  }

  // ── Parse header block (up to 20 lines to support both old and new format) ──
  const headerLines = lines.slice(0, 20);
  const get = (prefix: string) => {
    const line = headerLines.find(l => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
  };

  const recordDatetime = get('Record datetime:');
  const deviceId       = get('Device ID:');
  const filterDesc     = get('Bandpass filter:');
  const notchDesc      = get('Notch filter:');
  const name           = get('Subject name:');
  const sex            = get('Subject sex:');

  // Detect sample rate from header ("Device sampling rate: 1000 samples/second")
  const srLine = get('Device sampling rate:');
  const srMatch = srLine.match(/(\d+)/);
  const sampleRate = srMatch ? parseInt(srMatch[1]!, 10) : 1000;

  // ── Find column header line by scanning for "Timestamp" (supports both old 10-line and new 12-line header) ──
  let colHeaderIdx = 10; // default for old format
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    if (lines[i]!.trim().startsWith('Timestamp')) { colHeaderIdx = i; break; }
  }
  const colHeader = lines[colHeaderIdx]!;
  const cols = colHeader.split(',').map(c => c.trim());
  // Expected channel indices
  const tsIdx  = cols.indexOf('Timestamp');
  const snIdx  = cols.indexOf('Serial Number');
  const fp1Idx = cols.indexOf('Fp1');
  const evtIdx = cols.indexOf('Event Id');
  const evtNameIdx = cols.indexOf('Software Marker Name');

  if (tsIdx === -1 || fp1Idx === -1) {
    return { samples: [], deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, name, sex, error: 'csv_bad_header' };
  }

  const chStart = fp1Idx; // Fp1, Fp2, T7, T8, O1, O2, Fz, Pz = 8 channels

  // ── Parse data rows ────────────────────────────────────────────────────────
  const samples: RecordedSample[] = [];
  for (let i = colHeaderIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < chStart + 8) continue;

    const ts = parseFloat(parts[tsIdx]!);
    if (isNaN(ts)) continue;

    const sn = snIdx >= 0 ? parseInt(parts[snIdx]!, 10) : null;
    const serialNumber = isNaN(sn as number) ? null : sn;

    const channels = new Float32Array(8);
    for (let ch = 0; ch < 8; ch++) {
      const v = parseFloat(parts[chStart + ch]!);
      channels[ch] = isNaN(v) ? 0 : v;
    }

    const eventId   = evtIdx >= 0 ? (parts[evtIdx]!.trim() || undefined) : undefined;
    const eventName = evtNameIdx >= 0 ? (parts[evtNameIdx]!.trim() || undefined) : undefined;

    samples.push({ timestamp: ts, serialNumber, channels, eventId, eventName });
  }

  if (samples.length === 0) {
    return { samples, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, name, sex, error: 'csv_no_data' };
  }

  return { samples, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, name, sex };
}

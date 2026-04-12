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
  channelLabels: string[];
  deviceId: string;
  recordDatetime: string;
  filterDesc: string;
  notchDesc: string;
  sampleRate: number;
  error?: string;
}

/**
 * Parse CSV text (as produced by generateCsv) into samples + metadata.
 */
export function parseCsv(text: string): CsvParseResult {
  // Normalise line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (lines.length < 12) {
    return { samples: [], deviceId: '', recordDatetime: '', filterDesc: '', notchDesc: '', sampleRate: 1000, error: 'csv_too_short' };
  }

  // ── Parse header block (lines 1–10) ──────────────────────────────────────
  const headerLines = lines.slice(0, 10);
  const get = (prefix: string) => {
    const line = headerLines.find(l => l.startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : '';
  };

  const recordDatetime = get('Record datetime:');
  const deviceId       = get('Device ID:');
  const filterDesc     = get('Bandpass filter:');
  const notchDesc      = get('Notch filter:');

  // Detect sample rate from header ("Device sampling rate: 1000 samples/second")
  const srLine = get('Device sampling rate:');
  const srMatch = srLine.match(/(\d+)/);
  const sampleRate = srMatch ? parseInt(srMatch[1]!, 10) : 1000;

  // ── Verify column header line (line 11, index 10) ────────────────────────
  const colHeader = lines[10]!;
  const cols = colHeader.split(',').map(c => c.trim());
  // Expected channel indices
  const tsIdx  = cols.indexOf('Timestamp');
  const snIdx  = cols.indexOf('Serial Number');
  const fp1Idx = cols.indexOf('Fp1');
  const evtIdx = cols.indexOf('Event Id');
  const evtNameIdx = cols.indexOf('Software Marker Name');

  if (tsIdx === -1 || fp1Idx === -1) {
    return { samples: [], channelLabels: [], deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, error: 'csv_bad_header' };
  }

  // Determine number of channels: from Fp1 up to (but not including) Event Id
  const chStart = fp1Idx;
  const nch = evtIdx > chStart ? evtIdx - chStart : 8;
  const channelLabels = cols.slice(chStart, chStart + nch);

  // ── Parse data rows ────────────────────────────────────────────────────────
  const samples: RecordedSample[] = [];
  for (let i = 11; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length < chStart + nch) continue;

    const ts = parseFloat(parts[tsIdx]!);
    if (isNaN(ts)) continue;

    const sn = snIdx >= 0 ? parseInt(parts[snIdx]!, 10) : null;
    const serialNumber = isNaN(sn as number) ? null : sn;

    const channels = new Float32Array(nch);
    for (let ch = 0; ch < nch; ch++) {
      const v = parseFloat(parts[chStart + ch]!);
      channels[ch] = isNaN(v) ? 0 : v;
    }

    const eventId   = evtIdx >= 0 ? (parts[evtIdx]!.trim() || undefined) : undefined;
    const eventName = evtNameIdx >= 0 ? (parts[evtNameIdx]!.trim() || undefined) : undefined;

    samples.push({ timestamp: ts, serialNumber, channels, eventId, eventName });
  }

  if (samples.length === 0) {
    return { samples, channelLabels, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, error: 'csv_no_data' };
  }

  return { samples, channelLabels, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate };
}

/**
 * csvParser.ts
 * Parse the Cygnus/sgimacog CSV format back into RecordedSample[].
 *
 * CSV format (from csvWriter.ts):
 *   Lines 1-10: header metadata
 *   Line 11:    column headers
 *   Lines 12+:  data rows
 *
 * Columns:
 *   Timestamp, Serial Number, <channel labels...>,
 *   Event Id              — hardware event byte (TLV Tag 7), 1..255 or empty
 *   Event Date            — wallclock for hardware event row
 *   Event Duration        — reserved (always empty)
 *   Software Marker       — software marker numeric ID (e.g. "1101"); legacy CSVs may have "1"
 *   Software Marker Name  — software marker label
 *
 * Backward-compat: when `Software Marker == "1"`, treat as legacy format
 * (Event Id was the software ID; remap into softwareMarkerId).
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
  const tsIdx          = cols.indexOf('Timestamp');
  const snIdx          = cols.indexOf('Serial Number');
  const fp1Idx         = cols.indexOf('Fp1');
  const evtIdIdx       = cols.indexOf('Event Id');
  const swMarkerIdx    = cols.indexOf('Software Marker');
  const swMarkerNmIdx  = cols.indexOf('Software Marker Name');

  if (tsIdx === -1 || fp1Idx === -1) {
    return { samples: [], channelLabels: [], deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, error: 'csv_bad_header' };
  }

  const chStart = fp1Idx;
  const nch = evtIdIdx > chStart ? evtIdIdx - chStart : 8;
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

    const eventIdRaw  = evtIdIdx >= 0 ? parts[evtIdIdx]!.trim() : '';
    const swMarkerRaw = swMarkerIdx >= 0 ? parts[swMarkerIdx]!.trim() : '';
    const swMarkerNm  = swMarkerNmIdx >= 0 ? (parts[swMarkerNmIdx]!.trim() || undefined) : undefined;

    let hardwareEvent: number | undefined;
    let softwareMarkerId: string | undefined;
    const softwareMarkerName: string | undefined = swMarkerNm;

    if (swMarkerRaw === '1') {
      // Legacy format: `Software Marker = "1"` flag means Event Id was a software marker ID.
      softwareMarkerId = eventIdRaw || undefined;
    } else {
      // New format: Event Id is the hardware event byte; Software Marker holds software ID.
      if (eventIdRaw) {
        const n = parseInt(eventIdRaw, 10);
        if (!isNaN(n) && n >= 1 && n <= 255) hardwareEvent = n;
      }
      if (swMarkerRaw) softwareMarkerId = swMarkerRaw;
    }

    samples.push({ timestamp: ts, serialNumber, channels, hardwareEvent, softwareMarkerId, softwareMarkerName });
  }

  if (samples.length === 0) {
    return { samples, channelLabels, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate, error: 'csv_no_data' };
  }

  return { samples, channelLabels, deviceId, recordDatetime, filterDesc, notchDesc, sampleRate };
}

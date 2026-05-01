export interface RecordedSample {
  timestamp: number;        // seconds from recording start
  serialNumber: number | null;
  channels: Float32Array;   // raw µV values (unfiltered)
  /** Hardware event byte (TLV Tag 7), 1..255 when set; undefined when no event in this sample. */
  hardwareEvent?: number;
  /** Software marker numeric ID as string (e.g. "1101"). Comes from BroadcastChannel marker. */
  softwareMarkerId?: string;
  /** Software marker label string (e.g. "stim_target"). Comes from BroadcastChannel marker. */
  softwareMarkerName?: string;
}

const pad2 = (n: number) => n.toString().padStart(2, '0');
const pad3 = (n: number) => n.toString().padStart(3, '0');

function formatDatetime(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`
  );
}

export function generateCsv(
  samples: RecordedSample[],
  startTime: Date,
  deviceId: string,
  filterDesc: string,
  notchDesc: string,
  channelLabels?: string[],
  sampleRate?: number,
): string {
  return generateCsvHeader(startTime, deviceId, filterDesc, notchDesc, channelLabels, sampleRate)
    + generateCsvRows(samples, startTime, channelLabels);
}

function generateCsvHeader(
  startTime: Date,
  deviceId: string,
  filterDesc: string,
  notchDesc: string,
  channelLabels?: string[],
  sampleRate?: number,
): string {
  const chHeaders = (channelLabels ?? ['Fp1', 'Fp2', 'T7', 'T8', 'O1', 'O2', 'Fz', 'Pz']).join(',');
  const lines: string[] = [];
  lines.push('Cygnus version: 0.28.0.7,File version: 2021.11');
  lines.push('Operative system: Browser');
  lines.push(`Record datetime: ${formatDatetime(startTime)}`);
  lines.push(`Device ID: ${deviceId || 'STEEG_UNKNOWN'}`);
  lines.push('Device version: ');
  lines.push('Device bandwidth: DC to 131 Hz');
  lines.push(`Device sampling rate: ${sampleRate ?? 1000} samples/second`);
  lines.push('Data type / unit: EEG / micro-volt (uV)');
  lines.push(`Bandpass filter: ${filterDesc}`);
  lines.push(`Notch filter: ${notchDesc}`);
  lines.push(
    `Timestamp,Serial Number,${chHeaders},Event Id,Event Date,Event Duration,Software Marker,Software Marker Name`,
  );
  return lines.join('\r\n') + '\r\n';
}

function generateCsvRows(
  samples: RecordedSample[],
  startTime: Date,
  channelLabels?: string[],
): string {
  const nch = channelLabels?.length ?? (samples[0]?.channels.length ?? 8);
  const lines: string[] = [];
  for (const sample of samples) {
    const ts = sample.timestamp.toFixed(3);
    const sn = sample.serialNumber !== null ? sample.serialNumber.toString() : '';
    const ch = Array.from({ length: nch }, (_, i) =>
      sample.channels[i] !== undefined ? sample.channels[i]!.toFixed(4) : '0.0000',
    ).join(',');
    const hwEvent = sample.hardwareEvent != null ? String(sample.hardwareEvent) : '';
    const eventDate = sample.hardwareEvent != null
      ? formatDatetime(new Date(startTime.getTime() + sample.timestamp * 1000))
      : '';
    const swMarker = sample.softwareMarkerId ?? '';
    const swMarkerName = sample.softwareMarkerName ?? '';
    lines.push(`${ts},${sn},${ch},${hwEvent},${eventDate},,${swMarker},${swMarkerName}`);
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * Build CSV as a Blob in chunks to avoid allocating one massive string.
 * Peak memory ≈ CHUNK_SIZE rows worth of string (~5 MB) instead of the full file.
 */
export function generateCsvBlob(
  samples: RecordedSample[],
  startTime: Date,
  deviceId: string,
  filterDesc: string,
  notchDesc: string,
  channelLabels?: string[],
  sampleRate?: number,
): Blob {
  const CHUNK_SIZE = 50_000;
  const parts: BlobPart[] = [];
  parts.push(generateCsvHeader(startTime, deviceId, filterDesc, notchDesc, channelLabels, sampleRate));
  for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
    const slice = samples.slice(i, i + CHUNK_SIZE);
    parts.push(generateCsvRows(slice, startTime, channelLabels));
  }
  return new Blob(parts, { type: 'text/csv;charset=utf-8;' });
}

export function downloadCsvBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  downloadCsvBlob(blob, filename);
}

export function buildCsvFilename(subjectId: string, startTime: Date): string {
  const y = startTime.getFullYear();
  const mo = pad2(startTime.getMonth() + 1);
  const d = pad2(startTime.getDate());
  const h = pad2(startTime.getHours());
  const mi = pad2(startTime.getMinutes());
  const s = pad2(startTime.getSeconds());
  const id = subjectId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'subject';
  return `${id}_${y}${mo}${d}_${h}${mi}${s}.csv`;
}

/**
 * Build a CSV filename with custom-name or device-based logic.
 * - customName set  → `${customName}_${HHmmss}.csv`
 * - customName empty → `recording${deviceSuffix}_${YYYYMMDD}_${HHmmss}.csv`
 */
export function buildCsvFilenameCustom(
  customName: string,
  deviceId: string | null,
  startTime: Date,
): string {
  const y = startTime.getFullYear();
  const mo = pad2(startTime.getMonth() + 1);
  const d = pad2(startTime.getDate());
  const h = pad2(startTime.getHours());
  const mi = pad2(startTime.getMinutes());
  const s = pad2(startTime.getSeconds());
  const safe = (str: string) => str.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
  if (customName.trim()) {
    return `${safe(customName.trim())}_${h}${mi}${s}.csv`;
  }
  const suffix = deviceId?.replace(/^STEEG_/, '') ?? '';
  return `recording${suffix}_${y}${mo}${d}_${h}${mi}${s}.csv`;
}

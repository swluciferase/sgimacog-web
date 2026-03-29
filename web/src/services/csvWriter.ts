import type { SubjectInfo } from '../types/eeg';

export interface RecordedSample {
  timestamp: number;        // seconds from recording start
  serialNumber: number | null;
  channels: Float32Array;   // 8 raw µV values (unfiltered)
  eventId?: string;
  eventName?: string;
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
  subjectInfo: SubjectInfo,
  startTime: Date,
  deviceId: string,
  filterDesc: string,
  notchDesc: string,
): string {
  const lines: string[] = [];

  // Header block — matches Cygnus format exactly
  lines.push('Cygnus version: 0.28.0.7,File version: 2021.11');
  lines.push('Operative system: Browser');
  lines.push(`Record datetime: ${formatDatetime(startTime)}`);
  lines.push(`Device ID: ${deviceId || 'STEEG_UNKNOWN'}`);
  lines.push('Device version: ');
  lines.push('Device bandwidth: DC to 131 Hz');
  lines.push('Device sampling rate: 1000 samples/second');
  lines.push('Data type / unit: EEG / micro-volt (uV)');
  lines.push(`Bandpass filter: ${filterDesc}`);
  lines.push(`Notch filter: ${notchDesc}`);

  // Subject info comment lines (non-standard extension, harmless)
  if (subjectInfo.id) lines.push(`Subject ID: ${subjectInfo.id}`);
  if (subjectInfo.name) lines.push(`Subject Name: ${subjectInfo.name}`);
  if (subjectInfo.age) lines.push(`Subject Age: ${subjectInfo.age}`);
  if (subjectInfo.sex) lines.push(`Subject Sex: ${subjectInfo.sex}`);
  if (subjectInfo.notes) lines.push(`Notes: ${subjectInfo.notes}`);

  // Column headers
  lines.push(
    'Timestamp,Serial Number,Fp1,Fp2,T7,T8,O1,O2,Fz,Pz,Event Id,Event Date,Event Duration,Software Marker,Software Marker Name',
  );

  // Data rows
  for (const sample of samples) {
    const ts = sample.timestamp.toFixed(3);
    const sn = sample.serialNumber !== null ? sample.serialNumber.toString() : '';
    const ch = Array.from({ length: 8 }, (_, i) =>
      sample.channels[i] !== undefined ? sample.channels[i]!.toFixed(4) : '0.0000',
    ).join(',');

    const eventId = sample.eventId ?? '';
    const eventDate = sample.eventId ? formatDatetime(new Date(startTime.getTime() + sample.timestamp * 1000)) : '';
    const eventDuration = '';
    const softwareMarker = sample.eventId ? '1' : '';
    const softwareMarkerName = sample.eventName ?? '';

    lines.push(`${ts},${sn},${ch},${eventId},${eventDate},${eventDuration},${softwareMarker},${softwareMarkerName}`);
  }

  return lines.join('\r\n') + '\r\n';
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

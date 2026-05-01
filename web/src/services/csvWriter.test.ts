import { describe, it, expect } from 'vitest';
import { generateCsv, type RecordedSample } from './csvWriter';

const startTime = new Date('2026-05-01T12:34:56.789Z');

const sampleNoEvent = (ts: number): RecordedSample => ({
  timestamp: ts,
  serialNumber: 1000 + ts,
  channels: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]),
});

const sampleHardware = (ts: number, value: number): RecordedSample => ({
  ...sampleNoEvent(ts),
  hardwareEvent: value,
});

const sampleSoftware = (ts: number, id: string, name: string): RecordedSample => ({
  ...sampleNoEvent(ts),
  softwareMarkerId: id,
  softwareMarkerName: name,
});

describe('generateCsv — event column mapping', () => {
  it('writes empty Event Id / Software Marker for plain samples', () => {
    const csv = generateCsv([sampleNoEvent(0)], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    // Last 5 columns: Event Id, Event Date, Event Duration, Software Marker, Software Marker Name
    const tail = cols.slice(-5);
    expect(tail).toEqual(['', '', '', '', '']);
  });

  it('writes hardware event byte into Event Id and timestamp into Event Date', () => {
    const csv = generateCsv([sampleHardware(0.5, 42)], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    expect(tail[0]).toBe('42');                           // Event Id
    expect(tail[1]).not.toBe('');                         // Event Date filled
    expect(tail[2]).toBe('');                             // Event Duration empty
    expect(tail[3]).toBe('');                             // Software Marker empty
    expect(tail[4]).toBe('');                             // Software Marker Name empty
  });

  it('writes software marker ID into Software Marker and name into Software Marker Name', () => {
    const csv = generateCsv([sampleSoftware(0.5, '1101', 'stim_target')], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    expect(tail[0]).toBe('');                             // Event Id (hardware) empty
    expect(tail[1]).toBe('');                             // Event Date empty
    expect(tail[3]).toBe('1101');                         // Software Marker = ID
    expect(tail[4]).toBe('stim_target');                  // Software Marker Name
  });

  it('writes both columns when both hardware and software present on the same sample', () => {
    const sample: RecordedSample = {
      ...sampleNoEvent(1),
      hardwareEvent: 5,
      softwareMarkerId: '1101',
      softwareMarkerName: 'stim_target',
    };
    const csv = generateCsv([sample], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    expect(tail[0]).toBe('5');
    expect(tail[3]).toBe('1101');
    expect(tail[4]).toBe('stim_target');
  });

  it('Option B: uses hardwareEventWallclock for Event Date when set (broadcast alignment)', () => {
    // A fixed Unix ms that is different from startTime + timestamp
    // startTime = 2026-05-01T12:34:56.789Z  (ms = 1746102896789)
    // timestamp = 0.5 s  → fallback date would be startTime + 500ms
    // We supply a different wallclock to prove the field is used instead.
    const originWallclock = new Date('2026-05-01T08:00:00.000Z').getTime(); // distinct value
    const sample: RecordedSample = {
      ...sampleNoEvent(0.5),
      hardwareEvent: 5,
      hardwareEventWallclock: originWallclock,
    };
    const csv = generateCsv([sample], startTime, 'STEEG_X', 'BP', 'NOTCH');
    const dataRow = csv.trim().split('\r\n').pop()!;
    const cols = dataRow.split(',');
    const tail = cols.slice(-5);
    // Event Id
    expect(tail[0]).toBe('5');
    // Event Date must reflect originWallclock, NOT startTime + 0.5s
    // originWallclock = 2026-05-01T08:00:00.000Z
    // The formatter uses local time; we parse back to verify the ms value instead.
    const eventDateStr = tail[1];
    expect(eventDateStr).not.toBe('');
    // Verify it does NOT equal the fallback (startTime + 0.5 s = startTime + 500ms)
    const fallbackDate = new Date(startTime.getTime() + 0.5 * 1000);
    const fallbackStr = [
      `${fallbackDate.getFullYear()}-`,
      String(fallbackDate.getMonth() + 1).padStart(2, '0'), '-',
      String(fallbackDate.getDate()).padStart(2, '0'), ' ',
      String(fallbackDate.getHours()).padStart(2, '0'), ':',
      String(fallbackDate.getMinutes()).padStart(2, '0'), ':',
      String(fallbackDate.getSeconds()).padStart(2, '0'), '.',
      String(fallbackDate.getMilliseconds()).padStart(3, '0'),
    ].join('');
    expect(eventDateStr).not.toBe(fallbackStr);
    // And must equal the formatted originWallclock
    const wc = new Date(originWallclock);
    const wcStr = [
      `${wc.getFullYear()}-`,
      String(wc.getMonth() + 1).padStart(2, '0'), '-',
      String(wc.getDate()).padStart(2, '0'), ' ',
      String(wc.getHours()).padStart(2, '0'), ':',
      String(wc.getMinutes()).padStart(2, '0'), ':',
      String(wc.getSeconds()).padStart(2, '0'), '.',
      String(wc.getMilliseconds()).padStart(3, '0'),
    ].join('');
    expect(eventDateStr).toBe(wcStr);
  });
});

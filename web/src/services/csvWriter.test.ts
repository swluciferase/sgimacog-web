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
});

import { describe, it, expect } from 'vitest';
import { parseCsv } from './csvParser';
import { generateCsv, type RecordedSample } from './csvWriter';

const startTime = new Date('2026-05-01T12:34:56.789Z');

const baseSample = (ts: number): RecordedSample => ({
  timestamp: ts,
  serialNumber: 1,
  channels: new Float32Array([0, 0, 0, 0, 0, 0, 0, 0]),
});

describe('parseCsv — new format roundtrip', () => {
  it('parses hardware event from Event Id column', () => {
    const samples: RecordedSample[] = [{ ...baseSample(0.1), hardwareEvent: 7 }];
    const csv = generateCsv(samples, startTime, 'STEEG_X', 'BP', 'NOTCH');
    const out = parseCsv(csv);
    expect(out.samples).toHaveLength(1);
    expect(out.samples[0]!.hardwareEvent).toBe(7);
    expect(out.samples[0]!.softwareMarkerId).toBeUndefined();
    expect(out.samples[0]!.softwareMarkerName).toBeUndefined();
  });

  it('parses software marker from Software Marker columns', () => {
    const samples: RecordedSample[] = [{
      ...baseSample(0.1),
      softwareMarkerId: '1101',
      softwareMarkerName: 'stim_target',
    }];
    const csv = generateCsv(samples, startTime, 'STEEG_X', 'BP', 'NOTCH');
    const out = parseCsv(csv);
    expect(out.samples[0]!.hardwareEvent).toBeUndefined();
    expect(out.samples[0]!.softwareMarkerId).toBe('1101');
    expect(out.samples[0]!.softwareMarkerName).toBe('stim_target');
  });

  it('parses plain sample (no events) as all-undefined', () => {
    const samples: RecordedSample[] = [baseSample(0.1)];
    const csv = generateCsv(samples, startTime, 'STEEG_X', 'BP', 'NOTCH');
    const out = parseCsv(csv);
    expect(out.samples[0]!.hardwareEvent).toBeUndefined();
    expect(out.samples[0]!.softwareMarkerId).toBeUndefined();
    expect(out.samples[0]!.softwareMarkerName).toBeUndefined();
  });
});

describe('parseCsv — old format backward compatibility', () => {
  // Old CSVs (pre-2026-05-01) used `Event Id = software marker ID` and `Software Marker = "1"` flag.
  // New parser must detect this and remap into softwareMarkerId / softwareMarkerName.
  it('reads old CSV: Event Id was software ID, Software Marker was "1" flag', () => {
    const oldCsv = [
      'Cygnus version: 0.28.0.7,File version: 2021.11',
      'Operative system: Browser',
      'Record datetime: 2026-04-30 10:00:00.000',
      'Device ID: STEEG_OLD',
      'Device version: ',
      'Device bandwidth: DC to 131 Hz',
      'Device sampling rate: 1000 samples/second',
      'Data type / unit: EEG / micro-volt (uV)',
      'Bandpass filter: 1-45',
      'Notch filter: 60',
      'Timestamp,Serial Number,Fp1,Fp2,T7,T8,O1,O2,Fz,Pz,Event Id,Event Date,Event Duration,Software Marker,Software Marker Name',
      '0.100,1,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1101,2026-04-30 10:00:00.100,,1,stim_target',
    ].join('\r\n') + '\r\n';
    const out = parseCsv(oldCsv);
    expect(out.samples).toHaveLength(1);
    // Old `Event Id = 1101` was a software marker → remap
    expect(out.samples[0]!.softwareMarkerId).toBe('1101');
    expect(out.samples[0]!.softwareMarkerName).toBe('stim_target');
    expect(out.samples[0]!.hardwareEvent).toBeUndefined();
  });
});

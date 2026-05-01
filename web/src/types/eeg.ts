// EEG data types for sgimacog-web

export interface EegPacket {
  serialNumber: number | null;
  eegChannels: Float32Array | null; // µV values, 8 channels
  battery: number | null;
  connStatus: number | null;
  synctick: number | null;
  euler: { roll: number; pitch: number; yaw: number } | null;
  gsensor: {
    gyroX: number; gyroY: number; gyroZ: number;
    accelX: number; accelY: number; accelZ: number;
  } | null;
  machineInfo: string | null; // device ID string from TAG_COMMAND response
  event: number | null;       // hardware event byte (Tag 7), 0..255; null if absent
}

export interface ImpedanceResult {
  channel: number;
  impedanceKohm: number;
  quality: 'excellent' | 'good' | 'poor' | 'bad';
  acAmplitude: number;  // µV — AC signal amplitude; < 0.5 means no signal detected
}

export interface DeviceStats {
  packetsReceived: number;
  packetsLost: number;
  decodeErrors: number;
  packetRate: number;
  battery: number | null;
}

export interface SubjectInfo {
  id: string;
  name: string;
  dob: string;
  sex: 'M' | 'F' | 'Other' | '';
  notes: string;
}

export interface FilterParams {
  bandpassEnabled: boolean;
  hpFreq: number;
  lpFreq: number;
  notchFreq: 0 | 50 | 60;
}

// All biquad filter states stored in Float64Arrays.
// Layout documented alongside each field.
export interface FilterBiquadState {
  // HP 4th-order Butterworth: 2 cascaded biquads × 2 delay values × 8 channels = 32
  hpState1: Float64Array;   // stage 1: ch * 2 + [0,1]
  hpState2: Float64Array;   // stage 2: ch * 2 + [0,1]
  // LP 4th-order Butterworth: same layout
  lpState1: Float64Array;
  lpState2: Float64Array;
  // Notch 6th-order: 3 cascaded biquads × 2 delay values × 8 channels = 48
  notchState: Float64Array; // stage offset: ch * 6 + stageIndex * 2 + [0,1]
  // DC removal: 1 value per channel = 8
  dcState: Float64Array;
  // DC init flag: 0 = uninitialized, 1 = initialized (prevents startup transient)
  dcInitialized: Uint8Array;
}

export const CHANNEL_LABELS = ['Fp1', 'Fp2', 'T7', 'T8', 'O1', 'O2', 'Fz', 'Pz'] as const;
export const CHANNEL_COUNT = 8;

/** All 19 standard 10-20 electrode positions */
export const EEG_10_20_LABELS = [
  'Fp1', 'Fp2',
  'F7', 'F3', 'Fz', 'F4', 'F8',
  'T7', 'C3', 'Cz', 'C4', 'T8',
  'P7', 'P3', 'Pz', 'P4', 'P8',
  'O1', 'O2',
] as const;

export type Eeg1020Label = typeof EEG_10_20_LABELS[number];

/** 32-channel fixed electrode labels (STEEG_DG32 device) */
export const CH32_LABELS = [
  'Fp1', 'Fp2', 'AF3', 'AF4',
  'F7', 'F3', 'Fz', 'F4', 'F8',
  'FT7', 'FC3', 'FCz', 'FC4', 'FT8',
  'T7', 'C3', 'Cz', 'C4', 'T8',
  'TP7', 'CP3', 'CPz', 'CP4', 'TP8',
  'P7', 'P3', 'Pz', 'P4', 'P8',
  'O1', 'Oz', 'O2',
] as const;
export const CH32_COUNT = 32;
export const CH32_SAMPLE_RATE = 500;

/** Mutable copy of default channel labels (for comparison / reset) */
export const DEFAULT_CHANNEL_LABELS: string[] = [...CHANNEL_LABELS];
export const SAMPLE_RATE_HZ = 1001;

export const DEFAULT_FILTER_PARAMS: FilterParams = {
  bandpassEnabled: true,
  hpFreq: 1,
  lpFreq: 45,
  notchFreq: 60,
};

export const makeFilterBiquadState = (channelCount: number = CHANNEL_COUNT): FilterBiquadState => ({
  hpState1:      new Float64Array(channelCount * 2),
  hpState2:      new Float64Array(channelCount * 2),
  lpState1:      new Float64Array(channelCount * 2),
  lpState2:      new Float64Array(channelCount * 2),
  notchState:    new Float64Array(channelCount * 6),
  dcState:       new Float64Array(channelCount),
  dcInitialized: new Uint8Array(channelCount),
});

export interface DeviceConfig {
  baudRate: number;
  channels: number;
  sampleRate: number;
  impedanceWindow: number;
}

export const DEFAULT_CONFIG: DeviceConfig = {
  baudRate: 1_000_000,
  channels: 8,
  sampleRate: 1001.0,
  impedanceWindow: 500,
};

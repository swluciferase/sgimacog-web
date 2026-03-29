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
}

export interface ImpedanceResult {
  channel: number;
  impedanceKohm: number;
  quality: 'excellent' | 'good' | 'poor' | 'bad';
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
  age: string;
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
}

export const CHANNEL_LABELS = ['Fp1', 'Fp2', 'T7', 'T8', 'O1', 'O2', 'Fz', 'Pz'] as const;
export const CHANNEL_COUNT = 8;
export const SAMPLE_RATE_HZ = 1001;

export const DEFAULT_FILTER_PARAMS: FilterParams = {
  bandpassEnabled: true,
  hpFreq: 1,
  lpFreq: 45,
  notchFreq: 0,
};

export const makeFilterBiquadState = (): FilterBiquadState => ({
  hpState1:   new Float64Array(CHANNEL_COUNT * 2),
  hpState2:   new Float64Array(CHANNEL_COUNT * 2),
  lpState1:   new Float64Array(CHANNEL_COUNT * 2),
  lpState2:   new Float64Array(CHANNEL_COUNT * 2),
  notchState: new Float64Array(CHANNEL_COUNT * 6),
  dcState:    new Float64Array(CHANNEL_COUNT),
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

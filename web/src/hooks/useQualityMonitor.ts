import { useMemo, useRef, useEffect } from 'react';
import type { EegPacket } from '../types/eeg';
import { CHANNEL_COUNT, SAMPLE_RATE_HZ } from '../types/eeg';

export interface QualityWindow {
  startTime: number;  // seconds from recording start
  endTime: number;
  channelStds: Float32Array;  // STD per channel (µV)
  isGood: boolean;
}

export interface QualityConfig {
  enabled: boolean;                  // toggle quality monitoring on/off
  sensitivity: 1 | 2 | 3 | 4 | 5;  // 1=lenient, 5=strict
  targetDurationSec: number;         // 30,60,90,120,150,180,300, or Infinity (Manual)
  windowSec: number;                 // always 2
}

// STD thresholds per sensitivity level (µV): index 0 = level 1, index 4 = level 5
const STD_THRESHOLDS = [200, 150, 100, 60, 30] as const;

/** A window is "good" if >= 6/8 channels have STD < threshold. */
function evaluateWindow(stds: Float32Array, threshold: number): boolean {
  let goodCount = 0;
  for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
    if ((stds[ch] ?? Infinity) < threshold) goodCount++;
  }
  return goodCount >= 6;
}

function computeStd(samples: number[]): number {
  if (samples.length === 0) return 0;
  const n = samples.length;
  let sum = 0;
  for (const s of samples) sum += s;
  const mean = sum / n;
  let sq = 0;
  for (const s of samples) sq += (s - mean) ** 2;
  return Math.sqrt(sq / n);
}

export function useQualityMonitor(
  packets: EegPacket[],
  isRecording: boolean,
  config: QualityConfig,
): {
  currentWindowStds: Float32Array;
  goodWindowCount: number;
  totalWindowCount: number;
  goodTimeSec: number;
  goodPercent: number;
  shouldAutoStop: boolean;
  qualityHistory: QualityWindow[];
} {
  const windowSamples = Math.round(config.windowSec * SAMPLE_RATE_HZ);
  const threshold = STD_THRESHOLDS[(config.sensitivity - 1) as 0 | 1 | 2 | 3 | 4];

  // Accumulate raw samples per channel across windows
  const channelBuffersRef = useRef<number[][]>(
    Array.from({ length: CHANNEL_COUNT }, () => []),
  );
  const goodWindowCountRef = useRef(0);
  const totalWindowCountRef = useRef(0);
  const qualityHistoryRef = useRef<QualityWindow[]>([]);
  const currentWindowStdsRef = useRef<Float32Array>(new Float32Array(CHANNEL_COUNT));
  const recordingTimeRef = useRef(0); // seconds from recording start

  // Reset when recording starts or stops
  const prevIsRecordingRef = useRef(false);
  useEffect(() => {
    if (isRecording && !prevIsRecordingRef.current) {
      // Reset all tracking state on new recording
      channelBuffersRef.current = Array.from({ length: CHANNEL_COUNT }, () => []);
      goodWindowCountRef.current = 0;
      totalWindowCountRef.current = 0;
      qualityHistoryRef.current = [];
      currentWindowStdsRef.current = new Float32Array(CHANNEL_COUNT);
      recordingTimeRef.current = 0;
    }
    prevIsRecordingRef.current = isRecording;
  }, [isRecording]);

  // Process new packets
  useEffect(() => {
    if (!isRecording || !config.enabled || packets.length === 0) return;

    const buffers = channelBuffersRef.current;

    for (const pkt of packets) {
      if (!pkt.eegChannels || pkt.eegChannels.length < CHANNEL_COUNT) continue;
      recordingTimeRef.current += 1 / SAMPLE_RATE_HZ;
      for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
        buffers[ch]!.push(pkt.eegChannels[ch] ?? 0);
      }

      // Check if we've accumulated a full window
      if (buffers[0]!.length >= windowSamples) {
        const stds = new Float32Array(CHANNEL_COUNT);
        for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
          stds[ch] = computeStd(buffers[ch]!.slice(0, windowSamples));
        }
        currentWindowStdsRef.current = stds;

        const windowEndTime = recordingTimeRef.current;
        const windowStartTime = windowEndTime - config.windowSec;
        const isGood = evaluateWindow(stds, threshold);

        totalWindowCountRef.current++;
        if (isGood) goodWindowCountRef.current++;

        qualityHistoryRef.current = [
          ...qualityHistoryRef.current,
          { startTime: windowStartTime, endTime: windowEndTime, channelStds: stds, isGood },
        ];

        // Consume the window's samples (no overlap)
        for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
          buffers[ch]!.splice(0, windowSamples);
        }
      }
    }
  });

  const goodWindowCount = goodWindowCountRef.current;
  const totalWindowCount = totalWindowCountRef.current;
  const goodTimeSec = goodWindowCount * config.windowSec;
  const goodPercent = totalWindowCount > 0
    ? Math.round((goodWindowCount / totalWindowCount) * 100)
    : 0;

  const shouldAutoStop = useMemo(() => {
    if (!isRecording || !config.enabled) return false;
    if (!isFinite(config.targetDurationSec)) return false;
    return goodTimeSec >= config.targetDurationSec;
  }, [isRecording, config.enabled, goodTimeSec, config.targetDurationSec]);

  return {
    currentWindowStds: currentWindowStdsRef.current,
    goodWindowCount,
    totalWindowCount,
    goodTimeSec,
    goodPercent,
    shouldAutoStop,
    qualityHistory: qualityHistoryRef.current,
  };
}

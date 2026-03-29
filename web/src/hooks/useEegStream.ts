import { useEffect, useRef, useState } from 'react';
import { SerialService } from '../services/serial';
import type { DeviceStats, EegPacket, ImpedanceResult } from '../types/eeg';

interface SteegParser {
  feed(data: Uint8Array): unknown;
  packets_received(): number;
  packets_lost(): number;
  decode_errors(): number;
  enable_impedance(windowSize: number, sampleRate: number): void;
  free(): void;
}

interface EegStreamState {
  latestPackets: EegPacket[];
  stats: DeviceStats;
  latestImpedance: ImpedanceResult[] | null;
}

type RawImpedanceResult = {
  channel: number;
  impedanceKohm: number;
  quality: ImpedanceResult['quality'];
  acAmplitude: number;
};

type RawPacket = {
  serialNumber?: number | null;
  channels?: Float32Array | null;
  battery?: number | null;
  gsensor?: Float32Array | null;
  impedanceResults?: RawImpedanceResult[] | null;
  machineInfo?: string | null;
};

export function useEegStream(
  serial: SerialService | null,
  parser: SteegParser | null,
  onParserError?: () => void,
): EegStreamState {
  const [state, setState] = useState<EegStreamState>({
    latestPackets: [],
    stats: {
      packetsReceived: 0,
      packetsLost: 0,
      decodeErrors: 0,
      packetRate: 0,
      battery: null,
    },
    latestImpedance: null,
  });

  const rafRef = useRef<number | null>(null);
  const lastStatsUpdateRef = useRef<number>(0);
  const packetCountRef = useRef<number>(0);
  // Stable ref so callback changes don't restart the rAF loop
  const onParserErrorRef = useRef(onParserError);
  onParserErrorRef.current = onParserError;

  useEffect(() => {
    if (!serial || !parser) {
      return;
    }

    let running = true;

    const rafLoop = (timestamp: number): void => {
      if (!running) {
        return;
      }

      const chunks = serial.drainBuffer();

      if (chunks.length > 0) {
        const totalLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        // CRITICAL: try/catch around feed().
        // If the WASM traps (OOB, panic), wasm-bindgen's internal WasmRefCell
        // borrow is never released — permanently poisoning the parser instance.
        // Every subsequent call would throw "recursive use of an object".
        // We catch the crash, stop this loop, and signal App to create a fresh parser.
        let rawPackets: RawPacket[];
        try {
          rawPackets = parser.feed(combined) as RawPacket[];
        } catch (e) {
          console.error(
            '[useEegStream] parser.feed() crashed — parser is poisoned, requesting new instance:',
            e,
          );
          running = false;
          onParserErrorRef.current?.();
          return;
        }

        const packets: EegPacket[] = rawPackets.map((packet) => ({
          serialNumber: packet.serialNumber ?? null,
          eegChannels: packet.channels ?? null,
          battery: packet.battery ?? null,
          connStatus: null,
          synctick: null,
          euler: null,
          machineInfo: packet.machineInfo ?? null,
          gsensor: packet.gsensor
            ? {
                gyroX: packet.gsensor[0],
                gyroY: packet.gsensor[1],
                gyroZ: packet.gsensor[2],
                accelX: packet.gsensor[3],
                accelY: packet.gsensor[4],
                accelZ: packet.gsensor[5],
              }
            : null,
        }));

        packetCountRef.current += packets.length;

        let impedance: ImpedanceResult[] | null = null;
        if (rawPackets.length > 0) {
          const lastPacket = rawPackets[rawPackets.length - 1];
          if (lastPacket?.impedanceResults && lastPacket.impedanceResults.length > 0) {
            impedance = lastPacket.impedanceResults.map(r => ({
              channel: r.channel,
              impedanceKohm: r.impedanceKohm,
              quality: r.quality,
              acAmplitude: r.acAmplitude ?? 0,
            }));
          }
        }

        const elapsed = timestamp - lastStatsUpdateRef.current;
        if (elapsed >= 1000) {
          const rate = Math.round(packetCountRef.current / (elapsed / 1000));
          packetCountRef.current = 0;
          lastStatsUpdateRef.current = timestamp;

          setState((prev) => ({
            latestPackets: packets,
            stats: {
              packetsReceived: parser.packets_received(),
              packetsLost: parser.packets_lost(),
              decodeErrors: parser.decode_errors(),
              packetRate: rate,
              battery: packets.find((packet) => packet.battery !== null)?.battery ?? prev.stats.battery,
            },
            latestImpedance: impedance ?? prev.latestImpedance,
          }));
        } else if (packets.length > 0) {
          setState((prev) => ({
            ...prev,
            latestPackets: packets,
            latestImpedance: impedance ?? prev.latestImpedance,
          }));
        }
      }

      rafRef.current = requestAnimationFrame(rafLoop);
    };

    rafRef.current = requestAnimationFrame(rafLoop);

    return () => {
      running = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [serial, parser]);

  return state;
}

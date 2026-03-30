/**
 * Port Scanner — D2XX-inspired browser equivalent of FT_GetDeviceInfoDetail.
 *
 * Opens each authorized FTDI COM port briefly, sends cmd_machine_info,
 * and parses the firmware response to extract the device's USB serial number.
 * That serial maps to the WebUSB device's productName (e.g. "STEEG_DG085134").
 *
 * Works on Windows VCP where SerialPortInfo.usbSerialNumber is unavailable.
 */

import { wasmService } from './wasm';
import { DEFAULT_CONFIG } from '../types/eeg';

const SCAN_BAUD_RATE = DEFAULT_CONFIG.baudRate;   // 1_000_000
const SCAN_CHANNELS  = DEFAULT_CONFIG.channels;
const SCAN_SR        = DEFAULT_CONFIG.sampleRate;
const SCAN_TIMEOUT_MS = 4_000;
const PORT_SETTLE_MS  = 500;  // wait after open — Windows VCP driver needs time to settle

interface WasmCmds {
  cmd_machine_info(): Uint8Array;
  cmd_adc_on(): Uint8Array;
  cmd_adc_off(): Uint8Array;
}

interface RawPacket {
  machineInfo?: string | null;
}

export interface PortScanResult {
  port: SerialPort;
  /** USB serial as reported by firmware machineInfo (e.g. "AV0KHCQP") */
  serialNumber: string;
}

/**
 * Scans a list of FTDI SerialPorts by briefly opening each, sending the
 * cmd_machine_info command, and reading the firmware's serial number.
 * Ports that are already open or unresponsive are silently skipped.
 */
export async function scanPortSerials(ports: SerialPort[]): Promise<PortScanResult[]> {
  // Ensure WASM is initialized (safe to call repeatedly — idempotent)
  if (!wasmService.isInitialized) {
    try {
      await wasmService.init();
    } catch {
      return [];
    }
  }
  if (ports.length === 0) return [];

  const cmds = wasmService.api as unknown as WasmCmds;
  let cmdMachineInfo: Uint8Array;
  let cmdAdcOn: Uint8Array;
  let cmdAdcOff: Uint8Array;
  try {
    cmdMachineInfo = cmds.cmd_machine_info();
    cmdAdcOn = cmds.cmd_adc_on();
    cmdAdcOff = cmds.cmd_adc_off();
  } catch (e) {
    console.error('[portScanner] WASM command init failed:', e);
    return [];
  }

  const results: PortScanResult[] = [];
  for (const port of ports) {
    const sn = await probeSinglePort(port, cmdMachineInfo, cmdAdcOn, cmdAdcOff);
    if (sn) results.push({ port, serialNumber: sn });
  }
  return results;
}

async function probeSinglePort(
  port: SerialPort,
  cmdMachineInfo: Uint8Array,
  cmdAdcOn: Uint8Array,
  cmdAdcOff: Uint8Array,
): Promise<string | null> {
  // Open port — bufferSize MUST be large (default 255 drops data at 1Mbaud)
  try {
    await port.open({ baudRate: SCAN_BAUD_RATE, bufferSize: 65536 });
  } catch (e) {
    console.warn('[portScanner] port.open failed (already open?):', e);
    return null;
  }

  let serialNumber: string | null = null;

  try {
    const api = wasmService.api as Record<string, unknown>;
    const ParserCtor = api['SteegParser'] as new (ch: number, sr: number) => {
      feed(data: Uint8Array): unknown;
      free?(): void;
    };
    const parser = new ParserCtor(SCAN_CHANNELS, SCAN_SR);

    // Get reader BEFORE writing so we don't miss fast responses
    const reader = port.readable?.getReader();
    if (!reader) {
      parser.free?.();
      return null;
    }

    // Allow the FTDI chip to settle after open
    await new Promise(r => setTimeout(r, PORT_SETTLE_MS));

    // CRITICAL: Prime the FrameAccumulator so its "discard first segment" guard
    // is consumed by an empty segment, not by our actual machineInfo response.
    parser.feed(new Uint8Array([0x00]));

    // Mirror App.tsx exactly: cmd_machine_info → cmd_adc_on
    // The firmware embeds machineInfo in the data stream, so ADC must be running
    // for the response to appear. Without cmd_adc_on the device stays silent.
    if (port.writable) {
      const writer = port.writable.getWriter();
      try {
        await writer.write(cmdMachineInfo);
        await writer.write(cmdAdcOn);
      } finally {
        writer.releaseLock();
      }
    }

    // Read until machineInfo packet arrives or timeout
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    loop: while (Date.now() < deadline) {
      const remaining = Math.max(10, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>(resolve =>
          setTimeout(() => resolve({ done: true, value: undefined }), remaining)
        ),
      ]);

      if (chunk.done) break;
      if (!chunk.value?.length) continue;

      const packets = parser.feed(chunk.value) as RawPacket[] | null;
      for (const pkt of packets ?? []) {
        if (pkt.machineInfo) {
          const raw = pkt.machineInfo;
          serialNumber = raw.startsWith('STEEG_') ? raw.slice(6) : raw;
          console.log('[portScanner] identified port →', serialNumber);
          break loop;
        }
      }
    }

    await reader.cancel().catch(() => {});
    reader.releaseLock();

    // Stop ADC before closing so device isn't left streaming
    if (port.writable) {
      const writer = port.writable.getWriter();
      try { await writer.write(cmdAdcOff); } catch { /* ignore */ }
      finally { writer.releaseLock(); }
    }
    // Brief pause so device processes the stop command before port.close()
    await new Promise(r => setTimeout(r, 100));

    parser.free?.();
  } catch (e) {
    console.error('[portScanner] probe error:', e);
  } finally {
    await port.close().catch(() => {});
  }

  return serialNumber;
}

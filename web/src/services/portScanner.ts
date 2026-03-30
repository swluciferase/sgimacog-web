/**
 * Port Scanner — D2XX-inspired browser equivalent of FT_GetDeviceInfoDetail.
 *
 * D2XX achieves productName↔COM mapping via:
 *   FT_GetDeviceInfoList → Description + SerialNumber per device
 *   FT_GetComPortNumber  → device handle → Windows COM port number
 *
 * In a browser we cannot call D2XX. Instead, we briefly open each authorized
 * FTDI COM port via Web Serial, send cmd_machine_info, and parse the firmware
 * response — which contains the device's USB serial number (e.g. "AV0KHCQP").
 * That serial number maps directly to the WebUSB device that has the full
 * productName (e.g. "STEEG_DG085134"), completing the lookup.
 *
 * This works even when Chrome's SerialPortInfo.usbSerialNumber is unavailable
 * (common on Windows with VCP drivers older than Chrome 121).
 */

import { wasmService } from './wasm';

const SCAN_BAUD_RATE = 1_000_000;
const SCAN_TIMEOUT_MS = 2_500;

interface WasmCmds {
  cmd_machine_info(): Uint8Array;
}

interface RawPacket {
  machineInfo?: string | null;
}

interface RawParseResult {
  packets?: RawPacket[];
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
  if (!wasmService.isInitialized || ports.length === 0) return [];

  const cmds = wasmService.api as unknown as WasmCmds;
  let cmdBytes: Uint8Array;
  try {
    cmdBytes = cmds.cmd_machine_info();
  } catch {
    return [];
  }

  const results: PortScanResult[] = [];
  for (const port of ports) {
    const sn = await probeSinglePort(port, cmdBytes);
    if (sn) results.push({ port, serialNumber: sn });
  }
  return results;
}

async function probeSinglePort(port: SerialPort, cmdBytes: Uint8Array): Promise<string | null> {
  // Open port — skip if already in use
  try {
    await port.open({ baudRate: SCAN_BAUD_RATE });
  } catch {
    return null;
  }

  let serialNumber: string | null = null;

  try {
    // Create a temporary parser instance
    const api = wasmService.api as Record<string, unknown>;
    const ParserCtor = api['SteegParser'] as new () => {
      feed(data: Uint8Array): unknown;
      free?(): void;
    };
    const parser = new ParserCtor();

    // Send machine_info command
    if (port.writable) {
      const writer = port.writable.getWriter();
      try {
        await writer.write(cmdBytes);
      } finally {
        writer.releaseLock();
      }
    }

    // Read until machineInfo arrives or timeout
    if (port.readable) {
      const reader = port.readable.getReader();
      const deadline = Date.now() + SCAN_TIMEOUT_MS;

      loop: while (Date.now() < deadline) {
        const remaining = Math.max(0, deadline - Date.now());
        const chunk = await Promise.race([
          reader.read(),
          new Promise<{ done: true; value: undefined }>(resolve =>
            setTimeout(() => resolve({ done: true, value: undefined }), remaining)
          ),
        ]);

        if (chunk.done) break;
        if (!chunk.value?.length) continue;

        const result = parser.feed(chunk.value) as RawParseResult | null;
        for (const pkt of result?.packets ?? []) {
          if (pkt.machineInfo) {
            const raw = pkt.machineInfo;
            serialNumber = raw.startsWith('STEEG_') ? raw.slice(6) : raw;
            break loop;
          }
        }
      }

      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }

    parser.free?.();
  } finally {
    await port.close().catch(() => {});
  }

  return serialNumber;
}

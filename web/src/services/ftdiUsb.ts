/**
 * ftdiUsb.ts
 *
 * Raw WebUSB driver for FTDI FT232R USB-UART chip.
 * Implements the same public surface as SerialService so it can be used
 * as a drop-in alternative on platforms without Web Serial API (e.g. Android).
 *
 * Protocol reference:
 *  - FTDI AN_232R-01 (FT232R datasheet appendix)
 *  - Linux kernel driver: drivers/usb/serial/ftdi_sio.c
 *  - libftdi source
 *
 * FT232R USB layout:
 *  Configuration 1 → Interface 0
 *    Endpoint 0x81 (IN,  bulk, 64 B max) — device → host data
 *    Endpoint 0x02 (OUT, bulk, 64 B max) — host → device data
 *  Each bulk IN packet is prefixed with 2 FTDI modem-status bytes that must be stripped.
 */

import type { ConnectionStatus } from './serial';

// ── WebUSB type stubs (WebUSB is not in standard TS DOM lib) ──────────────
// Matches the subset of the WebUSB API we actually use.

interface UsbControlTransferParameters {
  requestType: 'vendor' | 'standard' | 'class';
  recipient: 'device' | 'interface' | 'endpoint' | 'other';
  request: number;
  value: number;
  index: number;
}

interface UsbInTransferResult {
  data: DataView | null;
  status: 'ok' | 'stall' | 'babble';
}

interface UsbConfiguration {
  configurationValue: number;
}

export interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  productName?: string | null;
  manufacturerName?: string | null;
  configuration: UsbConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  controlTransferOut(setup: UsbControlTransferParameters, data?: BufferSource): Promise<unknown>;
  transferIn(endpointNumber: number, length: number): Promise<UsbInTransferResult>;
  transferOut(endpointNumber: number, data: Uint8Array): Promise<unknown>;
}

interface UsbApiLike {
  requestDevice(options: { filters: { vendorId: number; productId?: number }[] }): Promise<UsbDeviceLike>;
  getDevices(): Promise<UsbDeviceLike[]>;
}

function getUsbApi(): UsbApiLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { usb?: UsbApiLike };
  return nav.usb ?? null;
}

// ── FTDI device identifiers ────────────────────────────────────────────────
export const FTDI_VID = 0x0403;
export const FTDI_PID_FT232 = 0x6001;

// ── FTDI SIO command codes (bRequest for vendor control transfers) ──────────
const SIO_RESET            = 0;   // Reset device / purge buffers
const SIO_SET_FLOW_CTRL    = 2;   // Set flow control
const SIO_SET_BAUD_RATE    = 3;   // Set baud rate divisor
const SIO_SET_DATA         = 4;   // Set data characteristics (8N1 etc.)
const SIO_SET_LATENCY_TIMER = 9;  // Set latency timer (1–255 ms)

// ── USB endpoint numbers (1-based, as used in WebUSB transferIn/Out) ───────
const EP_IN  = 1;  // 0x81
const EP_OUT = 2;  // 0x02

// Each bulk IN packet ≤ 64 bytes on FT232R (full-speed USB)
const EP_IN_PACKET = 64;

// ── Baud rate calculation ──────────────────────────────────────────────────
/**
 * Compute the FTDI baud rate divisor for FT232R (3 MHz clock).
 *
 * The divisor is a fixed-point number: integer(14-bit) + fraction(3-bit sub-integer).
 * Fractional encoding table (FTDI-specific, maps 0–7 sub-integers):
 *   sub-integer  0  1  2  3  4  5  6  7
 *   encoded code 0  3  2  4  1  5  6  7
 *
 * The encoded value is split:
 *   wValue  bits [13:0]  = integer divisor
 *   wValue  bits [15:14] = lower 2 bits of encoded fraction
 *   wIndex  bit  [0]     = high bit of encoded fraction
 *   wIndex  bits [15:8]  = 0 (interface 0)
 *
 * Returns [wValue, wIndex] for the SIO_SET_BAUD_RATE control transfer.
 */
function baudRateDivisor(baud: number): [number, number] {
  // FT232R clock = 3 MHz
  const CLOCK_X8 = 3_000_000 * 8;
  // Round to nearest sub-integer
  const divisorX8 = Math.round(CLOCK_X8 / baud);
  const integer   = Math.floor(divisorX8 / 8);
  const fraction  = divisorX8 % 8; // 0–7

  // Fractional encoding table
  const fracCode = [0, 3, 2, 4, 1, 5, 6, 7] as const;
  const encoded  = fracCode[fraction] ?? 0;

  const wValue = (integer & 0x3FFF) | ((encoded & 0x3) << 14);
  const wIndex = (encoded >> 2) & 0x1; // high bit of 3-bit encoded fraction

  return [wValue, wIndex];
}

// ── Ring buffer (copy from serial.ts to keep this file self-contained) ─────
class RingBuffer {
  private buf: Uint8Array[] = [];
  private readonly cap: number;
  constructor(cap = 10_000) { this.cap = cap; }
  push(item: Uint8Array): void {
    if (this.buf.length >= this.cap) this.buf.shift();
    this.buf.push(item);
  }
  drain(): Uint8Array[] { const b = this.buf; this.buf = []; return b; }
  clear(): void { this.buf = []; }
}

// ── FtdiUsbService ─────────────────────────────────────────────────────────

export class FtdiUsbService {
  private device: UsbDeviceLike | null = null;
  private reading = false;
  private stopped = false;

  private readonly rxBuffer = new RingBuffer(10_000);

  public onStatusChange: (status: ConnectionStatus) => void = () => {};
  public onError: (error: Error) => void = () => {};

  // ── Connection ────────────────────────────────────────────────────────────

  /**
   * Show the WebUSB device picker filtered to FTDI FT232R, then configure and
   * start streaming.  Call this instead of SerialService.connect() on Android.
   */
  async requestAndConnect(baudRate: number): Promise<void> {
    const usb = getUsbApi();
    if (!usb) throw new Error('WebUSB not available');
    const device = await usb.requestDevice({
      filters: [{ vendorId: FTDI_VID, productId: FTDI_PID_FT232 }],
    });
    await this.connectToDevice(device, baudRate);
  }

  /**
   * Connect to a pre-selected USB device (e.g. from device picker in ConnectModal).
   */
  async connectToDevice(device: UsbDeviceLike, baudRate: number): Promise<void> {
    if (this.device !== null && !this.stopped) return;

    this.stopped  = false;
    this.device   = device;
    this.onStatusChange('connecting');

    try {
      await device.open();

      // Select configuration 1 if not already selected
      if (device.configuration === null || device.configuration.configurationValue !== 1) {
        await device.selectConfiguration(1);
      }

      // Claim interface 0 (FTDI UART interface)
      await device.claimInterface(0);

      // ── Configure FTDI chip ──────────────────────────────────────────────

      // 1. Full chip reset
      await this._ctrl(SIO_RESET, 0, 0);

      // 2. Set baud rate
      const [wValue, wIndex] = baudRateDivisor(baudRate);
      await this._ctrl(SIO_SET_BAUD_RATE, wValue, wIndex);

      // 3. Set 8N1 data format
      //    wValue bits: [2:0] data bits (8=0b1000 after offset), [4:3] parity, [6:5] stop bits
      //    For 8N1: data=8 (value 0x08), parity=none (0), stop=1 (0) → wValue = 0x0008
      await this._ctrl(SIO_SET_DATA, 0x0008, 0);

      // 4. Disable flow control
      await this._ctrl(SIO_SET_FLOW_CTRL, 0x0000, 0);

      // 5. Set latency timer to 1 ms (default is 16 ms, far too slow at 1 Mbaud)
      await this._ctrl(SIO_SET_LATENCY_TIMER, 1, 0);

      // 6. Purge RX and TX buffers
      await this._ctrl(SIO_RESET, 1, 0); // purge RX
      await this._ctrl(SIO_RESET, 2, 0); // purge TX

      this.onStatusChange('connected');
      this.startReadLoop();

    } catch (e) {
      this.device = null;
      this.onStatusChange('error');
      const err = e instanceof Error ? e : new Error(String(e));
      this.onError(err);
      throw err;
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.reading = false;

    // Give the read loop one tick to exit its await
    await new Promise(r => setTimeout(r, 20));

    try {
      if (this.device) {
        // Stop any in-progress transfer (best effort — ignore errors)
        try { await this.device.releaseInterface(0); } catch { /* ok */ }
        try { await this.device.close(); } catch { /* ok */ }
      }
    } catch { /* ignore */ }

    this.device = null;
    this.rxBuffer.clear();
    this.onStatusChange('disconnected');
  }

  // ── Write ─────────────────────────────────────────────────────────────────

  async write(data: Uint8Array): Promise<void> {
    if (!this.device) throw new Error('FTDI device not connected');
    await this.device.transferOut(EP_OUT, data);
  }

  // ── Buffer drain (called from rAF loop, same as SerialService) ─────────

  drainBuffer(): Uint8Array[] {
    return this.rxBuffer.drain();
  }

  get isConnected(): boolean {
    return this.device !== null && !this.stopped;
  }

  /** Serial number / product name of connected device (for UI display). */
  get displayId(): string {
    if (!this.device) return '';
    const prod = this.device.productName ?? '';
    const ser  = this.device.serialNumber ?? '';
    const GENERIC = ['USB Serial', 'USB Serial Port', 'FT232R USB UART', ''];
    return GENERIC.includes(prod.trim()) ? (ser || prod) : prod.trim();
  }

  // ── FTDI vendor control transfer ──────────────────────────────────────────

  private async _ctrl(
    request: number,
    value: number,
    index: number,
  ): Promise<void> {
    if (!this.device) return;
    await this.device.controlTransferOut({
      requestType: 'vendor',
      recipient: 'device',
      request,
      value,
      index,
    });
  }

  // ── Async bulk IN read loop ────────────────────────────────────────────────

  private startReadLoop(): void {
    if (this.reading) return;
    this.reading = true;
    void this._readLoop();
  }

  private async _readLoop(): Promise<void> {
    while (!this.stopped && this.device) {
      try {
        const result = await this.device.transferIn(EP_IN, EP_IN_PACKET);

        if (!result.data || result.data.byteLength === 0) continue;

        // FTDI always prepends 2 modem-status bytes to every bulk IN packet.
        // If length <= 2, the packet carries no data (status-only, very common
        // when the latency timer fires on an idle line).
        if (result.data.byteLength <= 2) continue;

        // Strip the 2 FTDI status bytes and push the rest to the ring buffer
        const payload = new Uint8Array(
          result.data.buffer,
          result.data.byteOffset + 2,
          result.data.byteLength - 2,
        );
        this.rxBuffer.push(payload.slice()); // slice() owns its own buffer

      } catch (e) {
        if (this.stopped) break;
        // transferIn throws on device disconnect
        const err = e instanceof Error ? e : new Error(String(e));
        console.warn('[FtdiUsbService] Read error:', err.message);

        // Treat any read error as a fatal disconnect
        this.device = null;
        this.rxBuffer.clear();
        this.onStatusChange('disconnected');
        break;
      }
    }

    this.reading = false;
  }
}

// Singleton — mirrors how serialService is used in App.tsx
export const ftdiUsbService = new FtdiUsbService();

// ── Platform capability detection ─────────────────────────────────────────

/** True when the current browser exposes the Web Serial API (Chrome desktop). */
export function isWebSerialAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/** True when the current browser exposes the WebUSB API (Chrome desktop + Android). */
export function isWebUsbAvailableForFtdi(): boolean {
  return getUsbApi() !== null;
}

/** True when running on an Android device (user agent check). */
export function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * Returns true when WebUSB direct mode should be used instead of Web Serial.
 * This covers:
 *  - Browsers without Web Serial API at all, AND
 *  - Android Chrome, which has navigator.serial but cannot access FTDI devices
 *    through it (no kernel USB-serial driver on Android).
 */
export function needsAndroidUsbMode(): boolean {
  return (isAndroidDevice() || !isWebSerialAvailable()) && isWebUsbAvailableForFtdi();
}

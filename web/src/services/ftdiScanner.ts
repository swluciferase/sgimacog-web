// Uses WebUSB API to enumerate FTDI devices (VID:0x0403, PID:0x6001)
// and read their USB serial number strings BEFORE Web Serial connection.
// The USB serial number is readable from device descriptor without claiming any interface.
//
// WebUSB is not in the standard TypeScript DOM lib; we access it via a typed interface
// to avoid `any` while keeping compatibility.

export interface FtdiDeviceInfo {
  serialNumber: string;   // e.g. "AV0KHICV"
  productName: string;    // e.g. "USB Serial"
  manufacturerName: string;
}

interface UsbDeviceLike {
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  productName?: string | null;
  manufacturerName?: string | null;
}

interface UsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: { vendorId: number; productId: number }[] }): Promise<UsbDeviceLike>;
}

const FTDI_VENDOR_ID  = 0x0403;
const FTDI_PRODUCT_ID = 0x6001;

function getUsb(): UsbLike | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as unknown as { usb?: UsbLike };
  return nav.usb ?? null;
}

function deviceToInfo(device: UsbDeviceLike): FtdiDeviceInfo {
  return {
    serialNumber:    device.serialNumber    ?? '',
    productName:     device.productName     ?? 'USB Serial',
    manufacturerName: device.manufacturerName ?? 'FTDI',
  };
}

/**
 * Returns info for all FTDI devices the user has previously granted access to.
 * Does NOT open or claim any interface.
 */
export async function getAuthorizedFtdiDevices(): Promise<FtdiDeviceInfo[]> {
  const usb = getUsb();
  if (!usb) return [];
  try {
    const devices = await usb.getDevices();
    return devices
      .filter(d => d.vendorId === FTDI_VENDOR_ID && d.productId === FTDI_PRODUCT_ID)
      .map(deviceToInfo);
  } catch {
    return [];
  }
}

/**
 * Prompts the user to authorize a new FTDI device via the browser USB picker.
 * Returns the device info without opening or claiming any interface.
 * Returns null if the user cancels or no device is selected.
 */
export async function requestNewFtdiDevice(): Promise<FtdiDeviceInfo | null> {
  const usb = getUsb();
  if (!usb) return null;
  try {
    const device = await usb.requestDevice({
      filters: [{ vendorId: FTDI_VENDOR_ID, productId: FTDI_PRODUCT_ID }],
    });
    return deviceToInfo(device);
  } catch {
    // User cancelled or error
    return null;
  }
}

/** Returns true if the WebUSB API is available in this browser. */
export function isWebUsbAvailable(): boolean {
  return getUsb() !== null;
}

/**
 * Revoke browser permission for all authorized FTDI USB devices.
 * Uses device.forget() which is available in Chrome 122+.
 */
export async function forgetAllFtdiDevices(): Promise<void> {
  const usb = getUsb();
  if (!usb) return;
  try {
    const devices = await usb.getDevices();
    const ftdi = devices.filter(d => d.vendorId === FTDI_VENDOR_ID && d.productId === FTDI_PRODUCT_ID);
    for (const device of ftdi) {
      const d = device as UsbDeviceLike & { forget?: () => Promise<void> };
      if (typeof d.forget === 'function') await d.forget();
    }
  } catch { /* ignore */ }
}

/**
 * Revoke browser permission for all authorized FTDI Web Serial ports.
 */
export async function forgetAllFtdiPorts(): Promise<void> {
  try {
    const ports = await navigator.serial.getPorts();
    const ftdi = ports.filter(p => {
      const info = p.getInfo();
      return info.usbVendorId === 0x0403 && info.usbProductId === 0x6001;
    });
    for (const port of ftdi) {
      await port.forget();
    }
  } catch { /* ignore */ }
}

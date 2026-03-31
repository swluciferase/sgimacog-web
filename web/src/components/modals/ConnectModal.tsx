import { type FC, type MouseEvent, useState, useEffect, useCallback } from 'react';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import {
  getAuthorizedFtdiDevices,
  getAuthorizedFtdiPortsWithSerial,
  requestNewFtdiDevice,
  isWebUsbAvailable,
  forgetAllFtdiDevices,
  forgetAllFtdiPorts,
} from '../../services/ftdiScanner';
import {
  FTDI_VID, FTDI_PID_FT232,
  isWebSerialAvailable, isWebUsbAvailableForFtdi,
  type UsbDeviceLike,
} from '../../services/ftdiUsb';
import {
  getOtherTabDevices,
  onRegistryChange,
  clearRegistry,
  type RegistryEntry,
} from '../../services/deviceRegistry';

// ── Types ──

interface UnifiedDevice {
  /** USB serial number (e.g. "AV0KHCQP") — used internally for matching */
  serialNumber: string;
  /** productName from USB descriptor (e.g. "STEEG_DG085134") — shown in UI */
  displayId: string;
  /** Port auto-matched via getInfo().usbSerialNumber (Chrome 121+), may be null */
  port: SerialPort | null;
}

async function requestFtdiPort(): Promise<SerialPort | null> {
  try {
    return await navigator.serial.requestPort({
      filters: [{ usbVendorId: 0x0403, usbProductId: 0x6001 }],
    });
  } catch {
    return null;
  }
}

function toDisplayId(productName: string, serialNumber: string): string {
  const generic = ['USB Serial', 'USB Serial Port', 'FT232R USB UART', ''];
  return generic.includes(productName.trim()) ? serialNumber : productName.trim();
}

// ── Props ──

interface ConnectModalProps {
  lang: Lang;
  onConnect: (port: SerialPort | null, displayId?: string, usbSerial?: string) => void;
  /** Called on Android / no-Web-Serial path: raw WebUSB device selected */
  onConnectUsb?: (device: UsbDeviceLike, displayId: string) => void;
  onClose: () => void;
}

// ── Component ──

export const ConnectModal: FC<ConnectModalProps> = ({ lang, onConnect, onConnectUsb, onClose }) => {
  const [devices, setDevices] = useState<UnifiedDevice[]>([]);
  const [otherTabDevices, setOtherTabDevices] = useState<RegistryEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  /**
   * Port pairings: Key = USB serialNumber, Value = SerialPort
   * Built by "Authorize New Device" (WebUSB → COM picker) or "Select COM" per device.
   */
  const [portPairings, setPortPairings] = useState<Map<string, SerialPort>>(new Map());

  const webUsbAvailable = isWebUsbAvailable();

  // Platform capability flags
  const hasWebSerial = isWebSerialAvailable();
  const hasWebUsb    = isWebUsbAvailableForFtdi();
  // Android mode: show USB-direct section when Web Serial is absent
  const [androidConnecting, setAndroidConnecting] = useState(false);
  const [androidError, setAndroidError] = useState<string | null>(null);

  const handleAndroidConnect = useCallback(async () => {
    if (!hasWebUsb || !onConnectUsb) return;
    setAndroidConnecting(true);
    setAndroidError(null);
    try {
      // Use the same typed USB accessor as ftdiScanner.ts
      const nav = navigator as unknown as { usb?: { requestDevice(o: unknown): Promise<UsbDeviceLike> } };
      if (!nav.usb) throw new Error('WebUSB not available');
      const device = await nav.usb.requestDevice({
        filters: [{ vendorId: FTDI_VID, productId: FTDI_PID_FT232 }],
      });
      const GENERIC = ['USB Serial', 'USB Serial Port', 'FT232R USB UART', ''];
      const prod = device.productName ?? '';
      const ser  = device.serialNumber ?? '';
      const displayId = GENERIC.includes(prod.trim()) ? (ser || prod || 'FTDI') : prod.trim();
      onConnectUsb(device, displayId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('No device selected')) setAndroidError(msg);
    } finally {
      setAndroidConnecting(false);
    }
  }, [hasWebUsb, onConnectUsb]);

  const refresh = useCallback(async () => {
    setScanning(true);
    const [usbDevices, portsWithSerial] = await Promise.all([
      getAuthorizedFtdiDevices(),
      getAuthorizedFtdiPortsWithSerial(),
    ]);

    const seen = new Set<string>();
    const unified: UnifiedDevice[] = [];

    for (const dev of usbDevices) {
      const serial = dev.serialNumber;
      if (serial) seen.add(serial);
      const matchedPort = portsWithSerial.find(p => p.serialNumber === serial)?.port ?? null;
      unified.push({
        serialNumber: serial,
        displayId: toDisplayId(dev.productName, serial),
        port: matchedPort,
      });
    }

    for (const pw of portsWithSerial) {
      if (pw.serialNumber && !seen.has(pw.serialNumber)) {
        seen.add(pw.serialNumber);
        unified.push({ serialNumber: pw.serialNumber, displayId: pw.serialNumber, port: pw.port });
      }
    }

    setDevices(unified);
    setOtherTabDevices(getOtherTabDevices());
    setScanning(false);

    if (unified.length === 1 && unified[0]?.serialNumber) {
      setSelectedSerial(unified[0].serialNumber);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onRegistryChange(() => setOtherTabDevices(getOtherTabDevices()));
    return unsub;
  }, [refresh]);

  function isPaired(serial: string): boolean {
    return otherTabDevices.some(e =>
      e.steegId === `STEEG_${serial}` || e.steegId === serial,
    );
  }

  function getEffectivePort(dev: UnifiedDevice): SerialPort | null {
    return dev.port ?? portPairings.get(dev.serialNumber) ?? null;
  }

  /**
   * Authorize New Device:
   *   Step 1 — WebUSB picker shows productNames (e.g. "STEEG_DG085134") → user picks device
   *   Step 2 — Brief pause so the selected name is visible in this modal
   *   Step 3 — COM picker opens (shows "USB Serial Port (COM10)" etc.) → user picks manually
   *   Result — device ↔ COM pairing stored; Connect button is now ready
   */
  const handleAuthorizeNew = useCallback(async () => {
    if (!webUsbAvailable) return;
    setStatusMsg(null);
    setScanning(true);

    const device = await requestNewFtdiDevice();
    setScanning(false);
    if (!device?.serialNumber) return;

    const deviceDisplayId = toDisplayId(device.productName ?? '', device.serialNumber);
    setSelectedSerial(device.serialNumber);

    // Show selected device name briefly before COM picker opens
    setStatusMsg(T(lang, 'connectModalSelectedHint').replace('{id}', deviceDisplayId));
    await new Promise(r => setTimeout(r, 500));

    const port = await requestFtdiPort();
    if (!port) {
      setStatusMsg(null);
      await refresh();
      return;
    }

    setPortPairings(prev => new Map(prev).set(device.serialNumber, port));
    setStatusMsg(null);
    await refresh();
  }, [webUsbAvailable, refresh, lang]);

  /** Manually assign a COM port to a specific device */
  const handleSelectCom = useCallback(async (dev: UnifiedDevice) => {
    const port = await requestFtdiPort();
    if (!port) return;
    setPortPairings(prev => new Map(prev).set(dev.serialNumber, port));
    setSelectedSerial(dev.serialNumber);
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const selected = devices.find(d => d.serialNumber === selectedSerial);
    const displayId = selected?.displayId ?? selectedSerial;
    const effectivePort = selected ? getEffectivePort(selected) : null;

    if (effectivePort) {
      onConnect(effectivePort, displayId || undefined, selected?.serialNumber || undefined);
    } else {
      const port = await requestFtdiPort();
      onConnect(port, displayId || undefined, selected?.serialNumber || undefined);
    }
    setConnecting(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, onConnect, selectedSerial, portPairings]);

  const handleClearAll = useCallback(async () => {
    setScanning(true);
    setSelectedSerial('');
    setPortPairings(new Map());
    setStatusMsg(null);
    await Promise.all([forgetAllFtdiDevices(), forgetAllFtdiPorts()]);
    clearRegistry();
    await refresh();
  }, [refresh]);

  const handleOverlayClick = useCallback((e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const btnBase = {
    borderRadius: 7, fontSize: 13, fontWeight: 600,
    padding: '8px 18px', cursor: 'pointer', transition: 'background 0.15s',
  } as const;

  const selectedDevice = devices.find(d => d.serialNumber === selectedSerial);
  const selectedDisplayId = selectedDevice?.displayId ?? '';
  const needsPicker = !selectedDevice || !getEffectivePort(selectedDevice);
  const isBusy = scanning || connecting;

  return (
    <div
      onClick={handleOverlayClick}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div style={{
        background: 'linear-gradient(135deg, #0d1520 0%, #0a1220 100%)',
        border: '1px solid rgba(93,109,134,0.45)',
        borderRadius: 16,
        padding: '28px 32px',
        width: 480,
        maxWidth: 'calc(100vw - 32px)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#c5d8f0' }}>
            {T(lang, 'connectModalTitle')}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none',
            color: 'rgba(180,200,230,0.5)', fontSize: 20,
            cursor: 'pointer', lineHeight: 1, padding: '0 4px',
          }}>×</button>
        </div>

        {/* Device list — Web Serial path only (desktop Chrome) */}
        {hasWebSerial && <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'rgba(140,165,200,0.7)', fontWeight: 500 }}>
              {T(lang, 'connectModalDetectedDevices')}
            </span>
            <button
              onClick={refresh}
              disabled={isBusy}
              style={{
                background: 'transparent', border: '1px solid rgba(88,166,255,0.3)',
                borderRadius: 5, color: '#58a6ff',
                fontSize: 11, fontWeight: 600, padding: '3px 9px',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                opacity: isBusy ? 0.5 : 1,
              }}
            >
              {scanning ? '...' : T(lang, 'connectModalRefresh')}
            </button>
          </div>

          {!webUsbAvailable ? (
            <div style={{ fontSize: 12, color: 'rgba(248,81,73,0.7)', padding: '6px 0' }}>
              {T(lang, 'homeWebUsbNotAvailable')}
            </div>
          ) : devices.length === 0 ? (
            <div style={{
              fontSize: 12, color: 'rgba(130,155,185,0.5)',
              padding: '12px 14px',
              background: 'rgba(10,20,35,0.5)',
              borderRadius: 8, border: '1px dashed rgba(93,109,134,0.3)',
              textAlign: 'center',
            }}>
              {T(lang, 'connectModalNoDevices')}
            </div>
          ) : (
            <>
              {devices.length > 1 && (
                <div style={{ fontSize: 11, color: 'rgba(140,165,200,0.55)', marginBottom: 6 }}>
                  {T(lang, 'connectModalSelectDevice')}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {devices.map((dev, i) => {
                  const paired = isPaired(dev.serialNumber);
                  const isSelected = dev.serialNumber === selectedSerial;
                  const effectivePort = getEffectivePort(dev);
                  return (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
                      {/* Device row */}
                      <div
                        onClick={() => !paired && setSelectedSerial(dev.serialNumber)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 14px',
                          background: isSelected
                            ? 'rgba(88,166,255,0.12)'
                            : paired ? 'rgba(248,81,73,0.06)' : 'rgba(63,185,80,0.07)',
                          border: `2px solid ${isSelected ? 'rgba(88,166,255,0.7)'
                            : paired ? 'rgba(248,81,73,0.25)' : 'rgba(63,185,80,0.22)'}`,
                          borderRadius: '8px 8px 0 0',
                          cursor: paired ? 'default' : 'pointer',
                          userSelect: 'none',
                        }}
                      >
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: paired ? '#f85149' : effectivePort ? '#3fb950' : '#f0a830',
                          boxShadow: `0 0 5px ${paired ? '#f85149' : effectivePort ? '#3fb950' : '#f0a830'}`,
                        }} />
                        <span style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: 13, fontWeight: 700,
                          color: isSelected ? '#8ecfff' : '#7ec8f5',
                          flex: 1,
                        }}>
                          {dev.displayId}
                        </span>
                        {paired && (
                          <span style={{
                            fontSize: 11, fontWeight: 600, color: '#f85149',
                            background: 'rgba(248,81,73,0.12)',
                            border: '1px solid rgba(248,81,73,0.3)',
                            borderRadius: 4, padding: '2px 7px',
                          }}>
                            {T(lang, 'connectModalPaired')}
                          </span>
                        )}
                        {isSelected && !paired && (
                          <span style={{ fontSize: 14, color: '#58a6ff', fontWeight: 700, lineHeight: 1 }}>✓</span>
                        )}
                      </div>

                      {/* COM port sub-row */}
                      {!paired && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '5px 14px',
                          background: effectivePort ? 'rgba(63,185,80,0.05)' : 'rgba(240,168,48,0.05)',
                          border: `1px solid ${effectivePort ? 'rgba(63,185,80,0.2)' : 'rgba(240,168,48,0.2)'}`,
                          borderTop: 'none', borderRadius: '0 0 8px 8px',
                        }}>
                          <span style={{
                            fontSize: 11,
                            color: effectivePort ? 'rgba(63,185,80,0.85)' : 'rgba(240,168,48,0.8)',
                            flex: 1,
                          }}>
                            {effectivePort
                              ? T(lang, 'connectModalPortReady')
                              : T(lang, 'connectModalNeedsPairing')}
                          </span>
                          {!effectivePort && (
                            <button
                              onClick={() => handleSelectCom(dev)}
                              disabled={isBusy}
                              style={{
                                background: 'rgba(240,168,48,0.1)',
                                border: '1px solid rgba(240,168,48,0.35)',
                                borderRadius: 5, color: 'rgba(240,168,48,0.9)',
                                fontSize: 11, fontWeight: 600,
                                padding: '2px 9px', cursor: isBusy ? 'not-allowed' : 'pointer',
                              }}
                            >
                              {T(lang, 'connectModalPairPort')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>}  {/* end hasWebSerial device list */}

        {/* Status message (authorize flow feedback) — Web Serial only */}
        {hasWebSerial && statusMsg && (
          <div style={{
            marginBottom: 12, fontSize: 11,
            color: 'rgba(135,175,220,0.8)',
            padding: '7px 12px',
            background: 'rgba(88,166,255,0.06)',
            border: '1px solid rgba(88,166,255,0.2)',
            borderRadius: 6, lineHeight: 1.5,
          }}>
            {statusMsg}
          </div>
        )}

        {/* Authorize / Clear buttons — Web Serial only */}
        {hasWebSerial && webUsbAvailable && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={handleAuthorizeNew}
              disabled={isBusy}
              style={{
                ...btnBase, background: 'rgba(88,166,255,0.08)',
                border: '1px solid rgba(88,166,255,0.3)', color: '#58a6ff',
                width: '100%', opacity: isBusy ? 0.5 : 1,
                cursor: isBusy ? 'not-allowed' : 'pointer',
              }}
            >
              {T(lang, 'connectModalAuthorizeNew')}
            </button>
            <button
              onClick={handleClearAll}
              disabled={isBusy}
              style={{
                ...btnBase, background: 'rgba(248,81,73,0.07)',
                border: '1px solid rgba(248,81,73,0.25)', color: 'rgba(248,81,73,0.7)',
                width: '100%', opacity: isBusy ? 0.5 : 1,
                cursor: isBusy ? 'not-allowed' : 'pointer', marginTop: 8,
              }}
            >
              {T(lang, 'connectModalClearAll')}
            </button>
          </div>
        )}

        {hasWebSerial && <div style={{ borderTop: '1px solid rgba(93,109,134,0.2)', marginBottom: 16 }} />}

        {/* Hint before Connect — Web Serial only */}
        {hasWebSerial && selectedDisplayId && needsPicker && (
          <div style={{
            marginBottom: 14, fontSize: 12, color: 'rgba(135,175,220,0.75)',
            padding: '8px 12px', background: 'rgba(88,166,255,0.06)',
            border: '1px solid rgba(88,166,255,0.2)', borderRadius: 7,
          }}>
            {T(lang, 'connectModalSelectedHint').replace('{id}', selectedDisplayId)}
          </div>
        )}
        {hasWebSerial && selectedDisplayId && !needsPicker && (
          <div style={{
            marginBottom: 14, fontSize: 12, color: 'rgba(63,185,80,0.8)',
            padding: '8px 12px', background: 'rgba(63,185,80,0.05)',
            border: '1px solid rgba(63,185,80,0.2)', borderRadius: 7,
          }}>
            {T(lang, 'connectModalOnePortReady')}
          </div>
        )}

        {/* Connect button — Web Serial path (desktop) */}
        {hasWebSerial && (
          <button
            onClick={handleConnect}
            disabled={connecting || (devices.length > 0 && !selectedSerial)}
            style={{
              ...btnBase,
              background: connecting ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.18)',
              border: `1px solid ${connecting ? 'rgba(88,166,255,0.4)' : 'rgba(63,185,80,0.5)'}`,
              color: connecting ? '#58a6ff' : '#3fb950',
              width: '100%', fontSize: 14, fontWeight: 700, padding: '11px 0',
              cursor: (connecting || (devices.length > 0 && !selectedSerial)) ? 'not-allowed' : 'pointer',
              opacity: (devices.length > 0 && !selectedSerial) ? 0.45 : 1,
            }}
          >
            {connecting ? T(lang, 'connecting') : T(lang, 'connectModalConnect')}
          </button>
        )}

        {/* ── Android / WebUSB direct path ──────────────────────────── */}
        {!hasWebSerial && (
          <div style={{
            marginTop: 4,
            padding: '16px 18px',
            background: 'rgba(88,166,255,0.05)',
            border: '1px solid rgba(88,166,255,0.25)',
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#8ecfff', marginBottom: 8 }}>
              {T(lang, 'connectAndroidTitle')}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(135,175,220,0.7)', marginBottom: 14, lineHeight: 1.55 }}>
              {T(lang, 'connectAndroidHint')}
            </div>
            {!hasWebUsb ? (
              <div style={{ fontSize: 12, color: 'rgba(248,81,73,0.7)' }}>
                {T(lang, 'connectAndroidNoUsb')}
              </div>
            ) : (
              <>
                <button
                  onClick={handleAndroidConnect}
                  disabled={androidConnecting}
                  style={{
                    ...btnBase,
                    background: androidConnecting ? 'rgba(88,166,255,0.08)' : 'rgba(88,166,255,0.18)',
                    border: '1px solid rgba(88,166,255,0.5)',
                    color: androidConnecting ? 'rgba(88,166,255,0.5)' : '#58a6ff',
                    width: '100%', fontSize: 14, fontWeight: 700, padding: '11px 0',
                    cursor: androidConnecting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {androidConnecting
                    ? T(lang, 'connectAndroidConnecting')
                    : T(lang, 'connectAndroidButton')}
                </button>
                {androidError && (
                  <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(248,81,73,0.8)' }}>
                    {androidError}
                  </div>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

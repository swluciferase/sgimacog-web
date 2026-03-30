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
  getOtherTabDevices,
  onRegistryChange,
  clearRegistry,
  type RegistryEntry,
} from '../../services/deviceRegistry';

// ── Types ──

interface UnifiedDevice {
  /** USB serial number (e.g. "AV0KHCQP") — used internally for port matching */
  serialNumber: string;
  /**
   * Display identifier: productName if non-generic (e.g. "DG085134"),
   * otherwise falls back to serialNumber.
   */
  displayId: string;
  /** Port matched via getInfo().usbSerialNumber (Chrome 121+), may be null */
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

/** Returns a non-generic display ID: productName if custom, else serialNumber */
function toDisplayId(productName: string, serialNumber: string): string {
  const generic = ['USB Serial', 'USB Serial Port', 'FT232R USB UART', ''];
  return generic.includes(productName.trim()) ? serialNumber : productName.trim();
}

// ── Props ──

interface ConnectModalProps {
  lang: Lang;
  /** displayId = productName as-is; usbSerial = raw USB serialNumber for validation */
  onConnect: (port: SerialPort | null, displayId?: string, usbSerial?: string) => void;
  onClose: () => void;
}

// ── Component ──

export const ConnectModal: FC<ConnectModalProps> = ({ lang, onConnect, onClose }) => {
  const [devices, setDevices] = useState<UnifiedDevice[]>([]);
  const [otherTabDevices, setOtherTabDevices] = useState<RegistryEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState<string>('');
  /**
   * Manually established pairings: USB serialNumber → SerialPort.
   * Built when user clicks "Pair COM Port" or during "Authorize New Device".
   * Survives re-scans within this modal session.
   */
  const [portPairings, setPortPairings] = useState<Map<string, SerialPort>>(new Map());

  const webUsbAvailable = isWebUsbAvailable();

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
      // Try to match port via usbSerialNumber (Chrome 121+)
      const matchedPort = portsWithSerial.find(p => p.serialNumber === serial)?.port ?? null;
      unified.push({
        serialNumber: serial,
        displayId: toDisplayId(dev.productName, serial),
        port: matchedPort,
      });
    }

    // Web Serial ports with readable serial not already covered by WebUSB
    for (const pw of portsWithSerial) {
      if (pw.serialNumber && !seen.has(pw.serialNumber)) {
        seen.add(pw.serialNumber);
        unified.push({
          serialNumber: pw.serialNumber,
          displayId: pw.serialNumber,
          port: pw.port,
        });
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

  /** Get the effective SerialPort: auto-matched > manually paired */
  function getEffectivePort(dev: UnifiedDevice): SerialPort | null {
    return dev.port ?? portPairings.get(dev.serialNumber) ?? null;
  }

  /**
   * Manually pair a COM port to a specific device.
   * Opens the browser's serial port picker, then validates that the chosen
   * port's usbSerialNumber matches the device's USB serialNumber (Chrome 121+).
   * Rejects the pairing if there is a mismatch.
   */
  const handlePairPort = useCallback(async (dev: UnifiedDevice) => {
    const port = await requestFtdiPort();
    if (!port) return;

    // Validate via usbSerialNumber when available (Chrome 121+)
    const info = port.getInfo() as SerialPortInfo & { usbSerialNumber?: string };
    if (info.usbSerialNumber && dev.serialNumber) {
      if (info.usbSerialNumber !== dev.serialNumber) {
        alert(T(lang, 'connectModalMismatchWarning')
          .replace('{device}', `STEEG_${dev.displayId}`)
          .replace('{port}', info.usbSerialNumber));
        return; // reject
      }
    }

    setPortPairings(prev => new Map(prev).set(dev.serialNumber, port));
    setSelectedSerial(dev.serialNumber);
  }, [lang]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const selected = devices.find(d => d.serialNumber === selectedSerial);
    const displayId = selected?.displayId ?? selectedSerial;
    const effectivePort = selected ? getEffectivePort(selected) : null;

    if (effectivePort) {
      // Direct connect — no browser picker needed
      onConnect(effectivePort, displayId || undefined, selected?.serialNumber || undefined);
    } else {
      // Fallback: browser picker (port not yet matched/paired)
      const port = await requestFtdiPort();
      onConnect(port, displayId || undefined, selected?.serialNumber || undefined);
    }
    setConnecting(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, onConnect, selectedSerial, portPairings]);

  /**
   * Authorize a new device: WebUSB picker → Web Serial picker (in sequence).
   * After both steps, we know exactly which COM port belongs to which device.
   */
  const handleAuthorizeNew = useCallback(async () => {
    if (!webUsbAvailable) return;
    setScanning(true);

    // Step 1: WebUSB — get device identity (productName, serialNumber)
    const device = await requestNewFtdiDevice();
    if (device?.serialNumber) {
      setSelectedSerial(device.serialNumber);

      // Step 2: Web Serial — pair the COM port
      const port = await requestFtdiPort();
      if (port) {
        const info = port.getInfo() as SerialPortInfo & { usbSerialNumber?: string };
        if (info.usbSerialNumber && info.usbSerialNumber !== device.serialNumber) {
          alert(T(lang, 'connectModalMismatchWarning')
            .replace('{device}', device.productName || device.serialNumber)
            .replace('{port}', info.usbSerialNumber));
          // Don't store the mismatched pairing
        } else {
          setPortPairings(prev => new Map(prev).set(device.serialNumber, port));
        }
      }
    }

    await refresh();
  }, [webUsbAvailable, refresh, lang]);

  const handleClearAll = useCallback(async () => {
    setScanning(true);
    setSelectedSerial('');
    setPortPairings(new Map());
    await Promise.all([forgetAllFtdiDevices(), forgetAllFtdiPorts()]);
    clearRegistry();
    await refresh();
  }, [refresh]);

  const handleOverlayClick = useCallback((e: MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  const btnBase = {
    borderRadius: 7,
    fontSize: 13,
    fontWeight: 600,
    padding: '8px 18px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  } as const;

  const selectedDevice = devices.find(d => d.serialNumber === selectedSerial);
  const selectedDisplayId = selectedDevice?.displayId ?? '';
  const needsPicker = !selectedDevice || !getEffectivePort(selectedDevice);

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
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: 'rgba(180,200,230,0.5)', fontSize: 20,
              cursor: 'pointer', lineHeight: 1, padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        {/* Device list */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: 'rgba(140,165,200,0.7)', fontWeight: 500 }}>
              {T(lang, 'connectModalDetectedDevices')}
            </span>
            <button
              onClick={refresh}
              disabled={scanning}
              style={{
                background: 'transparent', border: '1px solid rgba(88,166,255,0.3)',
                borderRadius: 5, color: '#58a6ff',
                fontSize: 11, fontWeight: 600, padding: '3px 9px',
                cursor: scanning ? 'not-allowed' : 'pointer',
                opacity: scanning ? 0.5 : 1,
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
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {/* Main device row */}
                      <div
                        onClick={() => !paired && setSelectedSerial(dev.serialNumber)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '9px 14px',
                          background: isSelected
                            ? 'rgba(88,166,255,0.12)'
                            : paired ? 'rgba(248,81,73,0.06)' : 'rgba(63,185,80,0.07)',
                          border: `2px solid ${
                            isSelected ? 'rgba(88,166,255,0.7)'
                            : paired ? 'rgba(248,81,73,0.25)' : 'rgba(63,185,80,0.22)'
                          }`,
                          borderRadius: effectivePort || paired ? '8px 8px 0 0' : 8,
                          cursor: paired ? 'default' : 'pointer',
                          transition: 'border-color 0.15s, background 0.15s',
                          userSelect: 'none',
                        }}
                      >
                        {/* Status dot */}
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: paired ? '#f85149' : effectivePort ? '#3fb950' : '#f0a830',
                          boxShadow: `0 0 5px ${paired ? '#f85149' : effectivePort ? '#3fb950' : '#f0a830'}`,
                        }} />

                        {/* Device label: productName as-is, e.g. "STEEG_DG085134" */}
                        <span style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                          fontSize: 13, fontWeight: 700,
                          color: isSelected ? '#8ecfff' : '#7ec8f5',
                          flex: 1,
                        }}>
                          {dev.displayId}
                        </span>

                        {/* Paired badge */}
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

                        {/* Selected checkmark */}
                        {isSelected && !paired && (
                          <span style={{ fontSize: 14, color: '#58a6ff', fontWeight: 700, lineHeight: 1 }}>
                            ✓
                          </span>
                        )}
                      </div>

                      {/* COM port sub-row */}
                      {!paired && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 14px',
                          background: effectivePort
                            ? 'rgba(63,185,80,0.05)'
                            : 'rgba(240,168,48,0.05)',
                          border: `1px solid ${effectivePort ? 'rgba(63,185,80,0.2)' : 'rgba(240,168,48,0.25)'}`,
                          borderTop: 'none',
                          borderRadius: '0 0 8px 8px',
                        }}>
                          <span style={{
                            fontSize: 11,
                            color: effectivePort ? 'rgba(63,185,80,0.8)' : 'rgba(240,168,48,0.8)',
                            flex: 1,
                          }}>
                            {effectivePort
                              ? T(lang, 'connectModalPortReady')
                              : T(lang, 'connectModalNeedsPairing')}
                          </span>
                          {!effectivePort && (
                            <button
                              onClick={() => handlePairPort(dev)}
                              style={{
                                background: 'rgba(240,168,48,0.1)',
                                border: '1px solid rgba(240,168,48,0.35)',
                                borderRadius: 5,
                                color: 'rgba(240,168,48,0.9)',
                                fontSize: 11, fontWeight: 600,
                                padding: '3px 10px', cursor: 'pointer',
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
        </div>

        {/* Authorize new device */}
        {webUsbAvailable && (
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={handleAuthorizeNew}
              disabled={scanning}
              style={{
                ...btnBase,
                background: 'rgba(88,166,255,0.08)',
                border: '1px solid rgba(88,166,255,0.3)',
                color: '#58a6ff',
                width: '100%',
                opacity: scanning ? 0.5 : 1,
                cursor: scanning ? 'not-allowed' : 'pointer',
              }}
            >
              {T(lang, 'connectModalAuthorizeNew')}
            </button>
            <button
              onClick={handleClearAll}
              disabled={scanning}
              style={{
                ...btnBase,
                background: 'rgba(248,81,73,0.07)',
                border: '1px solid rgba(248,81,73,0.25)',
                color: 'rgba(248,81,73,0.7)',
                width: '100%',
                opacity: scanning ? 0.5 : 1,
                cursor: scanning ? 'not-allowed' : 'pointer',
                marginTop: 8,
              }}
            >
              {T(lang, 'connectModalClearAll')}
            </button>
          </div>
        )}

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(93,109,134,0.2)', marginBottom: 16 }} />

        {/* Status hint */}
        {selectedDisplayId && needsPicker && (
          <div style={{
            marginBottom: 14,
            fontSize: 12, color: 'rgba(135,175,220,0.75)',
            padding: '8px 12px',
            background: 'rgba(88,166,255,0.06)',
            border: '1px solid rgba(88,166,255,0.2)',
            borderRadius: 7,
          }}>
            {T(lang, 'connectModalSelectedHint').replace('{id}', selectedDisplayId)}
          </div>
        )}
        {selectedDisplayId && !needsPicker && (
          <div style={{
            marginBottom: 14,
            fontSize: 12, color: 'rgba(63,185,80,0.8)',
            padding: '8px 12px',
            background: 'rgba(63,185,80,0.05)',
            border: '1px solid rgba(63,185,80,0.2)',
            borderRadius: 7,
          }}>
            {T(lang, 'connectModalOnePortReady')}
          </div>
        )}

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={connecting || (devices.length > 0 && !selectedSerial)}
          style={{
            ...btnBase,
            background: connecting ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.18)',
            border: `1px solid ${connecting ? 'rgba(88,166,255,0.4)' : 'rgba(63,185,80,0.5)'}`,
            color: connecting ? '#58a6ff' : '#3fb950',
            width: '100%',
            fontSize: 14,
            fontWeight: 700,
            padding: '11px 0',
            cursor: (connecting || (devices.length > 0 && !selectedSerial)) ? 'not-allowed' : 'pointer',
            opacity: (devices.length > 0 && !selectedSerial) ? 0.45 : 1,
          }}
        >
          {connecting ? T(lang, 'connecting') : T(lang, 'connectModalConnect')}
        </button>

      </div>
    </div>
  );
};

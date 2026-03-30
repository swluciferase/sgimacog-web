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

/**
 * Unified device entry — merges WebUSB device info with a matched Web Serial port.
 * A device may appear here from:
 *   a) WebUSB only (no Web Serial port authorized yet)
 *   b) Web Serial only (Chrome exposes usbSerialNumber via getInfo())
 *   c) Both (port is directly matched by serial number — preferred path)
 */
interface UnifiedDevice {
  serialNumber: string;   // USB serial, e.g. "DG085134"
  productName: string;
  /** Directly matched SerialPort — when set, Connect needs no browser picker */
  port: SerialPort | null;
  hasWebUsb: boolean;
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

// ── Props ──

interface ConnectModalProps {
  lang: Lang;
  onConnect: (port: SerialPort | null, usbSerial?: string) => void;
  onClose: () => void;
}

// ── Component ──

export const ConnectModal: FC<ConnectModalProps> = ({ lang, onConnect, onClose }) => {
  const [devices, setDevices] = useState<UnifiedDevice[]>([]);
  const [otherTabDevices, setOtherTabDevices] = useState<RegistryEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedSerial, setSelectedSerial] = useState<string>('');

  const webUsbAvailable = isWebUsbAvailable();

  const refresh = useCallback(async () => {
    setScanning(true);
    const [usbDevices, portsWithSerial] = await Promise.all([
      getAuthorizedFtdiDevices(),
      getAuthorizedFtdiPortsWithSerial(),
    ]);

    // Build unified list: merge WebUSB devices + Web Serial ports by serial number.
    // Chrome 121+ exposes usbSerialNumber via port.getInfo(), so we can match them.
    const seen = new Set<string>();
    const unified: UnifiedDevice[] = [];

    // 1. WebUSB-authorized devices (authoritative source for serial numbers)
    for (const dev of usbDevices) {
      const serial = dev.serialNumber;
      if (serial) seen.add(serial);
      const matchedPort = portsWithSerial.find(p => p.serialNumber === serial)?.port ?? null;
      unified.push({
        serialNumber: serial,
        productName: dev.productName,
        port: matchedPort,
        hasWebUsb: true,
      });
    }

    // 2. Web Serial ports with a readable serial number (not already in list)
    //    This covers devices where user authorized Web Serial but not WebUSB.
    for (const pw of portsWithSerial) {
      if (pw.serialNumber && !seen.has(pw.serialNumber)) {
        seen.add(pw.serialNumber);
        unified.push({
          serialNumber: pw.serialNumber,
          productName: 'USB Serial',
          port: pw.port,
          hasWebUsb: false,
        });
      }
    }

    // 3. Web Serial ports with no readable serial (last resort, unidentifiable)
    for (const pw of portsWithSerial) {
      if (!pw.serialNumber) {
        unified.push({
          serialNumber: '',
          productName: 'USB Serial Port',
          port: pw.port,
          hasWebUsb: false,
        });
      }
    }

    setDevices(unified);
    setOtherTabDevices(getOtherTabDevices());
    setScanning(false);

    // Auto-select when only one unpaired device
    if (unified.length === 1 && unified[0]?.serialNumber) {
      setSelectedSerial(unified[0].serialNumber);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onRegistryChange(() => {
      setOtherTabDevices(getOtherTabDevices());
    });
    return unsub;
  }, [refresh]);

  function isPaired(serial: string): boolean {
    const candidate = `STEEG_${serial}`;
    return otherTabDevices.some(e =>
      e.steegId === candidate || e.steegId === serial,
    );
  }

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const selected = devices.find(d => d.serialNumber === selectedSerial);

    if (selected?.port) {
      // Best case: port is directly matched — no browser picker needed!
      onConnect(selected.port, selected.serialNumber || undefined);
    } else {
      // Fallback: show browser picker (no matched port)
      const port = await requestFtdiPort();
      onConnect(port, selectedSerial || undefined);
    }
    setConnecting(false);
  }, [devices, onConnect, selectedSerial]);

  const handleAuthorizeNew = useCallback(async () => {
    if (!webUsbAvailable) return;
    setScanning(true);
    const device = await requestNewFtdiDevice();
    if (device?.serialNumber) {
      setSelectedSerial(device.serialNumber);
    }
    await refresh();
  }, [webUsbAvailable, refresh]);

  const handleClearAll = useCallback(async () => {
    setScanning(true);
    setSelectedSerial('');
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

  const selectedId = selectedSerial ? `STEEG_${selectedSerial}` : '';
  const selectedDevice = devices.find(d => d.serialNumber === selectedSerial);
  // needsPicker: port is not directly matched, must show browser picker
  const needsPicker = !selectedDevice?.port;

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
        width: 460,
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

          {devices.length === 0 ? (
            <div style={{
              fontSize: 12,
              color: 'rgba(130,155,185,0.5)',
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
                  const paired = dev.serialNumber ? isPaired(dev.serialNumber) : false;
                  const isSelected = dev.serialNumber !== '' && dev.serialNumber === selectedSerial;
                  const label = dev.serialNumber ? `STEEG_${dev.serialNumber}` : dev.productName;
                  return (
                    <div
                      key={i}
                      onClick={() => !paired && dev.serialNumber && setSelectedSerial(dev.serialNumber)}
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
                        borderRadius: 8,
                        cursor: (paired || !dev.serialNumber) ? 'default' : 'pointer',
                        transition: 'border-color 0.15s, background 0.15s',
                        userSelect: 'none',
                      }}
                    >
                      {/* Status dot */}
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: paired ? '#f85149' : '#3fb950',
                        boxShadow: paired ? '0 0 5px #f85149' : '0 0 5px #3fb950',
                      }} />

                      {/* Device label */}
                      <span style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: 13, fontWeight: 700,
                        color: isSelected ? '#8ecfff' : '#7ec8f5',
                        flex: 1,
                      }}>
                        {label}
                      </span>

                      {/* Direct-connect badge */}
                      {dev.port && !paired && (
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: '#3fb950',
                          background: 'rgba(63,185,80,0.1)',
                          border: '1px solid rgba(63,185,80,0.3)',
                          borderRadius: 4, padding: '2px 6px',
                        }}>
                          {T(lang, 'connectModalPortReady')}
                        </span>
                      )}

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
                        <span style={{
                          fontSize: 14, color: '#58a6ff', fontWeight: 700,
                          lineHeight: 1,
                        }}>
                          ✓
                        </span>
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
        {selectedId && needsPicker && (
          <div style={{
            marginBottom: 14,
            fontSize: 12, color: 'rgba(135,175,220,0.75)',
            padding: '8px 12px',
            background: 'rgba(88,166,255,0.06)',
            border: '1px solid rgba(88,166,255,0.2)',
            borderRadius: 7,
          }}>
            {T(lang, 'connectModalSelectedHint').replace('{id}', selectedId)}
          </div>
        )}
        {selectedId && !needsPicker && (
          <div style={{
            marginBottom: 14,
            fontSize: 12, color: 'rgba(135,175,220,0.65)',
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

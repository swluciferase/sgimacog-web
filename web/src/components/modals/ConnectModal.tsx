import { type FC, type MouseEvent, useState, useEffect, useCallback } from 'react';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import {
  getAuthorizedFtdiDevices,
  requestNewFtdiDevice,
  isWebUsbAvailable,
  forgetAllFtdiDevices,
  forgetAllFtdiPorts,
  type FtdiDeviceInfo,
} from '../../services/ftdiScanner';
import {
  getOtherTabDevices,
  onRegistryChange,
  clearRegistry,
  type RegistryEntry,
} from '../../services/deviceRegistry';

// ── Web Serial port helpers ──

async function getAuthorizedFtdiPorts(): Promise<SerialPort[]> {
  try {
    const ports = await navigator.serial.getPorts();
    return ports.filter(p => {
      const info = p.getInfo();
      return info.usbVendorId === 0x0403 && info.usbProductId === 0x6001;
    });
  } catch {
    return [];
  }
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

interface ConnectModalProps {
  lang: Lang;
  onConnect: (port: SerialPort | null, usbSerial?: string) => void;
  onClose: () => void;
}

export const ConnectModal: FC<ConnectModalProps> = ({ lang, onConnect, onClose }) => {
  const [usbDevices, setUsbDevices] = useState<FtdiDeviceInfo[]>([]);
  const [authorizedPorts, setAuthorizedPorts] = useState<SerialPort[]>([]);
  const [otherTabDevices, setOtherTabDevices] = useState<RegistryEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  // The serial the user explicitly selected (or auto-selected if only 1 device)
  const [selectedSerial, setSelectedSerial] = useState<string>('');

  const webUsbAvailable = isWebUsbAvailable();

  const refresh = useCallback(async () => {
    setScanning(true);
    const [usb, ports] = await Promise.all([
      getAuthorizedFtdiDevices(),
      getAuthorizedFtdiPorts(),
    ]);
    setUsbDevices(usb);
    setAuthorizedPorts(ports);
    setOtherTabDevices(getOtherTabDevices());
    setScanning(false);
    // Auto-select if only one device
    if (usb.length === 1 && usb[0]?.serialNumber) {
      setSelectedSerial(usb[0].serialNumber);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onRegistryChange(() => {
      setOtherTabDevices(getOtherTabDevices());
    });
    return unsub;
  }, [refresh]);

  function isPaired(usbSerial: string): boolean {
    const candidate = `STEEG_${usbSerial}`;
    return otherTabDevices.some(e =>
      e.steegId === candidate || e.steegId === usbSerial,
    );
  }

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    const serial = selectedSerial;

    if (authorizedPorts.length === 1) {
      // Exactly one port authorized → auto-connect, no picker needed
      onConnect(authorizedPorts[0]!, serial || undefined);
    } else {
      // Multiple or zero ports → show browser picker (user picks COM port)
      const port = await requestFtdiPort();
      onConnect(port, serial || undefined);
    }
    setConnecting(false);
  }, [authorizedPorts, onConnect, selectedSerial]);

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

  const needsPicker = authorizedPorts.length !== 1;
  const selectedId = selectedSerial ? `STEEG_${selectedSerial}` : '';

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

        {/* Device list (WebUSB) — each row is clickable */}
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
          ) : usbDevices.length === 0 ? (
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
              {usbDevices.length > 1 && (
                <div style={{ fontSize: 11, color: 'rgba(140,165,200,0.55)', marginBottom: 6 }}>
                  {T(lang, 'connectModalSelectDevice')}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {usbDevices.map((dev, i) => {
                  const paired = isPaired(dev.serialNumber);
                  const isSelected = dev.serialNumber === selectedSerial;
                  return (
                    <div
                      key={i}
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
                        borderRadius: 8,
                        cursor: paired ? 'default' : 'pointer',
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

                      {/* Device ID */}
                      <span style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: 13, fontWeight: 700,
                        color: isSelected ? '#8ecfff' : '#7ec8f5',
                        flex: 1,
                      }}>
                        {dev.serialNumber ? `STEEG_${dev.serialNumber}` : dev.productName}
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

        {/* Status / hint */}
        {needsPicker && selectedId && (
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
        {!needsPicker && authorizedPorts.length === 1 && (
          <div style={{
            marginBottom: 14,
            fontSize: 12, color: 'rgba(135,175,220,0.65)',
            padding: '8px 12px',
            background: 'rgba(88,166,255,0.05)',
            border: '1px solid rgba(88,166,255,0.15)',
            borderRadius: 7,
          }}>
            {T(lang, 'connectModalOnePortReady')}
          </div>
        )}

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={connecting || (usbDevices.length > 0 && !selectedSerial)}
          style={{
            ...btnBase,
            background: connecting ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.18)',
            border: `1px solid ${connecting ? 'rgba(88,166,255,0.4)' : 'rgba(63,185,80,0.5)'}`,
            color: connecting ? '#58a6ff' : '#3fb950',
            width: '100%',
            fontSize: 14,
            fontWeight: 700,
            padding: '11px 0',
            cursor: (connecting || (usbDevices.length > 0 && !selectedSerial)) ? 'not-allowed' : 'pointer',
            opacity: (usbDevices.length > 0 && !selectedSerial) ? 0.45 : 1,
          }}
        >
          {connecting ? T(lang, 'connecting') : T(lang, 'connectModalConnect')}
        </button>

      </div>
    </div>
  );
};

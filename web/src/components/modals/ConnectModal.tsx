import { type FC, type MouseEvent, useState, useEffect, useCallback } from 'react';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import {
  getAuthorizedFtdiDevices,
  requestNewFtdiDevice,
  isWebUsbAvailable,
  type FtdiDeviceInfo,
} from '../../services/ftdiScanner';
import {
  getOtherTabDevices,
  onRegistryChange,
  type RegistryEntry,
} from '../../services/deviceRegistry';

// ── Web Serial port helpers (navigator.serial not in TS DOM by default for getPorts) ──
// We rely on the w3c-web-serial types that are already in tsconfig.

async function getAuthorizedFtdiPorts(): Promise<SerialPort[]> {
  try {
    const ports = await navigator.serial.getPorts();
    // Filter by FTDI VID/PID
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
    return null; // user cancelled
  }
}

interface ConnectModalProps {
  lang: Lang;
  /** Called with a pre-selected port (auto-found) or null (use picker). */
  onConnect: (port: SerialPort | null) => void;
  onClose: () => void;
}

export const ConnectModal: FC<ConnectModalProps> = ({ lang, onConnect, onClose }) => {
  const [usbDevices, setUsbDevices] = useState<FtdiDeviceInfo[]>([]);
  const [authorizedPorts, setAuthorizedPorts] = useState<SerialPort[]>([]);
  const [otherTabDevices, setOtherTabDevices] = useState<RegistryEntry[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);

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
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = onRegistryChange(() => {
      setOtherTabDevices(getOtherTabDevices());
    });
    return unsub;
  }, [refresh]);

  // Check whether a given USB serial is "paired" in another tab
  function isPaired(usbSerial: string): boolean {
    const candidate = `STEEG_${usbSerial}`;
    return otherTabDevices.some(e =>
      e.steegId === candidate || e.steegId === usbSerial,
    );
  }

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    if (authorizedPorts.length === 1) {
      // Exactly one FTDI port already authorized → use it directly (no picker)
      onConnect(authorizedPorts[0]!);
    } else if (authorizedPorts.length > 1) {
      // Multiple ports → show picker so user can choose
      const port = await requestFtdiPort();
      onConnect(port); // null if cancelled
    } else {
      // No pre-authorized ports → show picker (will also authorize)
      const port = await requestFtdiPort();
      onConnect(port); // null if cancelled
    }
    setConnecting(false);
  }, [authorizedPorts, onConnect]);

  const handleAuthorizeNew = useCallback(async () => {
    if (!webUsbAvailable) return;
    setScanning(true);
    await requestNewFtdiDevice();
    await refresh();
  }, [webUsbAvailable, refresh]);

  // Overlay click closes modal
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

        {/* Device list (WebUSB) */}
        <div style={{ marginBottom: 20 }}>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {usbDevices.map((dev, i) => {
                const paired = isPaired(dev.serialNumber);
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 14px',
                    background: paired ? 'rgba(248,81,73,0.06)' : 'rgba(63,185,80,0.07)',
                    border: `1px solid ${paired ? 'rgba(248,81,73,0.25)' : 'rgba(63,185,80,0.22)'}`,
                    borderRadius: 8,
                  }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: paired ? '#f85149' : '#3fb950',
                      boxShadow: paired ? '0 0 5px #f85149' : '0 0 5px #3fb950',
                    }} />
                    <span style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 13, fontWeight: 700, color: '#7ec8f5', flex: 1,
                    }}>
                      {dev.serialNumber ? `STEEG_${dev.serialNumber}` : dev.productName}
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
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Authorize new device */}
        {webUsbAvailable && (
          <div style={{ marginBottom: 20 }}>
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
          </div>
        )}

        {/* Divider */}
        <div style={{
          borderTop: '1px solid rgba(93,109,134,0.2)',
          marginBottom: 20,
        }} />

        {/* Authorized Web Serial ports info */}
        {authorizedPorts.length > 0 && (
          <div style={{
            marginBottom: 16,
            fontSize: 12, color: 'rgba(135,175,220,0.65)',
            padding: '8px 12px',
            background: 'rgba(88,166,255,0.05)',
            border: '1px solid rgba(88,166,255,0.15)',
            borderRadius: 7,
          }}>
            {authorizedPorts.length === 1
              ? T(lang, 'connectModalOnePortReady')
              : T(lang, 'connectModalMultiPortReady').replace('{n}', String(authorizedPorts.length))}
          </div>
        )}

        {/* Connect button */}
        <button
          onClick={handleConnect}
          disabled={connecting}
          style={{
            ...btnBase,
            background: connecting ? 'rgba(88,166,255,0.12)' : 'rgba(63,185,80,0.18)',
            border: `1px solid ${connecting ? 'rgba(88,166,255,0.4)' : 'rgba(63,185,80,0.5)'}`,
            color: connecting ? '#58a6ff' : '#3fb950',
            width: '100%',
            fontSize: 14,
            fontWeight: 700,
            padding: '11px 0',
            cursor: connecting ? 'not-allowed' : 'pointer',
          }}
        >
          {connecting ? T(lang, 'connecting') : T(lang, 'connectModalConnect')}
        </button>

      </div>
    </div>
  );
};

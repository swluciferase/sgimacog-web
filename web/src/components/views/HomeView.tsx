import { type FC, type ReactNode, useState, useEffect, useCallback } from 'react';
import type { ConnectionStatus } from '../../services/serial';
import type { DeviceStats } from '../../types/eeg';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import {
  getAuthorizedFtdiDevices,
  requestNewFtdiDevice,
  isWebUsbAvailable,
  type FtdiDeviceInfo,
} from '../../services/ftdiScanner';

export interface HomeViewProps {
  status: ConnectionStatus;
  stats: DeviceStats;
  deviceId: string | null;
  lang: Lang;
  onConnect: () => void;
  onDisconnect: () => void;
}

const BatteryBar: FC<{ level: number | null }> = ({ level }) => {
  if (level === null) return <span style={{ color: 'rgba(140,155,175,0.5)', fontSize: 13 }}>--</span>;

  const pct = Math.max(0, Math.min(100, level));
  const color = pct > 50 ? '#3fb950' : pct > 20 ? '#e3b341' : '#f85149';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        width: 44, height: 20, borderRadius: 3,
        border: `2px solid ${color}`,
        position: 'relative',
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.3)',
      }}>
        {/* battery nib */}
        <div style={{
          position: 'absolute',
          right: -5, top: '50%', transform: 'translateY(-50%)',
          width: 4, height: 10, background: color, borderRadius: '0 2px 2px 0',
        }} />
        {/* fill */}
        <div style={{
          position: 'absolute',
          left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: color,
          transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: 13, color, fontWeight: 600 }}>{pct}%</span>
    </div>
  );
};

const InfoRow: FC<{ label: string; value: ReactNode }> = ({ label, value }) => (
  <div style={{
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 0',
    borderBottom: '1px solid rgba(93,109,134,0.15)',
  }}>
    <span style={{ color: 'rgba(140,160,185,0.8)', fontSize: 13 }}>{label}</span>
    <span style={{ color: '#c5d8f0', fontSize: 13, fontWeight: 500 }}>{value}</span>
  </div>
);

export const HomeView: FC<HomeViewProps> = ({
  status, stats, deviceId, lang, onConnect, onDisconnect,
}) => {
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  // ── FTDI Device Scanner ──
  const webUsbAvailable = isWebUsbAvailable();
  const [ftdiDevices, setFtdiDevices] = useState<FtdiDeviceInfo[]>([]);
  const [scanning, setScanning] = useState(false);

  const refreshDevices = useCallback(async () => {
    if (!webUsbAvailable) return;
    setScanning(true);
    const devices = await getAuthorizedFtdiDevices();
    setFtdiDevices(devices);
    setScanning(false);
  }, [webUsbAvailable]);

  // Auto-scan on mount
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleAddDevice = useCallback(async () => {
    if (!webUsbAvailable) return;
    await requestNewFtdiDevice();
    await refreshDevices();
  }, [webUsbAvailable, refreshDevices]);

  const statusColor =
    isConnected   ? '#3fb950' :
    isConnecting  ? '#58a6ff' :
    status === 'error' ? '#f85149' : '#555e6a';

  const statusLabel = (() => {
    switch (status) {
      case 'connected':   return T(lang, 'connected');
      case 'connecting':  return T(lang, 'connecting');
      case 'error':       return T(lang, 'error');
      default:            return T(lang, 'disconnected');
    }
  })();

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '8px 0' }}>

      {/* Status card */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(13,21,34,0.95), rgba(10,18,30,0.95))',
        border: `1px solid ${isConnected ? 'rgba(63,185,80,0.35)' : 'rgba(93,109,134,0.3)'}`,
        borderRadius: 14,
        padding: '24px 28px',
        marginBottom: 20,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow */}
        <div style={{
          position: 'absolute',
          top: -30, left: -30,
          width: 160, height: 160,
          borderRadius: '50%',
          background: isConnected
            ? 'radial-gradient(circle, rgba(63,185,80,0.08), transparent 70%)'
            : 'radial-gradient(circle, rgba(88,166,255,0.06), transparent 70%)',
          pointerEvents: 'none',
        }} />

        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              background: statusColor,
              boxShadow: isConnected ? `0 0 10px ${statusColor}` : 'none',
              animation: isConnecting ? 'pulse 1.5s infinite' : 'none',
            }} />
            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#dce9f8' }}>
              {statusLabel}
            </span>
          </div>

          {/* Connect / Disconnect button */}
          {isConnected ? (
            <button
              onClick={onDisconnect}
              style={{
                background: 'rgba(248, 81, 73, 0.15)',
                border: '1px solid rgba(248, 81, 73, 0.5)',
                borderRadius: 8,
                color: '#f85149',
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 18px',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {T(lang, 'homeDisconnect')}
            </button>
          ) : (
            <button
              onClick={onConnect}
              disabled={isConnecting}
              style={{
                background: isConnecting
                  ? 'rgba(88,166,255,0.12)'
                  : 'rgba(63,185,80,0.18)',
                border: `1px solid ${isConnecting ? 'rgba(88,166,255,0.45)' : 'rgba(63,185,80,0.5)'}`,
                borderRadius: 8,
                color: isConnecting ? '#58a6ff' : '#3fb950',
                fontSize: 13,
                fontWeight: 600,
                padding: '8px 18px',
                cursor: isConnecting ? 'not-allowed' : 'pointer',
                transition: 'background 0.15s',
              }}
            >
              {isConnecting ? T(lang, 'connecting') : T(lang, 'homeConnect')}
            </button>
          )}
        </div>

        {/* Device info when connected */}
        {isConnected ? (
          <div>
            <InfoRow
              label={T(lang, 'homeDeviceId')}
              value={
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 12, color: '#7ec8f5',
                }}>
                  {deviceId ?? T(lang, 'unknown')}
                </span>
              }
            />
            <InfoRow
              label={T(lang, 'homeSampleRate')}
              value={<span>1000 {T(lang, 'hz')}</span>}
            />
            <InfoRow
              label={T(lang, 'homePacketRate')}
              value={
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}>
                  {stats.packetRate} pkt/s
                </span>
              }
            />
            <div style={{ padding: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'rgba(140,160,185,0.8)', fontSize: 13 }}>
                  {T(lang, 'homeBattery')}
                </span>
                <BatteryBar level={stats.battery} />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: 'rgba(140,160,190,0.65)', fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: 'rgba(180,200,230,0.8)', marginBottom: 6 }}>
              {T(lang, 'homeNotConnectedTitle')}
            </div>
            <div>{T(lang, 'homeNotConnectedHint')}</div>
          </div>
        )}
      </div>

      {/* Instructions card */}
      <div style={{
        background: 'rgba(10, 18, 30, 0.7)',
        border: '1px solid rgba(93,109,134,0.25)',
        borderRadius: 14,
        padding: '20px 24px',
        marginBottom: 20,
      }}>
        <h3 style={{
          margin: '0 0 14px',
          fontSize: '0.95rem',
          fontWeight: 600,
          color: 'rgba(180,200,230,0.85)',
          letterSpacing: '0.03em',
        }}>
          {T(lang, 'homeInstructions')}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            T(lang, 'homeStep1'),
            T(lang, 'homeStep2'),
            T(lang, 'homeStep3'),
          ].map((step, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              color: 'rgba(160,180,210,0.75)', fontSize: 13, lineHeight: 1.55,
            }}>
              <span style={{
                background: 'rgba(30,65,115,0.7)',
                border: '1px solid rgba(88,166,255,0.3)',
                borderRadius: '50%',
                width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: '#58a6ff',
                flexShrink: 0, marginTop: 1,
              }}>{i + 1}</span>
              <span>{step.replace(/^\d+\.\s*/, '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* FTDI Device Scanner card */}
      <div style={{
        background: 'rgba(10, 18, 30, 0.7)',
        border: '1px solid rgba(93,109,134,0.25)',
        borderRadius: 14,
        padding: '18px 22px',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{
            margin: 0,
            fontSize: '0.92rem',
            fontWeight: 600,
            color: 'rgba(180,200,230,0.85)',
            letterSpacing: '0.03em',
          }}>
            {T(lang, 'homeFoundDevices')}
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={refreshDevices}
              disabled={scanning || !webUsbAvailable}
              style={{
                background: 'rgba(88,166,255,0.1)',
                border: '1px solid rgba(88,166,255,0.35)',
                borderRadius: 6,
                color: '#58a6ff',
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                cursor: (!webUsbAvailable || scanning) ? 'not-allowed' : 'pointer',
                opacity: (!webUsbAvailable || scanning) ? 0.5 : 1,
              }}
            >
              {scanning ? '...' : T(lang, 'homeScanDevices')}
            </button>
            <button
              onClick={handleAddDevice}
              disabled={!webUsbAvailable}
              style={{
                background: 'rgba(63,185,80,0.1)',
                border: '1px solid rgba(63,185,80,0.35)',
                borderRadius: 6,
                color: '#3fb950',
                fontSize: 12,
                fontWeight: 600,
                padding: '5px 12px',
                cursor: !webUsbAvailable ? 'not-allowed' : 'pointer',
                opacity: !webUsbAvailable ? 0.5 : 1,
              }}
            >
              {T(lang, 'homeAddDevice')}
            </button>
          </div>
        </div>

        {!webUsbAvailable ? (
          <div style={{ fontSize: 12, color: 'rgba(248,81,73,0.7)', padding: '4px 0' }}>
            {T(lang, 'homeWebUsbNotAvailable')}
          </div>
        ) : ftdiDevices.length === 0 ? (
          <div style={{ fontSize: 12, color: 'rgba(130,150,180,0.55)', padding: '4px 0' }}>
            {T(lang, 'homeNoDevicesFound')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ftdiDevices.map((dev, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                background: 'rgba(63,185,80,0.06)',
                border: '1px solid rgba(63,185,80,0.2)',
                borderRadius: 8,
              }}>
                <div style={{
                  width: 9, height: 9, borderRadius: '50%',
                  background: '#3fb950',
                  boxShadow: '0 0 6px #3fb950',
                  flexShrink: 0,
                }} />
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 13, fontWeight: 700,
                  color: '#7ec8f5',
                }}>
                  {dev.serialNumber ? `STEEG_${dev.serialNumber}` : dev.productName}
                </span>
                <span style={{ fontSize: 11, color: 'rgba(130,155,185,0.55)', marginLeft: 'auto' }}>
                  {dev.manufacturerName}
                </span>
              </div>
            ))}
          </div>
        )}

        {webUsbAvailable && ftdiDevices.length > 0 && (
          <div style={{
            marginTop: 10,
            fontSize: 11,
            color: 'rgba(135,175,220,0.6)',
            padding: '6px 10px',
            background: 'rgba(88,166,255,0.05)',
            border: '1px solid rgba(88,166,255,0.15)',
            borderRadius: 6,
          }}>
            ℹ {T(lang, 'homeSelectPortHint')}
          </div>
        )}
      </div>

      {/* Browser requirement note */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(88,166,255,0.06)',
        border: '1px solid rgba(88,166,255,0.2)',
        borderRadius: 8,
        color: 'rgba(135,175,220,0.7)',
        fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 10,
      }}>
        <span style={{ fontSize: 15 }}>ℹ</span>
        {T(lang, 'homeRequiresSerial')}
      </div>

      {/* Multi-device note */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(63,185,80,0.04)',
        border: '1px solid rgba(63,185,80,0.15)',
        borderRadius: 8,
        color: 'rgba(120,190,150,0.7)',
        fontSize: 12,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 15 }}>⊕</span>
        {T(lang, 'homeMultiDevice')}
      </div>
    </div>
  );
};

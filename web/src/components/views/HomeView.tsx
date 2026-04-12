import React, { type FC, type ReactNode } from 'react';
import type { ConnectionStatus } from '../../services/serial';
import type { DeviceStats } from '../../types/eeg';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface HomeViewProps {
  status: ConnectionStatus;
  stats: DeviceStats;
  deviceId: string | null;
  lang: Lang;
  onConnect: () => void;
  onDisconnect: () => void;
  /** Hide instructions + notes; show only the status card */
  compact?: boolean;
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
    borderBottom: '1px solid var(--border)',
  }}>
    <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
    <span style={{ color: 'var(--cream)', fontSize: 13, fontWeight: 500 }}>{value}</span>
  </div>
);

export const HomeView: FC<HomeViewProps> = ({
  status, stats, deviceId, lang, onConnect, onDisconnect, compact = false,
}) => {
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

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
      <div
        className="nd-card"
        style={{
          '--card-accent': isConnected ? 'rgba(63,185,80,0.5)' : 'rgba(72,186,166,0.4)',
          borderColor: isConnected ? 'rgba(63,185,80,0.25)' : 'var(--border)',
          marginBottom: 16,
        } as React.CSSProperties}
      >
        {/* Background glow */}
        <div style={{
          position: 'absolute',
          top: -30, left: -30,
          width: 160, height: 160,
          borderRadius: '50%',
          background: isConnected
            ? 'radial-gradient(circle, rgba(63,185,80,0.08), transparent 70%)'
            : 'radial-gradient(circle, rgba(72,186,166,0.06), transparent 70%)',
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
            <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--cream)' }}>
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
                  ? 'rgba(72,186,166,0.12)'
                  : 'rgba(63,185,80,0.18)',
                border: `1px solid ${isConnecting ? 'rgba(72,186,166,0.45)' : 'rgba(63,185,80,0.5)'}`,
                borderRadius: 8,
                color: isConnecting ? 'var(--teal)' : '#3fb950',
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
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 12, color: 'var(--teal)',
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
                  fontFamily: "'IBM Plex Mono', monospace",
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
          <div style={{ color: 'rgba(87,136,136,0.65)', fontSize: 14, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, color: 'rgba(200,224,216,0.8)', marginBottom: 6 }}>
              {T(lang, 'homeNotConnectedTitle')}
            </div>
            <div>{T(lang, 'homeNotConnectedHint')}</div>
          </div>
        )}
      </div>

      {!compact && <>
      {/* Instructions card */}
      <div className="nd-card" style={{ '--card-accent': 'rgba(72,186,166,0.3)', marginBottom: 16 } as React.CSSProperties}>
        <h3 className="nd-card-title">{T(lang, 'homeInstructions')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            T(lang, 'homeStep1'),
            T(lang, 'homeStep2'),
            T(lang, 'homeStep3'),
          ].map((step, i) => (
            <div key={i} style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              color: 'rgba(136,176,168,0.75)', fontSize: 13, lineHeight: 1.55,
            }}>
              <span style={{
                background: 'rgba(13,40,56,0.7)',
                border: '1px solid rgba(72,186,166,0.3)',
                borderRadius: '50%',
                width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700, color: 'var(--teal)',
                flexShrink: 0, marginTop: 1,
              }}>{i + 1}</span>
              <span>{step.replace(/^\d+\.\s*/, '')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Browser requirement note */}
      <div style={{
        padding: '10px 16px',
        background: 'rgba(72,186,166,0.06)',
        border: '1px solid rgba(72,186,166,0.2)',
        borderRadius: 8,
        color: 'rgba(92,196,168,0.7)',
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
      </>}
    </div>
  );
};

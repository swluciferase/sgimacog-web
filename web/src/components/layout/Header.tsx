import type { FC } from 'react';
import type { ConnectionStatus } from '../../services/serial';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface HeaderProps {
  status: ConnectionStatus;
  packetRate: number;
  deviceId: string | null;
  lang: Lang;
  onLangToggle: () => void;
}

export const Header: FC<HeaderProps> = ({ status, packetRate, deviceId, lang, onLangToggle }) => {
  const statusText = (() => {
    switch (status) {
      case 'connected':    return T(lang, 'connected');
      case 'connecting':   return T(lang, 'connecting');
      case 'error':        return T(lang, 'error');
      default:             return T(lang, 'disconnected');
    }
  })();

  return (
    <header style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '0 20px',
      height: 56,
      background: 'linear-gradient(90deg, #0d1520 0%, #101c2e 100%)',
      borderBottom: '1px solid rgba(93,109,134,0.35)',
      flexShrink: 0,
    }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'linear-gradient(135deg, #1a5fa8, #0e3d70)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 700, color: '#7ec8f5',
          border: '1px solid rgba(100,160,255,0.3)',
          flexShrink: 0,
        }}>
          S
        </div>
        <h1 style={{
          margin: 0,
          fontSize: '1.1rem',
          fontWeight: 600,
          color: '#c5d8f0',
          letterSpacing: '0.03em',
        }}>
          {T(lang, 'appTitle')}
        </h1>
        <span style={{
          fontSize: 11,
          color: 'rgba(120,150,190,0.55)',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          letterSpacing: '0.05em',
          alignSelf: 'flex-end',
          marginBottom: 2,
        }}>
          v{__APP_VERSION__}
        </span>
      </div>

      {/* Right side: device ID + status + packet rate + lang toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Device ID (only when connected) */}
        {status === 'connected' && (
          <span style={{
            fontSize: 12,
            color: 'rgba(126,200,245,0.85)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            letterSpacing: '0.04em',
          }}>
            {T(lang, 'headerDeviceId')}: {deviceId ?? '—'}
          </span>
        )}

        {/* Packet rate (only when connected) */}
        {status === 'connected' && (
          <span style={{
            fontSize: 12,
            color: 'rgba(160,185,215,0.75)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}>
            {packetRate} pkt/s
          </span>
        )}

        {/* Status indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <div style={{
            width: 9, height: 9, borderRadius: '50%',
            background:
              status === 'connected'  ? '#3fb950' :
              status === 'connecting' ? '#58a6ff' :
              status === 'error'      ? '#f85149' : '#555e6a',
            boxShadow:
              status === 'connected'  ? '0 0 7px #3fb950' :
              status === 'connecting' ? '0 0 7px #58a6ff' : 'none',
            animation: status === 'connecting' ? 'pulse 1.5s infinite' : 'none',
          }} />
          <span style={{ fontSize: 13, color: '#8b949e' }}>{statusText}</span>
        </div>

        {/* Language toggle */}
        <button
          onClick={onLangToggle}
          style={{
            background: 'rgba(30, 48, 72, 0.8)',
            border: '1px solid rgba(93, 109, 134, 0.5)',
            borderRadius: 6,
            color: '#8ecfff',
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 10px',
            cursor: 'pointer',
            letterSpacing: '0.04em',
            transition: 'background 0.15s',
          }}
        >
          {lang === 'zh' ? 'EN' : '中'}
        </button>
      </div>
    </header>
  );
};

import { type FC, type ReactNode } from 'react';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';
import { SAMPLE_RATE_HZ } from '../../types/eeg';

export type TabType = 'connect' | 'impedance' | 'signal' | 'fft' | 'record';

export interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  lang: Lang;
  isConnected: boolean;
  isImpedanceActive: boolean;
  isRecording: boolean;
  packetRate: number;
  deviceId: string | null;
}

// SVG icons
const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const ConnectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

const ImpedanceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M8 12h8M12 8v8"/>
  </svg>
);

const WaveformIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2 12 5 3 9 19 12 8 16 15 19 10 22 12"/>
  </svg>
);

const RecordIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="4" fill="currentColor"/>
  </svg>
);

export const Sidebar: FC<SidebarProps> = ({
  activeTab, onTabChange, lang, isConnected, isImpedanceActive, isRecording,
  packetRate, deviceId,
}) => {
  const tabs: { id: TabType; labelKey: string; icon: ReactNode; requiresConnect: boolean }[] = [
    { id: 'connect',   labelKey: 'tabConnect',   icon: <ConnectIcon />,   requiresConnect: false },
    { id: 'impedance', labelKey: 'tabImpedance', icon: <ImpedanceIcon />, requiresConnect: true  },
    { id: 'signal',    labelKey: 'tabSignal',    icon: <WaveformIcon />,  requiresConnect: true  },
    { id: 'record',    labelKey: 'tabRecord',    icon: <RecordIcon />,    requiresConnect: true  },
  ];

  // Strip "STEEG_" prefix for display
  const shortId = deviceId?.startsWith('STEEG_') ? deviceId.slice(6) : deviceId;

  return (
    <aside style={{
      width: 240,
      background: 'linear-gradient(180deg, #07101f 0%, #060d1a 100%)',
      borderRight: '1px solid rgba(93,109,134,0.25)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      overflow: 'hidden',
    }}>

      {/* Brand section */}
      <div style={{
        padding: '18px 20px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(220,235,255,0.9)' }}>
          EEG Monitor
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 2 }}>
          8-Ch EEG System
        </div>
      </div>

      {/* Section label */}
      <div style={{
        fontSize: 10,
        color: 'rgba(255,255,255,0.28)',
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        padding: '14px 20px 5px',
      }}>
        {T(lang, 'sidebarSectionMain')}
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', padding: '0 0' }}>

        {/* 首頁 → external link */}
        <a
          href="https://www.sigmacog.xyz"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 20px',
            borderLeft: '3px solid transparent',
            color: 'rgba(160,185,215,0.65)',
            fontSize: 14,
            fontWeight: 400,
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'all 0.15s',
          }}
        >
          <span style={{ color: 'rgba(130,155,190,0.6)', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <HomeIcon />
          </span>
          <span>{T(lang, 'tabHome')}</span>
        </a>

        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const notConnected = tab.requiresConnect && !isConnected;
          const impedanceLocked = tab.id === 'signal' && isImpedanceActive;
          const recordingBlocksImpedance = tab.id === 'impedance' && isRecording;
          const isDisabled = notConnected || impedanceLocked || recordingBlocksImpedance;

          let title: string | undefined;
          if (impedanceLocked) title = T(lang, 'sidebarImpedanceActiveHint');
          else if (recordingBlocksImpedance) title = T(lang, 'impedanceBlockedByRecording');

          return (
            <button
              key={tab.id}
              onClick={() => !isDisabled && onTabChange(tab.id)}
              disabled={isDisabled}
              title={title}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 20px',
                borderLeft: isActive ? '3px solid #58a6ff' : '3px solid transparent',
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                background: isActive ? 'rgba(88,166,255,0.07)' : 'transparent',
                color: isDisabled
                  ? 'rgba(100,115,135,0.35)'
                  : isActive
                    ? '#8ecfff'
                    : 'rgba(160,185,215,0.65)',
                fontSize: 14,
                fontWeight: isActive ? 600 : 400,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s',
                outline: 'none',
                pointerEvents: isDisabled ? 'none' : 'auto',
              }}
            >
              <span style={{
                color: isDisabled
                  ? 'rgba(100,115,135,0.35)'
                  : isActive
                    ? '#58a6ff'
                    : 'rgba(130,155,190,0.6)',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
              }}>
                {tab.icon}
              </span>
              <span>{T(lang, tab.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Device info footer — only when connected */}
      {isConnected && (
        <div style={{
          marginTop: 'auto',
          padding: '14px 20px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
        }}>
          <div style={{
            fontSize: 10,
            color: 'rgba(255,255,255,0.28)',
            textTransform: 'uppercase',
            letterSpacing: '0.10em',
            marginBottom: 9,
          }}>
            {T(lang, 'sidebarDeviceInfo')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{T(lang, 'sidebarSampleRate')}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#8ecfff', fontFamily: 'ui-monospace, monospace' }}>
              {SAMPLE_RATE_HZ} Hz
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{T(lang, 'sidebarPacketRate')}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(220,235,255,0.75)', fontFamily: 'ui-monospace, monospace' }}>
              {packetRate} pkt/s
            </span>
          </div>
          {shortId && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>{T(lang, 'sidebarSerial')}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(220,235,255,0.5)', fontFamily: 'ui-monospace, monospace' }}>
                {shortId}
              </span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};

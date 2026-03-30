import { type FC, type ReactNode } from 'react';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export type TabType = 'home' | 'impedance' | 'signal' | 'fft' | 'record';

export interface SidebarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  lang: Lang;
  isConnected: boolean;
  isImpedanceActive: boolean;
  isRecording: boolean;
}

// SVG icons as inline elements
const HomeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const ImpedanceIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M8 12h8M12 8v8"/>
  </svg>
);

const WaveformIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="2 12 5 3 9 19 12 8 16 15 19 10 22 12"/>
  </svg>
);

const FftIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
    <line x1="3" y1="20" x2="21" y2="20"/>
  </svg>
);

const RecordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="4" fill="currentColor"/>
  </svg>
);

export const Sidebar: FC<SidebarProps> = ({
  activeTab, onTabChange, lang, isConnected, isImpedanceActive, isRecording,
}) => {
  const tabs: { id: TabType; labelKey: string; icon: ReactNode; requiresConnect: boolean }[] = [
    { id: 'home',      labelKey: 'tabHome',       icon: <HomeIcon />,      requiresConnect: false },
    { id: 'impedance', labelKey: 'tabImpedance',  icon: <ImpedanceIcon />, requiresConnect: true },
    { id: 'signal',    labelKey: 'tabSignal',     icon: <WaveformIcon />,  requiresConnect: true },
    { id: 'fft',       labelKey: 'tabFft',        icon: <FftIcon />,       requiresConnect: true },
    { id: 'record',    labelKey: 'tabRecord',     icon: <RecordIcon />,    requiresConnect: true },
  ];

  return (
    <aside style={{
      width: 200,
      background: 'linear-gradient(180deg, #0f1a27 0%, #0b1520 100%)',
      borderRight: '1px solid rgba(93,109,134,0.3)',
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 12,
      flexShrink: 0,
    }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const notConnected = tab.requiresConnect && !isConnected;

          // Impedance blocked during recording; signal/fft blocked during impedance measurement
          const impedanceLocked =
            (tab.id === 'signal' || tab.id === 'fft') && isImpedanceActive;
          const recordingBlocksImpedance =
            tab.id === 'impedance' && isRecording;

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
                gap: 10,
                padding: '10px 14px',
                borderRadius: 8,
                border: isActive ? '1px solid rgba(88,166,255,0.35)' : '1px solid transparent',
                background: isActive
                  ? 'linear-gradient(90deg, rgba(30,70,130,0.55), rgba(20,50,95,0.4))'
                  : 'transparent',
                color: isDisabled
                  ? 'rgba(100,115,135,0.4)'
                  : isActive
                    ? '#8ecfff'
                    : 'rgba(160,180,210,0.75)',
                fontSize: '0.9rem',
                fontWeight: isActive ? 600 : 400,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
                outline: 'none',
                pointerEvents: isDisabled ? 'none' : 'auto',
              }}
            >
              <span style={{
                color: isDisabled
                  ? 'rgba(100,115,135,0.4)'
                  : isActive
                    ? '#58a6ff'
                    : 'rgba(130,155,190,0.7)',
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
    </aside>
  );
};

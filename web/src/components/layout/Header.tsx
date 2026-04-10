import type { FC } from 'react';
import type { ConnectionStatus } from '../../services/serial';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface HeaderProps {
  status: ConnectionStatus;
  lang: Lang;
  onLangToggle: () => void;
}

export const Header: FC<HeaderProps> = ({ status, lang, onLangToggle }) => {

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
        <img
          src="./EEG_logo.svg"
          alt="Sigmacog EEG Logo"
          style={{ height: 40, flexShrink: 0 }}
        />
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

      {/* Right side: lang toggle only */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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

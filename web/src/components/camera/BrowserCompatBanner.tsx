import type { FC } from 'react';
import type { Lang } from '../../i18n';

interface Props {
  lang: Lang;
}

export const BrowserCompatBanner: FC<Props> = ({ lang }) => {
  const text =
    lang === 'zh'
      ? '⚠️ 相機錄製功能需要 Chrome 或 Edge 瀏覽器（File System Access API）。請改用 Chrome/Edge 開啟以啟用相機。'
      : '⚠️ Camera recording requires Chrome or Edge desktop browser (File System Access API). Please switch to Chrome/Edge to enable cameras.';
  return (
    <div
      role="alert"
      style={{
        padding: '10px 14px',
        margin: '8px 0',
        borderRadius: 6,
        background: 'rgba(255, 184, 0, 0.12)',
        border: '1px solid rgba(255, 184, 0, 0.4)',
        color: '#f0c14b',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {text}
    </div>
  );
};

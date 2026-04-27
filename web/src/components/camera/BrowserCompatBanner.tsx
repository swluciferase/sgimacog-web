import type { FC } from 'react';
import type { Lang } from '../../i18n';

interface Props {
  lang: Lang;
}

export const BrowserCompatBanner: FC<Props> = ({ lang }) => {
  const text =
    lang === 'zh'
      ? '相機錄製需要 Chrome 或 Edge 桌面瀏覽器（File System Access API）。請改用 Chrome / Edge 開啟以啟用相機。'
      : 'Camera recording requires Chrome or Edge desktop browser (File System Access API). Please switch to Chrome / Edge to enable cameras.';
  return (
    <div role="alert" className="cam-compat">
      <span className="cam-compat-glyph" aria-hidden="true">!</span>
      <span className="cam-compat-text">{text}</span>
    </div>
  );
};

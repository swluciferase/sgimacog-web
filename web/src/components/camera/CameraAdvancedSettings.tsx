import { type FC, type ReactNode } from 'react';
import type { CameraConfig } from '../../types/camera';

interface Props {
  open: boolean;
  config: CameraConfig;
  activeCameraCount: number;
  onClose(): void;
  onApply(c: CameraConfig): void;
}

const RESOLUTIONS: CameraConfig['resolution'][] = ['640x480', '1280x720', '1920x1080'];
const FPS_OPTIONS: CameraConfig['fps'][] = [15, 30, 60];
const BITRATES: CameraConfig['bitrate_bps'][] = [1_000_000, 2_500_000, 5_000_000, 8_000_000];

export const CameraAdvancedSettings: FC<Props> = ({
  open,
  config,
  activeCameraCount,
  onClose,
  onApply,
}) => {
  if (!open) return null;

  const heavyLoad = activeCameraCount >= 4 && config.resolution === '1920x1080' && config.fps === 60;

  return (
    <div className="cam-modal-backdrop" onClick={onClose}>
      <div className="cam-modal" onClick={(ev) => ev.stopPropagation()}>
        <h3 className="cam-modal-title">
          <span className="cam-modal-title-glyph" aria-hidden="true">α</span>
          Camera · Advanced
        </h3>

        <Row label="Resolution">
          <select
            className="cam-select"
            value={config.resolution}
            onChange={(e) =>
              onApply({ ...config, resolution: e.target.value as CameraConfig['resolution'] })
            }
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Row>

        <Row label="Frame rate">
          <select
            className="cam-select"
            value={config.fps}
            onChange={(e) =>
              onApply({ ...config, fps: Number.parseInt(e.target.value, 10) as CameraConfig['fps'] })
            }
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>{f} fps</option>
            ))}
          </select>
        </Row>

        <Row label="Bitrate">
          <select
            className="cam-select"
            value={config.bitrate_bps}
            onChange={(e) =>
              onApply({
                ...config,
                bitrate_bps: Number.parseInt(e.target.value, 10) as CameraConfig['bitrate_bps'],
              })
            }
          >
            {BITRATES.map((b) => (
              <option key={b} value={b}>{(b / 1_000_000).toFixed(1)} Mbps</option>
            ))}
          </select>
        </Row>

        {heavyLoad && (
          <div className="cam-modal-warn">
            <span className="cam-modal-warn-glyph" aria-hidden="true">!</span>
            <span>4 × 1080p @ 60 fps will be CPU-intensive. Consider 720p / 30 fps for stability.</span>
          </div>
        )}

        <div className="cam-modal-foot">
          <button type="button" className="cam-pill" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

const Row: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div className="cam-modal-row">
    <label className="cam-modal-label">{label}</label>
    {children}
  </div>
);

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
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1500,
      }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: '#0e2229',
          color: '#cde',
          padding: 20,
          borderRadius: 8,
          width: 320,
          border: '1px solid rgba(72,186,166,0.35)',
        }}
      >
        <h3 style={{ margin: '0 0 12px' }}>Advanced Camera Settings</h3>

        <Row label="Resolution">
          <select
            value={config.resolution}
            onChange={(e) =>
              onApply({ ...config, resolution: e.target.value as CameraConfig['resolution'] })
            }
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Row>

        <Row label="FPS">
          <select
            value={config.fps}
            onChange={(e) =>
              onApply({ ...config, fps: Number.parseInt(e.target.value, 10) as CameraConfig['fps'] })
            }
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Bitrate">
          <select
            value={config.bitrate_bps}
            onChange={(e) =>
              onApply({
                ...config,
                bitrate_bps: Number.parseInt(e.target.value, 10) as CameraConfig['bitrate_bps'],
              })
            }
          >
            {BITRATES.map((b) => (
              <option key={b} value={b}>
                {b / 1_000_000} Mbps
              </option>
            ))}
          </select>
        </Row>

        {heavyLoad && (
          <div style={{ color: '#f0c14b', fontSize: 12, marginTop: 8 }}>
            ⚠️ 4× 1080p/60fps will be CPU-intensive.
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const Row: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0' }}>
    <label style={{ fontSize: 13 }}>{label}</label>
    {children}
  </div>
);

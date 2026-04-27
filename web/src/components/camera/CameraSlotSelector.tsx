import { type FC, useEffect, useState } from 'react';
import type { CameraSlotId } from '../../types/camera';
import { listVideoInputs } from '../../services/camera/cameraDevices';

interface Props {
  slot: CameraSlotId;
  selectedDeviceId: string | null;
  disabled?: boolean;
  onChange(deviceId: string | null, label: string): void;
}

export const CameraSlotSelector: FC<Props> = ({ slot, selectedDeviceId, disabled, onChange }) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const list = await listVideoInputs();
      if (!cancelled) setDevices(list);
    }
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
    };
  }, []);

  return (
    <select
      className="cam-select"
      aria-label={`Camera for ${slot}`}
      disabled={disabled}
      value={selectedDeviceId ?? ''}
      onChange={(ev) => {
        const id = ev.target.value;
        if (!id) {
          onChange(null, '');
          return;
        }
        const info = devices.find((d) => d.deviceId === id);
        onChange(id, info?.label ?? id);
      }}
    >
      <option value="">— None —</option>
      {devices.map((d) => (
        <option key={d.deviceId} value={d.deviceId}>
          {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
        </option>
      ))}
    </select>
  );
};

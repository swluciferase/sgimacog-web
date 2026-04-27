import type { CameraSlotId } from '../../types/camera';

const LS_PREFIX = 'sgimacog.camera.slot.';

export function rememberDeviceForSlot(slot: CameraSlotId, deviceId: string): void {
  localStorage.setItem(LS_PREFIX + slot, deviceId);
}

export function recallDeviceForSlot(slot: CameraSlotId): string | null {
  return localStorage.getItem(LS_PREFIX + slot);
}

export function forgetDeviceForSlot(slot: CameraSlotId): void {
  localStorage.removeItem(LS_PREFIX + slot);
}

export async function hashDeviceId(deviceId: string): Promise<string> {
  const enc = new TextEncoder().encode(deviceId);
  const hash = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

/**
 * Browser device enumeration. Returns videoinput devices.
 * Note: browsers only return labels after a getUserMedia permission grant,
 * so the first call may return empty `label` fields — caller handles UI.
 */
export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

/**
 * Probe permission for video. Returns 'granted' | 'denied' | 'prompt' | 'unknown'.
 */
export async function probeCameraPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  if (!navigator.permissions) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

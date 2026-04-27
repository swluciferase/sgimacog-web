// src/services/camera/cameraDevices.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rememberDeviceForSlot,
  recallDeviceForSlot,
  forgetDeviceForSlot,
  hashDeviceId,
} from './cameraDevices';

describe('cameraDevices — slot deviceId memory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing stored', () => {
    expect(recallDeviceForSlot('dev1')).toBeNull();
  });

  it('persists deviceId per slot in localStorage', () => {
    rememberDeviceForSlot('dev1', 'abc-device-id');
    rememberDeviceForSlot('dev2', 'xyz-device-id');
    expect(recallDeviceForSlot('dev1')).toBe('abc-device-id');
    expect(recallDeviceForSlot('dev2')).toBe('xyz-device-id');
  });

  it('forget clears only the requested slot', () => {
    rememberDeviceForSlot('dev1', 'a');
    rememberDeviceForSlot('dev2', 'b');
    forgetDeviceForSlot('dev1');
    expect(recallDeviceForSlot('dev1')).toBeNull();
    expect(recallDeviceForSlot('dev2')).toBe('b');
  });
});

describe('cameraDevices — deviceId hashing', () => {
  it('produces a sha256-prefixed string', async () => {
    const h = await hashDeviceId('abc-device-id');
    expect(h).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is deterministic', async () => {
    const a = await hashDeviceId('same');
    const b = await hashDeviceId('same');
    expect(a).toBe(b);
  });

  it('differs across inputs', async () => {
    const a = await hashDeviceId('a');
    const b = await hashDeviceId('b');
    expect(a).not.toBe(b);
  });
});

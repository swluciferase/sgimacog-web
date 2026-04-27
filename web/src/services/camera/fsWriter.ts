import type { SessionMeta, VideoSidecar } from '../../types/camera';

export function isFsApiAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export async function pickRootFolder(): Promise<FileSystemDirectoryHandle> {
  if (!isFsApiAvailable()) {
    throw new Error('File System Access API not available — please use Chrome or Edge desktop.');
  }
  return await window.showDirectoryPicker({ mode: 'readwrite' });
}

export async function ensureSessionDir(
  root: FileSystemDirectoryHandle,
  sessionDirName: string,
): Promise<FileSystemDirectoryHandle> {
  const sessionDir = await root.getDirectoryHandle(sessionDirName, { create: true });
  await sessionDir.getDirectoryHandle('eeg', { create: true });
  await sessionDir.getDirectoryHandle('video', { create: true });
  return sessionDir;
}

export async function writeBlobAsFile(
  dir: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

export async function writeJson(
  dir: FileSystemDirectoryHandle,
  filename: string,
  data: unknown,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  } finally {
    await writable.close();
  }
}

export function buildSessionDirName(sessionId: string, startedAt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${startedAt.getFullYear()}${pad(startedAt.getMonth() + 1)}${pad(startedAt.getDate())}` +
    `-${pad(startedAt.getHours())}${pad(startedAt.getMinutes())}${pad(startedAt.getSeconds())}`;
  return `session_${sessionId}_${stamp}`;
}

export async function writeSidecar(
  videoDir: FileSystemDirectoryHandle,
  slot: string,
  sidecar: VideoSidecar,
): Promise<void> {
  await writeJson(videoDir, `${slot}_video.json`, sidecar);
}

export async function writeSessionMeta(
  sessionDir: FileSystemDirectoryHandle,
  meta: SessionMeta,
): Promise<void> {
  await writeJson(sessionDir, 'session_meta.json', meta);
}

// Cross-tab device connection registry.
// Uses BroadcastChannel for instant updates + localStorage for persistence.
// Each browser tab gets a unique tabId (per session via sessionStorage).

const STORAGE_KEY = 'sgimacog_device_registry';
const CHANNEL_NAME = 'sgimacog_devices';
const HEARTBEAT_MS  = 4_000;   // update timestamp every 4s while connected
const STALE_MS      = 12_000;  // entries older than 12s are treated as dead

export interface RegistryEntry {
  tabId: string;
  steegId: string | null;  // STEEG device ID from machineInfo; null until received
  timestamp: number;
}

type ChangeCallback = () => void;

// ── Tab ID (stable within one page session) ──

function getTabId(): string {
  let id = sessionStorage.getItem('sgimacog_tab_id');
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem('sgimacog_tab_id', id);
  }
  return id;
}

// ── Storage helpers ──

function readStorage(): RegistryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw) as RegistryEntry[];
    const now = Date.now();
    return entries.filter(e => now - e.timestamp < STALE_MS);
  } catch {
    return [];
  }
}

function writeStorage(entries: RegistryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch { /* ignore */ }
}

// ── BroadcastChannel ──

let _channel: BroadcastChannel | null = null;
const _listeners = new Set<ChangeCallback>();

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_channel) {
    _channel = new BroadcastChannel(CHANNEL_NAME);
    _channel.onmessage = () => {
      _listeners.forEach(fn => fn());
    };
  }
  return _channel;
}

function broadcast(): void {
  getChannel()?.postMessage({ t: 'u' });
  _listeners.forEach(fn => fn()); // also notify self
}

// ── Heartbeat ──

let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function stopHeartbeat(): void {
  if (_heartbeatTimer !== null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();
  _heartbeatTimer = setInterval(() => {
    const tabId = getTabId();
    const entries = readStorage();
    const idx = entries.findIndex(e => e.tabId === tabId);
    if (idx >= 0) {
      entries[idx]!.timestamp = Date.now();
      writeStorage(entries);
      broadcast();
    } else {
      stopHeartbeat(); // our entry was evicted; stop
    }
  }, HEARTBEAT_MS);
}

// ── Public API ──

/** Subscribe to registry changes (other tabs connected/disconnected). Returns unsubscribe fn. */
export function onRegistryChange(fn: ChangeCallback): () => void {
  _listeners.add(fn);
  getChannel(); // ensure channel is initialized
  return () => _listeners.delete(fn);
}

/** All entries from OTHER tabs (excluding this tab). Stale entries filtered. */
export function getOtherTabDevices(): RegistryEntry[] {
  const tabId = getTabId();
  return readStorage().filter(e => e.tabId !== tabId);
}

/** Register this tab as connected. Call once immediately after connect. */
export function registerConnected(steegId: string | null = null): void {
  const tabId = getTabId();
  const entries = readStorage().filter(e => e.tabId !== tabId);
  entries.push({ tabId, steegId, timestamp: Date.now() });
  writeStorage(entries);
  broadcast();
  startHeartbeat();
}

/** Update STEEG device ID once machineInfo packet arrives. */
export function updateRegistrySteegId(steegId: string): void {
  const tabId = getTabId();
  const entries = readStorage();
  const idx = entries.findIndex(e => e.tabId === tabId);
  if (idx >= 0 && entries[idx]!.steegId !== steegId) {
    entries[idx]!.steegId = steegId;
    entries[idx]!.timestamp = Date.now();
    writeStorage(entries);
    broadcast();
  }
}

/** Remove this tab's entry. Call on disconnect or page unload. */
export function registerDisconnected(): void {
  stopHeartbeat();
  const tabId = getTabId();
  const entries = readStorage().filter(e => e.tabId !== tabId);
  writeStorage(entries);
  broadcast();
}

// Clean up on page unload so stale entries don't linger
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    registerDisconnected();
  });
}

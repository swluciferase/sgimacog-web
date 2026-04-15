// WASM loader service — encrypted WASM (Scheme B)
//
// Flow:
//   1. Fetch AES-256-GCM key from Worker (requires JWT auth)
//   2. Fetch the encrypted .wasm asset (12-byte IV || ciphertext)
//   3. Decrypt in memory → pass raw bytes to wasm-bindgen init()
//
// The static asset served by Cloudflare Pages is the encrypted binary.
// Without the auth-gated key, it is unusable garbage.

import type { SteegParser } from '../pkg/steeg_wasm.js';
export type { SteegParser };

// Vite resolves this to the hashed URL of the (encrypted) .wasm asset at build time
import encWasmUrl from '../pkg/steeg_wasm_bg.wasm?url';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'https://artisebio-api.swlucifer.workers.dev';

export interface WasmApi {
  SteegParser: typeof SteegParser;
  [key: string]: unknown;
}

async function fetchWasmKey(): Promise<string> {
  const token = document.cookie.match(/steeg_token=([^;]+)/)?.[1];
  const res = await fetch(`${API_BASE}/wasm-key?app=steeg`, {
    headers: token ? { Authorization: `Bearer ${decodeURIComponent(token)}` } : {},
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`WASM key fetch failed: ${res.status}`);
  const { key } = await res.json() as { key: string };
  return key;
}

async function decryptWasm(encBytes: ArrayBuffer, keyHex: string): Promise<ArrayBuffer> {
  const keyBytes = Uint8Array.from(keyHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const iv  = encBytes.slice(0, 12);
  const ct  = encBytes.slice(12);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, ct);
}

class WasmService {
  private _initialized = false;
  private _module: WasmApi | null = null;

  async init(): Promise<void> {
    if (this._initialized) return;

    // 1. Load pkg module (gives us init() and type bindings; does NOT auto-fetch .wasm)
    const pkg = await import('../pkg/steeg_wasm.js');

    // 2. Fetch key + encrypted WASM in parallel
    const [keyHex, encResp] = await Promise.all([
      fetchWasmKey(),
      fetch(encWasmUrl),
    ]);
    const encBytes = await encResp.arrayBuffer();

    // 3. Decrypt and initialize WASM with raw bytes
    const wasmBytes = await decryptWasm(encBytes, keyHex);
    await pkg.default(new Uint8Array(wasmBytes));

    this._module = pkg as unknown as WasmApi;
    this._initialized = true;
  }

  get api(): WasmApi {
    if (!this._module) throw new Error('WASM not initialized — call init() first');
    return this._module;
  }

  get isInitialized(): boolean { return this._initialized; }
}

export const wasmService = new WasmService();

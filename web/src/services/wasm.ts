// WASM loader service
// NOTE: HMR does NOT work with WASM — full page reload required on Rust changes
// NOTE: init() is NOT idempotent — only call once
//
// pkg/ lives in src/pkg/ (NOT public/) so Vite can process it as an ES module.
// This lets Vite correctly resolve the `new URL('steeg_wasm_bg.wasm', import.meta.url)`
// pattern inside the wasm-pack generated JS — both in dev and production builds.

import type { SteegParser } from '../pkg/steeg_wasm.js';
export type { SteegParser };

export interface WasmApi {
  SteegParser: typeof SteegParser;
  [key: string]: unknown;
}

class WasmService {
  private _initialized = false;
  private _module: WasmApi | null = null;

  async init(): Promise<void> {
    if (this._initialized) return;
    // Dynamic import from src/pkg/ — Vite processes this as a real ES module.
    // The generated steeg_wasm.js uses new URL('steeg_wasm_bg.wasm', import.meta.url)
    // internally, which Vite resolves to the correct hashed asset URL at build time.
    const pkg = await import('../pkg/steeg_wasm.js');
    await pkg.default(); // init() — fetches and compiles the .wasm binary
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

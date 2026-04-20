/* tslint:disable */
/* eslint-disable */

/**
 * Main parser for STeEG EEG device byte streams.
 *
 * Accumulates raw serial bytes, decodes COBS frames, parses TLV packets,
 * and optionally computes impedance. All state lives here so JS only needs
 * one object.
 */
export class SteegParser {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Frames that failed COBS decode or TLV parse.
     */
    decode_errors(): number;
    /**
     * Disable impedance monitoring and free buffers.
     */
    disable_impedance(): void;
    /**
     * Enable impedance monitoring with given window size and sample rate.
     */
    enable_impedance(window_size: number, sample_rate: number): void;
    /**
     * Feed raw bytes from Web Serial into the parser.
     *
     * Returns a JS `Array` of packet objects. Each object has:
     * ```text
     * {
     *   serialNumber:      number | null,
     *   channels:          Float32Array | null,   // µV values
     *   battery:           number | null,
     *   gsensor:           Float32Array | null,   // [gx,gy,gz, ax,ay,az]
     *   impedanceResults:  Array | null,
     * }
     * ```
     */
    feed(data: Uint8Array): any;
    /**
     * Create a new parser.
     *
     * * `num_channels` — number of EEG channels (typically 8).
     * * `sample_rate`  — device sample rate in Hz (stored for impedance).
     */
    constructor(num_channels: number, _sample_rate: number);
    /**
     * Packets lost (serial number gaps).
     */
    packets_lost(): number;
    /**
     * Total successfully parsed packets.
     */
    packets_received(): number;
}

/**
 * Analyse EEG samples and return a JSON result string.
 *
 * `samples_flat`: f32 slice, row-major layout `[sample_idx * 8 + channel_idx]`,
 *   8 channels, values in µV.
 * `age`: subject age in fractional years (e.g. 12.5 for 12 years 6 months).
 *
 * Returns a JSON string:
 * ```json
 * {
 *   "indices":{"TBR":…,"APR":…,"FAA":…,"PAF":…,"RSA":…,"COH":…,"EnTP":…},
 *   "tscores":{"TBR":…,…},
 *   "capability":{"維度名":score,…},
 *   "age":…, "cleanEpochs":…, "totalEpochs":…, "durationSec":…
 * }
 * ```
 * On error: `{"error":"reason","age":…,"cleanEpochs":…,"totalEpochs":…,"durationSec":…}`
 */
export function analyze_eeg(samples_flat: Float32Array, age: number): string;

/**
 * Disable ADC (stop streaming raw EEG data).
 */
export function cmd_adc_off(): Uint8Array;

/**
 * Enable ADC (start streaming raw EEG data).
 */
export function cmd_adc_on(): Uint8Array;

/**
 * Disable AC impedance measurement.
 */
export function cmd_impedance_ac_off(): Uint8Array;

/**
 * Enable AC impedance measurement.
 * `code_set`: "reference" (default) or "pdf".
 */
export function cmd_impedance_ac_on(code_set: string): Uint8Array;

/**
 * Disable DC impedance measurement.
 */
export function cmd_impedance_dc_off(): Uint8Array;

/**
 * Enable DC impedance measurement.
 * `code_set`: "reference" (default) or "pdf".
 */
export function cmd_impedance_dc_on(code_set: string): Uint8Array;

/**
 * Request machine / device info from the device.
 * Send this command after connecting; the response arrives as a TAG_COMMAND
 * packet with `machineInfo` set to the device ID string (e.g. "STEEG_DG819452").
 */
export function cmd_machine_info(): Uint8Array;

/**
 * Start data acquisition (alias for cmd_adc_on).
 */
export function cmd_start_acquisition(): Uint8Array;

/**
 * Stop data acquisition (alias for cmd_adc_off).
 */
export function cmd_stop_acquisition(): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_steegparser_free: (a: number, b: number) => void;
    readonly analyze_eeg: (a: number, b: number, c: number) => [number, number];
    readonly cmd_adc_off: () => [number, number];
    readonly cmd_adc_on: () => [number, number];
    readonly cmd_impedance_ac_off: () => [number, number];
    readonly cmd_impedance_ac_on: (a: number, b: number) => [number, number];
    readonly cmd_impedance_dc_on: (a: number, b: number) => [number, number];
    readonly cmd_machine_info: () => [number, number];
    readonly steegparser_decode_errors: (a: number) => number;
    readonly steegparser_disable_impedance: (a: number) => void;
    readonly steegparser_enable_impedance: (a: number, b: number, c: number) => void;
    readonly steegparser_feed: (a: number, b: number, c: number) => any;
    readonly steegparser_new: (a: number, b: number) => number;
    readonly steegparser_packets_lost: (a: number) => number;
    readonly steegparser_packets_received: (a: number) => number;
    readonly cmd_impedance_dc_off: () => [number, number];
    readonly cmd_start_acquisition: () => [number, number];
    readonly cmd_stop_acquisition: () => [number, number];
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

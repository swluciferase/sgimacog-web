/* @ts-self-types="./steeg_wasm.d.ts" */

/**
 * Main parser for STeEG EEG device byte streams.
 *
 * Accumulates raw serial bytes, decodes COBS frames, parses TLV packets,
 * and optionally computes impedance. All state lives here so JS only needs
 * one object.
 */
export class SteegParser {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SteegParserFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_steegparser_free(ptr, 0);
    }
    /**
     * Frames that failed COBS decode or TLV parse.
     * @returns {number}
     */
    decode_errors() {
        const ret = wasm.steegparser_decode_errors(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Disable impedance monitoring and free buffers.
     */
    disable_impedance() {
        wasm.steegparser_disable_impedance(this.__wbg_ptr);
    }
    /**
     * Enable impedance monitoring with given window size and sample rate.
     * @param {number} window_size
     * @param {number} sample_rate
     */
    enable_impedance(window_size, sample_rate) {
        wasm.steegparser_enable_impedance(this.__wbg_ptr, window_size, sample_rate);
    }
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
     *   event:             number | null,   // hardware event byte (Tag 7), 0..255 or null
     *   impedanceResults:  Array | null,
     * }
     * ```
     * @param {Uint8Array} data
     * @returns {any}
     */
    feed(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.steegparser_feed(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    /**
     * Create a new parser.
     *
     * * `num_channels` — number of EEG channels (typically 8).
     * * `sample_rate`  — device sample rate in Hz (stored for impedance).
     * @param {number} num_channels
     * @param {number} _sample_rate
     */
    constructor(num_channels, _sample_rate) {
        const ret = wasm.steegparser_new(num_channels, _sample_rate);
        this.__wbg_ptr = ret >>> 0;
        SteegParserFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Packets lost (serial number gaps).
     * @returns {number}
     */
    packets_lost() {
        const ret = wasm.steegparser_packets_lost(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Total successfully parsed packets.
     * @returns {number}
     */
    packets_received() {
        const ret = wasm.steegparser_packets_received(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) SteegParser.prototype[Symbol.dispose] = SteegParser.prototype.free;

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
 * @param {Float32Array} samples_flat
 * @param {number} age
 * @returns {string}
 */
export function analyze_eeg(samples_flat, age) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF32ToWasm0(samples_flat, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.analyze_eeg(ptr0, len0, age);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Disable ADC (stop streaming raw EEG data).
 * @returns {Uint8Array}
 */
export function cmd_adc_off() {
    const ret = wasm.cmd_adc_off();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Enable ADC (start streaming raw EEG data).
 * @returns {Uint8Array}
 */
export function cmd_adc_on() {
    const ret = wasm.cmd_adc_on();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Disable AC impedance measurement.
 * @returns {Uint8Array}
 */
export function cmd_impedance_ac_off() {
    const ret = wasm.cmd_impedance_ac_off();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Enable AC impedance measurement.
 * `code_set`: "reference" (default) or "pdf".
 * @param {string} code_set
 * @returns {Uint8Array}
 */
export function cmd_impedance_ac_on(code_set) {
    const ptr0 = passStringToWasm0(code_set, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cmd_impedance_ac_on(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Disable DC impedance measurement.
 * @returns {Uint8Array}
 */
export function cmd_impedance_dc_off() {
    const ret = wasm.cmd_impedance_dc_off();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Enable DC impedance measurement.
 * `code_set`: "reference" (default) or "pdf".
 * @param {string} code_set
 * @returns {Uint8Array}
 */
export function cmd_impedance_dc_on(code_set) {
    const ptr0 = passStringToWasm0(code_set, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cmd_impedance_dc_on(ptr0, len0);
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Request machine / device info from the device.
 * Send this command after connecting; the response arrives as a TAG_COMMAND
 * packet with `machineInfo` set to the device ID string (e.g. "STEEG_DG819452").
 * @returns {Uint8Array}
 */
export function cmd_machine_info() {
    const ret = wasm.cmd_machine_info();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Start data acquisition (alias for cmd_adc_on).
 * @returns {Uint8Array}
 */
export function cmd_start_acquisition() {
    const ret = wasm.cmd_start_acquisition();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Stop data acquisition (alias for cmd_adc_off).
 * @returns {Uint8Array}
 */
export function cmd_stop_acquisition() {
    const ret = wasm.cmd_stop_acquisition();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_get_a8ee5c45dabc1b3b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_length_259ee9d041e381ad: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_b3416cf66a5452c8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_a70fbab9066b301f: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_ab79df5bd7c26067: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_with_length_81c1c31d4432cb9f: function(arg0) {
            const ret = new Float32Array(arg0 >>> 0);
            return ret;
        },
        __wbg_push_e87b0e732085a946: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_361bc2460da3016f: function(arg0, arg1, arg2) {
            arg0.set(getArrayF32FromWasm0(arg1, arg2));
        },
        __wbg_set_7eaa4f96924fd6b3: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./steeg_wasm_bg.js": import0,
    };
}

const SteegParserFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_steegparser_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('steeg_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };

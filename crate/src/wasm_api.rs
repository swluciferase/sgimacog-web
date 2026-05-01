use wasm_bindgen::prelude::*;
use js_sys::{Array, Float32Array, Object, Reflect};

use crate::{
    cobs_frame::{decode_cobs_frame, FrameAccumulator},
    commands::{self, CodeSet},
    impedance::ImpedanceResult,
    impedance_monitor::ImpedanceMonitor,
    protocol::parse_tlv_packet,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_code_set(s: &str) -> CodeSet {
    match s.to_lowercase().as_str() {
        "pdf" => CodeSet::Pdf,
        _ => CodeSet::Reference,
    }
}

/// Copy a Rust f32 slice into a new JS Float32Array (safe, no view).
fn f32_slice_to_typed_array(data: &[f32]) -> Float32Array {
    let arr = Float32Array::new_with_length(data.len() as u32);
    arr.copy_from(data);
    arr
}

// ---------------------------------------------------------------------------
// SteegParser — stateful WASM entry point
// ---------------------------------------------------------------------------

/// Main parser for STeEG EEG device byte streams.
///
/// Accumulates raw serial bytes, decodes COBS frames, parses TLV packets,
/// and optionally computes impedance. All state lives here so JS only needs
/// one object.
#[wasm_bindgen]
pub struct SteegParser {
    accumulator: FrameAccumulator,
    impedance_monitor: Option<ImpedanceMonitor>,
    num_channels: u8,
    last_serial: Option<u32>,
    packets_received: u32,
    packets_lost: u32,
    decode_errors: u32,
}

#[wasm_bindgen]
impl SteegParser {
    /// Create a new parser.
    ///
    /// * `num_channels` — number of EEG channels (typically 8).
    /// * `sample_rate`  — device sample rate in Hz (stored for impedance).
    #[wasm_bindgen(constructor)]
    pub fn new(num_channels: u8, _sample_rate: f64) -> SteegParser {
        SteegParser {
            accumulator: FrameAccumulator::new(),
            impedance_monitor: None,
            num_channels,
            last_serial: None,
            packets_received: 0,
            packets_lost: 0,
            decode_errors: 0,
        }
    }

    /// Feed raw bytes from Web Serial into the parser.
    ///
    /// Returns a JS `Array` of packet objects. Each object has:
    /// ```text
    /// {
    ///   serialNumber:      number | null,
    ///   channels:          Float32Array | null,   // µV values
    ///   battery:           number | null,
    ///   gsensor:           Float32Array | null,   // [gx,gy,gz, ax,ay,az]
    ///   event:             number | null,   // hardware event byte (Tag 7), 0..255 or null
    ///   impedanceResults:  Array | null,
    /// }
    /// ```
    pub fn feed(&mut self, data: &[u8]) -> JsValue {
        let result = Array::new();
        let raw_frames = self.accumulator.feed(data);
        let mut pending_impedance: Option<Vec<ImpedanceResult>> = None;

        for raw_frame in &raw_frames {
            // Step 1: COBS decode
            let decoded = match decode_cobs_frame(raw_frame) {
                Some(d) => d,
                None => {
                    self.decode_errors += 1;
                    continue;
                }
            };

            // Step 2: TLV parse
            let packet = match parse_tlv_packet(&decoded) {
                Some(p) => p,
                None => {
                    self.decode_errors += 1;
                    continue;
                }
            };

            self.packets_received += 1;

            // Step 3: lost-packet detection via serial gap
            if let Some(serial) = packet.serial_number {
                if let Some(last) = self.last_serial {
                    let expected = last.wrapping_add(1);
                    if serial > expected {
                        self.packets_lost += serial - expected;
                    }
                }
                self.last_serial = Some(serial);
            }

            // Step 4: impedance monitoring (if enabled)
            if let Some(ref mut monitor) = self.impedance_monitor {
                if let Some(results) = monitor.feed_packet(&packet) {
                    pending_impedance = Some(results);
                }
            }

            // Step 5: build JS object
            let obj = Self::packet_to_js(&packet);
            result.push(&obj);
        }

        // Attach impedance results to the LAST packet object
        if let Some(results) = pending_impedance {
            let len = result.length();
            if len > 0 {
                let last_obj = result.get(len - 1);
                let imp_arr = Self::impedance_to_js(&results);
                let _ = Reflect::set(&last_obj, &"impedanceResults".into(), &imp_arr);
            }
        }

        result.into()
    }

    /// Enable impedance monitoring with given window size and sample rate.
    pub fn enable_impedance(&mut self, window_size: u32, sample_rate: f64) {
        self.impedance_monitor = Some(ImpedanceMonitor::new(
            window_size as usize,
            sample_rate,
            self.num_channels as usize,
        ));
    }

    /// Disable impedance monitoring and free buffers.
    pub fn disable_impedance(&mut self) {
        self.impedance_monitor = None;
    }

    /// Total successfully parsed packets.
    pub fn packets_received(&self) -> u32 {
        self.packets_received
    }

    /// Packets lost (serial number gaps).
    pub fn packets_lost(&self) -> u32 {
        self.packets_lost
    }

    /// Frames that failed COBS decode or TLV parse.
    pub fn decode_errors(&self) -> u32 {
        self.decode_errors
    }

    // ---- internal helpers (not exported to JS) ----

    fn packet_to_js(packet: &crate::types::EegPacket) -> JsValue {
        let obj = Object::new();

        // serialNumber
        let serial_val = match packet.serial_number {
            Some(s) => JsValue::from(s),
            None => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"serialNumber".into(), &serial_val);

        // channels — µV as Float32Array
        let channels_val = match &packet.eeg_data {
            Some(eeg) => {
                let uv: Vec<f32> = eeg.channels_uv().iter().map(|&v| v as f32).collect();
                f32_slice_to_typed_array(&uv).into()
            }
            None => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"channels".into(), &channels_val);

        // battery
        let battery_val = match &packet.battery {
            Some(b) => JsValue::from(b.level),
            None => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"battery".into(), &battery_val);

        // gsensor — Float32Array [gyro_dps_x, y, z, accel_g_x, y, z]
        let gsensor_val = match &packet.gsensor {
            Some(gs) => {
                let (gx, gy, gz) = gs.gyro_dps();
                let (ax, ay, az) = gs.accel_g();
                let vals: [f32; 6] = [
                    gx as f32, gy as f32, gz as f32,
                    ax as f32, ay as f32, az as f32,
                ];
                f32_slice_to_typed_array(&vals).into()
            }
            None => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"gsensor".into(), &gsensor_val);

        // machineInfo — raw bytes from TAG_COMMAND response (device ID string)
        let machine_info_val = match &packet.machine_info {
            Some(bytes) if !bytes.is_empty() => {
                // Try UTF-8 decode; fall back to hex string
                let s = std::str::from_utf8(bytes)
                    .map(|s| s.trim_matches('\0').to_string())
                    .unwrap_or_else(|_| {
                        bytes.iter().map(|b| format!("{:02X}", b)).collect::<Vec<_>>().join("")
                    });
                JsValue::from_str(&s)
            }
            _ => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"machineInfo".into(), &machine_info_val);

        // event — hardware event byte (Tag 7), 0..255 or null if absent in this packet
        let event_val = match packet.event {
            Some(v) => JsValue::from(v),
            None => JsValue::NULL,
        };
        let _ = Reflect::set(&obj, &"event".into(), &event_val);

        // impedanceResults — starts null, overridden by feed() if available
        let _ = Reflect::set(&obj, &"impedanceResults".into(), &JsValue::NULL);

        obj.into()
    }

    fn impedance_to_js(results: &[ImpedanceResult]) -> JsValue {
        let arr = Array::new();
        for r in results {
            let obj = Object::new();
            let _ = Reflect::set(&obj, &"channel".into(), &JsValue::from(r.channel as u32));
            let _ = Reflect::set(
                &obj,
                &"impedanceKohm".into(),
                &JsValue::from(r.impedance_kohm),
            );
            let _ = Reflect::set(&obj, &"quality".into(), &JsValue::from(r.quality()));
            let _ = Reflect::set(&obj, &"acAmplitude".into(), &JsValue::from(r.ac_amplitude));
            arr.push(&obj);
        }
        arr.into()
    }
}

// ---------------------------------------------------------------------------
// Command generators — free functions exported to JS
// ---------------------------------------------------------------------------

/// Enable ADC (start streaming raw EEG data).
#[wasm_bindgen]
pub fn cmd_adc_on() -> Box<[u8]> {
    commands::cmd_adc_on().into_boxed_slice()
}

/// Disable ADC (stop streaming raw EEG data).
#[wasm_bindgen]
pub fn cmd_adc_off() -> Box<[u8]> {
    commands::cmd_adc_off().into_boxed_slice()
}

/// Enable AC impedance measurement.
/// `code_set`: "reference" (default) or "pdf".
#[wasm_bindgen]
pub fn cmd_impedance_ac_on(code_set: &str) -> Box<[u8]> {
    commands::cmd_impedance_ac_on(parse_code_set(code_set)).into_boxed_slice()
}

/// Disable AC impedance measurement.
#[wasm_bindgen]
pub fn cmd_impedance_ac_off() -> Box<[u8]> {
    commands::cmd_impedance_off(CodeSet::Reference).into_boxed_slice()
}

/// Enable DC impedance measurement.
/// `code_set`: "reference" (default) or "pdf".
#[wasm_bindgen]
pub fn cmd_impedance_dc_on(code_set: &str) -> Box<[u8]> {
    commands::cmd_impedance_dc_on(parse_code_set(code_set)).into_boxed_slice()
}

/// Disable DC impedance measurement.
#[wasm_bindgen]
pub fn cmd_impedance_dc_off() -> Box<[u8]> {
    commands::cmd_impedance_off(CodeSet::Reference).into_boxed_slice()
}

/// Request machine / device info from the device.
/// Send this command after connecting; the response arrives as a TAG_COMMAND
/// packet with `machineInfo` set to the device ID string (e.g. "STEEG_DG819452").
#[wasm_bindgen]
pub fn cmd_machine_info() -> Box<[u8]> {
    commands::cmd_machine_info().into_boxed_slice()
}

/// Start data acquisition (alias for cmd_adc_on).
#[wasm_bindgen]
pub fn cmd_start_acquisition() -> Box<[u8]> {
    commands::cmd_adc_on().into_boxed_slice()
}

/// Stop data acquisition (alias for cmd_adc_off).
#[wasm_bindgen]
pub fn cmd_stop_acquisition() -> Box<[u8]> {
    commands::cmd_adc_off().into_boxed_slice()
}

// ---------------------------------------------------------------------------
// EEG Analysis
// ---------------------------------------------------------------------------

/// Analyse EEG samples and return a JSON result string.
///
/// `samples_flat`: f32 slice, row-major layout `[sample_idx * 8 + channel_idx]`,
///   8 channels, values in µV.
/// `age`: subject age in fractional years (e.g. 12.5 for 12 years 6 months).
///
/// Returns a JSON string:
/// ```json
/// {
///   "indices":{"TBR":…,"APR":…,"FAA":…,"PAF":…,"RSA":…,"COH":…,"EnTP":…},
///   "tscores":{"TBR":…,…},
///   "capability":{"維度名":score,…},
///   "age":…, "cleanEpochs":…, "totalEpochs":…, "durationSec":…
/// }
/// ```
/// On error: `{"error":"reason","age":…,"cleanEpochs":…,"totalEpochs":…,"durationSec":…}`
#[wasm_bindgen]
pub fn analyze_eeg(samples_flat: &[f32], age: f64) -> String {
    let result = crate::eeg_analysis::analyze_eeg_internal(samples_flat, age);
    crate::eeg_analysis::result_to_json(&result)
}

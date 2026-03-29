# sgimacog-web

Browser-based EEG monitoring app for the STEEG 8-channel device (clinical/consumer use).

## Features

- Wizard-style user flow: connect → impedance check → signal view → record
- 10-20 electrode system impedance display (SVG head layout)
- EEG waveform viewer with 6th-order notch filter (50/60 Hz) and 4th-order Butterworth bandpass
- FFT power spectrum with shared filter state
- CSV recording (raw µV data in Cygnus-compatible format)
- Event markers (Space/M key or button)
- ZH/EN language toggle
- No demo mode — shows clear "Not Connected" status when disconnected

## Prerequisites

- Node.js 18+
- [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/)
- Rust toolchain with `wasm32-unknown-unknown` target

## Setup

### 1. Get the Rust crate

This app depends on the `steeg8ch-wasm-rs-web` crate. Either symlink it:

```bash
cd /path/to/sgimacog-web
ln -s ../steeg8ch-wasm-rs-web/crate crate
```

Or copy it:

```bash
cp -r ../steeg8ch-wasm-rs-web/crate ./crate
```

### 2. Build the WASM package

```bash
cd web
npm run build:wasm
```

This runs `wasm-pack build --target web --release` inside the `crate/` directory and outputs to `web/src/pkg/`.

### 3. Install dependencies

```bash
cd web
npm install
```

### 4. Start development server

```bash
cd web
npm run dev
```

Open http://localhost:5173 in Chrome or Edge (Web Serial API required).

## Build for production

```bash
cd web
npm run build
```

Output will be in `web/dist/`.

## Browser Compatibility

Requires a browser with Web Serial API support:
- Chrome 89+
- Edge 89+
- Opera 75+

Firefox and Safari do **not** support Web Serial API.

## CSV Format

Recordings are saved in Cygnus-compatible CSV format. Data is always raw (unfiltered) µV values. The header fields "Bandpass filter" and "Notch filter" describe the display filters active at the time of recording.

Channel mapping: WASM channels[0..7] → Fp1, Fp2, T7, T8, O1, O2, Fz, Pz

## Filter Design

- **Notch**: 6th-order (3 cascaded 2nd-order biquads), Q=35, 50 or 60 Hz
- **Bandpass HP**: 4th-order Butterworth (2 cascaded biquads), Q1=1.3066, Q2=0.5412
- **Bandpass LP**: 4th-order Butterworth (2 cascaded biquads), Q1=1.3066, Q2=0.5412
- **DC removal**: Single-pole IIR HP, α=0.9985 (always active)
- Filter state is shared between Signal and FFT tabs — switching tabs does not reset filter memory

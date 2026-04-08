import { readFileSync } from 'fs';
import { parseCsv } from './src/services/csvParser.ts';
import init, { analyze_eeg } from './src/pkg/steeg_wasm.js';

async function main() {
  const wasmBuf = readFileSync('./src/pkg/steeg_wasm_bg.wasm');
  await init(wasmBuf);

  const text = readFileSync('/Users/swryociao/Downloads/S01_20260408_134621.csv', 'utf-8');
  const result = parseCsv(text);
  
  const nSamples = result.samples.length;
  console.log('Sample count: ' + nSamples);
  
  const flat = new Float32Array(nSamples * 8);
  for (let i = 0; i < nSamples; i++) {
    const chs = result.samples[i].channels;
    for (let ch = 0; ch < 8; ch++) {
      flat[i * 8 + ch] = chs[ch] ?? 0;
    }
  }

  console.log('Calling WASM analyze_eeg...');
  try {
    const jsonStr = analyze_eeg(flat, 26);
    console.log('WASM result length:', jsonStr.length);
    console.log('WASM result sample:', jsonStr);
  } catch (e) {
    console.error('WASM PANICKED:', e);
  }
}

main().catch(console.error);

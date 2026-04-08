import { readFileSync } from 'fs';
import { parseCsv } from './src/services/csvParser.ts';
import fs from 'fs';
import init, { analyze_eeg } from './dist/assets/steeg_wasm*.js' || './src/pkg/steeg_wasm.js';

// No, dynamic import requires exact path, let's use the pkg one directly.

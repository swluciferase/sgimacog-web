/**
 * encrypt-wasm.mjs
 * After wasm-pack build, encrypts the .wasm with AES-256-GCM.
 * Usage: node scripts/encrypt-wasm.mjs <input.wasm> <output.enc>
 * Key read from env: WASM_ENC_KEY (64-char hex = 32 bytes)
 */
import { readFileSync, writeFileSync } from 'fs';
import { webcrypto } from 'crypto';

const [,, inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('Usage: node encrypt-wasm.mjs <input.wasm> <output.enc>');
  process.exit(1);
}

const keyHex = process.env.WASM_ENC_KEY;
if (!keyHex || keyHex.length !== 64) {
  console.error('WASM_ENC_KEY must be set (64-char hex)');
  process.exit(1);
}

const keyBytes = Uint8Array.from(keyHex.match(/.{2}/g).map(h => parseInt(h, 16)));
const wasmBytes = readFileSync(inFile);
const iv = webcrypto.getRandomValues(new Uint8Array(12));

const cryptoKey = await webcrypto.subtle.importKey(
  'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
);
const encrypted = await webcrypto.subtle.encrypt(
  { name: 'AES-GCM', iv }, cryptoKey, wasmBytes
);

// Output format: 12-byte IV || ciphertext+tag
const out = new Uint8Array(12 + encrypted.byteLength);
out.set(iv, 0);
out.set(new Uint8Array(encrypted), 12);
writeFileSync(outFile, out);

console.log(`Encrypted: ${inFile} (${wasmBytes.length} B) -> ${outFile} (${out.length} B)`);

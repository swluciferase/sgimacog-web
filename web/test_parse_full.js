const fs = require('fs');
const text = fs.readFileSync('/Users/swryociao/.gemini/antigravity/scratch/test_wasm_locally.ts', 'utf8');
const newText = text.replace('jsonStr.substring(0, 100)', 'jsonStr');
fs.writeFileSync('/Users/swryociao/.gemini/antigravity/scratch/test_wasm_full.ts', newText);

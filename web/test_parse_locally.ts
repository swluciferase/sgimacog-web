import { readFileSync } from 'fs';
import { parseCsv } from './src/services/csvParser.ts';

const text = readFileSync('/Users/swryociao/Downloads/S01_20260408_134621.csv', 'utf-8');
const result = parseCsv(text);
console.log('Sample count: ' + result.samples?.length);
if (result.error) console.log('Error: ' + result.error);

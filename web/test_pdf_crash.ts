import { jsPDF } from 'jspdf';
import { generateReportPdf } from './src/services/reportPdf.ts';

const result = {
  "indices":{"TBR":0.6448,"APR":0.1039,"FAA":0.0164,"PAF":10.47,"RSA":0.9170,"COH":0.2243,"EnTP":0.5277},
  "tscores":{"TBR":27,"APR":21,"FAA":52,"PAF":57,"RSA":35,"COH":26,"EnTP":21},
  "capability":{
    "職場執行力": 95.33,"決策判斷力": 62.81,"情緒情商": 64.58,"應變靈活性": 47.23,
    "壓力復原力": 55.14,"系統思考力": 67.13,"溝通影響力": 82.77,"職業續航力": 61.43
  },
  "age":26,"cleanEpochs":176,"totalEpochs":204,"durationSec":103.92
};

const fileSubject = { id: '', name: '', age: 26, isMale: true };

(async () => {
  // stub fetch
  global.fetch = async () => ({
    ok: false,
    text: async () => '',
    blob: async () => null,
    arrayBuffer: async () => new ArrayBuffer(0)
  });
  
  // ignore document/window since we are in node
  global.window = { btoa: (s) => Buffer.from(s).toString('base64') };
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({}) }) };
  
  console.log('Generating...');
  try {
    await generateReportPdf(result, fileSubject, new Date(), "STEEG");
    console.log('Done!');
  } catch (e) {
    console.error('CRASHED:', e.stack);
  }
})();

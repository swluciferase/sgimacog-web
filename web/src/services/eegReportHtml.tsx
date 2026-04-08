/**
 * eegReportHtml.tsx
 * Renders the EEG report as a printable HTML page using the standard template.
 * Opens in a new browser tab; layout is kept exactly as designed.
 */

import React from 'react';
import ReactDOMServer from 'react-dom/server';
import QRCode from 'qrcode';
import {
  Activity, Heart, Zap, AlertCircle, CheckCircle2,
  Leaf, ClipboardCheck, TrendingUp, User, Clock, Waves,
  Lightbulb, ShieldCheck, Briefcase, Compass, Smile,
  RefreshCcw, Network, Printer, Brain,
} from 'lucide-react';
import type { ReportResult } from './eegReport';
import type { SubjectInfo } from '../types/eeg';
import type { RppgResults } from './reportPdf';

const REPORT_API = 'https://www.sigmacog.xyz/api/report';

// SigmaCog logo SVG (inlined as data URL for portability in the blob HTML)
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 501.1 95.2"><defs><style>.st0{fill:#72c4a9}.st1{fill:#faf074}.st2{fill:#e2775a}.st3{fill:#9fc65c}.st4{fill:#c1946b}.st5{fill:#b254b2}.st6{fill:#4bb9db}.st7{fill:#e259b1}</style></defs><path d="M153.7,60.2c1,0,2.1-.1,3.1-.4,1-.3,1.9-.7,2.8-1.3.8-.6,1.5-1.3,2-2.1.5-.8.7-1.8.7-2.9s-.3-2.5-1-3.5c-.7-1-1.6-1.9-2.6-2.8-1.1-.8-2.3-1.6-3.7-2.4-1.4-.7-2.8-1.5-4.3-2.2-1.5-.7-2.9-1.5-4.3-2.4-1.4-.8-2.6-1.7-3.7-2.8-1.1-1-2-2.1-2.6-3.4-.7-1.2-1-2.7-1-4.3s.3-3.1.9-4.5c.6-1.4,1.5-2.6,2.7-3.6,1.2-1,2.6-1.8,4.3-2.4s3.7-.9,5.9-.9,3.8.2,5.4.6c1.6.4,3,1.1,4.2,1.9,1.2.8,2.2,1.9,3,3.1.8,1.2,1.5,2.6,2,4.2l-3.7,1.7c-.4-1.3-1-2.5-1.6-3.6-.7-1.1-1.5-2-2.4-2.8-.9-.8-2-1.4-3.2-1.8-1.2-.4-2.6-.6-4.1-.6s-2.5.2-3.5.6c-1,.4-1.8.9-2.5,1.5-.7.6-1.2,1.3-1.5,2.1-.3.8-.5,1.5-.5,2.3s.3,2.1,1,3.1c.7.9,1.6,1.8,2.7,2.6s2.4,1.6,3.9,2.4c1.4.8,2.9,1.5,4.4,2.3,1.5.8,3,1.6,4.4,2.5s2.7,1.8,3.9,2.8c1.1,1,2,2.1,2.7,3.3.7,1.2,1,2.6,1,4.1s-.3,3.3-1,4.8c-.6,1.5-1.6,2.8-2.9,3.9-1.3,1.1-2.9,2-4.8,2.6-1.9.6-4.1,1-6.6,1s-3.9-.2-5.5-.7c-1.6-.4-3-1.1-4.2-2-1.2-.9-2.3-1.9-3.2-3.1s-1.6-2.6-2.1-4.2l3.8-1.6c.4,1.4,1.1,2.6,1.8,3.7.8,1.1,1.6,2,2.6,2.8,1,.8,2.1,1.3,3.3,1.7,1.2.4,2.5.6,3.9.6Z"/><path d="M178.3,19.4h7.1v42.5h-7.1V19.4Z"/><path d="M221.1,21.5c-2.6,0-4.9.5-7.1,1.4-2.2.9-4,2.2-5.6,3.9-1.6,1.7-2.8,3.8-3.7,6.2-.9,2.4-1.3,5.1-1.3,8.1s.5,5.7,1.4,8.1c1,2.4,2.3,4.4,3.9,6.1s3.6,3,5.8,3.9,4.6,1.4,7.2,1.4,3.5-.3,5-.8c1.5-.5,2.8-1.2,4-2.2v-14.9h-8v-2.5h15.2v18.7c-1.2.7-2.5,1.2-3.7,1.8-1.3.5-2.6.9-4.1,1.3-1.5.3-3.1.6-4.8.8-1.8.2-3.7.3-6,.3s-4.6-.3-6.7-.8c-2.1-.5-4.1-1.3-5.9-2.2-1.8-1-3.4-2.1-4.9-3.4-1.5-1.3-2.7-2.8-3.7-4.4-1-1.6-1.8-3.4-2.4-5.2-.6-1.9-.8-3.8-.8-5.8s.3-3.9.8-5.8c.5-1.9,1.3-3.7,2.3-5.4,1-1.7,2.2-3.2,3.6-4.6s3-2.6,4.8-3.6c1.8-1,3.7-1.8,5.8-2.3,2.1-.6,4.3-.8,6.7-.8s4.3.3,6.2.9c1.9.6,3.7,1.4,5.2,2.4s3,2.2,4.2,3.5,2.3,2.7,3.1,4.1l-3.1,2.1c-1.8-3.4-3.8-6-6-7.5-2.2-1.6-4.7-2.4-7.5-2.4Z"/><path d="M249,19.4h7.3l16.5,32.6h.4l16.2-32.6h7.2v42.5h-7.2V27.1h-.2l-17.4,34.8h-1.5l-17.6-34.5h-.5v34.5h-3.2V19.4Z"/><path d="M324.7,18.5l20,43.5h-7.3l-6.5-14.2h-18.2l-6.7,14.2h-3.6l20.5-43.5h1.8ZM314,45h15.7l-7.7-16.8-7.9,16.8Z"/><path d="M356.2,40.8c0,3,.4,5.6,1.3,8,.9,2.4,2.1,4.4,3.7,6,1.6,1.6,3.4,2.9,5.6,3.8,2.1.9,4.5,1.3,7,1.3s2.9-.3,4.3-.9c1.4-.6,2.7-1.3,3.9-2.3,1.2-.9,2.2-2,3.2-3.1.9-1.2,1.7-2.3,2.3-3.5l3,1.9c-.9,1.4-1.9,2.8-3.1,4.1s-2.6,2.5-4.1,3.5c-1.6,1-3.3,1.8-5.3,2.4-2,.6-4.2.9-6.6.9-3.5,0-6.7-.6-9.6-1.8-2.9-1.2-5.3-2.8-7.4-4.8-2.1-2-3.6-4.4-4.8-7-1.1-2.7-1.7-5.5-1.7-8.5s.3-3.9.8-5.8,1.3-3.7,2.2-5.3c1-1.7,2.2-3.2,3.6-4.6,1.4-1.4,3-2.6,4.7-3.6,1.8-1,3.7-1.8,5.8-2.3,2.1-.5,4.3-.8,6.7-.8s4.4.3,6.3.9c1.9.6,3.7,1.4,5.2,2.4s3,2.2,4.2,3.5,2.3,2.7,3.2,4.1l-3.1,2.1c-1.8-3.4-3.8-6-6-7.5-2.2-1.6-4.7-2.4-7.6-2.4s-4.8.4-6.9,1.3c-2.1.9-4,2.2-5.6,3.8-1.6,1.7-2.8,3.7-3.7,6.1-.9,2.4-1.4,5.1-1.4,8.1Z"/><path d="M421.9,62.9c-3.3,0-6.4-.6-9.2-1.8-2.9-1.2-5.3-2.8-7.4-4.8s-3.8-4.4-5-7.1-1.8-5.6-1.8-8.7.3-4,.8-5.9,1.3-3.6,2.3-5.3c1-1.6,2.2-3.1,3.6-4.4,1.4-1.3,3-2.5,4.7-3.4,1.7-1,3.6-1.7,5.6-2.2s4.1-.8,6.3-.8,4.3.3,6.3.8,3.9,1.3,5.6,2.2c1.7,1,3.3,2.1,4.7,3.4,1.4,1.3,2.6,2.8,3.6,4.4,1,1.6,1.8,3.4,2.3,5.3.5,1.9.8,3.8.8,5.9s-.3,4-.8,5.9c-.5,1.9-1.3,3.7-2.3,5.4-1,1.7-2.2,3.2-3.6,4.5-1.4,1.4-3,2.5-4.7,3.5-1.7,1-3.6,1.7-5.6,2.3-2,.5-4.1.8-6.3.8ZM421.9,60.8c2.4,0,4.6-.5,6.5-1.5,1.9-1,3.4-2.4,4.7-4.2,1.3-1.8,2.2-4,2.9-6.4.7-2.5,1-5.2,1-8.1s-.3-5.6-1-8c-.7-2.4-1.6-4.5-2.9-6.3-1.3-1.8-2.9-3.1-4.7-4.1-1.9-1-4-1.5-6.5-1.5s-4.7.5-6.5,1.5c-1.9,1-3.4,2.3-4.7,4.1-1.3,1.8-2.2,3.9-2.9,6.3-.6,2.4-1,5.1-1,8s.3,5.7,1,8.1c.6,2.5,1.6,4.6,2.9,6.4,1.3,1.8,2.8,3.2,4.7,4.2,1.9,1,4,1.5,6.5,1.5Z"/><path d="M479.1,21.5c-2.6,0-4.9.5-7.1,1.4-2.2.9-4,2.2-5.6,3.9-1.6,1.7-2.8,3.8-3.7,6.2s-1.3,5.1-1.3,8.1.5,5.7,1.4,8.1c1,2.4,2.3,4.4,3.9,6.1,1.7,1.7,3.6,3,5.8,3.9s4.6,1.4,7.2,1.4,3.5-.3,5-.8c1.5-.5,2.8-1.2,4-2.2v-14.9h-8v-2.5h15.2v18.7c-1.2.7-2.5,1.2-3.7,1.8-1.3.5-2.6.9-4.1,1.3-1.5.3-3.1.6-4.8.8s-3.7.3-6,.3-4.6-.3-6.7-.8-4.1-1.3-5.9-2.2c-1.8-1-3.4-2.1-4.9-3.4-1.5-1.3-2.7-2.8-3.7-4.4-1-1.6-1.8-3.4-2.4-5.2-.6-1.9-.8-3.8-.8-5.8s.3-3.9.8-5.8,1.3-3.7,2.3-5.4,2.2-3.2,3.6-4.6,3-2.6,4.8-3.6,3.7-1.8,5.8-2.3c2.1-.6,4.3-.8,6.7-.8s4.3.3,6.2.9c1.9.6,3.7,1.4,5.2,2.4s3,2.2,4.2,3.5,2.3,2.7,3.1,4.1l-3.1,2.1c-1.8-3.4-3.8-6-6-7.5-2.2-1.6-4.7-2.4-7.5-2.4Z"/><g><path class="st3" d="M77.7,5.5c-7.3-.3-9.2,3.9-9.3,4.1,0,.2-.3.4-.5.4-6.9.6-9,2.4-9.5,3.7-.8,2,1.4,4.3,1.4,4.3.2.2.2.4.1.7s-.3.4-.5.4c-4.3.3-7.5,1.7-9.3,4.2-3,4.2-1.7,10.4-1,12.8,1.2,4,0,6.4-1.4,7.8.4.9,2.4,4,8.4,5.6.8-.5,3.4-1.8,6.7-1.8.4,0,.9,0,1.5.1,2.9.4,8.4,1,12.8-2.9,4.7-4.1,7.2-12.2,7.4-24.2,0-.2,0-.4.2-.5.1-.1.3-.2.5-.1,0,0,5.2.6,7.6,0,.5-.1,1.5-.5,2.3-1.4-5.4-5.8-11.2-9.8-16.1-12.6-.4-.2-.9-.5-1.4-.7Z"/><path class="st2" d="M48.5,75.6c.9-.8,1.9-1.3,2.9-1.6,5.9-1.8,7.5-4.3,7.8-4.9,0-.1,0-.2,0-.2,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,.1,0,0,0,0,0,0,0h0s0,0,.1,0c0,0,0,0,.1,0s0,0,.1,0c0,0,0,0,0,0,4.6,1.7,10.8-.3,15.6-2.3,5-2,9-1.3,10.1-1.1,5-4.6,3.4-9.7,2.8-11.1-6.8,1.1-12-2-12.3-2.2-.3-.2-.4-.5-.3-.8.6-1.6.4-3,.3-3.8-4.5,2.8-9.3,2.2-12.1,1.9-.5,0-1-.1-1.4-.1-3.6,0-6.2,1.7-6.2,1.7-.1,0-.2.1-.4.1s0,0-.2,0c-6.3-1.5-8.6-4.7-9.4-6.1-.8.5-1.5.8-1.5.8,0,0-.2,0-.3,0-16.1-2.7-20.9,12.3-21.1,12.9,0,.1-.1.2-.2.3l-.6.4c-.4,2.5-.8,9.7,7.2,14.4,6.7,4,14.2,2.9,18.3,1.8h0Z"/><path class="st6" d="M93.2,21.5c-2.1.6-5.8.4-7.4.2-.3,12-2.9,20.2-7.8,24.4-.2.2-.4.3-.6.5.2.7.6,2.4,0,4.5,1.4.7,5.9,2.7,11.4,1.7.3,0,.5,0,.7.3,0,0,3.8,7-2.8,13,.4.9,2.1,3.3,7.9,4.3.9.2,1.8.3,2.6.5,6.7-1.1,15.8-8.3,11.3-26.9-2.5-10.4-7.2-18.2-12.5-24.2-.7.8-1.7,1.4-2.8,1.7h0Z"/><path class="st5" d="M21.8,58.6l.9-.6c.7-1.9,6.3-16.2,22.3-13.6.8-.3,4.6-2,2.9-7.8-.8-2.6-2.2-9.3,1.1-13.9,1.9-2.6,4.9-4.2,9.1-4.7-.7-1.1-1.6-2.9-.9-4.7.9-2.4,4.3-4,10.2-4.5.6-1,2.6-3.9,7.6-4.5C64.1.1,40.9-4.1,19.8,7.7-4.5,21.4-1.8,42.8,3.8,52c4.5,7.4,14.3,7,18,6.6h0Z"/><path class="st7" d="M94.4,71.7c-6.7-1.1-8.5-4.1-9-5.2-1-.2-4.7-.9-9.3,1-4.9,2-11.1,4.1-16,2.5-.4,1.2-.9,4.2,2.8,6.9,0,0,0,0,0,0,.3.3,3.2,3.3,3.8,4.6,0,0,0,0,0,0,.4.3,2.8,0,5.1-.5.2,0,.3,0,.5,0l1.4.9c17.7,3,20.2-7.6,20.6-10.4h0Z"/><path class="st1" d="M72.1,82.4c-1.4.3-3,.6-4.2.6,1,1.6,2.5,3.9,3,4.8.4.8,0,3.4-.8,6,.6.8.9,1.2.9,1.2,5.9,1.2,6.5-3.4,6.5-3.4-3.7-3.9-4.8-7.5-5.1-9h-.2Z"/><path class="st0" d="M57.6,80.3c3.8-.3,5-1.1,5.3-1.5-.3-.3-.5-.6-.8-.8-2.9-2.1-3.6-4.4-3.6-6.2-1.3,1.1-3.4,2.4-6.8,3.5.7,1.4.6,1.9,5.6,4.9,0,0,.1,0,.2.1h0Z"/><path class="st4" d="M69.7,88.4c-.7-1.3-3.8-6.1-3.9-6.1h0s0,0,0,0c-.2-.5-1.1-1.4-1.9-2.5-.6.6-1.9,1.3-4.7,1.7,3.6,2.9,7.6,8,9.9,11,.5-2,.8-3.6.6-4h0Z"/></g></svg>`;
const LOGO_SRC = `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;

// ---------------------------------------------------------------------------
// Supplement & flower recommendation data (per indicator, per direction)
// ---------------------------------------------------------------------------
const RECS: Record<string, {
  high: { supps: string[]; flowers: string[] };
  low:  { supps: string[]; flowers: string[] };
}> = {
  TBR: {
    high: {
      supps:   ['Omega-3 EPA/DHA 1000–2000 mg/天', '鋅 15–30 mg/天', '磷脂醯絲氨酸(PS) 300 mg/天'],
      flowers: ['Clematis（注意力渙散）', 'Chestnut Bud（重複錯誤）', 'Cherry Plum（衝動控制）'],
    },
    low: {
      supps:   ['鎂(Glycinate) 300–400 mg/天，睡前', 'L-Theanine 200 mg/天', 'GABA 500–750 mg/天'],
      flowers: ['White Chestnut（思緒不停打轉）', 'Honeysuckle（思想留在過去）', 'Rescue Remedy（急性壓力）'],
    },
  },
  APR: {
    high: {
      supps:   ['維生素 B12 1000 mcg/天', 'Ginkgo Biloba 120–240 mg/天', '咖啡因 100mg + L-Theanine 200mg'],
      flowers: ['Clematis（心不在焉）', 'Hornbeam（缺乏動力）', 'Wild Rose（漠然無感）'],
    },
    low: {
      supps:   ['L-Theanine 200–400 mg/天', '鎂 300–400 mg/天', 'Ashwagandha 300–600 mg/天'],
      flowers: ['Agrimony（壓抑焦慮）', 'Impatiens（神經緊繃）', 'White Chestnut（睡前思緒翻騰）'],
    },
  },
  FAA: {
    high: {
      supps:   ['Omega-3 EPA優先 2000 mg/天', '鎂 400 mg/天', '維生素 B6(P5P) 50 mg/天'],
      flowers: ['Vervain（過度執著）', 'Impatiens（急躁）', 'Cherry Plum（衝動失控）'],
    },
    low: {
      supps:   ['Omega-3 EPA/DHA 1000–2000 mg/天', '維生素 D3 2000–4000 IU/天', 'SAMe 400–800 mg/天'],
      flowers: ['Mustard（無來由悲傷）', 'Wild Rose（漠然無感）', 'Larch（缺乏自信）'],
    },
  },
  PAF: {
    high: {
      supps:   ['L-Theanine 200 mg/天（防過度激活）', '鎂（維持電解質平衡）'],
      flowers: ['Vervain（過度執著）', 'Impatiens（急躁）', 'Rock Water（過度苛求）'],
    },
    low: {
      supps:   ['Omega-3 DHA 1000–2000 mg/天', 'Citicoline 500–1000 mg/天', '維生素 B1 100 mg/天'],
      flowers: ['Clematis（精神恍惚）', 'Hornbeam（缺乏動力）', 'Olive（極度疲勞）'],
    },
  },
  RSA: {
    high: {
      supps:   ['維生素 B12 1000 mcg/天', '磷脂醯膽鹼 600 mg/天', 'Ginkgo Biloba 120–240 mg/天'],
      flowers: ['Hornbeam（精神懶散）', 'Wild Rose（漠然無感）', 'Clematis（游離當下）'],
    },
    low: {
      supps:   ['L-Theanine 200–400 mg/天', '鎂(Glycinate) 300–400 mg/天', 'Ashwagandha 300–600 mg/天'],
      flowers: ['Agrimony（壓抑焦慮）', 'Impatiens（過度急躁）', 'Rock Water（完美主義緊繃）'],
    },
  },
  COH: {
    high: {
      supps:   ['Omega-3脂肪酸（維持膜流動性）', '維生素 D3 2000 IU/天'],
      flowers: ['Cherry Plum（衝動無法控制）', 'White Chestnut（思緒反覆循環）', 'Vine（強勢不接受意見）'],
    },
    low: {
      supps:   ['Omega-3 DHA 1500–2000 mg/天', 'PS + PC 各300 mg/天', 'B6 50mg + 鎂 300mg'],
      flowers: ['Water Violet（孤立疏離）', 'Clematis（游離當下）', 'Star of Bethlehem（創傷）'],
    },
  },
  EnTP: {
    high: {
      supps:   ['維生素 B12 1000mcg + 葉酸 400mcg/天', '碘+硒（甲狀腺支持）', '咖啡因+L-Theanine（平衡Theta）'],
      flowers: ['Clematis（脫離現實）', 'Star of Bethlehem（創傷解離）', 'Honeysuckle（思想回到過去）'],
    },
    low: {
      supps:   ['Omega-3 DHA 1000–1500 mg/天', '褪黑激素 0.5–1 mg，睡前', '鎂(甘胺酸鎂) 300mg，睡前'],
      flowers: ['Wild Rose（漠然無感）', 'Olive（深度疲勞）', 'Rescue Remedy（複方花精）'],
    },
  },
};

const INDEX_INFO: Record<string, { chName: string; unit: string; decimals: number }> = {
  TBR:  { chName: '大腦喚醒指數', unit: '',   decimals: 2 },
  APR:  { chName: '壓力調節指數', unit: '',   decimals: 2 },
  FAA:  { chName: '情緒趨避指數', unit: '',   decimals: 2 },
  PAF:  { chName: '處理速度指數', unit: 'Hz', decimals: 2 },
  RSA:  { chName: '慢化/疲勞指數', unit: '',  decimals: 2 },
  COH:  { chName: '腦區連結指數', unit: '',   decimals: 2 },
  EnTP: { chName: '大腦複雜度指數', unit: '', decimals: 2 },
};

const TIER_DESC: Record<string, Record<string, string>> = {
  TBR:  { vhigh: '覺醒不足。背景慢波過多，執行力難以啟動，常表現為極度恍神。', high: '分心傾向。注意力容易被外界干擾，維持專注有一定難度。', mid: '狀態平衡。理想的喚醒水平，能在任務與休息間流暢切換。', low: '警覺性高。皮質活動較快，大腦處於高度戒備，長期難以放鬆。', vlow: '過度緊繃。腦力消耗極快，常伴隨強迫性思考，需關注情緒調節。' },
  APR:  { vhigh: '反應淡漠。可能過度抑制外部刺激，建議適度提升活動刺激。', high: '深度寧靜。平靜安穩，心理彈性大，有助快速從壓力恢復。', mid: '彈性良好。具備優質修復能力，大腦「待機」功能正常。', low: '抗壓降低。大腦待機不足，長期處於應激狀態，容易身心疲累。', vlow: '壓力透支。完全喪失放鬆調節能力，大腦運轉過熱，需立即關注。' },
  FAA:  { vhigh: '冒險衝動。強烈趨近動機，情緒亢奮，可能缺乏衝動控制。', high: '積極主動。性格外向進取，面對挑戰多採正向歸因，社交潛力良好。', mid: '情緒穩定。左右腦調節平衡，具良好情緒韌性，趨近與迴避動機均衡。', low: '情緒低落。易受負面訊息影響，表現較強的退縮或消極行為。', vlow: '退縮消極。情緒韌性極低，社交主動性顯著下降，需心理支持介入。' },
  PAF:  { vhigh: '思緒飛躍。腦部運作過快，可能導致資訊超載而焦慮不安。', high: '思維敏捷。邏輯運算與反應速度優異，工作記憶潛力佳。', mid: '標準速。資訊處理效能符合年齡預期，神經傳導效率平衡。', low: '效率下降。腦力疲勞特徵，處理複雜事務較吃力，建議確保充足睡眠。', vlow: '明顯慢化。反應遲緩，神經系統能量受限，建議評估睡眠或代謝因素。' },
  RSA:  { vhigh: '明顯慢化。高頻功率缺失，認知效能與記憶連線受顯著影響。', high: '輕度疲勞。大腦內省過度或能量不足，思考較緩，建議檢視作息。', mid: '生理平衡。大腦節律分布符合年齡預期，Alpha 頻段健康穩定。', low: '認知潛力。高頻 Alpha 占優勢，具優異學習敏銳度，是年輕健康特徵。', vlow: '運轉過熱。缺乏修復性慢波調節，可能導致長期注意力耗竭。' },
  COH:  { vhigh: '系統僵化。腦區過度同步，缺乏靈活分工，認知靈活性顯著下降。', high: '思維慣性。思考容易陷入固定路徑，對新資訊適應力較慢。', mid: '健康網絡。區域間連通正常，能協調完成複雜任務。', low: '協作較弱。通訊不流暢，整合任務可能較吃力，建議加強腦力訓練。', vlow: '網路斷連。各區資訊傳遞失效，難以進行整體性思維整合。' },
  EnTP: { vhigh: '訊號紊亂。資訊處理超載且無序，難以抓重點，建議增加結構化日程。', high: '高創造力。思維活躍聯想豐富，發散思考能力優秀，適合創新任務。', mid: '健康彈性。思維多樣性與穩定度達最佳平衡，能在創意與邏輯間切換。', low: '靈活性低。思維單調反應固定，可能存在長期倦怠，建議多元感官刺激。', vlow: '認知封鎖。活動模式極其單調，缺乏系統動態調節空間，需認知復健。' },
};

function getTier(t: number): string {
  if (t > 90) return 'vhigh';
  if (t > 65) return 'high';
  if (t >= 35) return 'mid';
  if (t >= 10) return 'low';
  return 'vlow';
}

function tierStatusLabel(t: number): string {
  if (t >= 40 && t <= 60) return '正常';
  if (t > 60) return '偏高';
  if (t >= 30) return '偏低';
  return '異常';
}

// ---------------------------------------------------------------------------
// Capability icon & color mapping
// ---------------------------------------------------------------------------
const CAP_COLORS = [
  'bg-blue-600', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500',
  'bg-amber-500', 'bg-emerald-500', 'bg-orange-500', 'bg-red-400',
];

const CAP_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  '職場執行力': Briefcase,  '溝通影響力': Network,    '系統思考力': Brain,
  '情緒情商':   Smile,      '決策判斷力': Compass,     '職業續航力': RefreshCcw,
  '壓力復原力': ShieldCheck,'應變靈活性': Zap,
  '專注持久力': Brain,      '學習敏捷度': Lightbulb,  '邏輯整合力': Network,
  '創意發散力': Zap,        '情緒穩定性': Smile,       '社交適應力': Activity,
  '考試抗壓力': ShieldCheck,'心智續航力': RefreshCcw,
  '認知敏銳度': Brain,      '記憶連結力': Network,     '情緒平和度': Smile,
  '生活應變力': Zap,        '睡眠修復力': RefreshCcw,  '社交參與度': Activity,
  '感覺整合力': Network,    '心智活力度': Lightbulb,
};

// ---------------------------------------------------------------------------
// Report component — exact template layout, dynamic data
// ---------------------------------------------------------------------------
interface ReportProps {
  subjectInfo: {
    id: string; name: string; age: string;
    recordingDate: string; quality: string; device: string; generatedDate: string;
  };
  brainIndices: Array<{
    id: string; name: string; value: string; tScore: number;
    status: string; description: string; supplements: string[]; bachFlowers: string[];
    showRec: boolean;
  }>;
  capabilityProfile: Array<{ label: string; value: number; color: string }>;
  summary: { abnormalNames: string[]; goodNames: string[] };
  topSupps: { name: string; desc: string }[];
  topFlowers: { name: string; desc: string }[];
  rppg?: RppgResults;
  qrCodeDataUrl?: string;
}

const EegReportTemplate: React.FC<ReportProps> = ({
  subjectInfo, brainIndices, capabilityProfile, summary, topSupps, topFlowers, rppg, qrCodeDataUrl,
}) => {
  const abnormalText = summary.abnormalNames.length > 0
    ? `你的 ${summary.abnormalNames.map(n => `${n}`).join(' 與 ')} 指標落入異常區間。這連帶反映大腦在激活與調節上存在不平衡，需要特別關注。`
    : '目前各項指標整體表現良好，大腦激活與調節處於平衡狀態。';

  const goodText = summary.goodNames.length > 0
    ? `儘管部分指標需要關注，你的 ${summary.goodNames.map(n => `${n}`).join(' 與 ')} 仍維持在正常水平，顯示認知潛力與情緒穩定性具備良好基礎。`
    : '整體指標表現均衡，展現出穩定的認知與情緒調節能力。';

  const rppgStressLevel = rppg?.si != null
    ? (rppg.si > 150 ? '高' : rppg.si > 50 ? '中等' : '低')
    : '--';
  const rppgHR   = rppg?.hr   != null ? `${rppg.hr} BPM` : '--';
  const rppgFatigue = rppg?.rmssd != null
    ? (rppg.rmssd < 20 ? '高' : rppg.rmssd < 40 ? '中等' : '低')
    : '--';

  return (
    <div className="min-h-screen bg-gray-100 p-0 md:p-8 flex flex-col items-center">
      {/* Print Button */}
      <button
        id="printBtn"
        className="fixed top-6 right-6 z-50 bg-indigo-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 hover:bg-indigo-700 transition-all no-print print:hidden"
      >
        <Printer className="w-5 h-5" />
        列印 A4 報告
      </button>

      <div className="w-full max-w-[210mm] space-y-8 print:space-y-0">

        {/* === PAGE 1: COVER & OVERVIEW === */}
        <div className="bg-white shadow-lg print:shadow-none w-full min-h-[296mm] p-[20mm] flex flex-col break-after-page page-break">
          {/* Header */}
          <div className="flex justify-between items-start border-b-2 border-indigo-900 pb-6 mb-8">
            <div className="flex flex-col gap-1">
              <img src={LOGO_SRC} alt="SigmaCog" style={{ height: '40px', width: 'auto' }} />
              <span className="text-[10px] tracking-[0.1em] text-indigo-500 font-bold">全年齡的腦力指南</span>
            </div>
            <div className="text-right text-xs text-slate-500">
              <p>報告編號: {subjectInfo.id}</p>
              <p>產出日期: {subjectInfo.generatedDate}</p>
            </div>
          </div>

          <h1 className="text-4xl font-black text-slate-800 mb-4">腦健康評估報告</h1>
          <p className="text-slate-500 text-sm mb-12">Brain Health Assessment &amp; Intervention Guidance</p>

          {/* Subject Info Table */}
          <div className="grid grid-cols-2 gap-4 mb-12">
            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <h3 className="text-indigo-900 font-bold text-sm mb-4 flex items-center gap-2">
                <User className="w-4 h-4" /> 基本資料 Subject Info
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-500">受測 ID</span>
                  <span className="font-bold text-slate-800">{subjectInfo.id}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-500">生理年齡</span>
                  <span className="font-bold text-slate-800">{subjectInfo.age}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-500">量測裝置</span>
                  <span className="font-bold text-slate-800">{subjectInfo.device}</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
              <h3 className="text-indigo-900 font-bold text-sm mb-4 flex items-center gap-2">
                <Activity className="w-4 h-4" /> 量測品質 Recording
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-500">量測時間</span>
                  <span className="font-bold text-slate-800">{subjectInfo.recordingDate}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-500">數據品質</span>
                  <span className="font-bold text-emerald-600">{subjectInfo.quality}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-1">
                  <span className="text-slate-500">評估類型</span>
                  <span className="font-bold text-slate-800">靜態閉眼 (EC)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Summary Section */}
          <div className="mb-12">
            <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
              <ClipboardCheck className="text-indigo-600" /> 核心評估摘要 Executive Summary
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div className="p-6 rounded-3xl bg-red-50 border border-red-100">
                <div className="flex items-center gap-3 mb-3 text-red-700 font-bold">
                  <Zap className="w-5 h-5" /> 大腦激活程度與壓力反應
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{abnormalText}</p>
              </div>
              <div className="p-6 rounded-3xl bg-indigo-50 border border-indigo-100">
                <div className="flex items-center gap-3 mb-3 text-indigo-700 font-bold">
                  <ShieldCheck className="w-5 h-5" /> 良好的認知潛力與情緒穩定性
                </div>
                <p className="text-sm text-slate-600 leading-relaxed">{goodText}</p>
              </div>
            </div>
          </div>

          {/* FaceAI Snapshot (rPPG) */}
          <div>
            <h3 className="text-xl font-bold text-slate-800 mb-6">生理健康快照 FaceAI Health</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center">
                <Heart className="w-5 h-5 text-red-500 mx-auto mb-2" />
                <p className="text-[10px] text-slate-500 uppercase">壓力指數</p>
                <p className="font-bold text-red-600 text-lg">{rppgStressLevel}</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center">
                <Activity className="w-5 h-5 text-indigo-500 mx-auto mb-2" />
                <p className="text-[10px] text-slate-500 uppercase">心跳</p>
                <p className="font-bold text-slate-800 text-lg">{rppgHR}</p>
              </div>
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 text-center">
                <Clock className="w-5 h-5 text-amber-500 mx-auto mb-2" />
                <p className="text-[10px] text-slate-500 uppercase">疲勞指數</p>
                <p className="font-bold text-slate-800 text-lg">{rppgFatigue}</p>
              </div>
            </div>
          </div>

          <div className="mt-auto text-center text-[10px] text-slate-400">
            1/3 - SIGMACOG Brain Health Assessment Report
          </div>
        </div>

        {/* === PAGE 2: BRAIN INDICES DETAILS === */}
        <div className="bg-white shadow-lg print:shadow-none w-full min-h-[296mm] p-[20mm] flex flex-col break-after-page page-break">
          <h2 className="text-2xl font-black text-slate-800 mb-8 border-l-4 border-indigo-900 pl-4">七大腦波指標深度解析</h2>

          <div className="space-y-6 flex-grow">
            {brainIndices.map((idx) => (
              <div key={idx.id} className={`p-6 rounded-3xl border ${idx.tScore < 30 || idx.tScore > 70 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    {idx.tScore < 30 || idx.tScore > 70
                      ? <AlertCircle className="text-red-500 w-5 h-5" />
                      : <CheckCircle2 className="text-emerald-500 w-5 h-5" />
                    }
                    {idx.name}
                  </h4>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">原始值: {idx.value}</span>
                    <span className="text-xs text-slate-500 ml-2">T分數:</span>
                    <span className={`px-4 py-1 rounded-full text-xs font-black ${idx.tScore < 30 || idx.tScore > 70 ? 'bg-red-500 text-white' : idx.tScore >= 40 && idx.tScore <= 60 ? 'bg-emerald-600 text-white' : 'bg-indigo-900 text-white'}`}>
                      {idx.tScore}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-slate-600 leading-relaxed mb-4">{idx.description}</p>

                {idx.showRec && (
                  <div className="grid grid-cols-2 gap-4 border-t border-red-200 pt-4">
                    <div>
                      <p className="text-[10px] font-bold text-red-800 mb-1 uppercase tracking-wider">🥗 營養補充</p>
                      <p className="text-xs text-slate-700">{idx.supplements.join('、')}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold text-pink-800 mb-1 uppercase tracking-wider">🌸 巴哈花精</p>
                      <p className="text-xs text-slate-700">{idx.bachFlowers.join('、')}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-8 p-6 bg-amber-50 border border-amber-200 rounded-2xl text-[10px] text-amber-800">
            <p className="font-bold mb-1">指標判讀標準：</p>
            <p>T分數平均值為 50，標準差為 10。T分數低於 30 或高於 70 代表指標與常模相比存在顯著差異，建議進行生活方式或補充劑調整。</p>
          </div>

          <div className="mt-auto text-center text-[10px] text-slate-400">
            2/3 - SIGMACOG Brain Health Assessment Report
          </div>
        </div>

        {/* === PAGE 3: CAPABILITY & ADVICE === */}
        <div className="bg-white shadow-lg print:shadow-none w-full min-h-[296mm] p-[20mm] flex flex-col">
          <h2 className="text-2xl font-black text-slate-800 mb-8 border-l-4 border-indigo-900 pl-4">能力剖析與調整方案</h2>

          {/* Capability Bars */}
          <div className="mb-12">
            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
              <TrendingUp className="text-emerald-500" /> 職場與生活能力百分比
            </h3>
            <div className="grid grid-cols-1 gap-4">
              {capabilityProfile.map((cap, i) => {
                const IconComp = CAP_ICON_MAP[cap.label] ?? Brain;
                return (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-24 text-[10px] font-bold text-slate-500 text-right flex items-center justify-end gap-1">
                      <IconComp className="w-3 h-3" />
                      {cap.label}
                    </div>
                    <div className="flex-grow h-4 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${cap.color}`} style={{ width: `${cap.value}%` }} />
                    </div>
                    <div className="w-12 text-xs font-black text-indigo-600">{cap.value.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Intervention Program */}
          <div className="bg-indigo-900 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden mb-12">
            <div className="relative z-10">
              <h3 className="text-2xl font-bold mb-6 flex items-center gap-3">
                <Leaf className="text-emerald-400" /> 建議調整方案 (4–8 週計畫)
              </h3>

              <div className="space-y-8">
                <div>
                  <h4 className="text-emerald-400 font-bold text-sm mb-4 border-b border-white/20 pb-2">🥗 營養補充建議 (生理平衡)</h4>
                  <ul className="grid grid-cols-2 gap-4 text-xs">
                    {topSupps.map((s, i) => (
                      <li key={i} className="bg-white/10 p-4 rounded-2xl">
                        <p className="font-bold text-white mb-1">{s.name}</p>
                        <p className="text-indigo-200">{s.desc}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h4 className="text-pink-300 font-bold text-sm mb-4 border-b border-white/20 pb-2">🌸 巴哈花精處方 (情緒穩定)</h4>
                  <ul className="grid grid-cols-2 gap-4 text-xs">
                    {topFlowers.map((f, i) => (
                      <li key={i} className="bg-white/10 p-4 rounded-2xl">
                        <p className="font-bold text-white mb-1">{f.name}</p>
                        <p className="text-indigo-200">{f.desc}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Brain className="w-64 h-64 text-white" />
            </div>
          </div>

          {/* Action Steps */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="p-5 rounded-3xl bg-slate-50 border border-slate-100 text-center">
              <Waves className="w-6 h-6 text-blue-500 mx-auto mb-2" />
              <h5 className="text-xs font-bold text-slate-800">呼吸調節</h5>
              <p className="text-[10px] text-slate-500 mt-1">每日睡前 4-7-8 呼吸 10 分鐘</p>
            </div>
            <div className="p-5 rounded-3xl bg-slate-50 border border-slate-100 text-center">
              <Lightbulb className="w-6 h-6 text-amber-500 mx-auto mb-2" />
              <h5 className="text-xs font-bold text-slate-800">多元刺激</h5>
              <p className="text-[10px] text-slate-500 mt-1">增加感官活動提升大腦複雜度</p>
            </div>
            <div className="p-5 rounded-3xl bg-slate-50 border border-slate-100 text-center">
              <RefreshCcw className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
              <h5 className="text-xs font-bold text-slate-800">間歇休息</h5>
              <p className="text-[10px] text-slate-500 mt-1">使用番茄鐘避免連續腦部慢化</p>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8 mt-auto">
            <div className="flex items-start gap-6">
              <p className="text-[10px] text-slate-400 leading-relaxed flex-1">
                聲明：本報告僅供個人健康參考，不具醫療診斷效力。若你有身心不適，請諮詢合格醫療人員。所有營養補充劑與花精使用建議請先諮詢專業人員。
              </p>
              {qrCodeDataUrl && (
                <div className="flex-shrink-0 text-center">
                  <img src={qrCodeDataUrl} alt="QR Code" style={{ width: '72px', height: '72px' }} />
                  <p className="text-[8px] text-slate-400 mt-1">掃描下載此報告</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 text-center text-[10px] text-slate-400">
            3/3 - SIGMACOG Brain Health Assessment Report
          </div>
        </div>

      </div>

      <style>{`
        @media print {
          body { background-color: white !important; margin: 0 !important; padding: 0 !important; }
          .page-break { display: block; page-break-after: always; }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Build ReportProps from EEG results
// ---------------------------------------------------------------------------

function buildReportProps(
  result: ReportResult,
  subject: SubjectInfo,
  startTime: Date | null,
  deviceId: string | null,
  rppg?: RppgResults,
): ReportProps {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const rec = startTime ?? now;

  const indices = result.indices as unknown as Record<string, number>;
  const tscores = result.tscores as unknown as Record<string, number>;

  const ORDER = ['TBR', 'APR', 'FAA', 'PAF', 'RSA', 'COH', 'EnTP'];

  const brainIndices = ORDER.map(key => {
    const info  = INDEX_INFO[key]!;
    const raw   = indices[key] ?? 0;
    const ts    = tscores[key] ?? 50;
    const tier  = getTier(ts);
    const isHigh = tier === 'high' || tier === 'vhigh';
    const isLow  = tier === 'low'  || tier === 'vlow';
    const showRec = isHigh || isLow;
    const recDir  = isHigh ? 'high' : 'low';
    const recs    = RECS[key]?.[recDir];
    const valueStr = info.unit
      ? `${raw.toFixed(info.decimals)} ${info.unit}`
      : raw.toFixed(info.decimals);
    return {
      id:          key,
      name:        `${info.chName} (${key})`,
      value:       valueStr,
      tScore:      ts,
      status:      tierStatusLabel(ts),
      description: TIER_DESC[key]?.[tier] ?? '',
      supplements: recs?.supps ?? [],
      bachFlowers: recs?.flowers ?? [],
      showRec,
    };
  });

  // Summary
  const abnormal = brainIndices.filter(b => b.tScore < 30 || b.tScore > 70);
  const good     = brainIndices.filter(b => b.tScore >= 40 && b.tScore <= 60);

  // Capability
  const capEntries = Object.entries(result.capability ?? {});
  const capabilityProfile = capEntries
    .sort((a, b) => b[1] - a[1])
    .map(([label, score], i) => ({
      label,
      value: Math.round(score * 10) / 10,
      color: CAP_COLORS[i % CAP_COLORS.length]!,
    }));

  // Top supplements & flowers from worst 2 abnormal indicators
  const worstTwo = abnormal.slice(0, 2);
  const topSupps: { name: string; desc: string }[] = [];
  const topFlowers: { name: string; desc: string }[] = [];

  worstTwo.forEach(idx => {
    const dir = (idx.tScore < 30 || getTier(idx.tScore) === 'vlow') ? 'low' : 'high';
    const recs = RECS[idx.id]?.[dir];
    if (recs) {
      recs.supps.slice(0, 2).forEach(s => {
        if (topSupps.length < 4) {
          const [name, ...rest] = s.split(' ');
          topSupps.push({ name: name ?? s, desc: rest.join(' ') || '依建議劑量服用' });
        }
      });
      recs.flowers.slice(0, 2).forEach(f => {
        if (topFlowers.length < 4) {
          const paren = f.indexOf('（');
          topFlowers.push({
            name:  paren > 0 ? f.slice(0, paren) : f,
            desc:  paren > 0 ? f.slice(paren + 1).replace('）', '') : '情緒調節',
          });
        }
      });
    }
  });

  // Fallback if no abnormal
  if (topSupps.length === 0)   topSupps.push({ name: 'Omega-3 EPA/DHA', desc: '維持神經膜健康，每日 1–2 g' });
  if (topFlowers.length === 0) topFlowers.push({ name: 'Rescue Remedy', desc: '日常情緒平衡維護' });

  const quality = `${Math.round((result.cleanEpochs / Math.max(1, result.totalEpochs)) * 100)}%`;

  return {
    subjectInfo: {
      id:            subject.id  || '—',
      name:          subject.name || '受測者',
      age:           `${result.age} years`,
      recordingDate: `${rec.getFullYear()}/${pad2(rec.getMonth()+1)}/${pad2(rec.getDate())} ${pad2(rec.getHours())}:${pad2(rec.getMinutes())}:${pad2(rec.getSeconds())}`,
      quality,
      device:        deviceId || 'STEEG',
      generatedDate: `${now.getFullYear()}/${pad2(now.getMonth()+1)}/${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
    },
    brainIndices,
    capabilityProfile,
    summary: {
      abnormalNames: abnormal.map(b => b.id),
      goodNames:     good.map(b => b.id),
    },
    topSupps,
    topFlowers,
    rppg,
  };
}

// ---------------------------------------------------------------------------
// Public API — opens the report in a new tab
// ---------------------------------------------------------------------------

function buildFullHtml(reportId: string, htmlBody: string): string {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>腦健康評估報告 — ${reportId}</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
${htmlBody}
<script>
  document.getElementById('printBtn')?.addEventListener('click', function(){ window.print(); });
</script>
</body>
</html>`;
}

export async function openHtmlReport(
  result: ReportResult,
  subject: SubjectInfo,
  startTime: Date | null,
  deviceId: string | null,
  rppg?: RppgResults,
): Promise<void> {
  const props = buildReportProps(result, subject, startTime, deviceId, rppg);

  // Open the window IMMEDIATELY (must be synchronous w.r.t. user gesture to pass popup blocker)
  const win = window.open('', '_blank');
  if (win) {
    win.document.write('<html><body style="background:#0a1422;color:#8ba3c8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-size:16px">報告生成中，請稍候…</body></html>');
    win.document.close();
  }

  // Try to upload the HTML and get a shareable URL for the QR code
  let qrCodeDataUrl: string | undefined;
  try {
    const prelimBody = ReactDOMServer.renderToStaticMarkup(<EegReportTemplate {...props} />);
    const prelimHtml = buildFullHtml(props.subjectInfo.id, prelimBody);
    const resp = await fetch(REPORT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: new Blob([prelimHtml], { type: 'text/html;charset=utf-8' }),
    });
    if (resp.ok) {
      const { url } = await resp.json() as { url: string };
      qrCodeDataUrl = await QRCode.toDataURL(url, { width: 200, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
    }
  } catch { /* no QR if upload fails */ }

  // Final render with QR code embedded
  const finalProps = { ...props, qrCodeDataUrl };
  const htmlBody = ReactDOMServer.renderToStaticMarkup(<EegReportTemplate {...finalProps} />);
  const fullHtml = buildFullHtml(props.subjectInfo.id, htmlBody);

  if (win) {
    // Write final HTML into the already-open window
    win.document.open();
    win.document.write(fullHtml);
    win.document.close();
  } else {
    // Popup was blocked — fallback to blob URL (user may need to allow popups)
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const w2 = window.open(blobUrl, '_blank');
    if (w2) w2.addEventListener('load', () => setTimeout(() => URL.revokeObjectURL(blobUrl), 5000));
    else {
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      throw new Error('瀏覽器封鎖了彈出視窗，請允許此網站開啟彈出視窗後重試');
    }
  }
}

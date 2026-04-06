/**
 * reportPdf.ts
 * Generates a brain health assessment PDF using jsPDF.
 */

import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { BrainIndices, ReportResult } from './eegReport';
import type { SubjectInfo } from '../types/eeg';

const REPORT_API = 'https://www.sigmacog.xyz/api/report';

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------
const C = {
  bg:        [8,  17, 30] as [number, number, number],
  headerBg:  [20, 40, 70] as [number, number, number],
  accent:    [88, 166, 255] as [number, number, number],
  text:      [200, 215, 235] as [number, number, number],
  subtext:   [130, 155, 185] as [number, number, number],
  good:      [63, 185, 80] as [number, number, number],
  warn:      [227, 160, 48] as [number, number, number],
  bad:       [248, 81, 73] as [number, number, number],
  rowEven:   [14, 28, 48] as [number, number, number],
  rowOdd:    [10, 20, 35] as [number, number, number],
  border:    [40, 65, 100] as [number, number, number],
  white:     [255, 255, 255] as [number, number, number],
  // Tier colours
  tierVHigh: [124, 58, 237] as [number, number, number],
  tierHigh:  [217, 119,  6] as [number, number, number],
  tierMid:   [  5, 150, 105] as [number, number, number],
  tierLow:   [ 37,  99, 235] as [number, number, number],
  tierVLow:  [220,  38,  38] as [number, number, number],
};

// ---------------------------------------------------------------------------
// T-score 5-tier helpers
// ---------------------------------------------------------------------------
type Tier = 'vhigh' | 'high' | 'mid' | 'low' | 'vlow';

function getTier(t: number): Tier {
  if (t > 90) return 'vhigh';
  if (t > 65) return 'high';
  if (t >= 35) return 'mid';
  if (t >= 10) return 'low';
  return 'vlow';
}

function tierColor(tier: Tier): [number, number, number] {
  const map: Record<Tier, [number,number,number]> = {
    vhigh: C.tierVHigh, high: C.tierHigh, mid: C.tierMid,
    low: C.tierLow, vlow: C.tierVLow,
  };
  return map[tier];
}

function tierChLabel(tier: Tier): string {
  return { vhigh:'過高', high:'偏高', mid:'適中', low:'偏低', vlow:'過低' }[tier];
}

function tscoreColor(t: number): [number, number, number] {
  if (t >= 40 && t <= 60) return C.good;
  if (t >= 30 && t <= 70) return C.warn;
  return C.bad;
}

function tscoreStatusLabel(t: number): string {
  if (t >= 40 && t <= 60) return '正常';
  if (t > 60) return '偏高';
  if (t >= 30) return '偏低';
  return '異常';
}

// ---------------------------------------------------------------------------
// Index metadata — descriptions from reference document (no channels/formulas)
// ---------------------------------------------------------------------------
interface IndexMeta {
  key: keyof BrainIndices;
  name: string;
  chName: string;
  unit: string;
  decimals: number;
  description: string;
  tiers: Record<Tier, string>;
}

const INDEX_META: IndexMeta[] = [
  {
    key: 'TBR', name: 'TBR', chName: '大腦喚醒指數', unit: '', decimals: 2,
    description: 'Theta 波在放鬆與思緒飄移時增強，Beta 波在清醒專注時活躍，此比值廣泛應用於注意力與認知投入效率的研究評估。',
    tiers: {
      vhigh: '覺醒不足。背景慢波過多，執行力難以啟動，常表現為極度恍神。建議評估是否有注意力缺失傾向或睡眠問題。',
      high:  '分心傾向。注意力容易被外界干擾，維持專注有一定難度，在高度集中任務時表現不穩定。',
      mid:   '狀態平衡。理想的喚醒水平，能在任務與休息間流暢切換，皮質喚醒度處於理想區間。',
      low:   '警覺性高。皮質活動較快，大腦處於高度戒備狀態，但長期下難以放鬆，可能容易感到緊繃。',
      vlow:  '過度緊繃。腦力消耗極快，常伴隨強迫性思考，需特別關注情緒調節能力。',
    },
  },
  {
    key: 'APR', name: 'APR', chName: '壓力調節指數', unit: '', decimals: 2,
    description: 'Alpha 波相對功率反映大腦在不同狀態下的功能表現，較高數值對應放鬆儲備，較低數值則與長期應激及壓力調節困難相關。',
    tiers: {
      vhigh: '反應淡漠。可能過度抑制外部刺激，表現為情感隔離或遲鈍，建議適度提升活動刺激。',
      high:  '深度寧靜。平靜安穩，心理彈性空間大，有助於快速從壓力中恢復，整體心理韌性佳。',
      mid:   '彈性良好。具備優質的修復能力，能在壓力後迅速恢復平衡，大腦「待機」功能正常。',
      low:   '抗壓降低。大腦待機不足，長期處於應激狀態，容易感到身心疲累或焦躁。',
      vlow:  '壓力透支。完全喪失放鬆調節能力，大腦運轉過熱且無法停下，需立即關注身心狀態。',
    },
  },
  {
    key: 'FAA', name: 'FAA', chName: '情緒趨避指數', unit: '', decimals: 2,
    description: '左右額葉之間腦波功率的不對稱程度，與情緒狀態和心理健康密切相關，是評估情緒調節傾向的重要生理標記。',
    tiers: {
      vhigh: '冒險衝動。強烈的趨近動機，情緒亢奮，但可能缺乏衝動控制，行動前應多加思考。',
      high:  '積極主動。性格外向具進取心，面對挑戰多採積極歸因，社交與領導潛力良好。',
      mid:   '情緒穩定。左右腦調節平衡，具備良好的情緒韌性，趨近與迴避動機均衡。',
      low:   '情緒低落。易受負面訊息影響，表現出較強的退縮或消極行為，建議練習認知重評策略。',
      vlow:  '退縮消極。情緒韌性極低，社交主動性顯著下降，需要積極的心理支持介入。',
    },
  },
  {
    key: 'PAF', name: 'PAF', chName: '處理速度指數', unit: 'Hz', decimals: 2,
    description: 'Alpha 波頻譜中功率最高的特定頻率，與認知發展、功能成熟及神經傳導活動效率高度相關，反映大腦的「核心時脈」。',
    tiers: {
      vhigh: '思緒飛躍。腦部運作過快，可能導致資訊超載而產生焦慮不安，建議有意識地放慢思考節奏。',
      high:  '思維敏捷。邏輯運算與反應速度優異，工作記憶潛力佳，在快節奏任務中表現突出。',
      mid:   '標準速。資訊處理效能符合生理年齡預期，神經傳導效率與認知負荷達到平衡。',
      low:   '效率下降。腦力疲勞特徵，處理複雜事務時較為吃力，建議確保充足睡眠以維持神經傳導品質。',
      vlow:  '明顯慢化。反應遲緩，神經系統運作能量受限，建議評估是否有睡眠障礙或其他代謝因素。',
    },
  },
  {
    key: 'RSA', name: 'RSA', chName: '慢化／疲勞指數', unit: '', decimals: 2,
    description: 'Alpha 頻段內低頻與高頻的功率比值，反映大腦節律的老化跡象或疲勞程度，廣泛應用於認知疲勞、老化及注意力的研究。',
    tiers: {
      vhigh: '明顯慢化。高頻功率缺失，認知效能與記憶連線受到顯著影響，建議進行認知功能詳細評估。',
      high:  '輕度疲勞。大腦內省過度或能量不足，自覺學習或思考較緩慢，建議檢視作息習慣。',
      mid:   '生理平衡。大腦節律分布符合年齡預期，Alpha 頻段運作健康穩定。',
      low:   '認知潛力。高頻 Alpha 占優勢，具備優異的學習敏銳度，是年輕健康大腦的典型特徵。',
      vlow:  '運轉過熱。缺乏修復性慢波調節，可能導致長期注意力耗竭，建議評估睡眠品質。',
    },
  },
  {
    key: 'COH', name: 'COH', chName: '腦區連結指數', unit: '', decimals: 2,
    description: '腦區之間腦波活動的同步程度，代表功能連結性與資訊傳遞效率，是評估大腦協同運作能力的重要依據。',
    tiers: {
      vhigh: '系統僵化。腦區過度依賴與同步，缺乏靈活分工與多元反應，認知靈活性顯著下降。',
      high:  '思維慣性。思考容易陷入固定路徑，對新資訊適應力較慢，需要刺激多元化思考。',
      mid:   '健康網絡。區域間連通正常，能協調完成複雜任務，兼顧專業分工與跨域整合。',
      low:   '協作較弱。通訊不流暢，整合任務（如手眼協調）可能較吃力，建議透過腦力訓練加強連結。',
      vlow:  '網路斷連。各區資訊傳遞失效，難以進行整體性的思維整合，建議尋求專業評估。',
    },
  },
  {
    key: 'EnTP', name: 'EnTP', chName: '大腦複雜度指數', unit: '', decimals: 2,
    description: '評估大腦活動的複雜程度與資訊處理能力，較高數值代表豐富的腦波模式與強大的動態調節能力。',
    tiers: {
      vhigh: '訊號紊亂。資訊處理超載且無序，難以抓到重點，建議增加結構化日程規劃。',
      high:  '高創造力。思維活躍且聯想豐富，具備優秀的發散思考能力，適合需要創新的任務環境。',
      mid:   '健康彈性。思維多樣性與穩定度取得最佳平衡，能在創意與邏輯之間靈活切換。',
      low:   '靈活性低。思維單調、反應固定，可能存在長期倦怠，建議增加多元感官刺激。',
      vlow:  '認知封鎖。活動模式極其單調，缺乏系統動態調節空間，建議積極的認知復健介入。',
    },
  },
];

// ---------------------------------------------------------------------------
// Capability profile — utility score transform (v2 algorithm)
// ---------------------------------------------------------------------------
interface CapDim { name: string; score: number }

/** Map a T-score to a quality score 0–100 based on the indicator's mode. */
function utilityScore(tRaw: number, mode: 'centered' | 'high' | 'low'): number {
  const t = Math.max(0, Math.min(100, tRaw));
  let q: number;
  if (mode === 'centered') {
    const sigma = 22;
    q = 100 * Math.exp(-((t - 50) ** 2) / (2 * sigma * sigma));
  } else if (mode === 'high') {
    q = t > 70 ? 100 - (t - 70) * 1.5 : t > 0 ? 100 * (t / 70) : 0;
  } else {
    q = t < 30 ? 100 - (30 - t) * 1.5 : 100 * (1 - (t - 30) / 70);
  }
  return Math.max(0, q);
}

function capabilityProfile(
  ts: Record<string, number>,
  age: number,
): CapDim[] | null {
  if (age >= 4 && age <= 6) return null;

  const raw = (k: string) => ts[k] ?? 50;
  const q = {
    TBR:     utilityScore(raw('TBR'),  'low'),
    APR:     utilityScore(raw('APR'),  'high'),
    FAA:     utilityScore(raw('FAA'),  'high'),
    PAF:     utilityScore(raw('PAF'),  'centered'),
    RSA:     utilityScore(raw('RSA'),  'low'),
    COH:     utilityScore(raw('COH'),  'centered'),
    EnTP:    utilityScore(raw('EnTP'), 'centered'),
    COH_inv: utilityScore(100 - raw('COH'), 'centered'),
  };
  const r2 = (v: number) => Math.round(v * 100) / 100;

  if (age >= 7 && age <= 24) {
    return [
      { name: '專注持久力', score: r2(q.TBR*0.7  + q.COH*0.3) },
      { name: '學習敏捷度', score: r2(q.PAF*0.6  + q.EnTP*0.4) },
      { name: '邏輯整合力', score: r2(q.COH*0.6  + q.PAF*0.4) },
      { name: '創意發散力', score: r2(q.EnTP*0.7 + q.COH_inv*0.3) },
      { name: '情緒穩定性', score: r2(q.FAA*0.5  + q.APR*0.5) },
      { name: '社交適應力', score: r2(q.FAA*0.6  + q.EnTP*0.4) },
      { name: '考試抗壓力', score: r2(q.APR*0.7  + q.TBR*0.3) },
      { name: '心智續航力', score: r2(q.RSA*0.6  + q.PAF*0.4) },
    ];
  }
  if (age >= 25 && age <= 64) {
    return [
      { name: '職場執行力', score: r2(q.TBR*0.6  + q.PAF*0.4) },
      { name: '決策判斷力', score: r2(q.FAA*0.4  + q.COH*0.6) },
      { name: '情緒情商',   score: r2(q.FAA*0.7  + q.EnTP*0.3) },
      { name: '應變靈活性', score: r2(q.EnTP*0.6 + q.COH_inv*0.4) },
      { name: '壓力復原力', score: r2(q.APR*0.6  + q.RSA*0.4) },
      { name: '系統思考力', score: r2(q.COH*0.7  + q.PAF*0.3) },
      { name: '溝通影響力', score: r2(q.FAA*0.6  + q.TBR*0.4) },
      { name: '職業續航力', score: r2(q.RSA*0.5  + q.APR*0.5) },
    ];
  }
  // age >= 65
  return [
    { name: '認知敏銳度', score: r2(q.PAF*0.5  + q.RSA*0.5) },
    { name: '記憶連結力', score: r2(q.RSA*0.6  + q.COH*0.4) },
    { name: '情緒平和度', score: r2(q.FAA*0.4  + q.APR*0.6) },
    { name: '生活應變力', score: r2(q.EnTP*0.7 + q.COH_inv*0.3) },
    { name: '睡眠修復力', score: r2(q.APR*0.6  + q.TBR*0.4) },
    { name: '社交參與度', score: r2(q.FAA*0.6  + q.EnTP*0.4) },
    { name: '感覺整合力', score: r2(q.COH*0.5  + q.PAF*0.5) },
    { name: '心智活力度', score: r2(q.EnTP*0.6 + q.RSA*0.4) },
  ];
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function setFont(doc: jsPDF, size: number, style: 'normal'|'bold' = 'normal', color = C.text) {
  doc.setFontSize(size);
  doc.setFont('helvetica', style);
  doc.setTextColor(...color);
}

function rect(doc: jsPDF, x: number, y: number, w: number, h: number, fill: [number,number,number], stroke?: [number,number,number]) {
  doc.setFillColor(...fill);
  if (stroke) {
    doc.setDrawColor(...stroke);
    doc.rect(x, y, w, h, 'FD');
  } else {
    doc.rect(x, y, w, h, 'F');
  }
}

function tBar(doc: jsPDF, x: number, y: number, totalW: number, h: number, tScore: number) {
  rect(doc, x, y, totalW, h, [20, 38, 62]);
  const lo = totalW * (40 / 99);
  const hi = totalW * (60 / 99);
  rect(doc, x + lo, y, hi - lo, h, [35, 60, 95]);
  const pct = Math.min(1, tScore / 99);
  const fillW = Math.max(0.5, totalW * pct);
  rect(doc, x, y, fillW, h, tscoreColor(tScore));
  doc.setDrawColor(...C.white);
  doc.setLineWidth(0.5);
  doc.line(x + fillW, y, x + fillW, y + h);
}

// Capability horizontal bar
function capBar(doc: jsPDF, x: number, y: number, w: number, h: number, score: number) {
  rect(doc, x, y, w, h, [12, 24, 42]);
  const pct = Math.min(1, score / 100);
  const fillW = Math.max(0.5, w * pct);
  let color: [number,number,number];
  if (score >= 65) color = [5, 150, 105];
  else if (score >= 35) color = [217, 119, 6];
  else color = [220, 38, 38];
  rect(doc, x, y, fillW, h, color);
}

// ---------------------------------------------------------------------------
// Check/add page
// ---------------------------------------------------------------------------
function ensureSpace(doc: jsPDF, y: number, needed: number, PH: number, ML: number, PW: number): number {
  if (y + needed > PH - 14) {
    doc.addPage();
    rect(doc, 0, 0, PW, PH, C.bg);
    return 14;
  }
  return y;
}

// ---------------------------------------------------------------------------
// Main PDF builder
// ---------------------------------------------------------------------------

export async function generateReportPdf(
  result: ReportResult,
  subject: SubjectInfo,
  startTime: Date | null,
  deviceId: string | null,
): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210;
  const PH = 297;
  const ML = 14, MR = 14;
  const CW = PW - ML - MR;

  rect(doc, 0, 0, PW, PH, C.bg);

  let y = 0;

  // ── Header ──────────────────────────────────────────────────
  const headerH = 34;
  rect(doc, 0, 0, PW, headerH, C.headerBg);
  rect(doc, 0, headerH - 2, PW, 2, C.accent);

  setFont(doc, 16, 'bold', C.white);
  doc.text('腦波健康評估報告', ML, 12);
  setFont(doc, 8, 'normal', C.subtext);
  doc.text('Brain Health Assessment Report', ML, 18);
  doc.text('sgimacog EEG · Powered by STeEG', ML, 23);

  const now = new Date();
  setFont(doc, 8, 'normal', C.subtext);
  doc.text(`Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`, PW - MR, 14, { align: 'right' });
  if (startTime) {
    doc.text(`Recording: ${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString()}`, PW - MR, 20, { align: 'right' });
  }

  y = headerH + 8;

  // ── Subject info ────────────────────────────────────────────
  const infoH = 36;
  rect(doc, ML, y, CW, infoH, C.rowOdd, C.border);
  setFont(doc, 9, 'bold', C.accent);
  doc.text('受測者資訊 SUBJECT INFORMATION', ML + 5, y + 7);

  const col1 = ML + 5, col2 = ML + CW / 2 + 5;
  const infoRows1 = [['Subject ID', subject.id || '—'], ['Name', subject.name || '—'], ['Date of Birth', subject.dob || '—']];
  const infoRows2 = [['Age', `${result.age} years`], ['Sex', subject.sex || '—'], ['Device', deviceId || '—']];
  infoRows1.forEach(([label, val], i) => {
    const iy = y + 14 + i * 7;
    setFont(doc, 8, 'normal', C.subtext); doc.text(label + ':', col1, iy);
    setFont(doc, 8, 'bold', C.text); doc.text(val, col1 + 28, iy);
  });
  infoRows2.forEach(([label, val], i) => {
    const iy = y + 14 + i * 7;
    setFont(doc, 8, 'normal', C.subtext); doc.text(label + ':', col2, iy);
    setFont(doc, 8, 'bold', C.text); doc.text(val, col2 + 18, iy);
  });

  y += infoH + 6;

  // ── Recording stats ─────────────────────────────────────────
  const statsH = 18;
  rect(doc, ML, y, CW, statsH, C.rowEven, C.border);
  const dur = result.durationSec;
  const durStr = `${Math.floor(dur / 60)}m ${Math.floor(dur % 60)}s`;
  const statsItems = [
    ['Duration', durStr],
    ['Total Epochs', `${result.totalEpochs}`],
    ['Clean Epochs', `${result.cleanEpochs}`],
    ['Quality', `${Math.round((result.cleanEpochs / Math.max(1, result.totalEpochs)) * 100)}%`],
  ];
  const statW = CW / statsItems.length;
  statsItems.forEach(([label, val], i) => {
    const sx = ML + i * statW + statW / 2;
    setFont(doc, 7, 'normal', C.subtext); doc.text(label, sx, y + 6, { align: 'center' });
    setFont(doc, 10, 'bold', C.accent); doc.text(val, sx, y + 14, { align: 'center' });
  });

  y += statsH + 8;

  // ── Brain Health Indices section header ─────────────────────
  setFont(doc, 10, 'bold', C.accent);
  doc.text('七大腦波指標  BRAIN HEALTH INDICES', ML, y);
  y += 6;

  // ── Index table columns ──────────────────────────────────────
  const COL_KEY    = ML;
  const COL_DESC   = ML + 22;
  const COL_RAW    = ML + 96;
  const COL_TS     = ML + 116;
  const COL_BAR    = ML + 132;
  const COL_STATUS = ML + 181;
  const BAR_W      = 46;
  const ROW_H      = 32;   // base row height; tier panel adds more

  // Table header
  rect(doc, ML, y, CW, 8, C.headerBg);
  setFont(doc, 7, 'bold', C.subtext);
  const hdrs = ['指標','說明','原始值','T分數','T分數量表 (1–99)','狀態'];
  const hdrX = [COL_KEY, COL_DESC, COL_RAW, COL_TS, COL_BAR, COL_STATUS];
  hdrs.forEach((h, i) => doc.text(h, hdrX[i]! + 1, y + 5.5));
  y += 8;

  // ── Per-indicator rows ───────────────────────────────────────
  const tscoresMap: Record<string, number> = result.tscores as unknown as Record<string, number>;

  INDEX_META.forEach((meta, idx) => {
    const raw  = (result.indices as unknown as Record<string, number>)[meta.key] ?? 0;
    const ts   = tscoresMap[meta.key] ?? 50;
    const tier = getTier(ts);
    const bg   = idx % 2 === 0 ? C.rowOdd : C.rowEven;
    const tCol = tierColor(tier);
    const statusLabel = tscoreStatusLabel(ts);

    // --- Tier explanation text height estimate ---
    const tierLines = doc.splitTextToSize(meta.tiers[tier], BAR_W + 14);
    const tierPanelH = 8 + tierLines.length * 4.2 + 3;
    const rowTotal = ROW_H + tierPanelH;

    y = ensureSpace(doc, y, rowTotal + 2, PH, ML, PW);
    rect(doc, ML, y, CW, rowTotal, bg, C.border);

    // Indicator key + Chinese name
    setFont(doc, 9, 'bold', C.accent);
    doc.text(meta.name, COL_KEY + 1, y + 7);
    setFont(doc, 7, 'normal', C.subtext);
    doc.text(meta.chName, COL_KEY + 1, y + 13);

    // Description — wrapped
    const descLines = doc.splitTextToSize(meta.description, 72);
    setFont(doc, 6.5, 'normal', C.text);
    doc.text(descLines.slice(0, 5), COL_DESC + 1, y + 6);

    // Raw value
    const rawStr = meta.unit
      ? `${raw.toFixed(meta.decimals)} ${meta.unit}`
      : raw.toFixed(meta.decimals);
    setFont(doc, 8, 'bold', C.text);
    doc.text(rawStr, COL_RAW + 1, y + 8);

    // T-score
    setFont(doc, 11, 'bold', tscoreColor(ts));
    doc.text(`${ts}`, COL_TS + 5, y + 8, { align: 'center' });

    // T-bar
    tBar(doc, COL_BAR + 1, y + 4, BAR_W, 5, ts);
    setFont(doc, 5.5, 'normal', C.subtext);
    [30, 50, 70].forEach(v => {
      doc.text(`${v}`, COL_BAR + 1 + BAR_W * (v / 99), y + 11.5, { align: 'center' });
    });

    // Status
    setFont(doc, 8, 'bold', tscoreColor(ts));
    doc.text(statusLabel, COL_STATUS + 1, y + 8);

    // --- 5-tier explanation panel ---
    const panelY = y + ROW_H - 2;
    const panelX = COL_BAR + 1;
    const panelW = CW - (COL_BAR - ML) - 2;

    // Tier badge background
    rect(doc, panelX, panelY, panelW, tierPanelH - 2, [12, 22, 40]);
    doc.setDrawColor(...tCol);
    doc.setLineWidth(0.4);
    doc.rect(panelX, panelY, panelW, tierPanelH - 2);

    // Badge
    const badgeW = 22;
    rect(doc, panelX + 2, panelY + 2, badgeW, 4.5, tCol);
    setFont(doc, 6.5, 'bold', C.white);
    doc.text(tierChLabel(tier), panelX + 2 + badgeW / 2, panelY + 5.2, { align: 'center' });

    // Tier text
    setFont(doc, 6, 'normal', C.text);
    doc.text(tierLines, panelX + badgeW + 5, panelY + 5);

    y += rowTotal + 2;
  });

  y += 6;

  // ── Capability Profile section ───────────────────────────────
  const tscoresForCap: Record<string, number> = {};
  for (const [k, v] of Object.entries(result.tscores as unknown as Record<string, number>)) {
    tscoresForCap[k] = v;
  }

  // Also accept pre-computed capability from WASM result
  const wasmCap = (result as unknown as { capability?: Record<string, number> }).capability;
  const dimScores: CapDim[] | null = wasmCap
    ? Object.entries(wasmCap).map(([name, score]) => ({ name, score }))
    : capabilityProfile(tscoresForCap, result.age);

  const ageGroupLabel =
    result.age >= 65 ? '高齡長者 (65+ 歲) · Healthy Aging' :
    result.age >= 25 ? '職場成人 (25–64 歲) · Workplace Performance' :
    result.age >= 7  ? '學生族群 (7–24 歲) · Development Potential' :
    '';

  y = ensureSpace(doc, y, 20, PH, ML, PW);

  // Section header
  rect(doc, ML, y, CW, 10, C.headerBg);
  rect(doc, ML, y + 9, CW, 1, C.accent);
  setFont(doc, 9, 'bold', C.accent);
  doc.text('能力面向指標  CAPABILITY PROFILE', ML + 3, y + 6.5);
  if (ageGroupLabel) {
    setFont(doc, 7, 'normal', C.subtext);
    doc.text(ageGroupLabel, PW - MR, y + 6.5, { align: 'right' });
  }
  y += 12;

  if (!dimScores) {
    // Age 4-6: skip notice
    y = ensureSpace(doc, y, 18, PH, ML, PW);
    rect(doc, ML, y, CW, 14, C.rowOdd, C.border);
    setFont(doc, 8, 'normal', C.subtext);
    doc.text('受測者年齡為 4–6 歲，能力面向指標分析不適用於此年齡層。', ML + 5, y + 8);
    y += 20;
  } else {
    const capLabelW = 34;
    const capBarX   = ML + capLabelW + 2;
    const capBarW   = CW - capLabelW - 22;
    const capScoreX = capBarX + capBarW + 3;
    const CAP_ROW_H = 9;

    dimScores.forEach((dim, i) => {
      y = ensureSpace(doc, y, CAP_ROW_H + 3, PH, ML, PW);
      const bg = i % 2 === 0 ? C.rowOdd : C.rowEven;
      rect(doc, ML, y, CW, CAP_ROW_H, bg);

      // Label
      setFont(doc, 8, 'bold', C.text);
      doc.text(dim.name, ML + capLabelW - 1, y + 6.2, { align: 'right' });

      // Bar
      capBar(doc, capBarX, y + 1.5, capBarW, 6, dim.score);

      // Score value
      const scoreColor: [number,number,number] =
        dim.score >= 65 ? C.good : dim.score >= 35 ? C.warn : C.bad;
      setFont(doc, 8, 'bold', scoreColor);
      doc.text(dim.score.toFixed(1), capScoreX, y + 6.2);

      y += CAP_ROW_H;
    });
    y += 4;
  }

  // ── Notes ────────────────────────────────────────────────────
  if (subject.notes && subject.notes.trim()) {
    y = ensureSpace(doc, y, 24, PH, ML, PW);
    const notesH = 20;
    rect(doc, ML, y, CW, notesH, C.rowEven, C.border);
    setFont(doc, 8, 'bold', C.accent);
    doc.text('Clinical Notes', ML + 5, y + 7);
    setFont(doc, 7.5, 'normal', C.text);
    const wrapped = doc.splitTextToSize(subject.notes, CW - 10);
    doc.text(wrapped.slice(0, 2), ML + 5, y + 14);
    y += notesH + 6;
  }

  // ── Footer ────────────────────────────────────────────────────
  const lastPage = doc.getNumberOfPages();
  for (let p = 1; p <= lastPage; p++) {
    doc.setPage(p);
    rect(doc, 0, PH - 10, PW, 10, C.headerBg);
    setFont(doc, 7, 'normal', C.subtext);
    doc.text(
      '僅供研究用途，非醫療診斷設備。結果需結合專業臨床判斷。For research use only. Not a medical device.',
      PW / 2, PH - 4, { align: 'center' },
    );
  }

  // ── Upload PDF → get share URL → add QR last page ────────────
  try {
    const pdfBytes = doc.output('arraybuffer');
    const resp = await fetch(REPORT_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdfBytes,
    });
    if (resp.ok) {
      const { url } = await resp.json() as { url: string };
      const qrDataUrl = await QRCode.toDataURL(url, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });

      // Add a dedicated QR page at the end
      doc.addPage();
      rect(doc, 0, 0, PW, PH, C.bg);
      // Header strip
      rect(doc, 0, 0, PW, 18, C.headerBg);
      rect(doc, 0, 16, PW, 2, C.accent);
      setFont(doc, 11, 'bold', C.white);
      doc.text('掃描 QR Code 下載此報告', PW / 2, 10, { align: 'center' });
      setFont(doc, 7, 'normal', C.subtext);
      doc.text('Scan QR Code to download this report on your phone', PW / 2, 15, { align: 'center' });

      // QR image — centered, 80 × 80 mm
      const qrSize = 80;
      const qrX = (PW - qrSize) / 2;
      const qrY = 35;
      rect(doc, qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, C.white);
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

      // Instructions
      setFont(doc, 9, 'bold', C.accent);
      doc.text('使用手機相機或 QR 掃描 App 掃描上方 QR Code', PW / 2, qrY + qrSize + 14, { align: 'center' });
      setFont(doc, 8, 'normal', C.subtext);
      doc.text('Use your phone camera or QR scanner app to scan the code above', PW / 2, qrY + qrSize + 21, { align: 'center' });

      // URL text
      setFont(doc, 6.5, 'normal', C.subtext);
      doc.text(url, PW / 2, qrY + qrSize + 30, { align: 'center' });

      // Expiry notice
      setFont(doc, 7.5, 'bold', C.warn);
      doc.text('此連結 48 小時後失效 · Link expires in 48 hours', PW / 2, qrY + qrSize + 38, { align: 'center' });

      // Footer on QR page
      rect(doc, 0, PH - 10, PW, 10, C.headerBg);
      setFont(doc, 7, 'normal', C.subtext);
      doc.text(
        '僅供研究用途，非醫療診斷設備。For research use only. Not a medical device.',
        PW / 2, PH - 4, { align: 'center' },
      );
    }
  } catch (_e) {
    // Upload failed — skip QR page, save PDF as-is
  }

  // ── Save ──────────────────────────────────────────────────────
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const d = startTime ?? new Date();
  const fname = `BrainReport_${subject.id || 'subject'}_${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}.pdf`;
  doc.save(fname);
}

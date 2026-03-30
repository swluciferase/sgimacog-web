/**
 * reportPdf.ts
 * Generates a brain health assessment PDF using jsPDF.
 */

import { jsPDF } from 'jspdf';
import type { BrainIndices, ReportResult } from './eegReport';
import type { SubjectInfo } from '../types/eeg';

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
};

// ---------------------------------------------------------------------------
// T-score interpretation
// ---------------------------------------------------------------------------
function tscoreColor(t: number): [number, number, number] {
  if (t >= 40 && t <= 60) return C.good;
  if (t >= 30 && t <= 70) return C.warn;
  return C.bad;
}

function tscoreLabel(t: number): string {
  if (t >= 40 && t <= 60) return 'Normal';
  if (t > 60)             return 'High';
  if (t >= 30)            return 'Borderline';
  return 'Low';
}

// ---------------------------------------------------------------------------
// Index metadata
// ---------------------------------------------------------------------------
interface IndexMeta {
  key: keyof BrainIndices;
  name: string;
  fullName: string;
  unit: string;
  decimals: number;
  description: string;
}

const INDEX_META: IndexMeta[] = [
  { key: 'TBR',  name: 'TBR',  fullName: 'Theta/Beta Ratio',            unit: '',    decimals: 3, description: 'Attention & cognitive engagement (Fz, Pz)' },
  { key: 'APR',  name: 'APR',  fullName: 'Alpha Power Ratio',           unit: '',    decimals: 4, description: 'Relaxation & alertness (T7, T8, Fz, Pz)' },
  { key: 'FAA',  name: 'FAA',  fullName: 'Frontal Alpha Asymmetry',     unit: '',    decimals: 4, description: 'Emotional valence asymmetry (F3/F4 approx)' },
  { key: 'PAF',  name: 'PAF',  fullName: 'Peak Alpha Frequency',        unit: 'Hz',  decimals: 2, description: 'Individual alpha frequency / IQ correlate (O1, O2)' },
  { key: 'RSA',  name: 'RSA',  fullName: 'Relative Spectral Alpha',     unit: '',    decimals: 3, description: 'Alpha sub-band ratio α1/α2 (O1, O2)' },
  { key: 'COH',  name: 'COH',  fullName: 'Spectral Coherence',          unit: '',    decimals: 4, description: 'Cortical connectivity (Fp1, Fp2, Fz, Pz)' },
  { key: 'EnTP', name: 'EnTP', fullName: 'Permutation Entropy',         unit: '',    decimals: 4, description: 'EEG complexity/irregularity (O1,O2,Fz,Pz,T7,T8)' },
];

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
  // Background track
  rect(doc, x, y, totalW, h, [20, 38, 62]);
  // Normal range bracket (T=40–60)
  const lo = totalW * (40 / 99);
  const hi = totalW * (60 / 99);
  rect(doc, x + lo, y, hi - lo, h, [35, 60, 95]);
  // Filled portion
  const pct = Math.min(1, tScore / 99);
  const fillW = Math.max(0.5, totalW * pct);
  rect(doc, x, y, fillW, h, tscoreColor(tScore));
  // Marker line at current value
  doc.setDrawColor(...C.white);
  doc.setLineWidth(0.5);
  doc.line(x + fillW, y, x + fillW, y + h);
}

// ---------------------------------------------------------------------------
// Main PDF builder
// ---------------------------------------------------------------------------

export function generateReportPdf(
  result: ReportResult,
  subject: SubjectInfo,
  startTime: Date | null,
  deviceId: string | null,
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const PW = 210; // page width mm
  const PH = 297;
  const ML = 14, MR = 14;
  const CW = PW - ML - MR; // content width

  // ---- Full-page background ----
  rect(doc, 0, 0, PW, PH, C.bg);

  let y = 0;

  // ---- Header banner ----
  const headerH = 34;
  rect(doc, 0, 0, PW, headerH, C.headerBg);
  // Accent stripe
  rect(doc, 0, headerH - 2, PW, 2, C.accent);

  setFont(doc, 18, 'bold', C.white);
  doc.text('Brain Health Assessment Report', ML, 14);
  setFont(doc, 9, 'normal', C.subtext);
  doc.text('sgimacog EEG · Powered by STeEG', ML, 21);

  const now = new Date();
  setFont(doc, 8, 'normal', C.subtext);
  doc.text(
    `Generated: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`,
    PW - MR, 14, { align: 'right' },
  );
  if (startTime) {
    doc.text(
      `Recording: ${startTime.toLocaleDateString()} ${startTime.toLocaleTimeString()}`,
      PW - MR, 20, { align: 'right' },
    );
  }

  y = headerH + 8;

  // ---- Subject info box ----
  const infoH = 36;
  rect(doc, ML, y, CW, infoH, C.rowOdd, C.border);
  setFont(doc, 9, 'bold', C.accent);
  doc.text('SUBJECT INFORMATION', ML + 5, y + 7);

  const col1 = ML + 5, col2 = ML + CW / 2 + 5;
  setFont(doc, 8, 'normal', C.subtext);
  const infoRows = [
    ['Subject ID',     subject.id    || '—'],
    ['Name',           subject.name  || '—'],
    ['Date of Birth',  subject.dob   || '—'],
  ];
  const infoRows2 = [
    ['Age',     `${result.age} years`],
    ['Sex',     subject.sex   || '—'],
    ['Device',  deviceId      || '—'],
  ];
  infoRows.forEach(([label, val], i) => {
    const iy = y + 14 + i * 7;
    setFont(doc, 8, 'normal', C.subtext);
    doc.text(label + ':', col1, iy);
    setFont(doc, 8, 'bold', C.text);
    doc.text(val, col1 + 28, iy);
  });
  infoRows2.forEach(([label, val], i) => {
    const iy = y + 14 + i * 7;
    setFont(doc, 8, 'normal', C.subtext);
    doc.text(label + ':', col2, iy);
    setFont(doc, 8, 'bold', C.text);
    doc.text(val, col2 + 18, iy);
  });

  y += infoH + 6;

  // ---- Recording stats ----
  const statsH = 18;
  rect(doc, ML, y, CW, statsH, C.rowEven, C.border);
  const dur = result.durationSec;
  const durStr = `${Math.floor(dur / 60)}m ${Math.floor(dur % 60)}s`;
  const statsItems = [
    ['Duration',     durStr],
    ['Total Epochs', `${result.totalEpochs}`],
    ['Clean Epochs', `${result.cleanEpochs}`],
    ['Quality',      `${Math.round((result.cleanEpochs / Math.max(1, result.totalEpochs)) * 100)}%`],
  ];
  const statW = CW / statsItems.length;
  statsItems.forEach(([label, val], i) => {
    const sx = ML + i * statW + statW / 2;
    setFont(doc, 7, 'normal', C.subtext);
    doc.text(label, sx, y + 6, { align: 'center' });
    setFont(doc, 10, 'bold', C.accent);
    doc.text(val, sx, y + 14, { align: 'center' });
  });

  y += statsH + 8;

  // ---- Index table header ----
  setFont(doc, 10, 'bold', C.accent);
  doc.text('Brain Health Indices', ML, y);
  y += 5;

  // Table column positions
  const COL = {
    index:   ML,
    name:    ML + 18,
    value:   ML + 72,
    tscore:  ML + 90,
    bar:     ML + 108,
    status:  ML + 164,
  };
  const barW = 52;
  const rowH = 16;

  // Table header row
  rect(doc, ML, y, CW, 8, C.headerBg);
  setFont(doc, 7, 'bold', C.subtext);
  ['Index', 'Full Name', 'Value', 'T-Score', 'T-Score Bar (1–99)', 'Status'].forEach((h, i) => {
    const xs = [COL.index, COL.name, COL.value, COL.tscore, COL.bar, COL.status];
    doc.text(h, xs[i]! + 1, y + 5.5);
  });
  y += 8;

  // Table rows
  INDEX_META.forEach((meta, i) => {
    const raw = result.indices[meta.key];
    const ts  = result.tscores[meta.key];
    const bg  = i % 2 === 0 ? C.rowOdd : C.rowEven;

    rect(doc, ML, y, CW, rowH, bg, C.border);

    // Index name (bold, accent)
    setFont(doc, 8, 'bold', C.accent);
    doc.text(meta.name, COL.index + 1, y + 6);

    // Full name + description
    setFont(doc, 7.5, 'bold', C.text);
    doc.text(meta.fullName, COL.name + 1, y + 5.5);
    setFont(doc, 6.5, 'normal', C.subtext);
    doc.text(meta.description, COL.name + 1, y + 11.5);

    // Raw value
    const valStr = meta.unit
      ? `${raw.toFixed(meta.decimals)} ${meta.unit}`
      : raw.toFixed(meta.decimals);
    setFont(doc, 8, 'normal', C.text);
    doc.text(valStr, COL.value + 1, y + 8);

    // T-score
    setFont(doc, 9, 'bold', tscoreColor(ts));
    doc.text(`${ts}`, COL.tscore + 4, y + 8, { align: 'center' });

    // T-score bar
    tBar(doc, COL.bar + 1, y + 3, barW, 6, ts);
    // Reference ticks at 30, 50, 70
    setFont(doc, 5.5, 'normal', C.subtext);
    [30, 50, 70].forEach(v => {
      const tx = COL.bar + 1 + barW * (v / 99);
      doc.text(`${v}`, tx, y + 12, { align: 'center' });
    });

    // Status
    setFont(doc, 7.5, 'bold', tscoreColor(ts));
    doc.text(tscoreLabel(ts), COL.status + 1, y + 8);

    y += rowH;
  });

  y += 8;

  // ---- Interpretation note ----
  const noteH = 26;
  rect(doc, ML, y, CW, noteH, C.rowOdd, C.border);
  setFont(doc, 8, 'bold', C.accent);
  doc.text('T-Score Reference', ML + 5, y + 7);
  setFont(doc, 7.5, 'normal', C.subtext);
  const noteLines = [
    'T-Score 40–60: Normal range (within 1 SD of age-matched norms)',
    'T-Score 30–39 or 61–70: Borderline (1–2 SD from norms) — consider follow-up',
    'T-Score < 30 or > 70: Clinically significant deviation — recommend evaluation',
  ];
  noteLines.forEach((line, i) => doc.text(line, ML + 5, y + 14 + i * 5));

  y += noteH + 6;

  // ---- Notes from subject ----
  if (subject.notes && subject.notes.trim()) {
    const notesH = 20;
    rect(doc, ML, y, CW, notesH, C.rowEven, C.border);
    setFont(doc, 8, 'bold', C.accent);
    doc.text('Clinical Notes', ML + 5, y + 7);
    setFont(doc, 7.5, 'normal', C.text);
    const wrapped = doc.splitTextToSize(subject.notes, CW - 10);
    doc.text(wrapped.slice(0, 2), ML + 5, y + 14);
    y += notesH + 6;
  }

  // ---- Footer ----
  rect(doc, 0, PH - 10, PW, 10, C.headerBg);
  setFont(doc, 7, 'normal', C.subtext);
  doc.text('For research use only. Not a medical device. Results require clinical interpretation.', PW / 2, PH - 4, { align: 'center' });

  // ---- Save ----
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  const d = startTime ?? new Date();
  const fname = `BrainReport_${subject.id || 'subject'}_${d.getFullYear()}${pad2(d.getMonth()+1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}.pdf`;
  doc.save(fname);
}

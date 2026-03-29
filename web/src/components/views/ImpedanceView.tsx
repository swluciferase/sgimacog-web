import { useState, type FC } from 'react';
import type { ImpedanceResult } from '../../types/eeg';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface ImpedanceViewProps {
  impedanceResults?: ImpedanceResult[];
  isConnected: boolean;
  lang: Lang;
  onEnterImpedanceMode: () => void;
  onExitImpedanceMode: () => void;
}

// 10-20 channel positions in a 200×240 viewBox
const ELECTRODE_POSITIONS: { label: string; cx: number; cy: number }[] = [
  { label: 'Fp1', cx: 72,  cy: 52  },
  { label: 'Fp2', cx: 128, cy: 52  },
  { label: 'T7',  cx: 30,  cy: 112 },
  { label: 'T8',  cx: 170, cy: 112 },
  { label: 'O1',  cx: 72,  cy: 182 },
  { label: 'O2',  cx: 128, cy: 182 },
  { label: 'Fz',  cx: 100, cy: 72  },
  { label: 'Pz',  cx: 100, cy: 148 },
];

// AC amplitude threshold below which we consider the electrode unconnected / no signal
const NO_SIGNAL_AMPLITUDE_UV = 0.5;

// Quality thresholds (KΩ): <150 = excellent, <300 = good, <600 = poor, ≥600 = bad
function getQuality(kohm: number): ImpedanceResult['quality'] {
  if (kohm < 150) return 'excellent';
  if (kohm < 300) return 'good';
  if (kohm < 600) return 'poor';
  return 'bad';
}

function qualityColor(quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal'): string {
  switch (quality) {
    case 'excellent': return '#3fb950';
    case 'good':      return '#85e89d';
    case 'poor':      return '#e3a030';
    case 'bad':       return '#f85149';
    default:          return '#555e6a';
  }
}

function qualityLabel(quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal', lang: Lang): string {
  switch (quality) {
    case 'excellent': return T(lang, 'impedanceExcellent');
    case 'good':      return T(lang, 'impedanceGood');
    case 'poor':      return T(lang, 'impedancePoor');
    case 'bad':       return T(lang, 'impedanceBad');
    case 'noSignal':  return 'N/A';
    default:          return '--';
  }
}

export const ImpedanceView: FC<ImpedanceViewProps> = ({
  impedanceResults,
  isConnected,
  lang,
  onEnterImpedanceMode,
  onExitImpedanceMode,
}) => {
  const [isActive, setIsActive] = useState(false);

  // Map results by channel index (0-based, matches ELECTRODE_POSITIONS order)
  const resultByIndex = new Map<number, ImpedanceResult>();
  if (impedanceResults) {
    for (const r of impedanceResults) {
      resultByIndex.set(r.channel, r);
    }
  }

  const handleToggle = () => {
    if (!isConnected) return;
    if (isActive) {
      setIsActive(false);
      onExitImpedanceMode();
    } else {
      setIsActive(true);
      onEnterImpedanceMode();
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 16 }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px',
        background: 'rgba(5,14,23,0.8)',
        border: '1px solid rgba(93,109,134,0.3)',
        borderRadius: 10,
        flexWrap: 'wrap',
        gap: 10,
      }}>
        <span style={{ color: 'rgba(180,200,230,0.85)', fontSize: '0.95rem', fontWeight: 600 }}>
          {T(lang, 'impedanceTitle')}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!isConnected && (
            <span style={{ fontSize: 12, color: 'rgba(248,81,73,0.8)' }}>
              {T(lang, 'impedanceNotConnected')}
            </span>
          )}
          <button
            onClick={handleToggle}
            disabled={!isConnected}
            style={{
              background: isActive
                ? 'rgba(248,81,73,0.18)'
                : 'rgba(63,185,80,0.15)',
              border: `1px solid ${isActive ? 'rgba(248,81,73,0.5)' : 'rgba(63,185,80,0.45)'}`,
              borderRadius: 8,
              color: isActive ? '#f85149' : '#3fb950',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 18px',
              cursor: isConnected ? 'pointer' : 'not-allowed',
              opacity: isConnected ? 1 : 0.4,
              transition: 'all 0.15s',
            }}
          >
            {isActive ? T(lang, 'impedanceStop') : T(lang, 'impedanceStart')}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>

        {/* SVG head diagram */}
        <div style={{
          flex: '0 0 auto',
          background: 'linear-gradient(135deg, rgba(8,17,30,0.95), rgba(5,12,22,0.95))',
          border: '1px solid rgba(93,109,134,0.3)',
          borderRadius: 14,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          <svg
            viewBox="0 0 200 240"
            width="260"
            height="312"
            style={{ display: 'block' }}
          >
            {/* Head outline — oval */}
            <ellipse cx="100" cy="118" rx="88" ry="106"
              fill="rgba(14,26,44,0.8)"
              stroke="rgba(93,109,134,0.55)"
              strokeWidth="1.5"
            />
            {/* Nose */}
            <path d="M93 16 Q100 8 107 16"
              fill="none"
              stroke="rgba(93,109,134,0.4)"
              strokeWidth="1.5"
            />
            {/* Left ear */}
            <path d="M12 100 Q4 112 12 124"
              fill="none"
              stroke="rgba(93,109,134,0.4)"
              strokeWidth="1.5"
            />
            {/* Right ear */}
            <path d="M188 100 Q196 112 188 124"
              fill="none"
              stroke="rgba(93,109,134,0.4)"
              strokeWidth="1.5"
            />
            {/* Center cross lines */}
            <line x1="100" y1="14" x2="100" y2="224"
              stroke="rgba(93,109,134,0.2)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <line x1="12" y1="118" x2="188" y2="118"
              stroke="rgba(93,109,134,0.2)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />

            {/* Electrode nodes */}
            {ELECTRODE_POSITIONS.map((pos, idx) => {
              const result = resultByIndex.get(idx);
              const kohm = result?.impedanceKohm;
              const isNoSignal = result !== undefined && (result.acAmplitude ?? 0) < NO_SIGNAL_AMPLITUDE_UV;
              const quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal' =
                result === undefined ? 'unknown'
                : isNoSignal ? 'noSignal'
                : getQuality(kohm!);
              const color = qualityColor(quality);
              const isDim = quality === 'unknown' || quality === 'noSignal';

              return (
                <g key={pos.label}>
                  {/* Glow ring */}
                  {!isDim && (
                    <circle
                      cx={pos.cx} cy={pos.cy}
                      r={16}
                      fill="none"
                      stroke={color}
                      strokeWidth="1"
                      opacity="0.3"
                    />
                  )}
                  {/* Main circle */}
                  <circle
                    cx={pos.cx} cy={pos.cy}
                    r={12}
                    fill={isDim ? 'rgba(30,42,60,0.9)' : `${color}22`}
                    stroke={color}
                    strokeWidth={isDim ? 1 : 2}
                    opacity={isDim ? 0.5 : 1}
                  />
                  {/* Channel label */}
                  <text
                    x={pos.cx} y={pos.cy + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={isDim ? 'rgba(150,165,185,0.5)' : color}
                    fontSize="7"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    fontWeight="700"
                  >
                    {pos.label}
                  </text>
                  {/* Impedance value or N/A below */}
                  {result !== undefined && (
                    <text
                      x={pos.cx} y={pos.cy + 21}
                      textAnchor="middle"
                      fill="rgba(200,220,245,0.75)"
                      fontSize="6"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                    >
                      {isNoSignal ? 'N/A' : `${kohm!.toFixed(0)}kΩ`}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Right panel: channel list + legend */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Channel cards grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 10,
          }}>
            {ELECTRODE_POSITIONS.map((pos, idx) => {
              const result = resultByIndex.get(idx);
              const kohm = result?.impedanceKohm;
              const isNoSignal = result !== undefined && (result.acAmplitude ?? 0) < NO_SIGNAL_AMPLITUDE_UV;
              const quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal' =
                result === undefined ? 'unknown'
                : isNoSignal ? 'noSignal'
                : getQuality(kohm!);
              const color = qualityColor(quality);
              const isDim = quality === 'unknown' || quality === 'noSignal';

              return (
                <div
                  key={pos.label}
                  style={{
                    background: 'rgba(8,17,30,0.8)',
                    border: `1px solid ${!isDim ? color + '55' : 'rgba(60,75,95,0.4)'}`,
                    borderRadius: 10,
                    padding: '12px 14px',
                    transition: 'border-color 0.3s',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 14, fontWeight: 700,
                      color: !isDim ? color : 'rgba(140,160,190,0.7)',
                    }}>
                      {pos.label}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      color: color,
                      background: `${color}18`,
                      border: `1px solid ${color}44`,
                      borderRadius: 4,
                      padding: '2px 6px',
                      opacity: isDim ? 0.5 : 1,
                    }}>
                      {qualityLabel(quality, lang)}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    fontSize: 18, fontWeight: 700,
                    color: !isDim ? color : 'rgba(100,115,135,0.5)',
                  }}>
                    {result === undefined
                      ? '--'
                      : isNoSignal
                        ? 'N/A'
                        : kohm!.toFixed(1)}
                    <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3 }}>
                      {result !== undefined && !isNoSignal ? T(lang, 'kohm') : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quality legend */}
          <div style={{
            background: 'rgba(8,17,30,0.7)',
            border: '1px solid rgba(60,75,95,0.35)',
            borderRadius: 10,
            padding: '12px 16px',
          }}>
            <div style={{ fontSize: 12, color: 'rgba(140,160,185,0.7)', marginBottom: 8, fontWeight: 600 }}>
              {T(lang, 'impedanceLegend')}
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {(
                [
                  { quality: 'excellent' as const, range: '< 150 kΩ' },
                  { quality: 'good'      as const, range: '< 300 kΩ' },
                  { quality: 'poor'      as const, range: '< 600 kΩ' },
                  { quality: 'bad'       as const, range: '≥ 600 kΩ' },
                ]
              ).map(item => (
                <div key={item.quality} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: qualityColor(item.quality),
                  }} />
                  <span style={{ fontSize: 12, color: qualityColor(item.quality) }}>
                    {qualityLabel(item.quality, lang)}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(130,150,175,0.6)' }}>
                    {item.range}
                  </span>
                </div>
              ))}
              {/* N/A legend entry */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{
                  width: 12, height: 12, borderRadius: '50%',
                  background: '#555e6a',
                }} />
                <span style={{ fontSize: 12, color: '#555e6a' }}>N/A</span>
                <span style={{ fontSize: 11, color: 'rgba(130,150,175,0.6)' }}>
                  無訊號
                </span>
              </div>
            </div>
            {/* N/A explanation note */}
            <div style={{
              marginTop: 10,
              fontSize: 11,
              color: 'rgba(130,150,175,0.65)',
              padding: '5px 8px',
              background: 'rgba(255,255,255,0.03)',
              borderRadius: 5,
            }}>
              {T(lang, 'impedanceNoSignal')}
            </div>
          </div>

          {/* Status info */}
          {!isActive && isConnected && (
            <div style={{
              fontSize: 13,
              color: 'rgba(140,160,190,0.6)',
              padding: '8px 12px',
              background: 'rgba(88,166,255,0.04)',
              border: '1px solid rgba(88,166,255,0.15)',
              borderRadius: 8,
            }}>
              {T(lang, 'impedanceNotMeasured')} — {T(lang, 'impedanceStart').toLowerCase()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

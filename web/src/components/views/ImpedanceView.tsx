import { useState, type FC } from 'react';
import type { ImpedanceResult } from '../../types/eeg';
import type { Lang } from '../../i18n';
import { T } from '../../i18n';

export interface ImpedanceViewProps {
  impedanceResults?: ImpedanceResult[];
  isConnected: boolean;
  isRecording: boolean;
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

const NO_SIGNAL_AMPLITUDE_UV = 0.5;
const LOW_IMPEDANCE_NA_KOHM = 10;

function getQuality(kohm: number): ImpedanceResult['quality'] {
  if (kohm < 150) return 'excellent';
  if (kohm < 300) return 'good';
  if (kohm < 600) return 'poor';
  return 'bad';
}

// Colors matching the gradient colorbar
function qualityColor(quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal'): string {
  switch (quality) {
    case 'excellent': return '#68cc8a';
    case 'good':      return '#9ed070';
    case 'poor':      return '#d8c060';
    case 'bad':       return '#d07070';
    default:          return '#284050';
  }
}

function qualityFill(quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal'): string {
  switch (quality) {
    case 'excellent': return 'rgba(104,204,138,.18)';
    case 'good':      return 'rgba(158,208,112,.14)';
    case 'poor':      return 'rgba(216,192,96,.14)';
    case 'bad':       return 'rgba(208,112,112,.16)';
    default:          return 'rgba(40,64,80,.5)';
  }
}

export const ImpedanceView: FC<ImpedanceViewProps> = ({
  impedanceResults,
  isConnected,
  isRecording,
  lang,
  onEnterImpedanceMode,
  onExitImpedanceMode,
}) => {
  const [isActive, setIsActive] = useState(false);

  const resultByIndex = new Map<number, ImpedanceResult>();
  if (impedanceResults) {
    for (const r of impedanceResults) {
      resultByIndex.set(r.channel, r);
    }
  }

  const handleToggle = () => {
    if (!isConnected || isRecording) return;
    if (isActive) {
      setIsActive(false);
      onExitImpedanceMode();
    } else {
      setIsActive(true);
      onEnterImpedanceMode();
    }
  };

  if (!isConnected) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', flex: 1, gap: 8, padding: '24px 0',
        color: 'var(--faint)', fontSize: '.75rem',
      }}>
        <div style={{ fontFamily: "'Crimson Pro', serif", fontStyle: 'italic', fontSize: '2.2rem', color: 'var(--dim)', lineHeight: 1 }}>○</div>
        <div>{lang === 'zh' ? '請先連線裝置' : 'Connect a device first'}</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* Measure / Stop buttons row */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexShrink: 0 }}>
        <button
          onClick={handleToggle}
          disabled={isRecording}
          style={{
            flex: 1,
            padding: '.3rem .6rem',
            borderRadius: 3,
            border: `1px solid ${isActive ? 'rgba(208,112,112,.45)' : 'rgba(72,186,166,.45)'}`,
            background: isActive ? 'rgba(208,112,112,.12)' : 'rgba(72,186,166,.12)',
            color: isActive ? 'var(--red)' : 'var(--teal)',
            fontSize: '.72rem',
            fontFamily: "'IBM Plex Mono', monospace",
            cursor: isRecording ? 'not-allowed' : 'pointer',
            opacity: isRecording ? .4 : 1,
            transition: 'all .15s',
            letterSpacing: '.05em',
          }}
        >
          {isActive ? T(lang, 'impedanceStop') : T(lang, 'impedanceStart')}
        </button>
      </div>

      {/* Brain SVG — fills available space */}
      <div className="imp-brain-wrap">
        <div className="imp-brain-svg-wrap">
          <svg
            viewBox="0 0 200 240"
            preserveAspectRatio="xMidYMid meet"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          >
            {/* Head outline */}
            <ellipse cx="100" cy="118" rx="82" ry="100"
              fill="rgba(13,23,32,.8)"
              stroke="rgba(72,186,166,0.2)"
              strokeWidth="1.5"
            />
            {/* Nose */}
            <path d="M93 20 Q100 12 107 20"
              fill="none" stroke="rgba(72,186,166,0.18)" strokeWidth="1.4"
            />
            {/* Left ear */}
            <path d="M18 104 Q10 116 18 128"
              fill="none" stroke="rgba(72,186,166,0.18)" strokeWidth="1.4"
            />
            {/* Right ear */}
            <path d="M182 104 Q190 116 182 128"
              fill="none" stroke="rgba(72,186,166,0.18)" strokeWidth="1.4"
            />
            {/* Center guides */}
            <line x1="100" y1="18" x2="100" y2="220"
              stroke="rgba(72,186,166,0.1)" strokeWidth="1" strokeDasharray="3 4"
            />
            <line x1="18" y1="118" x2="182" y2="118"
              stroke="rgba(72,186,166,0.1)" strokeWidth="1" strokeDasharray="3 4"
            />

            {/* Electrode nodes */}
            {ELECTRODE_POSITIONS.map((pos, idx) => {
              const result = resultByIndex.get(idx);
              const kohm = result?.impedanceKohm;
              const isNoSignal = result !== undefined && (
                (result.acAmplitude ?? 0) < NO_SIGNAL_AMPLITUDE_UV ||
                result.impedanceKohm < LOW_IMPEDANCE_NA_KOHM
              );
              const quality: ImpedanceResult['quality'] | 'unknown' | 'noSignal' =
                result === undefined ? 'unknown'
                : isNoSignal ? 'noSignal'
                : getQuality(kohm!);
              const color = qualityColor(quality);
              const fill  = qualityFill(quality);
              const isDim = quality === 'unknown' || quality === 'noSignal';

              return (
                <g key={pos.label}>
                  {!isDim && (
                    <circle cx={pos.cx} cy={pos.cy} r={15}
                      fill="none" stroke={color} strokeWidth="1" opacity=".25"
                    />
                  )}
                  <circle
                    cx={pos.cx} cy={pos.cy} r={11}
                    fill={fill}
                    stroke={color}
                    strokeWidth={isDim ? 1 : 1.5}
                    opacity={isDim ? .45 : 1}
                  />
                  <text
                    x={pos.cx} y={pos.cy + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fill={isDim ? 'rgba(88,136,136,.5)' : color}
                    fontSize="7"
                    fontFamily="'IBM Plex Mono', monospace"
                    fontWeight="500"
                  >
                    {pos.label}
                  </text>
                  {result !== undefined && !isNoSignal && (
                    <text
                      x={pos.cx} y={pos.cy + 20}
                      textAnchor="middle"
                      fill="rgba(200,224,216,.65)"
                      fontSize="5.5"
                      fontFamily="'IBM Plex Mono', monospace"
                    >
                      {kohm!.toFixed(0)}k
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Gradient colorbar */}
        <div className="imp-colorbar">
          <div className="imp-colorbar-track" />
          <div className="imp-colorbar-labels">
            <div>
              <div style={{ color: '#68cc8a', fontWeight: 500 }}>{lang === 'zh' ? '優秀' : 'Exc'}</div>
              <div style={{ color: 'var(--muted)' }}>&lt;150kΩ</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#9ed070', fontWeight: 500 }}>{lang === 'zh' ? '良好' : 'Good'}</div>
              <div style={{ color: 'var(--muted)' }}>&lt;300kΩ</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ color: '#d8c060', fontWeight: 500 }}>{lang === 'zh' ? '尚可' : 'Poor'}</div>
              <div style={{ color: 'var(--muted)' }}>&lt;600kΩ</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#d07070', fontWeight: 500 }}>{lang === 'zh' ? '不良' : 'Bad'}</div>
              <div style={{ color: 'var(--muted)' }}>≥600kΩ</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

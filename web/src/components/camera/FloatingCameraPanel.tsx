import { type FC, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import type { CameraSlotId } from '../../types/camera';
import type { SlotState, UseCameraSessionResult } from '../../hooks/useCameraSession';

interface Props {
  cam: UseCameraSessionResult;
  visible: boolean;
  elapsedMs: number;
  onClose(): void;
}

const SLOT_ORDER: CameraSlotId[] = ['dev1', 'dev2', 'dev3', 'dev4'];

export const FloatingCameraPanel: FC<Props> = ({ cam, visible, elapsedMs, onClose }) => {
  const [pos, setPos] = useState({ x: window.innerWidth - 520, y: window.innerHeight - 360 });
  const [size, setSize] = useState({ w: 480, h: 320 });
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);

  if (!visible) return null;

  const activeSlots = SLOT_ORDER.filter((s) => cam.slots[s].deviceId);
  const cols = activeSlots.length <= 1 ? 1 : 2;

  function startDrag(ev: ReactPointerEvent) {
    dragRef.current = { ox: ev.clientX, oy: ev.clientY, px: pos.x, py: pos.y };
    (ev.target as Element).setPointerCapture(ev.pointerId);
  }
  function onDrag(ev: ReactPointerEvent) {
    if (!dragRef.current) return;
    setPos({
      x: dragRef.current.px + (ev.clientX - dragRef.current.ox),
      y: dragRef.current.py + (ev.clientY - dragRef.current.oy),
    });
  }
  function endDrag() {
    dragRef.current = null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: collapsed ? 32 : size.h,
        background: 'rgba(8,20,28,0.95)',
        border: '1px solid rgba(72,186,166,0.5)',
        borderRadius: 6,
        zIndex: 2000,
        color: '#cde',
        fontSize: 12,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        style={{
          height: 32,
          background: 'rgba(20,40,52,0.9)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          cursor: 'move',
          userSelect: 'none',
          gap: 8,
        }}
      >
        <span style={{ color: '#3fb950' }}>●</span>
        <span>Cameras {formatElapsed(elapsedMs)}</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={() => setCollapsed((v) => !v)}>{collapsed ? '▢' : '—'}</button>
        <button type="button" onClick={onClose}>✕</button>
      </div>

      {!collapsed && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, padding: 4 }}>
          {activeSlots.map((s) => (
            <SlotCell key={s} slot={s} state={cam.slots[s]} stream={cam.getSlotStream(s)} pause={() => cam.pauseSlot(s)} resume={() => cam.resumeSlot(s)} />
          ))}
        </div>
      )}

      {!collapsed && (
        <div
          onPointerDown={(ev) => {
            const startX = ev.clientX;
            const startY = ev.clientY;
            const startW = size.w;
            const startH = size.h;
            const onMove = (e: PointerEvent) => {
              setSize({
                w: Math.max(280, startW + (e.clientX - startX)),
                h: Math.max(200, startH + (e.clientY - startY)),
              });
            };
            const onUp = () => {
              window.removeEventListener('pointermove', onMove);
              window.removeEventListener('pointerup', onUp);
            };
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
          }}
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            cursor: 'nwse-resize',
            background: 'rgba(72,186,166,0.4)',
          }}
        />
      )}
    </div>
  );
};

interface SlotCellProps {
  slot: CameraSlotId;
  state: SlotState;
  stream: MediaStream | null;
  pause(): void;
  resume(): void;
}

const SlotCell: FC<SlotCellProps> = ({ slot, state, stream, pause, resume }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const dotColor =
    state.status === 'recording'
      ? '#3fb950'
      : state.status === 'paused'
        ? '#f0c14b'
        : state.status === 'error'
          ? '#dc7860'
          : '#888';

  return (
    <div style={{ position: 'relative', background: '#000', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <video ref={videoRef} autoPlay muted playsInline style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 6px', gap: 6, background: 'rgba(0,0,0,0.6)' }}>
        <span style={{ color: dotColor }}>●</span>
        <span>{slot}</span>
        <span style={{ flex: 1 }} />
        <span>seg {String(state.segmentCount).padStart(2, '0')}</span>
        {state.status === 'recording' && (
          <button type="button" onClick={pause}>Pause</button>
        )}
        {state.status === 'paused' && (
          <button type="button" onClick={resume}>Resume</button>
        )}
      </div>
      {state.status === 'error' && state.errorMsg && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(220,120,96,0.7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, padding: 6, textAlign: 'center' }}>
          ⚠ {state.errorMsg}
        </div>
      )}
    </div>
  );
};

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

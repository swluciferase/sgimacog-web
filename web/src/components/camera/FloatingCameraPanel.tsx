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
      className="cam-dock"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: collapsed ? 30 : size.h,
      }}
    >
      <div
        className="cam-dock-head"
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
      >
        <span className="cam-dock-recdot" aria-hidden="true" />
        <span className="cam-dock-label">REC</span>
        <span className="cam-dock-time">{formatElapsed(elapsedMs)}</span>
        <span className="cam-dock-spacer" />
        <button
          type="button"
          className="cam-dock-icon"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▢' : '−'}
        </button>
        <button
          type="button"
          className="cam-dock-icon danger"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {!collapsed && (
        <div
          className="cam-dock-grid"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {activeSlots.map((s) => (
            <SlotCell
              key={s}
              slot={s}
              state={cam.slots[s]}
              stream={cam.getSlotStream(s)}
              pause={() => cam.pauseSlot(s)}
              resume={() => cam.resumeSlot(s)}
            />
          ))}
        </div>
      )}

      {!collapsed && (
        <div
          className="cam-dock-resize"
          aria-hidden="true"
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

  const statusClass =
    state.status === 'recording'
      ? 'recording'
      : state.status === 'paused'
        ? 'paused'
        : state.status === 'error'
          ? 'error'
          : 'idle';

  return (
    <div className="cam-tile">
      <video ref={videoRef} className="cam-tile-video" autoPlay muted playsInline />
      <span className="cam-tile-id">{slot}</span>
      <span className={`cam-tile-status ${statusClass}`} aria-hidden="true" />
      <div className="cam-tile-bar">
        <span className="cam-tile-seg">
          seg <b>{String(state.segmentCount).padStart(2, '0')}</b>
        </span>
        {state.status === 'recording' && (
          <button type="button" className="cam-tile-action amber" onClick={pause}>Pause</button>
        )}
        {state.status === 'paused' && (
          <button type="button" className="cam-tile-action" onClick={resume}>Resume</button>
        )}
      </div>
      {state.status === 'error' && state.errorMsg && (
        <div className="cam-tile-error">
          <span className="cam-tile-error-glyph" aria-hidden="true">!</span>
          <span>{state.errorMsg}</span>
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

/**
 * S-Pen / pointer contract (README: hover · down · move · up · erase · handwriting).
 * Web/debug path uses Pointer Events. Takes `unknown` at the boundary.
 *
 * Erase: pen eraser end (buttons & 32, W3C "eraser" button 5) or the S Pen
 * barrel button held while touching (Chrome on Android reports buttons & 2).
 * Pressure only counts for pens; mouse/touch report a constant 0.5.
 */
export type StylusKind = 'hover' | 'down' | 'move' | 'up' | 'erase' | 'handwriting';

export interface StylusEvent {
  kind: StylusKind;
  pointer_type: 'pen' | 'touch' | 'mouse';
  x: number;
  y: number;
  pressure: number;
  tilt_x: number;
  tilt_y: number;
  t: number;
}

const ERASER_BUTTONS = 32;
const BARREL_BUTTONS = 2;

export function parsePointer(raw: unknown, phase: 'down' | 'move' | 'up' | 'hover'): StylusEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const x = r.offsetX ?? r.x;
  const y = r.offsetY ?? r.y;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const pt = r.pointerType === 'pen' || r.pointerType === 'touch' ? r.pointerType : 'mouse';
  const buttons = typeof r.buttons === 'number' ? r.buttons : 0;
  const pressure = pt === 'pen' && typeof r.pressure === 'number' && r.pressure > 0 ? Math.min(1, r.pressure) : 0.5;
  let kind: StylusKind = phase;
  if (phase !== 'hover' && phase !== 'up' && pt === 'pen' && (buttons & ERASER_BUTTONS || buttons & BARREL_BUTTONS)) kind = 'erase';
  if (phase === 'move' && buttons === 0) kind = 'hover';
  return {
    kind,
    pointer_type: pt,
    x,
    y,
    pressure,
    tilt_x: typeof r.tiltX === 'number' ? r.tiltX : 0,
    tilt_y: typeof r.tiltY === 'number' ? r.tiltY : 0,
    t: typeof r.timeStamp === 'number' ? r.timeStamp : 0,
  };
}

/** Stroke width from pressure: pens taper, mice draw at the base width. */
export function widthFor(base: number, e: Pick<StylusEvent, 'pointer_type' | 'pressure'>): number {
  return e.pointer_type === 'pen' ? base * (0.35 + 1.3 * e.pressure) : base;
}

import { DECLARE_FLICK_DX, DECLARE_FLICK_DY, GATE_MIN_POINTS, STYLUS_STROKE_MIN } from "./geometry";

export const STYLUS_PHASES = ["hover", "down", "move", "up", "erase", "handwriting"] as const;
export type StylusPhase = (typeof STYLUS_PHASES)[number];

export const STYLUS_ACTIONS = ["annotation", "gate", "declare"] as const;
export type StylusAction = (typeof STYLUS_ACTIONS)[number];

export const POINTER_TYPES = ["pen", "touch", "mouse", "unknown"] as const;
export type PointerKind = (typeof POINTER_TYPES)[number];

/** Expo Go does not expose Samsung TOOL_TYPE_STYLUS. Keep the contract anyway. */
export const EXPO_GO_STYLUS_NATIVE = false;

export type IntentStylusEvent = {
  phase: StylusPhase;
  pointerType: PointerKind;
  x: number;
  y: number;
  t: number;
  pressure?: number;
  tilt?: number;
  action?: StylusAction;
  text?: string;
};

export type StrokePoint = { x: number; y: number };

const ERASER_BUTTON = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function phaseOf(value: unknown): StylusPhase | undefined {
  if (value === "hover" || value === "down" || value === "move" || value === "up" || value === "erase" || value === "handwriting") {
    return value;
  }
  return undefined;
}

function pointerOf(value: unknown): PointerKind {
  if (value === "pen" || value === "touch" || value === "mouse") return value;
  return "unknown";
}

function actionOf(value: unknown): StylusAction | undefined {
  if (value === "annotation" || value === "gate" || value === "declare") return value;
  return undefined;
}

export function isEraseButtons(buttons: number | undefined): boolean {
  return buttons !== undefined && (buttons & ERASER_BUTTON) === ERASER_BUTTON;
}

/** Parse a pointer/touch nativeEvent. Unknown at the boundary. */
export function stylusEventFromUnknown(
  phase: StylusPhase,
  nativeEvent: unknown,
  now: number,
  eraseMode = false,
): IntentStylusEvent | null {
  if (!isRecord(nativeEvent)) return null;
  const x = finite(nativeEvent.locationX) ?? finite(nativeEvent.offsetX) ?? finite(nativeEvent.x) ?? finite(nativeEvent.pageX);
  const y = finite(nativeEvent.locationY) ?? finite(nativeEvent.offsetY) ?? finite(nativeEvent.y) ?? finite(nativeEvent.pageY);
  if (x === undefined || y === undefined) return null;
  const buttons = finite(nativeEvent.buttons);
  const nextPhase: StylusPhase = eraseMode || isEraseButtons(buttons) ? "erase" : phase;
  const pressure = finite(nativeEvent.pressure) ?? finite(nativeEvent.force);
  const tilt = finite(nativeEvent.tiltX) ?? finite(nativeEvent.altitudeAngle);
  const pointerType = pointerOf(nativeEvent.pointerType ?? nativeEvent.toolType);
  const event: IntentStylusEvent = {
    phase: nextPhase,
    pointerType,
    x,
    y,
    t: now,
  };
  if (pressure !== undefined) event.pressure = pressure;
  if (tilt !== undefined) event.tilt = tilt;
  return event;
}

export function parseStylusEvent(raw: unknown): IntentStylusEvent | null {
  if (!isRecord(raw)) return null;
  const phase = phaseOf(raw.phase);
  if (!phase) return null;
  const x = finite(raw.x);
  const y = finite(raw.y);
  const t = finite(raw.t);
  if (x === undefined || y === undefined || t === undefined) return null;
  const event: IntentStylusEvent = {
    phase,
    pointerType: pointerOf(raw.pointerType),
    x,
    y,
    t,
  };
  const pressure = finite(raw.pressure);
  const tilt = finite(raw.tilt);
  const action = actionOf(raw.action);
  if (pressure !== undefined) event.pressure = pressure;
  if (tilt !== undefined) event.tilt = tilt;
  if (action) event.action = action;
  if (typeof raw.text === "string") event.text = raw.text;
  return event;
}

export function classifyStroke(points: readonly StrokePoint[]): StylusAction | "handwriting" {
  if (points.length < 2) return "annotation";
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return "annotation";
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  if (dy < -DECLARE_FLICK_DY && Math.abs(dx) < DECLARE_FLICK_DX) return "declare";
  if (looksLikeGate(points)) return "gate";
  if (points.length >= STYLUS_STROKE_MIN * 3) return "handwriting";
  return "annotation";
}

function looksLikeGate(points: readonly StrokePoint[]): boolean {
  if (points.length < GATE_MIN_POINTS) return false;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxIdx = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    if (p.y < maxY) continue;
    maxY = p.y;
    maxIdx = i;
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return false;
  if (maxIdx <= 0 || maxIdx >= points.length - 1) return false;
  return last.x > first.x && last.y < maxY - 8;
}

export function withAction(event: IntentStylusEvent, action: StylusAction): IntentStylusEvent {
  return {
    phase: event.phase,
    pointerType: event.pointerType,
    x: event.x,
    y: event.y,
    t: event.t,
    pressure: event.pressure,
    tilt: event.tilt,
    action,
    text: event.text,
  };
}

export function toHandwriting(event: IntentStylusEvent, text?: string): IntentStylusEvent {
  return {
    phase: "handwriting",
    pointerType: event.pointerType,
    x: event.x,
    y: event.y,
    t: event.t,
    pressure: event.pressure,
    tilt: event.tilt,
    action: "annotation",
    text,
  };
}

export type IntentWire = {
  declared: string;
  visualId?: string;
  harnessId?: string;
  stylusCount?: number;
};

export function toIntentWire(
  declared: string,
  visualId: string | undefined,
  harnessId: string | undefined,
  stylus: readonly IntentStylusEvent[],
): IntentWire {
  const wire: IntentWire = { declared };
  if (visualId) wire.visualId = visualId;
  if (harnessId) wire.harnessId = harnessId;
  if (stylus.length > 0) wire.stylusCount = stylus.length;
  return wire;
}

export { INTENT_CHIP_HEIGHT, INTENT_CHIP_MAX, INTENT_NODE_SIZE, INTENT_PATTERN_DOT, INTENT_PATTERN_DOTS, INTENT_STRIP_HEIGHT, INTENT_WIRE_HEIGHT, INTENT_WIRE_WIDTH, OWNS_KEYBOARD_DOCK } from "./geometry";
export { AODL_HARNESS_IDS, AODL_VISUAL_IDS, isAodlHarnessId, isAodlVisualId } from "./catalog-ids";
export type { AodlHarnessId, AodlVisualId } from "./catalog-ids";
export { parseIntentDocument, questionsFor, resolveQuestion, withDeclared } from "./document";
export type { IntentDocument, QuestionWhy, UnresolvedQuestion } from "./document";
export { Ripple } from "./Ripple";
export type { RippleHandle, RippleProps } from "./Ripple";
export { createIntentSession, sessionCycleZoom, sessionDeclare, sessionRecord, sessionResolve, sessionSetErase } from "./pretotype";
export type { IntentSession } from "./pretotype";
export { StylusCapture } from "./StylusCapture";
export {
  EXPO_GO_STYLUS_NATIVE,
  classifyStroke,
  parseStylusEvent,
  stylusEventFromUnknown,
  toIntentWire,
} from "./stylus";
export type { IntentStylusEvent, IntentWire, PointerKind, StylusAction, StylusPhase } from "./stylus";
export { surfaceColors } from "./tokens";
export { ZOOM_LEVELS, ZOOM_NODE, ZOOM_PATTERN, ZOOM_UNIT, nextZoom, zoomLabel } from "./zoom";
export type { ZoomLevel } from "./zoom";

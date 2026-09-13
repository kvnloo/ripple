/** Zoom language: one object, three depths. Never spawn extra orbs. */

export const ZOOM_UNIT = 0;
export const ZOOM_PATTERN = 1;
export const ZOOM_NODE = 2;

export type ZoomLevel = typeof ZOOM_UNIT | typeof ZOOM_PATTERN | typeof ZOOM_NODE;

export const ZOOM_LEVELS = 3;

export function nextZoom(level: ZoomLevel): ZoomLevel {
  if (level === ZOOM_UNIT) return ZOOM_PATTERN;
  if (level === ZOOM_PATTERN) return ZOOM_NODE;
  return ZOOM_UNIT;
}

export function zoomLabel(level: ZoomLevel): "unit" | "pattern" | "node" {
  if (level === ZOOM_UNIT) return "unit";
  if (level === ZOOM_PATTERN) return "pattern";
  return "node";
}

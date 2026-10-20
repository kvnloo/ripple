/**
 * Coordinate spaces for the visual-review surface.
 *
 *  source  : normalized [0,1]x[0,1] over the IMMUTABLE source image (u right, v down).
 *            Every stroke, pin and mask lookup is stored here, never in screen pixels.
 *  display : normalized [0,1]x[0,1] over the image as shown after the capture's
 *            explicit `CropTransform` (crop in source space, then rotate/flip).
 *  screen  : CSS pixels inside a pane, after the view's zoom/pan.
 *
 * A stroke drawn on a cropped, rotated, zoomed phone screen and replayed on a
 * desktop at another density lands on the same source pixels because only the
 * transform travels, never the pixels.
 */

/** Pinned geometry numbers (AGENTS.md: pin geometry in src/geometry). */
export const GEOMETRY = {
  MIN_ZOOM: 1,
  MAX_ZOOM: 16,
  WHEEL_ZOOM_STEP: 1.15,
  /** Strokes simplify to points at least this far apart (source-normalized). */
  MIN_POINT_SPACING: 0.0015,
  /** An underline is a stroke whose bbox height/width is below this. */
  FLAT_STROKE_RATIO: 0.18,
  /** Probe above a flat stroke by this many bbox-widths (an underline sits under what it marks). */
  UNDERLINE_PROBE_UP: 0.08,
} as const;

export type Rotation = 0 | 90 | 180 | 270;

export interface Pt {
  x: number;
  y: number;
}

export interface CropTransform {
  /** Crop rectangle in SOURCE-normalized coords. Identity = {x:0,y:0,w:1,h:1}. */
  crop: { x: number; y: number; w: number; h: number };
  rotation: Rotation;
  flipX: boolean;
}

export interface ViewTransform {
  zoom: number;
  /** Display-normalized point shown at the pane centre. */
  cx: number;
  cy: number;
}

export interface Pane {
  /** CSS-pixel size of the pane; the image is fit (contain) inside it. */
  width: number;
  height: number;
}

export const IDENTITY_CROP: CropTransform = Object.freeze({
  crop: Object.freeze({ x: 0, y: 0, w: 1, h: 1 }),
  rotation: 0,
  flipX: false,
}) as CropTransform;

export const IDENTITY_VIEW: ViewTransform = Object.freeze({ zoom: 1, cx: 0.5, cy: 0.5 }) as ViewTransform;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Source-normalized -> display-normalized. */
export function sourceToDisplay(p: Pt, t: CropTransform): Pt {
  let x = (p.x - t.crop.x) / t.crop.w;
  let y = (p.y - t.crop.y) / t.crop.h;
  if (t.flipX) x = 1 - x;
  switch (t.rotation) {
    case 0:
      return { x, y };
    case 90: // clockwise
      return { x: 1 - y, y: x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: y, y: 1 - x };
  }
}

/** Display-normalized -> source-normalized (exact inverse of sourceToDisplay). */
export function displayToSource(p: Pt, t: CropTransform): Pt {
  let x: number;
  let y: number;
  switch (t.rotation) {
    case 0:
      x = p.x;
      y = p.y;
      break;
    case 90:
      x = p.y;
      y = 1 - p.x;
      break;
    case 180:
      x = 1 - p.x;
      y = 1 - p.y;
      break;
    case 270:
      x = 1 - p.y;
      y = p.x;
      break;
  }
  if (t.flipX) x = 1 - x;
  return { x: t.crop.x + x * t.crop.w, y: t.crop.y + y * t.crop.h };
}

/** Pixel aspect (w/h) of the displayed image given the source pixel size. */
export function displayAspect(srcW: number, srcH: number, t: CropTransform): number {
  const w = srcW * t.crop.w;
  const h = srcH * t.crop.h;
  return t.rotation === 90 || t.rotation === 270 ? h / w : w / h;
}

/** Rect (CSS px) of the full display image inside the pane at zoom 1 (contain fit). */
export function fitRect(pane: Pane, aspect: number): { x: number; y: number; w: number; h: number } {
  const paneAspect = pane.width / pane.height;
  if (aspect >= paneAspect) {
    const w = pane.width;
    const h = w / aspect;
    return { x: 0, y: (pane.height - h) / 2, w, h };
  }
  const h = pane.height;
  const w = h * aspect;
  return { x: (pane.width - w) / 2, y: 0, w, h };
}

/** Display-normalized -> screen px. */
export function displayToScreen(p: Pt, pane: Pane, aspect: number, v: ViewTransform): Pt {
  const r = fitRect(pane, aspect);
  return {
    x: pane.width / 2 + (p.x - v.cx) * r.w * v.zoom,
    y: pane.height / 2 + (p.y - v.cy) * r.h * v.zoom,
  };
}

/** Screen px -> display-normalized. */
export function screenToDisplay(s: Pt, pane: Pane, aspect: number, v: ViewTransform): Pt {
  const r = fitRect(pane, aspect);
  return {
    x: v.cx + (s.x - pane.width / 2) / (r.w * v.zoom),
    y: v.cy + (s.y - pane.height / 2) / (r.h * v.zoom),
  };
}

export function screenToSource(s: Pt, pane: Pane, aspect: number, v: ViewTransform, t: CropTransform): Pt {
  return displayToSource(screenToDisplay(s, pane, aspect, v), t);
}

export function sourceToScreen(p: Pt, pane: Pane, aspect: number, v: ViewTransform, t: CropTransform): Pt {
  return displayToScreen(sourceToDisplay(p, t), pane, aspect, v);
}

/** Zoom about a screen point, keeping the display point under it fixed. */
export function zoomAt(v: ViewTransform, s: Pt, factor: number, pane: Pane, aspect: number): ViewTransform {
  const zoom = clamp(v.zoom * factor, GEOMETRY.MIN_ZOOM, GEOMETRY.MAX_ZOOM);
  const anchor = screenToDisplay(s, pane, aspect, v);
  const r = fitRect(pane, aspect);
  const cx = anchor.x - (s.x - pane.width / 2) / (r.w * zoom);
  const cy = anchor.y - (s.y - pane.height / 2) / (r.h * zoom);
  return clampView({ zoom, cx, cy });
}

export function panBy(v: ViewTransform, dxPx: number, dyPx: number, pane: Pane, aspect: number): ViewTransform {
  const r = fitRect(pane, aspect);
  return clampView({ zoom: v.zoom, cx: v.cx - dxPx / (r.w * v.zoom), cy: v.cy - dyPx / (r.h * v.zoom) });
}

/** Keep the centre inside the image so the view never drifts off into nothing. */
export function clampView(v: ViewTransform): ViewTransform {
  const half = 0.5 / v.zoom;
  return {
    zoom: v.zoom,
    cx: v.zoom <= 1 ? 0.5 : clamp(v.cx, half, 1 - half),
    cy: v.zoom <= 1 ? 0.5 : clamp(v.cy, half, 1 - half),
  };
}

/** Is a source-normalized point inside the image? */
export function inImage(p: Pt): boolean {
  return p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
}

/** Validate a transform arriving over the wire. Returns null if invalid. */
export function parseCropTransform(raw: unknown): CropTransform | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const c = r.crop as Record<string, unknown> | undefined;
  const rot = r.rotation;
  if (!c || typeof c !== 'object') return null;
  const nums = [c.x, c.y, c.w, c.h];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, w, h] = nums as number[];
  if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1 + 1e-9 || y + h > 1 + 1e-9) return null;
  if (rot !== 0 && rot !== 90 && rot !== 180 && rot !== 270) return null;
  return { crop: { x, y, w, h }, rotation: rot, flipX: r.flipX === true };
}

import { describe, expect, test } from 'bun:test';
import {
  GEOMETRY,
  IDENTITY_CROP,
  IDENTITY_VIEW,
  displayAspect,
  displayToSource,
  fitRect,
  parseCropTransform,
  screenToSource,
  sourceToDisplay,
  sourceToScreen,
  zoomAt,
  type CropTransform,
  type Rotation,
} from './geometry';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('pinned geometry', () => {
  test('numbers', () => {
    expect(GEOMETRY.MIN_ZOOM).toBe(1);
    expect(GEOMETRY.MAX_ZOOM).toBe(16);
    expect(GEOMETRY.FLAT_STROKE_RATIO).toBe(0.18);
    expect(GEOMETRY.UNDERLINE_PROBE_UP).toBe(0.08);
  });
});

describe('source <-> display', () => {
  const rots: Rotation[] = [0, 90, 180, 270];
  const crop = { x: 0.1, y: 0.2, w: 0.5, h: 0.6 };
  for (const rotation of rots)
    for (const flipX of [false, true]) {
      const t: CropTransform = { crop, rotation, flipX };
      test(`round-trip rot ${rotation} flip ${flipX}`, () => {
        for (const p of [{ x: 0.1, y: 0.2 }, { x: 0.35, y: 0.5 }, { x: 0.6, y: 0.8 }, { x: 0.42, y: 0.31 }]) {
          const q = displayToSource(sourceToDisplay(p, t), t);
          close(q.x, p.x);
          close(q.y, p.y);
        }
      });
    }
  test('crop maps crop corners to display corners', () => {
    const t: CropTransform = { crop, rotation: 0, flipX: false };
    const a = sourceToDisplay({ x: 0.1, y: 0.2 }, t);
    const b = sourceToDisplay({ x: 0.6, y: 0.8 }, t);
    close(a.x, 0); close(a.y, 0); close(b.x, 1); close(b.y, 1);
  });
  test('rotate 90 clockwise: source top-left goes to display top-right', () => {
    const d = sourceToDisplay({ x: 0, y: 0 }, { crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 90, flipX: false });
    close(d.x, 1); close(d.y, 0);
  });
  test('aspect swaps on 90/270', () => {
    expect(displayAspect(1920, 1080, IDENTITY_CROP)).toBeCloseTo(16 / 9);
    expect(displayAspect(1920, 1080, { ...IDENTITY_CROP, rotation: 90 })).toBeCloseTo(9 / 16);
  });
});

describe('screen <-> source with zoom', () => {
  const pane = { width: 800, height: 600 };
  const aspect = 16 / 9;
  test('fit is letterboxed for a wide image', () => {
    const r = fitRect(pane, aspect);
    close(r.w, 800); close(r.h, 450); close(r.y, 75);
  });
  test('round trip under zoom + crop + rotation', () => {
    const t: CropTransform = { crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, rotation: 270, flipX: false };
    const asp = displayAspect(1920, 1080, t);
    const v = zoomAt(IDENTITY_VIEW, { x: 500, y: 200 }, 3, pane, asp);
    for (const p of [{ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.9 }]) {
      const s = sourceToScreen(p, pane, asp, v, t);
      const q = screenToSource(s, pane, asp, v, t);
      close(q.x, p.x, 1e-9); close(q.y, p.y, 1e-9);
    }
  });
  test('zoomAt keeps the point under the cursor fixed', () => {
    const s = { x: 600, y: 250 };
    const before = screenToSource(s, pane, aspect, IDENTITY_VIEW, IDENTITY_CROP);
    const v = zoomAt(IDENTITY_VIEW, s, 2, pane, aspect);
    const after = screenToSource(s, pane, aspect, v, IDENTITY_CROP);
    close(after.x, before.x, 1e-9); close(after.y, before.y, 1e-9);
  });
  test('density independence: same source point at 1x and 3x panes', () => {
    const p = { x: 0.37, y: 0.61 };
    const s1 = sourceToScreen(p, { width: 400, height: 300 }, aspect, IDENTITY_VIEW, IDENTITY_CROP);
    const s3 = sourceToScreen(p, { width: 1200, height: 900 }, aspect, IDENTITY_VIEW, IDENTITY_CROP);
    close(s3.x, s1.x * 3, 1e-9); close(s3.y, s1.y * 3, 1e-9);
  });
});

describe('wire transform parsing', () => {
  test('rejects invalid', () => {
    expect(parseCropTransform(null)).toBeNull();
    expect(parseCropTransform({ crop: { x: 0, y: 0, w: 1.2, h: 1 }, rotation: 0 })).toBeNull();
    expect(parseCropTransform({ crop: { x: 0, y: 0, w: 1, h: 1 }, rotation: 45 })).toBeNull();
    expect(parseCropTransform({ crop: { x: 0, y: 0, w: 0, h: 1 }, rotation: 0 })).toBeNull();
    expect(parseCropTransform({ crop: { x: NaN, y: 0, w: 1, h: 1 }, rotation: 0 })).toBeNull();
  });
  test('accepts valid', () => {
    expect(parseCropTransform({ crop: { x: 0.1, y: 0, w: 0.9, h: 1 }, rotation: 180, flipX: true })).toEqual({
      crop: { x: 0.1, y: 0, w: 0.9, h: 1 },
      rotation: 180,
      flipX: true,
    });
  });
});

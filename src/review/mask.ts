/**
 * Object-ID mask: what object is under any source-normalized point.
 *
 * Each review candidate image may ship a mask rendered from the same camera
 * (ACE: Blender pass_index emission pass), as a little-endian Uint32 array
 * (row-major, top-down; 0 = background) plus a legend.
 * Owner-facing granularity is the legend GROUP label ("R tennis halls roof"),
 * because the owner talks about parts, not about mesh objects.
 */
import { GEOMETRY, type Pt } from './geometry';
import type { Stroke } from './events';

export interface LegendEntry {
  id: number;
  object: string;
  label: string;
  building?: string | null;
  part?: string | null;
  synonyms?: string[];
  /** words that name the building ("tennis hall") vs the part ("roof") */
  building_synonyms?: string[];
  part_synonyms?: string[];
  /** pixels covered in this mask (filled by the manifest builder) */
  area?: number;
}

export interface Group {
  label: string;
  ids: number[];
  area: number;
  building: string | null;
  part: string | null;
  synonyms: string[];
  buildingWords: string[];
  partWords: string[];
  /** bbox in source-normalized coords */
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export class IdMask {
  readonly byId = new Map<number, LegendEntry>();
  readonly groups = new Map<string, Group>();

  constructor(
    readonly w: number,
    readonly h: number,
    readonly ids: Uint32Array | Uint16Array,
    legend: LegendEntry[],
  ) {
    if (ids.length !== w * h) throw new Error(`mask size ${ids.length} != ${w}x${h}`);
    for (const e of legend) this.byId.set(e.id, e);
    const area = new Map<number, number>();
    const bb = new Map<number, [number, number, number, number]>();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = ids[y * w + x];
        if (!id) continue;
        area.set(id, (area.get(id) ?? 0) + 1);
        const b = bb.get(id);
        if (!b) bb.set(id, [x, y, x, y]);
        else {
          if (x < b[0]) b[0] = x;
          if (y < b[1]) b[1] = y;
          if (x > b[2]) b[2] = x;
          if (y > b[3]) b[3] = y;
        }
      }
    }
    for (const [id, a] of area) {
      const e = this.byId.get(id) ?? { id, object: `id ${id}`, label: `id ${id}` };
      const g = this.groups.get(e.label);
      const b = bb.get(id)!;
      const nb = { x0: b[0] / w, y0: b[1] / h, x1: (b[2] + 1) / w, y1: (b[3] + 1) / h };
      if (!g) {
        this.groups.set(e.label, {
          label: e.label,
          ids: [id],
          area: a,
          building: e.building ?? null,
          part: e.part ?? null,
          synonyms: e.synonyms ?? [],
          buildingWords: e.building_synonyms ?? [],
          partWords: e.part_synonyms ?? [],
          bbox: nb,
        });
      } else {
        g.ids.push(id);
        g.area += a;
        g.bbox = { x0: Math.min(g.bbox.x0, nb.x0), y0: Math.min(g.bbox.y0, nb.y0), x1: Math.max(g.bbox.x1, nb.x1), y1: Math.max(g.bbox.y1, nb.y1) };
      }
    }
  }

  /** id at a source-normalized point (0 outside the image or on background). */
  idAt(p: Pt): number {
    if (p.x < 0 || p.y < 0 || p.x >= 1 || p.y >= 1) return 0;
    const x = Math.min(this.w - 1, Math.floor(p.x * this.w));
    const y = Math.min(this.h - 1, Math.floor(p.y * this.h));
    return this.ids[y * this.w + x];
  }

  labelOf(id: number): string | null {
    if (!id) return null;
    return this.byId.get(id)?.label ?? `id ${id}`;
  }

  groupAt(p: Pt): Group | null {
    const l = this.labelOf(this.idAt(p));
    return l ? this.groups.get(l) ?? null : null;
  }

  /**
   * What a stroke marks, weighted by label:
   * - flat stroke (underline): probe just ABOVE its middle, like Scrawl's
   *   Accessibility lookup ("an underline sits under what it marks");
   * - ellipse/box: the label covering most of the enclosed area;
   * - pen/arrow: labels along the path, arrow tip weighted most.
   */
  strokeTargets(s: Stroke): Map<string, number> {
    const out = new Map<string, number>();
    const add = (p: Pt, wgt: number) => {
      const l = this.labelOf(this.idAt(p));
      if (l) out.set(l, (out.get(l) ?? 0) + wgt);
    };
    const xs = s.points.map((p) => p.x);
    const ys = s.points.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const bw = Math.max(1e-6, x1 - x0), bh = y1 - y0;
    if (s.tool === 'ellipse' || s.tool === 'box') {
      const n = 12;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const u = (i + 0.5) / n, v = (j + 0.5) / n;
          if (s.tool === 'ellipse' && (u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25) continue;
          add({ x: x0 + u * bw, y: y0 + v * bh }, 1);
        }
      return out;
    }
    if (s.tool === 'pen' && bh / bw < GEOMETRY.FLAT_STROKE_RATIO && s.points.length > 1) {
      const cx = (x0 + x1) / 2;
      const up = Math.max(GEOMETRY.UNDERLINE_PROBE_UP * bw, 2 / this.h);
      for (const f of [0.25, 0.5, 0.75]) add({ x: x0 + f * bw, y: y0 - up }, 1);
      add({ x: cx, y: y0 - up * 2 }, 0.5);
      return out;
    }
    if (s.tool === 'arrow' && s.points.length >= 2) {
      add(s.points[s.points.length - 1], 3);
      add(s.points[0], 0.5);
      return out;
    }
    if (s.tool === 'pen' && s.points.length > 6) {
      // closed-ish loop: treat like an ellipse over its bbox
      const a = s.points[0], b = s.points[s.points.length - 1];
      const closed = Math.hypot(a.x - b.x, a.y - b.y) < 0.25 * Math.max(bw, bh);
      if (closed) return this.strokeTargets({ ...s, tool: 'ellipse', points: [{ x: x0, y: y0 }, { x: x1, y: y1 }] });
    }
    for (const p of s.points) add(p, 1);
    return out;
  }

  /** Sorted, unique ids of a stroke's path (for event payloads). */
  strokeHitIds(s: Stroke): number[] {
    const set = new Set<number>();
    for (const p of s.points) {
      const id = this.idAt(p);
      if (id) set.add(id);
    }
    return [...set].sort((a, b) => a - b);
  }
}

export function topLabel(weights: Map<string, number>): string | null {
  let best: string | null = null;
  let bw = -1;
  for (const [l, w] of weights) if (w > bw) (best = l), (bw = w);
  return best;
}

import { describe, expect, test } from 'bun:test';
import { IdMask, topLabel, type LegendEntry } from './mask';
import { fuse, liveFocus, type CandidateInfo, type FusionInput, type PointerSample } from './fusion';
import { restate } from './restate';
import type { Stroke, WordTiming } from './events';

/**
 * Synthetic 100x50 mask (2:1):
 *  - x  0..39, y  0..19 : id 1 "R tennis halls roof"
 *  - x  0..39, y 20..49 : id 2 "R tennis halls facade"
 *  - x 40..69, y  0..19 : id 3 "C commons and learning roof"
 *  - x 40..69, y 20..49 : id 4 "C commons and learning facade"
 *  - x 70..99, y 10..30 : id 5 "skybridge"
 *  - rest background 0
 */
const W = 100, H = 50;
function makeMask() {
  const ids = new Uint16Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let id = 0;
      if (x < 40) id = y < 20 ? 1 : 2;
      else if (x < 70) id = y < 20 ? 3 : 4;
      else if (y >= 10 && y <= 30) id = 5;
      ids[y * W + x] = id;
    }
  const R = { building: 'R', building_synonyms: ['tennis', 'tennis hall', 'tennis halls'] };
  const C = { building: 'C', building_synonyms: ['commons', 'learning', 'cafe'] };
  const legend: LegendEntry[] = [
    { id: 1, object: 'R_roof', label: 'R tennis halls roof', part: 'roof', part_synonyms: ['roof', 'roofs', 'solar'], ...R },
    { id: 2, object: 'R_skin', label: 'R tennis halls facade', part: 'facade', part_synonyms: ['facade', 'wall', 'walls'], ...R },
    { id: 3, object: 'C_roof', label: 'C commons and learning roof', part: 'roof', part_synonyms: ['roof', 'roofs'], ...C },
    { id: 4, object: 'C_skin', label: 'C commons and learning facade', part: 'facade', part_synonyms: ['facade', 'wall'], ...C },
    { id: 5, object: 'Skybridge_RC', label: 'skybridge', part: 'skybridge', part_synonyms: ['skybridge', 'bridge', 'walkway'], building: null },
  ];
  return new IdMask(W, H, ids, legend);
}

const mask = makeMask();
const cands: CandidateInfo[] = [
  { id: 'old', aliases: ['old', 'original', 'first one', 'option 1'], groups: [] },
  { id: 'v2', aliases: ['v2', 'new one', 'option 2', 'domes'], groups: [...mask.groups.values()] },
];
const words = (s: string, start = 0, step = 0.3): WordTiming[] =>
  s.split(' ').map((w, i) => ({ w, start: start + i * step, end: start + i * step + 0.25 }));
const at = (x: number, y: number) => mask.labelOf(mask.idAt({ x, y }));
const hover = (t: number, x: number, y: number, c = 'v2'): PointerSample => ({ t, candidate_id: c, label: at(x, y) });
const base = (over: Partial<FusionInput>): FusionInput => ({ t0: 10_000, words: [], pointer: [], strokes: [], candidates: cands, activeCandidate: 'v2', ...over });

describe('IdMask', () => {
  test('lookup + groups + bbox', () => {
    expect(at(0.1, 0.1)).toBe('R tennis halls roof');
    expect(at(0.75, 0.9)).toBeNull();
    expect(mask.groups.get('skybridge')!.area).toBe(30 * 21);
    const b = mask.groups.get('R tennis halls roof')!.bbox;
    expect([b.x0, b.y0, b.x1, b.y1]).toEqual([0, 0, 0.4, 0.4]);
  });
  test('underline marks what is ABOVE it', () => {
    const s: Stroke = { stroke_id: 'u', tool: 'pen', pointer_type: 'mouse', color: 'r', width: 2, points: [{ x: 0.05, y: 0.42 }, { x: 0.2, y: 0.43 }, { x: 0.35, y: 0.425 }] };
    expect(topLabel(mask.strokeTargets(s))).toBe('R tennis halls roof');
  });
  test('circle marks what it encloses', () => {
    const s: Stroke = { stroke_id: 'e', tool: 'ellipse', pointer_type: 'pen', color: 'r', width: 2, points: [{ x: 0.42, y: 0.45 }, { x: 0.68, y: 0.95 }] };
    expect(topLabel(mask.strokeTargets(s))).toBe('C commons and learning facade');
  });
  test('arrow marks its tip', () => {
    const s: Stroke = { stroke_id: 'a', tool: 'arrow', pointer_type: 'mouse', color: 'r', width: 2, points: [{ x: 0.1, y: 0.9 }, { x: 0.8, y: 0.4 }] };
    expect(topLabel(mask.strokeTargets(s))).toBe('skybridge');
  });
});

describe('speech-object fusion on synthetic timelines', () => {
  test('explicit full mention wins over where the pointer idles', () => {
    const r = fuse(base({ words: words('the tennis hall roof needs more warmth'), pointer: [hover(10_000, 0.5, 0.8), hover(11_000, 0.5, 0.8)] }));
    expect(r.label).toBe('R tennis halls roof');
    expect(r.candidate_id).toBe('v2');
  });
  test('deixis "this" binds to what was pointed at when the word was spoken', () => {
    // pointer on skybridge 0.0-0.9s, then moves to C facade. "this" spoken at 0.3s.
    const r = fuse(base({
      words: words('this is too narrow'),
      pointer: [hover(10_000, 0.85, 0.4), hover(10_400, 0.85, 0.4), hover(10_900, 0.5, 0.8), hover(11_100, 0.5, 0.8)],
    }));
    expect(r.label).toBe('skybridge');
    expect(r.reason).toContain('"this"');
  });
  test('bare part ("the roof") is disambiguated by the pointed building', () => {
    // pointing at C facade, says "the roof should swoop" -> C roof, not R roof
    const r = fuse(base({ words: words('the roof should swoop more'), pointer: [hover(9_800, 0.5, 0.8), hover(10_600, 0.5, 0.8), hover(11_400, 0.5, 0.8)] }));
    expect(r.label).toBe('C commons and learning roof');
  });
  test('focus can move within one utterance (spans in word order)', () => {
    const r = fuse(base({
      words: words('this bridge is great but that wall is boring'),
      pointer: [hover(10_000, 0.85, 0.4), hover(10_500, 0.85, 0.4), hover(11_200, 0.1, 0.8), hover(12_600, 0.1, 0.8)],
    }));
    const labels = r.spans.map((s) => s.label);
    expect(labels[0]).toBe('skybridge');
    expect(labels).toContain('R tennis halls facade');
  });
  test('a stroke drawn just before speaking counts as evidence', () => {
    const s: Stroke = { stroke_id: 'e', tool: 'ellipse', pointer_type: 'pen', color: 'r', width: 2, points: [{ x: 0.02, y: 0.02 }, { x: 0.38, y: 0.38 }] };
    const r = fuse(base({ words: words('make it warmer'), strokes: [{ t_start: 7_000, t_end: 8_000, candidate_id: 'v2', targets: mask.strokeTargets(s) }] }));
    expect(r.label).toBe('R tennis halls roof');
  });
  test('candidate binding from speech ("the old one") overrides the active pane', () => {
    const r = fuse(base({ words: words('honestly the old one had a better roofline') }));
    expect(r.candidate_id).toBe('old');
    expect(r.label).toBeNull(); // old candidate has no mask: no invented object
  });
  test('single-letter building names need "building" next to them', () => {
    const r = fuse(base({ words: words('i think a roof is fine') }));
    // "i" and "a" must not be read as buildings I and A; bare roof w/o pointer -> unsure largest roof
    expect(r.label === 'R tennis halls roof' || r.label === 'C commons and learning roof').toBe(true);
    expect(r.reason).toContain('unsure');
  });
  test('no words, no pointer -> no focus, no crash', () => {
    const r = fuse(base({}));
    expect(r.label).toBeNull();
    expect(r.confidence).toBe(0);
  });
  test('live focus while talking follows recent dwell', () => {
    const p = [hover(1000, 0.1, 0.1), hover(1600, 0.85, 0.4), hover(2000, 0.85, 0.4), hover(2400, 0.85, 0.4)];
    expect(liveFocus(p, 2500).label).toBe('skybridge');
  });
});

describe('restatement', () => {
  test('one structured line', () => {
    const r = restate('the roof is way too boring, really make it swoop more', 'V2 arrival', 'R tennis halls roof');
    expect(r.attribute).toBe('form');
    expect(r.severity).toBe('high');
    expect(r.line).toBe(`V2 arrival / R tennis halls roof / form / ${r.direction} / severity high / scope: this candidate`);
  });
  test('rule scope', () => {
    expect(restate('always keep the timber soffits warm', 'CURRENT', null).scope).toBe('rule');
    expect(restate('maybe slightly warmer', 'CURRENT', null, true).scope).toBe('rule');
    expect(restate('maybe slightly warmer', 'CURRENT', null).severity).toBe('low');
  });
});

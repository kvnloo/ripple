/**
 * Speech -> object binding ("what is the owner talking about right now?").
 *
 * Time-aligned fusion of three evidence streams on one clock (surface ms):
 *  (a) pointer: hover samples and strokes over the object-ID mask while speaking;
 *  (b) mention: words in the transcript that match legend labels / synonyms
 *      ("tennis hall roof", "skybridge", "the domes");
 *  (c) deixis: "this", "that one", "here" resolve to whatever was pointed at
 *      when the word was spoken (word timestamps from faster-whisper);
 *      a bare part ("the roof") is disambiguated by the pointed building.
 * Also binds the candidate ("the old one", "v2", "option 2").
 *
 * Pure function of its inputs so it is unit-testable on synthetic timelines.
 */
import type { WordTiming } from './events';
import type { Group } from './mask';

export const FUSION = {
  /** pointer evidence for a word: [word.start - BEFORE, word.end + AFTER] */
  DEIXIS_BEFORE_MS: 1500,
  DEIXIS_AFTER_MS: 400,
  /** strokes drawn up to this long before the utterance still count */
  STROKE_LOOKBACK_MS: 4000,
  W_MENTION_FULL: 3,
  W_MENTION_PART: 1.5,
  W_DEIXIS: 2,
  W_DWELL: 1,
  W_STROKE: 1.5,
} as const;

export interface PointerSample {
  t: number;
  candidate_id: string;
  label: string | null;
}

export interface StrokeEvidence {
  t_start: number;
  t_end: number;
  candidate_id: string;
  targets: Map<string, number>;
}

export interface CandidateInfo {
  id: string;
  aliases: string[];
  groups: Group[];
}

export interface FusionInput {
  t0: number;
  words: WordTiming[];
  pointer: PointerSample[];
  strokes: StrokeEvidence[];
  candidates: CandidateInfo[];
  /** candidate whose pane the owner is in when nothing else says otherwise */
  activeCandidate: string | null;
}

export interface FocusSpan {
  from: number; // word index
  to: number;
  label: string;
  why: string;
}

export interface FusionResult {
  candidate_id: string | null;
  label: string | null;
  ids: number[];
  confidence: number;
  reason: string;
  spans: FocusSpan[];
  scores: Record<string, number>;
}

const DEIXIS = new Set(['this', 'that', 'these', 'those', 'here', 'there', 'it']);

export function norm(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9']+/g, '').replace(/'s$/, '');
}

const plural = (t: string) => (t.endsWith('s') && t.length > 3 ? t.slice(0, -1) : t);

/** Does `phrase` occur in tokens starting at i? Single letters need "building"/"hall" next to them. */
function matchAt(tokens: string[], i: number, phrase: string[]): boolean {
  if (phrase.length === 1 && phrase[0].length === 1) {
    if (tokens[i] !== phrase[0]) return false;
    return ['building', 'hall', 'block'].includes(tokens[i - 1] ?? '') || ['building', 'hall', 'block'].includes(tokens[i + 1] ?? '');
  }
  for (let k = 0; k < phrase.length; k++) if (plural(tokens[i + k] ?? '') !== plural(phrase[k])) return false;
  return true;
}

function findPhrases(tokens: string[], phrases: string[]): number[] {
  const hits: number[] = [];
  const ps = phrases.map((p) => p.toLowerCase().split(/\s+/).map(norm).filter(Boolean)).filter((p) => p.length);
  for (let i = 0; i < tokens.length; i++) for (const p of ps) if (matchAt(tokens, i, p)) hits.push(i);
  return hits;
}

function partWords(g: Group): string[] {
  return [...new Set([...(g.part ? [g.part] : []), ...g.partWords.filter((w) => w.length > 1)])];
}

function pointerLabelsIn(samples: PointerSample[], cand: string | null, a: number, b: number): Map<string, number> {
  const out = new Map<string, number>();
  const sorted = samples.filter((s) => cand == null || s.candidate_id === cand).sort((x, y) => x.t - y.t);
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const next = sorted[i + 1]?.t ?? s.t + 50;
    const lo = Math.max(a, s.t), hi = Math.min(b, next);
    if (hi <= lo || !s.label) continue;
    out.set(s.label, (out.get(s.label) ?? 0) + (hi - lo));
  }
  return out;
}

function lastPointedBefore(samples: PointerSample[], cand: string | null, t: number, window: number): string | null {
  let best: PointerSample | null = null;
  for (const s of samples) {
    if (cand != null && s.candidate_id !== cand) continue;
    if (s.t <= t && s.t >= t - window && s.label && (!best || s.t > best.t)) best = s;
  }
  return best?.label ?? null;
}

function argmax(m: Map<string, number>): [string | null, number] {
  let k: string | null = null, v = 0;
  for (const [kk, vv] of m) if (vv > v) (k = kk), (v = vv);
  return [k, v];
}

/** Candidate binding from words ("old", "v2", "option 2"), else the pane in use. */
export function bindCandidate(tokens: string[], input: FusionInput): { id: string | null; why: string } {
  let best: { id: string; i: number } | null = null;
  for (const c of input.candidates) {
    const hits = findPhrases(tokens, c.aliases);
    for (const i of hits) if (!best || i > best.i) best = { id: c.id, i };
  }
  if (best) return { id: best.id, why: `said "${tokens[best.i]}"` };
  // pointer majority during the utterance
  const end = input.t0 + 1000 * (input.words[input.words.length - 1]?.end ?? 0);
  const counts = new Map<string, number>();
  for (const s of input.pointer) if (s.t >= input.t0 - 500 && s.t <= end + 300) counts.set(s.candidate_id, (counts.get(s.candidate_id) ?? 0) + 1);
  const [pid] = argmax(counts);
  if (pid) return { id: pid, why: 'pointer was on it' };
  return { id: input.activeCandidate, why: 'active pane' };
}

export function fuse(input: FusionInput): FusionResult {
  const tokens = input.words.map((w) => norm(w.w));
  const cand = bindCandidate(tokens, input);
  const info = input.candidates.find((c) => c.id === cand.id);
  const groups = info?.groups ?? [];
  const scores = new Map<string, number>();
  const why = new Map<string, string[]>();
  const add = (label: string, w: number, reason: string) => {
    scores.set(label, (scores.get(label) ?? 0) + w);
    const r = why.get(label) ?? [];
    if (!r.includes(reason)) r.push(reason);
    why.set(label, r);
  };
  const spans: FocusSpan[] = [];
  const wordT = (i: number) => input.t0 + 1000 * input.words[i].start;
  const wordTEnd = (i: number) => input.t0 + 1000 * input.words[i].end;
  const uttStart = input.t0 + 1000 * (input.words[0]?.start ?? 0);
  const uttEnd = input.words.length ? wordTEnd(input.words.length - 1) : input.t0;

  // (b) mentions: building + part within 6 tokens = full; part alone = needs disambiguation
  const byBuilding = new Map<string, number[]>();
  const bWords = new Map<string, Set<string>>();
  for (const g of groups) if (g.building) for (const w of g.buildingWords) bWords.set(g.building, (bWords.get(g.building) ?? new Set()).add(w));
  for (const [b, words] of bWords) byBuilding.set(b, findPhrases(tokens, [...words]));
  for (const g of groups) {
    const pHits = findPhrases(tokens, partWords(g));
    const bHits = g.building ? byBuilding.get(g.building) ?? [] : [];
    for (const pi of pHits) {
      const near = bHits.find((bi) => Math.abs(bi - pi) <= 6);
      if (near !== undefined) {
        add(g.label, FUSION.W_MENTION_FULL, `said "${tokens[Math.min(near, pi)]}…${tokens[Math.max(near, pi)]}"`);
        spans.push({ from: Math.min(near, pi), to: Math.max(near, pi), label: g.label, why: 'mention' });
      }
    }
    if (!g.part && bHits.length) {
      for (const bi of bHits) {
        add(g.label, FUSION.W_MENTION_PART, `said "${tokens[bi]}"`);
        spans.push({ from: bi, to: bi, label: g.label, why: 'mention' });
      }
    }
  }
  // part-only mentions ("the roof", "the domes")
  const partIndex = new Map<string, Group[]>();
  for (const g of groups) for (const pw of partWords(g)) partIndex.set(pw, [...(partIndex.get(pw) ?? []), g]);
  for (const [pw, gs] of partIndex) {
    for (const i of findPhrases(tokens, [pw])) {
      // skip when a building word is right there (already scored as full)
      const nearB = [...byBuilding.entries()].filter(([, h]) => h.some((bi) => Math.abs(bi - i) <= 6)).map(([b]) => b);
      if (gs.some((g) => g.building && nearB.includes(g.building))) continue;
      const pointed = lastPointedBefore(input.pointer, cand.id, wordTEnd(i), FUSION.DEIXIS_BEFORE_MS * 2);
      const pointedGroup = groups.find((g) => g.label === pointed);
      let pick: Group | undefined;
      let reason = '';
      if (gs.length === 1) {
        pick = gs[0];
        reason = `said "${tokens[i]}" (only one)`;
      } else if (pointedGroup && gs.includes(pointedGroup)) {
        pick = pointedGroup;
        reason = `said "${tokens[i]}" while pointing at it`;
      } else if (pointedGroup?.building) {
        pick = gs.find((g) => g.building === pointedGroup.building);
        reason = `said "${tokens[i]}" while pointing at building ${pointedGroup.building}`;
      }
      if (!pick) {
        pick = [...gs].sort((a, b) => b.area - a.area)[0];
        reason = `said "${tokens[i]}" (largest visible, unsure)`;
        add(pick.label, FUSION.W_MENTION_PART * 0.5, reason);
      } else add(pick.label, FUSION.W_MENTION_PART + (pointedGroup ? 1 : 0), reason);
      spans.push({ from: i, to: i, label: pick.label, why: 'part' });
    }
  }
  // (c) deixis
  for (let i = 0; i < tokens.length; i++) {
    if (!DEIXIS.has(tokens[i])) continue;
    const pointed = lastPointedBefore(input.pointer, cand.id, wordTEnd(i) + FUSION.DEIXIS_AFTER_MS, FUSION.DEIXIS_BEFORE_MS);
    if (pointed) {
      add(pointed, FUSION.W_DEIXIS, `"${tokens[i]}" at ${(input.words[i].start).toFixed(1)}s while pointing`);
      spans.push({ from: i, to: i, label: pointed, why: 'deixis' });
    }
  }
  // (a) pointer dwell over the whole utterance, normalized to fractions
  const dwell = pointerLabelsIn(input.pointer, cand.id, uttStart - 500, uttEnd + 300);
  const total = [...dwell.values()].reduce((a, b) => a + b, 0);
  for (const [l, ms] of dwell) if (total > 0) add(l, (FUSION.W_DWELL * ms) / total, `pointer ${(ms / 1000).toFixed(1)}s`);
  // strokes drawn during / just before speaking
  for (const s of input.strokes) {
    if (cand.id && s.candidate_id !== cand.id) continue;
    if (s.t_end < uttStart - FUSION.STROKE_LOOKBACK_MS || s.t_start > uttEnd + 300) continue;
    const sum = [...s.targets.values()].reduce((a, b) => a + b, 0) || 1;
    for (const [l, w] of s.targets) add(l, (FUSION.W_STROKE * w) / sum, 'marked it');
  }

  const [label, best] = argmax(scores);
  const sumAll = [...scores.values()].reduce((a, b) => a + b, 0);
  const group = groups.find((g) => g.label === label);
  spans.sort((a, b) => a.from - b.from);
  return {
    candidate_id: cand.id,
    label,
    ids: group?.ids ?? [],
    confidence: label && sumAll > 0 ? Math.round((100 * best) / sumAll) / 100 : 0,
    reason: label ? `${cand.why}; ${(why.get(label) ?? []).join(' + ')}` : cand.why,
    spans,
    scores: Object.fromEntries(scores),
  };
}

/** Pointer-only focus while the owner is talking and no words have arrived yet. */
export function liveFocus(pointer: PointerSample[], now: number, windowMs = 1500): { candidate_id: string | null; label: string | null } {
  const recent = pointer.filter((s) => s.t >= now - windowMs && s.t <= now);
  if (!recent.length) return { candidate_id: null, label: null };
  const cand = recent[recent.length - 1].candidate_id;
  const d = pointerLabelsIn(recent, cand, now - windowMs, now);
  return { candidate_id: cand, label: argmax(d)[0] };
}

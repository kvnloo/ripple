/**
 * Ripple visual-review wire events.
 *
 * Envelope follows kvnloo/ripple#2 (proposal, reviewed with z0live#29):
 * {schema_version, session_id, capture_id, source_device, origin, image_ref,
 *  image_sha256, dimensions, orientation, crop_transform, sequence, generation,
 *  timestamp, event_type, payload}
 *
 * Event types: the issue's capture_open | annotation_delta | annotation_undo |
 * annotation_commit | capture_close | handoff, plus three this surface needs:
 * decision_pick (option selector), utterance (speech + restatement) and
 * object_focus (what the owner is talking about). Every event also names the
 * Ripple intent action it records: annotation | gate | declare.
 *
 * Coordinates in payloads are SOURCE-normalized (see geometry.ts).
 */
import { parseCropTransform, type CropTransform, type Pt } from './geometry';

export const SCHEMA_VERSION = 'ripple.review/v1';

export const EVENT_TYPES = [
  'capture_open',
  'annotation_delta',
  'annotation_undo',
  'annotation_commit',
  'capture_close',
  'handoff',
  'decision_pick',
  'utterance',
  'object_focus',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Ripple README actions an intent object records. */
export type IntentAction = 'annotation' | 'gate' | 'declare';

export const ACTION_OF: Record<EventType, IntentAction | null> = {
  capture_open: null,
  annotation_delta: 'annotation',
  annotation_undo: 'annotation',
  annotation_commit: 'annotation',
  capture_close: null,
  handoff: null,
  decision_pick: 'gate',
  utterance: 'declare',
  object_focus: 'declare',
};

export type Tool = 'pen' | 'arrow' | 'ellipse' | 'box' | 'text' | 'pin';

export interface Stroke {
  stroke_id: string;
  tool: Tool;
  /** Source-normalized points; for arrow/ellipse/box: [start, end]. */
  points: Pt[];
  /** Optional per-point pressure (S-Pen / pen), 0..1. */
  pressure?: number[];
  pointer_type: 'pen' | 'touch' | 'mouse';
  color: string;
  width: number;
  text?: string;
  /** Object-mask ids the stroke touches (filled by the surface, informative). */
  hit_ids?: number[];
}

export interface Envelope<P = unknown> {
  schema_version: string;
  session_id: string;
  capture_id: string;
  source_device: string;
  origin: 'user' | 'agent';
  image_ref: string | null;
  image_sha256: string | null;
  dimensions: { w: number; h: number } | null;
  orientation: 0 | 90 | 180 | 270;
  crop_transform: CropTransform | null;
  sequence: number;
  generation: number;
  timestamp: number;
  event_type: EventType;
  action: IntentAction | null;
  payload: P;
}

export interface DecisionPickPayload {
  card_id: string;
  /** candidate id, or '=' for a tie. */
  pick: string;
  reason?: string;
}

export interface WordTiming {
  w: string;
  /** seconds relative to utterance start */
  start: number;
  end: number;
}

export interface UtterancePayload {
  utterance_id: string;
  card_id: string;
  candidate_id: string | null;
  /** surface clock (ms) when recording started */
  t0: number;
  text: string;
  words: WordTiming[];
  focus: { label: string | null; ids: number[]; confidence: number; reason: string } | null;
  restatement: string;
  confirmed: boolean;
  rule: boolean;
}

export interface ObjectFocusPayload {
  card_id: string;
  candidate_id: string;
  label: string | null;
  ids: number[];
  source: 'pointer' | 'speech' | 'owner_correction';
  confidence: number;
}

/** Dedupe key: the same (session, device, generation, sequence) is the same event. */
export function eventKey(e: Pick<Envelope, 'session_id' | 'source_device' | 'generation' | 'sequence'>): string {
  return `${e.session_id}|${e.source_device}|${e.generation}|${e.sequence}`;
}

/** Total order for replay: generation, then sequence, then device for ties across devices. */
export function compareEvents(a: Envelope, b: Envelope): number {
  return a.generation - b.generation || a.sequence - b.sequence || (a.source_device < b.source_device ? -1 : a.source_device > b.source_device ? 1 : 0);
}

const MAX_POINTS = 4096;
const MAX_TEXT = 2000;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function parsePts(raw: unknown): Pt[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_POINTS) return null;
  const out: Pt[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') return null;
    const { x, y } = p as Record<string, unknown>;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    // allow slight overshoot (a stroke can leave the image) but reject garbage
    if (x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5) return null;
    out.push({ x, y });
  }
  return out;
}

/**
 * Boundary parser: takes `unknown` (AGENTS.md: parsers take unknown at the
 * boundary). Returns a typed envelope or an error string. Rejects stale
 * schema, invalid transforms, oversized strokes and unknown event types.
 */
export function parseEnvelope(raw: unknown): { ok: true; event: Envelope } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (r.schema_version !== SCHEMA_VERSION) return { ok: false, error: 'schema_version' };
  for (const k of ['session_id', 'capture_id', 'source_device'] as const) if (!isStr(r[k])) return { ok: false, error: k };
  if (!isInt(r.sequence) || !isInt(r.generation)) return { ok: false, error: 'sequence/generation' };
  if (typeof r.timestamp !== 'number' || !Number.isFinite(r.timestamp)) return { ok: false, error: 'timestamp' };
  if (!EVENT_TYPES.includes(r.event_type as EventType)) return { ok: false, error: 'event_type' };
  if (r.origin !== 'user' && r.origin !== 'agent') return { ok: false, error: 'origin' };
  let crop: CropTransform | null = null;
  if (r.crop_transform != null) {
    crop = parseCropTransform(r.crop_transform);
    if (!crop) return { ok: false, error: 'crop_transform' };
  }
  const et = r.event_type as EventType;
  const p = (r.payload ?? {}) as Record<string, unknown>;
  if (typeof p !== 'object') return { ok: false, error: 'payload' };
  if (et === 'annotation_delta') {
    const s = p.stroke as Record<string, unknown> | undefined;
    if (!s || !isStr(s.stroke_id) || !parsePts(s.points)) return { ok: false, error: 'stroke' };
    if (typeof s.text === 'string' && s.text.length > MAX_TEXT) return { ok: false, error: 'stroke.text' };
    // agent-suggested marks must be explicit suggestions (require approval)
    if (r.origin === 'agent' && p.suggested !== true) return { ok: false, error: 'agent mark must be suggested' };
  }
  if (et === 'annotation_undo' && (!isStr(p.stroke_id) || typeof p.undone !== 'boolean')) return { ok: false, error: 'undo' };
  if (et === 'decision_pick' && (!isStr(p.card_id) || !isStr(p.pick))) return { ok: false, error: 'pick' };
  if (et === 'utterance') {
    if (!isStr(p.utterance_id) || typeof p.text !== 'string' || (p.text as string).length > MAX_TEXT) return { ok: false, error: 'utterance' };
    if (!Array.isArray(p.words) || (p.words as unknown[]).length > 2000) return { ok: false, error: 'utterance.words' };
  }
  const dims = r.dimensions as Record<string, unknown> | null | undefined;
  const event: Envelope = {
    schema_version: SCHEMA_VERSION,
    session_id: r.session_id as string,
    capture_id: r.capture_id as string,
    source_device: r.source_device as string,
    origin: r.origin as 'user' | 'agent',
    image_ref: typeof r.image_ref === 'string' ? r.image_ref : null,
    image_sha256: typeof r.image_sha256 === 'string' ? r.image_sha256 : null,
    dimensions: dims && isInt(dims.w) && isInt(dims.h) ? { w: dims.w as number, h: dims.h as number } : null,
    orientation: ([0, 90, 180, 270] as const).includes(r.orientation as 0) ? (r.orientation as 0) : 0,
    crop_transform: crop,
    sequence: r.sequence as number,
    generation: r.generation as number,
    timestamp: r.timestamp as number,
    event_type: et,
    action: ACTION_OF[et],
    payload: p,
  };
  return { ok: true, event };
}

/** Client-side sequencer: monotonic sequence within a generation. */
export class Sequencer {
  private seq: number;
  constructor(
    readonly session_id: string,
    readonly source_device: string,
    readonly generation: number,
    start = 0,
  ) {
    this.seq = start;
  }
  next(): number {
    this.seq += 1;
    return this.seq;
  }
  make<P>(
    event_type: EventType,
    capture_id: string,
    payload: P,
    img?: { ref: string; sha256: string; w: number; h: number; crop?: CropTransform },
    now: number = Date.now(),
  ): Envelope<P> {
    return {
      schema_version: SCHEMA_VERSION,
      session_id: this.session_id,
      capture_id,
      source_device: this.source_device,
      origin: 'user',
      image_ref: img?.ref ?? null,
      image_sha256: img?.sha256 ?? null,
      dimensions: img ? { w: img.w, h: img.h } : null,
      orientation: 0,
      crop_transform: img?.crop ?? null,
      sequence: this.next(),
      generation: this.generation,
      timestamp: now,
      event_type,
      action: ACTION_OF[event_type],
      payload,
    };
  }
}

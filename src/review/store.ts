/**
 * Event log -> review state. Pure and idempotent: feeding the same events in any
 * order, with duplicates, yields the same state. This is what makes late join
 * (snapshot + ordered deltas), reconnect replay and phone<->desktop handoff safe.
 */
import { compareEvents, eventKey, type DecisionPickPayload, type Envelope, type Stroke, type UtterancePayload } from './events';

export interface ReviewState {
  /** capture_id -> visible strokes in draw order */
  strokes: Map<string, Stroke[]>;
  /** card_id -> latest pick */
  picks: Map<string, DecisionPickPayload & { sequence: number; generation: number }>;
  utterances: UtterancePayload[];
  committed: Set<string>;
  closed: Set<string>;
  /** keys applied, for dedupe */
  seen: Set<string>;
  lastSequence: number;
  lastGeneration: number;
}

export function emptyState(): ReviewState {
  return {
    strokes: new Map(),
    picks: new Map(),
    utterances: [],
    committed: new Set(),
    closed: new Set(),
    seen: new Set(),
    lastSequence: 0,
    lastGeneration: 0,
  };
}

/** Dedupe + total order. Duplicates (same key) keep the first copy. */
export function normalizeLog(events: Envelope[]): Envelope[] {
  const byKey = new Map<string, Envelope>();
  for (const e of events) {
    const k = eventKey(e);
    if (!byKey.has(k)) byKey.set(k, e);
  }
  return [...byKey.values()].sort(compareEvents);
}

/**
 * Replay a log. Strokes are added by annotation_delta and toggled by
 * annotation_undo {stroke_id, undone}. Undo of a stroke that never arrived is
 * ignored (no phantom strokes); a later delta for an undone id stays hidden,
 * so an out-of-order undo still wins once both have arrived.
 */
export function replay(events: Envelope[]): ReviewState {
  const s = emptyState();
  const added = new Map<string, { capture: string; stroke: Stroke; order: number }>();
  const undone = new Map<string, boolean>();
  let order = 0;
  for (const e of normalizeLog(events)) {
    s.seen.add(eventKey(e));
    s.lastSequence = Math.max(s.lastSequence, e.sequence);
    s.lastGeneration = Math.max(s.lastGeneration, e.generation);
    const p = e.payload as Record<string, unknown>;
    switch (e.event_type) {
      case 'annotation_delta': {
        const st = p.stroke as Stroke;
        if (p.suggested === true && p.approved !== true) break; // agent suggestion awaiting approval
        if (!added.has(st.stroke_id)) added.set(st.stroke_id, { capture: e.capture_id, stroke: st, order: order++ });
        break;
      }
      case 'annotation_undo':
        undone.set(p.stroke_id as string, p.undone as boolean);
        break;
      case 'annotation_commit':
        s.committed.add(e.capture_id);
        break;
      case 'capture_close':
        s.closed.add(e.capture_id);
        break;
      case 'decision_pick': {
        const pp = p as unknown as DecisionPickPayload;
        s.picks.set(pp.card_id, { ...pp, sequence: e.sequence, generation: e.generation });
        break;
      }
      case 'utterance': {
        const u = p as unknown as UtterancePayload;
        const i = s.utterances.findIndex((x) => x.utterance_id === u.utterance_id);
        if (i >= 0) s.utterances[i] = u; // a confirm/correction supersedes the draft
        else s.utterances.push(u);
        break;
      }
      default:
        break;
    }
  }
  for (const [id, a] of [...added.entries()].sort((x, y) => x[1].order - y[1].order)) {
    if (undone.get(id)) continue;
    const list = s.strokes.get(a.capture) ?? [];
    list.push(a.stroke);
    s.strokes.set(a.capture, list);
  }
  return s;
}

/**
 * Local undo/redo stack for one device. Undo hides the newest visible stroke
 * this device drew; redo re-shows the newest undone one. New strokes clear redo.
 */
export class UndoStack {
  private done: string[] = [];
  private undoneStack: string[] = [];
  push(strokeId: string) {
    this.done.push(strokeId);
    this.undoneStack = [];
  }
  undo(): string | null {
    const id = this.done.pop() ?? null;
    if (id) this.undoneStack.push(id);
    return id;
  }
  redo(): string | null {
    const id = this.undoneStack.pop() ?? null;
    if (id) this.done.push(id);
    return id;
  }
  /** Eraser removes a specific stroke: same wire event as undo. */
  erase(strokeId: string) {
    this.done = this.done.filter((x) => x !== strokeId);
    this.undoneStack.push(strokeId);
  }
  get canUndo() {
    return this.done.length > 0;
  }
  get canRedo() {
    return this.undoneStack.length > 0;
  }
}

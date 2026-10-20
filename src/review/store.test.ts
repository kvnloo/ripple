import { describe, expect, test } from 'bun:test';
import { Sequencer, parseEnvelope, type Envelope, type Stroke } from './events';
import { UndoStack, normalizeLog, replay } from './store';

const stroke = (id: string): Stroke => ({
  stroke_id: id,
  tool: 'pen',
  points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }],
  pointer_type: 'mouse',
  color: '#ff3b30',
  width: 3,
});

function log() {
  const sq = new Sequencer('s1', 'desktop', 1);
  const img = { ref: 'arrival/v2.jpg', sha256: 'abc', w: 960, h: 540 };
  return [
    sq.make('capture_open', 'arrival/v2', { card_id: 'arrival' }, img, 1),
    sq.make('annotation_delta', 'arrival/v2', { stroke: stroke('a') }, img, 2),
    sq.make('annotation_delta', 'arrival/v2', { stroke: stroke('b') }, img, 3),
    sq.make('annotation_undo', 'arrival/v2', { stroke_id: 'b', undone: true }, img, 4),
    sq.make('decision_pick', 'arrival/v2', { card_id: 'arrival', pick: 'v2' }, img, 5),
    sq.make('annotation_delta', 'arrival/v2', { stroke: stroke('c') }, img, 6),
    sq.make('annotation_commit', 'arrival/v2', {}, img, 7),
  ] as Envelope[];
}

describe('event envelope', () => {
  test('sequencer is monotonic and stamps Ripple actions', () => {
    const l = log();
    expect(l.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(l[1].action).toBe('annotation');
    expect(l[4].action).toBe('gate');
  });
  test('boundary parser accepts what the sequencer makes', () => {
    for (const e of log()) expect(parseEnvelope(JSON.parse(JSON.stringify(e))).ok).toBe(true);
  });
  test('boundary parser rejects bad input', () => {
    const e = JSON.parse(JSON.stringify(log()[1]));
    expect(parseEnvelope({ ...e, schema_version: 'x' }).ok).toBe(false);
    expect(parseEnvelope({ ...e, event_type: 'screen_record' }).ok).toBe(false);
    expect(parseEnvelope({ ...e, sequence: -1 }).ok).toBe(false);
    expect(parseEnvelope({ ...e, crop_transform: { crop: { x: 0, y: 0, w: 2, h: 1 }, rotation: 0 } }).ok).toBe(false);
    const big = { ...e, payload: { stroke: { ...e.payload.stroke, points: Array.from({ length: 5000 }, () => ({ x: 0, y: 0 })) } } };
    expect(parseEnvelope(big).ok).toBe(false);
    // agent marks must be explicit suggestions
    expect(parseEnvelope({ ...e, origin: 'agent' }).ok).toBe(false);
    expect(parseEnvelope({ ...e, origin: 'agent', payload: { ...e.payload, suggested: true } }).ok).toBe(true);
    expect(parseEnvelope('nope').ok).toBe(false);
  });
});

describe('replay: ordering, dedupe, undo', () => {
  test('in-order replay', () => {
    const s = replay(log());
    expect(s.strokes.get('arrival/v2')!.map((x) => x.stroke_id)).toEqual(['a', 'c']);
    expect(s.picks.get('arrival')!.pick).toBe('v2');
    expect(s.committed.has('arrival/v2')).toBe(true);
    expect(s.lastSequence).toBe(7);
  });
  test('shuffled + duplicated log replays to the same state', () => {
    const l = log();
    const messy = [l[6], l[3], l[1], l[1], l[0], l[5], l[2], l[4], l[3]];
    const a = replay(l);
    const b = replay(messy);
    expect(b.strokes.get('arrival/v2')!.map((x) => x.stroke_id)).toEqual(a.strokes.get('arrival/v2')!.map((x) => x.stroke_id));
    expect(normalizeLog(messy).length).toBe(7);
  });
  test('undo arriving before its stroke still hides it', () => {
    const l = log();
    const s = replay([l[3], l[0], l[2]]);
    expect(s.strokes.get('arrival/v2') ?? []).toEqual([]);
  });
  test('redo (undone:false) after undo shows it again', () => {
    const l = log();
    const sq = new Sequencer('s1', 'desktop', 1, 7);
    const redo = sq.make('annotation_undo', 'arrival/v2', { stroke_id: 'b', undone: false });
    const s = replay([...l, redo]);
    expect(s.strokes.get('arrival/v2')!.map((x) => x.stroke_id)).toEqual(['a', 'b', 'c']);
  });
  test('undo of unknown stroke is ignored (no phantom strokes)', () => {
    const sq = new Sequencer('s1', 'desktop', 1);
    const s = replay([sq.make('annotation_undo', 'x', { stroke_id: 'zzz', undone: true })]);
    expect(s.strokes.size).toBe(0);
  });
  test('later generation wins for the same card pick', () => {
    const g1 = new Sequencer('s1', 'desktop', 1, 50);
    const g2 = new Sequencer('s1', 'desktop', 2, 0);
    const s = replay([
      g2.make('decision_pick', 'c', { card_id: 'arrival', pick: 'old' }),
      g1.make('decision_pick', 'c', { card_id: 'arrival', pick: 'v2' }),
    ]);
    expect(s.picks.get('arrival')!.pick).toBe('old');
  });
  test('two devices with the same sequence numbers do not collide', () => {
    const d = new Sequencer('s1', 'desktop', 1);
    const p = new Sequencer('s1', 'phone', 1);
    const s = replay([
      d.make('annotation_delta', 'x', { stroke: stroke('d1') }),
      p.make('annotation_delta', 'x', { stroke: stroke('p1') }),
    ]);
    expect(s.strokes.get('x')!.length).toBe(2);
  });
  test('agent suggestion stays hidden until approved', () => {
    const sq = new Sequencer('s1', 'agent', 1);
    const e = { ...sq.make('annotation_delta', 'x', { stroke: stroke('ag'), suggested: true }), origin: 'agent' as const };
    expect(replay([e]).strokes.get('x')).toBeUndefined();
    const ok = { ...e, sequence: 2, payload: { stroke: stroke('ag'), suggested: true, approved: true } };
    expect(replay([e, ok]).strokes.get('x')!.length).toBe(1);
  });
});

describe('UndoStack', () => {
  test('undo/redo/erase', () => {
    const u = new UndoStack();
    u.push('a');
    u.push('b');
    expect(u.undo()).toBe('b');
    expect(u.redo()).toBe('b');
    expect(u.undo()).toBe('b');
    u.push('c'); // new stroke clears redo
    expect(u.canRedo).toBe(false);
    u.erase('a');
    expect(u.undo()).toBe('c');
    expect(u.canUndo).toBe(false);
  });
});

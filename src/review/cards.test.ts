import { describe, expect, test } from 'bun:test';
import { cardIntentLine, cardIntentPayload, docTitle, isDocName, parseEuiMessage, withSizeReporter, SIZE_REPORTER } from './cards';
import { parseEnvelope, Sequencer } from './events';

const ctx = { card_id: 'v2-dome', card_title: 'Dome', candidate_id: 'new', pick: 'new', focus: 'dome roof' };
const kitIntent = {
  type: 'eui:intent',
  detail: { v: 0, kind: 'inbox', app: 'gmail', action: 'select', label: 'Use “Invoice 4471”', ids: ['message:m4471'], entities: { message: 'm4471' }, at: 1730000000000 },
};

describe('doc names', () => {
  test('plain export names only', () => {
    expect(isDocName('review-cards.html')).toBe(true);
    expect(isDocName('a.b_c-1.html')).toBe(true);
    for (const bad of ['../x.html', '.hidden.html', 'x.htm', 'a/b.html', '', 'x.html\n', 'a..b.html', 'x'.repeat(120) + '.html']) expect(isDocName(bad)).toBe(false);
    expect(isDocName(42)).toBe(false);
  });
});

describe('parseEuiMessage (untrusted frame boundary)', () => {
  test('kit intent shape parses; entities win over flat ids', () => {
    const m = parseEuiMessage(kitIntent);
    expect(m).toEqual({ type: 'intent', detail: { v: 0, kind: 'inbox', app: 'gmail', action: 'select', label: 'Use “Invoice 4471”', ids: ['message:m4471'], entities: { message: ['m4471'] }, at: 1730000000000 } });
  });
  test('flat ids are a fallback when a card sends no entities', () => {
    const m = parseEuiMessage({ type: 'eui:intent', detail: { kind: 'k', app: 'a', action: 'pin', label: 'x', ids: ['task:T1', 'nocolon', 7] } });
    expect(m?.type === 'intent' && m.detail.ids).toEqual(['task:T1']);
  });
  test('ready and size', () => {
    expect(parseEuiMessage({ type: 'eui:ready', cards: 3, failed: 0 })).toEqual({ type: 'ready', cards: 3, failed: 0 });
    expect(parseEuiMessage({ type: 'eui:ready', cards: -1, failed: 0 })).toBeNull();
    expect(parseEuiMessage({ type: 'eui:size', height: 99999 })).toEqual({ type: 'size', height: 6000 });
    expect(parseEuiMessage({ type: 'eui:size', height: 'x' })).toBeNull();
  });
  test('garbage and hostile payloads are dropped or clipped', () => {
    expect(parseEuiMessage(null)).toBeNull();
    expect(parseEuiMessage('eui:intent')).toBeNull();
    expect(parseEuiMessage({ type: 'eui:intent', detail: { ...kitIntent.detail, kind: '<img onerror>' } })).toBeNull();
    expect(parseEuiMessage({ type: 'eui:intent', detail: { ...kitIntent.detail, label: '' } })).toBeNull();
    const big = parseEuiMessage({ type: 'eui:intent', detail: { ...kitIntent.detail, label: 'x\u0000'.repeat(900), entities: { message: Array.from({ length: 80 }, (_, i) => `m${i}`), 'bad key!': 'z', person: '<script>' } } });
    expect(big?.type).toBe('intent');
    if (big?.type !== 'intent') return;
    expect(big.detail.label.length).toBeLessThanOrEqual(500);
    expect(big.detail.label).not.toContain('\u0000');
    expect(Object.keys(big.detail.entities)).toEqual(['message']);
    expect(big.detail.ids.length).toBe(24);
  });
});

describe('card_intent event', () => {
  const m = parseEuiMessage(kitIntent)!;
  if (m.type !== 'intent') throw Error('fixture');
  const payload = cardIntentPayload({ doc: 'mail.html', sha256: 'ab'.repeat(32) }, m.detail, ctx);

  test('payload carries review context and never authority', () => {
    expect(payload.authority).toBe('none');
    expect(payload.doc_sha256).toBe('ab'.repeat(32));
    expect(payload.card_id).toBe('v2-dome');
    expect(payload.eui_action).toBe('select');
  });
  test('round-trips through the server envelope parser', () => {
    const e = new Sequencer('s', 'desktop-x', 1).make('card_intent', 'v2-dome', payload);
    const r = parseEnvelope(JSON.parse(JSON.stringify(e)));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.event.action).toBe('declare');
  });
  test('server rejects agent-origin, approving or path-escaping card intents', () => {
    const e = new Sequencer('s', 'desktop-x', 1).make('card_intent', 'v2-dome', payload);
    expect(parseEnvelope({ ...e, origin: 'agent' })).toEqual({ ok: false, error: 'card_intent origin' });
    expect(parseEnvelope({ ...e, payload: { ...payload, authority: 'approved' } })).toEqual({ ok: false, error: 'card_intent.authority' });
    expect(parseEnvelope({ ...e, payload: { ...payload, doc: '../manifest.html' } })).toEqual({ ok: false, error: 'card_intent' });
  });
  test('one queue line names card, action, ids and where it happened', () => {
    expect(cardIntentLine(payload)).toBe('card gmail/inbox · select: Use “Invoice 4471” [message:m4471] · on Dome/new (dome roof)');
    expect(cardIntentLine({ ...payload, card_id: null, ids: [] })).toBe('card gmail/inbox · select: Use “Invoice 4471”');
  });
});

describe('served document', () => {
  test('size reporter lands before </body> exactly once', () => {
    const out = withSizeReporter('<html><body><p>x</p></body></html>');
    expect(out.indexOf(SIZE_REPORTER)).toBeLessThan(out.indexOf('</body>'));
    expect(out.split(SIZE_REPORTER).length).toBe(2);
    expect(withSizeReporter('<p>no body</p>').endsWith(SIZE_REPORTER)).toBe(true);
  });
  test('title from the export head', () => {
    expect(docTitle('<head><title>Dome &lt;v2&gt; cards</title></head>', 'f')).toBe('Dome <v2> cards');
    expect(docTitle('<p>none</p>', 'fallback')).toBe('fallback');
  });
});

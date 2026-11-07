/**
 * ephemeral-ui cards hosted inside Ripple.
 *
 * An agent drops a self-contained ephemeral-ui export (`tools/export-cards.mjs` in the kit) into
 * `<session>/cards/<doc>.html`. Ripple shows it in a sandboxed iframe (opaque origin, no network)
 * beside the review stage. The kit's cards already mirror their events to the parent frame:
 *
 *   { type: "eui:ready",  cards, failed }                       once, after every card mounted
 *   { type: "eui:intent", detail: { v:0, kind, app, action, label, ids:["type:id"…], entities, text?, at } }
 *   { type: "eui:size",   height }                              Ripple's own injected reporter
 *
 * This module is the boundary: messages arrive as `unknown` from a frame we do not trust, and
 * leave as a typed `card_intent` payload plus one agent-queue line. A card intent is context for
 * the agent, never an approval: `authority` is always "none", whatever the card's action says.
 */

const DOC_RE = /^[A-Za-z0-9][\w.-]{0,95}\.html$/;
const TOKEN_RE = /^[\w.:@#/-]{1,64}$/;
const ID_RE = /^[\w.:\-@#/ ]{1,160}$/;
export const LIMITS = { ids: 24, label: 500, text: 2000, entityTypes: 16, html: 2 * 1024 * 1024 } as const;

export interface EuiIntent {
  v: 0;
  kind: string;
  app: string;
  action: string;
  label: string;
  ids: string[];
  entities: Record<string, string[]>;
  text?: string;
  at: number | null;
}

export type EuiMessage = { type: 'ready'; cards: number; failed: number } | { type: 'size'; height: number } | { type: 'intent'; detail: EuiIntent };

export interface CardDoc {
  doc: string;
  title: string;
  bytes: number;
  mtime: number;
  sha256: string;
}

/** What Ripple was showing when the card spoke: lets the agent join the card to the review. */
export interface ReviewContext {
  card_id: string | null;
  card_title: string | null;
  candidate_id: string | null;
  pick: string | null;
  focus: string | null;
}

export interface CardIntentPayload extends ReviewContext {
  doc: string;
  doc_sha256: string | null;
  kind: string;
  app: string;
  eui_action: string;
  label: string;
  ids: string[];
  entities: Record<string, string[]>;
  text?: string;
  at: number | null;
  /** A card intent never approves, signs, pays or starts work: it is context for the agent. */
  authority: 'none';
}

export const isDocName = (v: unknown): v is string => typeof v === 'string' && DOC_RE.test(v) && !v.includes('..');

const tok = (v: unknown): string | null => (typeof v === 'string' && TOKEN_RE.test(v) ? v : null);
const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) : '');

/** Typed ids → the kit's "type:id" list; unsafe ids are dropped (same rule as the kit's idsOf). */
function idsFrom(entities: Record<string, string[]>): string[] {
  const out: string[] = [];
  for (const [t, list] of Object.entries(entities)) for (const id of list) out.push(`${t}:${id}`);
  return [...new Set(out)].slice(0, LIMITS.ids);
}

function parseEntities(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [t, v] of Object.entries(raw as Record<string, unknown>).slice(0, LIMITS.entityTypes)) {
    if (!TOKEN_RE.test(t)) continue;
    const list = ([] as unknown[]).concat(v).filter((x) => (typeof x === 'string' || typeof x === 'number') && ID_RE.test(String(x))).map(String);
    if (list.length) out[t] = [...new Set(list)].slice(0, LIMITS.ids);
  }
  return out;
}

/** Boundary parser for a postMessage from a card frame. Anything else returns null. */
export function parseEuiMessage(raw: unknown): EuiMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (m.type === 'eui:ready') {
    const cards = Number(m.cards), failed = Number(m.failed);
    if (!Number.isInteger(cards) || !Number.isInteger(failed) || cards < 0 || failed < 0 || cards > 500 || failed > 500) return null;
    return { type: 'ready', cards, failed };
  }
  if (m.type === 'eui:size') {
    const h = Number(m.height);
    return Number.isFinite(h) && h > 0 ? { type: 'size', height: Math.min(6000, Math.max(80, Math.round(h))) } : null;
  }
  if (m.type !== 'eui:intent' || !m.detail || typeof m.detail !== 'object') return null;
  const d = m.detail as Record<string, unknown>;
  const kind = tok(d.kind), app = tok(d.app), action = tok(d.action);
  if (!kind || !app || !action) return null;
  const label = clip(d.label, LIMITS.label);
  if (!label) return null;
  const entities = parseEntities(d.entities);
  // ids: prefer the typed map; fall back to the flat list when a card sent ids only.
  let ids = idsFrom(entities);
  if (!ids.length && Array.isArray(d.ids)) ids = [...new Set(d.ids.filter((s): s is string => typeof s === 'string' && s.includes(':') && ID_RE.test(s)))].slice(0, LIMITS.ids);
  const text = clip(d.text, LIMITS.text);
  const at = typeof d.at === 'number' && Number.isFinite(d.at) ? d.at : null;
  return { type: 'intent', detail: { v: 0, kind, app, action, label, ids, entities, ...(text ? { text } : {}), at } };
}

export function cardIntentPayload(doc: CardDoc | { doc: string; sha256?: string | null }, d: EuiIntent, ctx: ReviewContext): CardIntentPayload {
  return {
    doc: doc.doc,
    doc_sha256: ('sha256' in doc && doc.sha256) || null,
    kind: d.kind,
    app: d.app,
    eui_action: d.action,
    label: d.label,
    ids: d.ids,
    entities: d.entities,
    ...(d.text ? { text: d.text } : {}),
    at: d.at,
    ...ctx,
    authority: 'none',
  };
}

/** One structured line for agent-queue.jsonl (same role as restate() for spoken notes). */
export function cardIntentLine(p: CardIntentPayload): string {
  const where = p.card_id ? ` · on ${p.card_title ?? p.card_id}${p.candidate_id ? `/${p.candidate_id}` : ''}${p.focus ? ` (${p.focus})` : ''}` : '';
  const ids = p.ids.length ? ` [${p.ids.slice(0, 6).join(', ')}${p.ids.length > 6 ? ` +${p.ids.length - 6}` : ''}]` : '';
  return `card ${p.app}/${p.kind} · ${p.eui_action}: ${p.label}${ids}${where}`;
}

/** `<title>` of an export, for the drawer header. */
export function docTitle(html: string, fallback: string): string {
  const m = /<title>([^<]{1,200})<\/title>/i.exec(html);
  return m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim() || fallback : fallback;
}

/**
 * Host-side size reporter, appended to each served export: an opaque-origin frame cannot be
 * measured by its parent, so the document reports its own height. No kit change needed.
 */
export const SIZE_REPORTER =
  '<script>(()=>{if(parent===window)return;let l=0;const s=()=>{const h=Math.ceil(document.documentElement.scrollHeight);if(Math.abs(h-l)>2){l=h;parent.postMessage({type:"eui:size",height:h},"*")}};new ResizeObserver(s).observe(document.documentElement);addEventListener("load",s);s()})()</script>';

/** No network, no forms, no navigation out of the frame: the export embeds everything it reads. */
export const CARD_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";

export function withSizeReporter(html: string): string {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i < 0 ? html + SIZE_REPORTER : html.slice(0, i) + SIZE_REPORTER + html.slice(i);
}

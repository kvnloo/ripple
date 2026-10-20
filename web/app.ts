/**
 * Ripple visual-review surface (desktop web / Dash WebView).
 * Pick between candidates, draw on them, hold to talk; the surface tracks which
 * scene object you are talking about through each candidate's object-ID mask.
 * All state is a replay of typed Ripple events stored on this machine.
 */
import { IDENTITY_CROP, IDENTITY_VIEW, GEOMETRY, panBy, sourceToScreen, screenToSource, zoomAt, type Pt, type ViewTransform } from '../src/review/geometry';
import { Sequencer, type Envelope, type Stroke, type Tool, type UtterancePayload, type WordTiming } from '../src/review/events';
import { UndoStack, replay } from '../src/review/store';
import { IdMask, type LegendEntry } from '../src/review/mask';
import { fuse, liveFocus, type CandidateInfo, type FusionResult, type PointerSample, type StrokeEvidence } from '../src/review/fusion';
import { restate } from '../src/review/restate';
import { parsePointer, widthFor } from '../src/review/stylus';

// ---------------- types ----------------
interface MaskRef {
  file: string;
  w: number;
  h: number;
  sha256: string;
  legend: LegendEntry[];
  provenance: Record<string, unknown>;
  alignment?: number | null;
}
interface Candidate {
  id: string;
  key: string;
  label: string;
  title: string;
  image: string;
  w: number;
  h: number;
  source: { path: string; sha256: string; mtime: string; round?: string };
  aliases: string[];
  mask: MaskRef | null;
  note?: string;
}
interface Card {
  id: string;
  title: string;
  question: string;
  note?: string;
  candidates: Candidate[];
}
interface Manifest {
  session_id: string;
  title: string;
  built: string;
  cards: Card[];
}
type Mode = 'grid' | 'swipe' | 'overlay' | 'flicker' | 'diff';
type ToolMode = Tool | 'eraser' | 'pan';

// ---------------- state ----------------
const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const now = () => performance.timeOrigin + performance.now();
const DEVICE = localStorage.getItem('ripple.device') ?? `desktop-${Math.random().toString(36).slice(2, 8)}`;
localStorage.setItem('ripple.device', DEVICE);

let M: Manifest;
let seq: Sequencer;
let cardIdx = 0;
let mode: Mode = 'grid';
let tool: ToolMode = 'pen';
let view: ViewTransform = { ...IDENTITY_VIEW };
let abA = 0, abB = 1;
let opacity = 0.5;
let flickerOn = false;
let events: Envelope[] = [];
const outbox: Envelope[] = [];
const images = new Map<string, HTMLImageElement>();
const masks = new Map<string, IdMask>();
const undo = new UndoStack();
const strokeCapture = new Map<string, string>(); // stroke_id -> capture_id
const pointer: PointerSample[] = [];
const strokeEv: StrokeEvidence[] = [];
let hover: { cand: string; label: string | null; p: Pt } | null = null;
let drawing: { capture: string; cand: Candidate; stroke: Stroke; t0: number; pane: HTMLElement } | null = null;
let panning: { x: number; y: number } | null = null;
let talk: {
  t0: number;
  rec: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
  partialTimer: number;
  id: string;
} | null = null;
let draft: { utt: UtterancePayload; fusion: FusionResult; card: Card } | null = null;
let focusOverride: string | null = null;
let liveLabel: string | null = null;

const card = () => M.cards[cardIdx];
const capId = (c: Card, cand: Candidate) => `${c.id}/${cand.id}`;
const candById = (id: string | null) => card().candidates.find((c) => c.id === id) ?? null;

// ---------------- events ----------------
function emit(type: Envelope['event_type'], cand: Candidate | null, payload: unknown) {
  const c = card();
  const img = cand ? { ref: cand.image, sha256: cand.source.sha256, w: cand.w, h: cand.h, crop: IDENTITY_CROP } : undefined;
  const e = seq.make(type, cand ? capId(c, cand) : c.id, payload, img, now());
  events.push(e);
  outbox.push(e);
  scheduleFlush();
  return e;
}
let flushTimer = 0;
function scheduleFlush() {
  if (!flushTimer) flushTimer = window.setTimeout(flush, 250);
}
async function flush() {
  flushTimer = 0;
  if (!outbox.length) return;
  const batch = outbox.splice(0, outbox.length);
  try {
    const r = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ripple': '1' }, body: JSON.stringify(batch) });
    const j = await r.json();
    setPill('#store-pill', `store ✓ ${events.length}`, j.errors?.length ? 'bad' : 'ok');
  } catch {
    outbox.unshift(...batch); // retry; server dedupes by key
    setPill('#store-pill', 'store offline', 'bad');
    window.setTimeout(scheduleFlush, 1500);
  }
}

function setPill(sel: string, text: string, cls = '') {
  const el = $(sel);
  el.textContent = text;
  el.className = `pill ${cls}`;
}
function toast(msg: string, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  window.clearTimeout((t as any)._h);
  (t as any)._h = window.setTimeout(() => (t.hidden = true), ms);
}

// ---------------- loading ----------------
async function load() {
  M = await (await fetch('/manifest.json')).json();
  const prior: Envelope[] = await (await fetch('/api/events')).json().catch(() => []);
  events = prior;
  const mine = prior.filter((e) => e.source_device === DEVICE);
  const gen = mine.reduce((g, e) => Math.max(g, e.generation), 0) + 1;
  seq = new Sequencer(M.session_id, DEVICE, gen);
  $('#title').textContent = `${M.title} · built ${M.built}`;
  for (const c of M.cards)
    for (const cand of c.candidates) {
      const img = new Image();
      img.src = '/' + cand.image;
      img.onload = () => render();
      images.set(capId(c, cand), img);
      if (cand.mask) loadMask(c, cand);
    }
  for (const e of prior) if (e.event_type === 'annotation_delta') strokeCapture.set((e.payload as any).stroke.stroke_id, e.capture_id);
  setPill('#store-pill', `store ✓ ${prior.length}`, 'ok');
  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      setPill('#bridge-pill', s.bridge.enabled ? 'agent: Hermes API' : 'agent: queue file', 'dim');
      $('#bridge-pill').title = s.bridge.reason;
      if (!s.whisper.ready) setPill('#mic-pill', s.whisper.disabled ? 'stt disabled' : 'stt loading…', 'busy');
    });
  buildQueue();
  openCard(0);
}

async function loadMask(c: Card, cand: Candidate) {
  const m = cand.mask!;
  const buf = await (await fetch('/' + m.file)).arrayBuffer();
  masks.set(capId(c, cand), new IdMask(m.w, m.h, new Uint32Array(buf), m.legend));
  if (c === card()) {
    renderPaneChrome();
    render();
  }
}

let stCache: { n: number; s: ReturnType<typeof replay> } | null = null;
function state() {
  if (!stCache || stCache.n !== events.length) stCache = { n: events.length, s: replay(events) };
  return stCache.s;
}

// ---------------- queue + card ----------------
function buildQueue() {
  const q = $('#queue');
  q.innerHTML = '';
  const st = state();
  M.cards.forEach((c, i) => {
    const d = document.createElement('div');
    d.className = 'qcard' + (i === cardIdx ? ' cur' : '');
    const pick = st.picks.get(c.id);
    const pickTxt = pick ? (pick.pick === '=' ? 'tie' : candLabel(c, pick.pick)) : 'pending';
    d.innerHTML = `<div class="t">${esc(c.title)}</div><div class="s">${c.candidates.map((x) => esc(x.label)).join(' · ')}</div>
      <div class="thumbs">${c.candidates.map((x) => `<img src="/${x.image}" alt="">`).join('')}</div>
      <div class="s">pick: <span class="${pick ? 'picked' : ''}">${esc(pickTxt)}</span></div>`;
    d.onclick = () => openCard(i);
    q.appendChild(d);
  });
}
const candLabel = (c: Card, id: string) => c.candidates.find((x) => x.id === id)?.label ?? id;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

const opened = new Set<string>();
function openCard(i: number) {
  const prev = M.cards[cardIdx];
  if (prev && i !== cardIdx) for (const cand of prev.candidates) if (opened.has(capId(prev, cand))) emit('capture_close', cand, { card_id: prev.id });
  cardIdx = i;
  const c = card();
  view = { ...IDENTITY_VIEW };
  abA = 0;
  abB = c.candidates.length - 1;
  for (const cand of c.candidates) {
    const id = capId(c, cand);
    if (!opened.has(id)) {
      opened.add(id);
      emit('capture_open', cand, { card_id: c.id, source_path: cand.source.path, mtime: cand.source.mtime, mask_sha256: cand.mask?.sha256 ?? null });
    }
  }
  $('#question').textContent = c.question;
  $('#cardnote').textContent = c.note ?? '';
  for (const [sel, idx] of [['#sel-a', abA], ['#sel-b', abB]] as const) {
    const s = $<HTMLSelectElement>(sel);
    s.innerHTML = c.candidates.map((x, k) => `<option value="${k}">${k + 1} ${esc(x.label)}</option>`).join('');
    s.value = String(idx);
  }
  const pb = $('#pick-buttons');
  pb.innerHTML = '';
  for (const cand of c.candidates) {
    const b = document.createElement('button');
    b.textContent = `${cand.key} ${cand.label}`;
    b.dataset.pick = cand.id;
    b.onclick = () => pick(cand.id);
    pb.appendChild(b);
  }
  const tie = document.createElement('button');
  tie.textContent = '= tie';
  tie.dataset.pick = '=';
  tie.onclick = () => pick('=');
  pb.appendChild(tie);
  buildPanes();
  buildQueue();
  updatePickUi();
}

function pick(id: string) {
  const c = card();
  const cand = id === '=' ? null : candById(id);
  const reason = $<HTMLInputElement>('#reason').value.trim();
  emit('decision_pick', cand ?? c.candidates[0], { card_id: c.id, pick: id, reason: reason || undefined });
  for (const x of c.candidates) if ((state().strokes.get(capId(c, x)) ?? []).length) emit('annotation_commit', x, { card_id: c.id });
  $<HTMLInputElement>('#reason').value = '';
  updatePickUi();
  buildQueue();
  toast(`Picked ${id === '=' ? 'tie' : candLabel(c, id)} for “${c.title}”${reason ? ` — ${reason}` : ''}`);
}

function updatePickUi() {
  const p = state().picks.get(card().id);
  document.querySelectorAll<HTMLButtonElement>('#pick-buttons button').forEach((b) => b.classList.toggle('on', p?.pick === b.dataset.pick));
  $('#pick-state').textContent = p ? `picked: ${p.pick === '=' ? 'tie' : candLabel(card(), p.pick)}${p.reason ? ` — ${p.reason}` : ''}` : 'keys 1–4 pick · = tie';
  document.querySelectorAll<HTMLElement>('.pane').forEach((el) => el.classList.toggle('picked', !!p && el.dataset.cand === p.pick));
}

// ---------------- panes ----------------
interface PaneRef {
  el: HTMLElement;
  canvas: HTMLCanvasElement;
  cands: Candidate[]; // grid: one; compare modes: [A, B]
}
let panes: PaneRef[] = [];

function buildPanes() {
  const host = $('#panes');
  host.innerHTML = '';
  const c = card();
  const list: Candidate[][] = mode === 'grid' ? c.candidates.map((x) => [x]) : [[c.candidates[abA], c.candidates[abB]]];
  const n = list.length;
  const cols = n <= 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : 3;
  host.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  host.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, 1fr)`;
  panes = list.map((cands) => {
    const el = document.createElement('div');
    el.className = 'pane';
    el.dataset.cand = cands[cands.length - 1].id;
    const canvas = document.createElement('canvas');
    el.appendChild(canvas);
    host.appendChild(el);
    const ref = { el, canvas, cands };
    attachPointer(ref);
    return ref;
  });
  renderPaneChrome();
  updateModeUi();
  requestAnimationFrame(render);
}

function renderPaneChrome() {
  for (const p of panes) {
    p.el.querySelectorAll('.badge,.stamp,.maskinfo').forEach((x) => x.remove());
    const top = shownCand(p);
    const b = document.createElement('div');
    b.className = 'badge';
    b.innerHTML = mode === 'grid' ? `<span class="key">${top.key}</span><span class="name">${esc(top.label)}</span>` : `<span class="name">${esc(p.cands[0].label)} ⟷ ${esc(p.cands[1].label)}</span>`;
    const s = document.createElement('div');
    s.className = 'stamp';
    s.textContent = `${top.source.round ?? ''} · ${top.source.mtime} · sha ${top.source.sha256.slice(0, 10)}`;
    const mi = document.createElement('div');
    mi.className = 'maskinfo';
    const mk = masks.get(capId(card(), top));
    mi.textContent = top.mask ? (mk ? `ID mask · ${mk.groups.size} objects` : 'ID mask loading…') : 'no ID mask (speech only)';
    p.el.append(b, s, mi);
  }
}

function updateModeUi() {
  document.querySelectorAll<HTMLButtonElement>('#modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  ($('#modes .ab') as HTMLElement).style.visibility = mode === 'grid' ? 'hidden' : 'visible';
  $<HTMLInputElement>('#opacity').style.display = mode === 'overlay' ? '' : 'none';
  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
}

/** The candidate a pointer action in this pane applies to (what you see there). */
function shownCand(p: PaneRef, sx?: number): Candidate {
  if (mode === 'grid') return p.cands[0];
  if (mode === 'swipe' && sx !== undefined) return sx < swipeX * p.canvas.clientWidth ? p.cands[0] : p.cands[1];
  if (mode === 'flicker') return flickerOn ? p.cands[1] : p.cands[0];
  return p.cands[1];
}
let swipeX = 0.5;

function paneGeom(p: PaneRef, cand: Candidate) {
  return { pane: { width: p.canvas.clientWidth, height: p.canvas.clientHeight }, aspect: cand.w / cand.h };
}
function toSource(p: PaneRef, cand: Candidate, sx: number, sy: number): Pt {
  const g = paneGeom(p, cand);
  return screenToSource({ x: sx, y: sy }, g.pane, g.aspect, view, IDENTITY_CROP);
}
function toScreen(p: PaneRef, cand: Candidate, pt: Pt): Pt {
  const g = paneGeom(p, cand);
  return sourceToScreen(pt, g.pane, g.aspect, view, IDENTITY_CROP);
}

// ---------------- rendering ----------------
const hlCache = new Map<string, HTMLCanvasElement>();
function highlightCanvas(key: string, mk: IdMask, label: string, rgb: [number, number, number], alpha: number): HTMLCanvasElement {
  const k = `${key}|${label}|${rgb}|${alpha}`;
  const hit = hlCache.get(k);
  if (hit) return hit;
  const g = mk.groups.get(label);
  const set = new Set(g?.ids ?? []);
  const cv = document.createElement('canvas');
  cv.width = mk.w;
  cv.height = mk.h;
  const ctx = cv.getContext('2d')!;
  const im = ctx.createImageData(mk.w, mk.h);
  const W = mk.w, H = mk.h, ids = mk.ids;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!set.has(ids[i])) continue;
      const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || !set.has(ids[i - 1]) || !set.has(ids[i + 1]) || !set.has(ids[i - W]) || !set.has(ids[i + W]);
      im.data[i * 4] = rgb[0];
      im.data[i * 4 + 1] = rgb[1];
      im.data[i * 4 + 2] = rgb[2];
      im.data[i * 4 + 3] = edge ? 255 : Math.round(alpha * 255);
    }
  ctx.putImageData(im, 0, 0);
  if (hlCache.size > 60) hlCache.clear();
  hlCache.set(k, cv);
  return cv;
}

const diffCache = new Map<string, HTMLCanvasElement>();
function diffCanvas(a: Candidate, b: Candidate): HTMLCanvasElement | null {
  const k = `${capId(card(), a)}|${capId(card(), b)}`;
  if (diffCache.has(k)) return diffCache.get(k)!;
  const ia = images.get(capId(card(), a)), ib = images.get(capId(card(), b));
  if (!ia?.complete || !ib?.complete) return null;
  const w = 960, h = Math.round((960 * a.h) / a.w);
  const mk = (img: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0, w, h);
    return x.getImageData(0, 0, w, h);
  };
  const da = mk(ia), db = mk(ib);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  const im = ctx.createImageData(w, h);
  for (let i = 0; i < da.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch++) im.data[i + ch] = Math.min(255, 3 * Math.abs(da.data[i + ch] - db.data[i + ch]));
    im.data[i + 3] = 255;
  }
  ctx.putImageData(im, 0, 0);
  diffCache.set(k, out);
  return out;
}

function imageRect(p: PaneRef, cand: Candidate) {
  const a = toScreen(p, cand, { x: 0, y: 0 });
  const b = toScreen(p, cand, { x: 1, y: 1 });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

function render() {
  if (!M) return;
  const c = card();
  const focusLabel = currentFocusLabel();
  const focusCand = draft?.fusion.candidate_id ?? (talk ? hover?.cand : null) ?? null;
  for (const p of panes) {
    const dpr = window.devicePixelRatio || 1;
    const cw = p.canvas.clientWidth, ch = p.canvas.clientHeight;
    if (p.canvas.width !== Math.round(cw * dpr) || p.canvas.height !== Math.round(ch * dpr)) {
      p.canvas.width = Math.round(cw * dpr);
      p.canvas.height = Math.round(ch * dpr);
    }
    const ctx = p.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    const drawImg = (cand: Candidate, alpha = 1, clip?: [number, number]) => {
      const img = images.get(capId(c, cand));
      if (!img?.complete) return;
      const r = imageRect(p, cand);
      ctx.save();
      if (clip) {
        ctx.beginPath();
        ctx.rect(clip[0], 0, clip[1] - clip[0], ch);
        ctx.clip();
      }
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      ctx.restore();
    };
    const layers: { cand: Candidate; clip?: [number, number] }[] = [];
    if (mode === 'grid') {
      drawImg(p.cands[0]);
      layers.push({ cand: p.cands[0] });
    } else if (mode === 'swipe') {
      const sx = swipeX * cw;
      drawImg(p.cands[0], 1, [0, sx]);
      drawImg(p.cands[1], 1, [sx, cw]);
      layers.push({ cand: p.cands[0], clip: [0, sx] }, { cand: p.cands[1], clip: [sx, cw] });
    } else if (mode === 'overlay') {
      drawImg(p.cands[0]);
      drawImg(p.cands[1], opacity);
      layers.push({ cand: p.cands[1] });
    } else if (mode === 'flicker') {
      const s = flickerOn ? p.cands[1] : p.cands[0];
      drawImg(s);
      layers.push({ cand: s });
    } else if (mode === 'diff') {
      const d = diffCanvas(p.cands[0], p.cands[1]);
      if (d) {
        const r = imageRect(p, p.cands[0]);
        ctx.drawImage(d, r.x, r.y, r.w, r.h);
      }
      layers.push({ cand: p.cands[1] });
    }
    for (const L of layers) {
      ctx.save();
      if (L.clip) {
        ctx.beginPath();
        ctx.rect(L.clip[0], 0, L.clip[1] - L.clip[0], ch);
        ctx.clip();
      }
      const key = capId(c, L.cand);
      const mk = masks.get(key);
      const r = imageRect(p, L.cand);
      ctx.imageSmoothingEnabled = false;
      if (mk && hover && hover.cand === L.cand.id && hover.label && hover.label !== focusLabel && tool !== 'pan')
        ctx.drawImage(highlightCanvas(key, mk, hover.label, [255, 214, 10], 0.22), r.x, r.y, r.w, r.h);
      if (mk && focusLabel && (focusCand === L.cand.id || (!focusCand && hover?.cand === L.cand.id)))
        ctx.drawImage(highlightCanvas(key, mk, focusLabel, [49, 208, 170], 0.38), r.x, r.y, r.w, r.h);
      ctx.imageSmoothingEnabled = true;
      const strokes = [...(state().strokes.get(key) ?? [])];
      if (drawing && drawing.capture === key) strokes.push(drawing.stroke);
      for (const s of strokes) drawStroke(ctx, p, L.cand, s);
      ctx.restore();
    }
    if (mode === 'swipe') {
      ctx.fillStyle = '#fff';
      ctx.fillRect(swipeX * cw - 1, 0, 2, ch);
    }
    p.el.classList.toggle('talk', !!talk && hover?.cand === p.el.dataset.cand);
  }
}

function drawStroke(ctx: CanvasRenderingContext2D, p: PaneRef, cand: Candidate, s: Stroke) {
  const pts = s.points.map((q) => toScreen(p, cand, q));
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = s.width * Math.max(1, Math.sqrt(view.zoom));
  ctx.lineWidth = w;
  if (s.tool === 'pen') {
    for (let i = 1; i < pts.length; i++) {
      ctx.lineWidth = s.pressure ? widthFor(w, { pointer_type: 'pen', pressure: s.pressure[i] ?? 0.5 }) : w;
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (s.tool === 'arrow' && pts.length >= 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x), L = 10 + 3 * w;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - L * Math.cos(ang - 0.45), b.y - L * Math.sin(ang - 0.45));
    ctx.lineTo(b.x - L * Math.cos(ang + 0.45), b.y - L * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if ((s.tool === 'ellipse' || s.tool === 'box') && pts.length >= 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    ctx.beginPath();
    if (s.tool === 'box') ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    else ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === 'text' && s.text) {
    ctx.font = '600 15px ui-sans-serif, system-ui';
    const m = ctx.measureText(s.text);
    ctx.fillStyle = '#000c';
    ctx.fillRect(pts[0].x - 4, pts[0].y - 16, m.width + 8, 22);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, pts[0].x, pts[0].y);
  } else if (s.tool === 'pin') {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px ui-sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(s.text ?? '•', pts[0].x, pts[0].y + 4);
    ctx.textAlign = 'start';
  }
}

// ---------------- pointer: hover, draw, erase, pan, zoom ----------------
function attachPointer(p: PaneRef) {
  const el = p.canvas;
  el.addEventListener('pointerdown', (ev) => {
    const se = parsePointer(ev, 'down');
    if (!se) return;
    el.setPointerCapture(ev.pointerId);
    const cand = shownCand(p, se.x);
    if (mode === 'swipe' && Math.abs(se.x - swipeX * el.clientWidth) < 10) {
      panning = null;
      (el as any)._swipe = true;
      return;
    }
    if (tool === 'pan' || ev.altKey || ev.button === 1) {
      panning = { x: ev.clientX, y: ev.clientY };
      return;
    }
    const pt = toSource(p, cand, se.x, se.y);
    const capture = capId(card(), cand);
    if (tool === 'eraser' || se.kind === 'erase') {
      eraseAt(p, cand, se.x, se.y);
      return;
    }
    if (tool === 'text' || tool === 'pin') {
      const n = (state().strokes.get(capture) ?? []).filter((s) => s.tool === 'pin').length + 1;
      const text = tool === 'text' ? window.prompt('Text') ?? '' : String(n);
      if (!text) return;
      commitStroke(capture, cand, { stroke_id: sid(), tool, points: [pt], pointer_type: se.pointer_type, color: '#ff3b30', width: 3, text }, now(), now());
      return;
    }
    drawing = {
      capture,
      cand,
      pane: p.el,
      t0: now(),
      stroke: { stroke_id: sid(), tool: tool as Tool, points: [pt], pressure: se.pointer_type === 'pen' ? [se.pressure] : undefined, pointer_type: se.pointer_type, color: '#ff3b30', width: 3 },
    };
  });
  el.addEventListener('pointermove', (ev) => {
    const se = parsePointer(ev, 'move');
    if (!se) return;
    if ((el as any)._swipe) {
      swipeX = Math.min(1, Math.max(0, se.x / el.clientWidth));
      render();
      return;
    }
    if (panning) {
      const cand = shownCand(p);
      const g = paneGeom(p, cand);
      view = panBy(view, ev.clientX - panning.x, ev.clientY - panning.y, g.pane, g.aspect);
      panning = { x: ev.clientX, y: ev.clientY };
      render();
      return;
    }
    const cand = shownCand(p, se.x);
    const pt = toSource(p, cand, se.x, se.y);
    const mk = masks.get(capId(card(), cand));
    const label = mk ? mk.labelOf(mk.idAt(pt)) : null;
    const changed = !hover || hover.label !== label || hover.cand !== cand.id;
    hover = { cand: cand.id, label, p: pt };
    const t = now();
    const last = pointer[pointer.length - 1];
    if (!last || t - last.t > 30 || last.label !== label) pointer.push({ t, candidate_id: cand.id, label });
    if (pointer.length > 5000) pointer.splice(0, 1000);
    if (changed) {
      $('#hover-chip').textContent = label ?? (mk ? 'sky / background' : 'no ID mask');
      $('#hover-chip').className = label ? 'chip' : 'chip dim';
      if (talk) updateLiveFocus();
    }
    if (drawing) {
      const s = drawing.stroke;
      if (s.tool === 'pen') {
        const lp = s.points[s.points.length - 1];
        if (Math.hypot(pt.x - lp.x, pt.y - lp.y) >= GEOMETRY.MIN_POINT_SPACING) {
          s.points.push(pt);
          if (s.pressure) s.pressure.push(se.pressure);
        }
      } else s.points = [s.points[0], pt];
      render();
    } else if (changed) render();
  });
  const end = (ev: PointerEvent) => {
    (el as any)._swipe = false;
    panning = null;
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (d.stroke.points.length === 1 && d.stroke.tool !== 'pen') return render();
    commitStroke(d.capture, d.cand, d.stroke, d.t0, now());
    void ev;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', () => {
    if (!drawing) {
      hover = null;
      $('#hover-chip').textContent = '—';
      $('#hover-chip').className = 'chip dim';
      render();
    }
  });
  el.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const cand = shownCand(p);
      const g = paneGeom(p, cand);
      view = zoomAt(view, { x: ev.offsetX, y: ev.offsetY }, ev.deltaY < 0 ? GEOMETRY.WHEEL_ZOOM_STEP : 1 / GEOMETRY.WHEEL_ZOOM_STEP, g.pane, g.aspect);
      render();
    },
    { passive: false },
  );
}

const sid = () => `s_${DEVICE}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

function commitStroke(capture: string, cand: Candidate, s: Stroke, t0: number, t1: number) {
  const mk = masks.get(capture);
  if (mk) s.hit_ids = mk.strokeHitIds(s).slice(0, 64);
  emit('annotation_delta', cand, { stroke: s, card_id: card().id });
  strokeCapture.set(s.stroke_id, capture);
  undo.push(s.stroke_id);
  if (mk) strokeEv.push({ t_start: t0, t_end: t1, candidate_id: cand.id, targets: mk.strokeTargets(s) });
  render();
}

function eraseAt(p: PaneRef, cand: Candidate, sx: number, sy: number) {
  const capture = capId(card(), cand);
  const strokes = state().strokes.get(capture) ?? [];
  let best: Stroke | null = null, bd = 14;
  for (const s of strokes) {
    const pts = s.points.map((q) => toScreen(p, cand, q));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
      const d = distSeg({ x: sx, y: sy }, a, b);
      if (d < bd) (bd = d), (best = s);
    }
  }
  if (!best) return;
  emit('annotation_undo', cand, { stroke_id: best.stroke_id, undone: true, via: 'eraser' });
  undo.erase(best.stroke_id);
  render();
}
function distSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function doUndo(redo = false) {
  const id = redo ? undo.redo() : undo.undo();
  if (!id) return;
  const capture = strokeCapture.get(id);
  const cand = card().candidates.find((x) => capId(card(), x) === capture) ?? null;
  emit('annotation_undo', cand, { stroke_id: id, undone: !redo });
  render();
}

// ---------------- talk ----------------
function candidateInfos(): CandidateInfo[] {
  const c = card();
  return c.candidates.map((cand) => {
    const mk = masks.get(capId(c, cand));
    return { id: cand.id, aliases: cand.aliases, groups: mk ? [...mk.groups.values()] : [] };
  });
}

function currentFocusLabel(): string | null {
  if (focusOverride) return focusOverride;
  if (draft) return draft.fusion.label;
  if (talk) return liveLabel;
  return null;
}

function updateLiveFocus() {
  const lf = liveFocus(pointer, now());
  if (lf.label !== liveLabel) {
    liveLabel = lf.label;
    if (lf.label && lf.candidate_id) emit('object_focus', candById(lf.candidate_id), { card_id: card().id, candidate_id: lf.candidate_id, label: lf.label, ids: [], source: 'pointer', confidence: 0.5 });
  }
  setFocusChip(liveLabel, talk ? 'pointing' : '');
  render();
}

function setFocusChip(label: string | null, why: string) {
  const ch = $('#focus-chip');
  ch.textContent = label ? `${label}${why ? ` · ${why}` : ''}` : '—';
  ch.className = label ? 'chip' : 'chip dim';
  ch.title = why ? `${why} — click to correct` : 'click to correct';
}

async function startTalk() {
  if (talk) return;
  focusOverride = null;
  const id = `u_${Date.now().toString(36)}`;
  talk = { t0: now(), rec: null, stream: null, chunks: [], partialTimer: 0, id };
  $('#mic').classList.add('live');
  setPill('#mic-pill', '● listening', 'live');
  $('#transcript').innerHTML = '<span class="partial">listening…</span>';
  updateLiveFocus();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    if (!talk || talk.id !== id) return stream.getTracks().forEach((t) => t.stop());
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' });
    talk.stream = stream;
    talk.rec = rec;
    talk.t0 = now(); // word times are relative to the recorder start
    rec.ondataavailable = (e) => e.data.size && talk?.chunks.push(e.data);
    rec.start(500);
    talk.partialTimer = window.setInterval(() => void sendPartial(), 1500);
  } catch (e) {
    setPill('#mic-pill', 'mic denied', 'bad');
    $('#transcript').textContent = 'Microphone unavailable or denied — nothing is recorded. You can still draw, pick and type the note.';
    talk = null;
    $('#mic').classList.remove('live');
  }
}

async function sendPartial() {
  if (!talk?.chunks.length) return;
  const blob = new Blob(talk.chunks, { type: 'audio/webm' });
  const r = await fetch('/api/transcribe?partial=1', { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-ripple': '1' }, body: blob }).then((x) => x.json()).catch(() => null);
  if (!talk || !r || r.skipped || r.error) return;
  $('#transcript').innerHTML = `<span class="partial">${esc(r.text || '…')}</span>`;
  if (r.words?.length) runFusion(r.words, r.text, talk.t0, false);
}

async function stopTalk() {
  if (!talk) return;
  const t = talk;
  talk = null;
  window.clearInterval(t.partialTimer);
  $('#mic').classList.remove('live');
  if (!t.rec) return;
  setPill('#mic-pill', 'transcribing…', 'busy');
  const done = new Promise<void>((res) => (t.rec!.onstop = () => res()));
  t.rec.stop();
  await done;
  t.stream?.getTracks().forEach((x) => x.stop()); // mic closed after every utterance
  const blob = new Blob(t.chunks, { type: 'audio/webm' });
  const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': 'audio/webm', 'x-ripple': '1' }, body: blob }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  setPill('#mic-pill', 'mic off');
  if (r.error) {
    $('#transcript').textContent = `transcription failed: ${r.error}`;
    return;
  }
  finalizeUtterance(t.id, t.t0, r.words ?? [], r.text ?? '');
}

function runFusion(words: WordTiming[], text: string, t0: number, final: boolean): FusionResult {
  const fr = fuse({ t0, words, pointer, strokes: strokeEv, candidates: candidateInfos(), activeCandidate: hover?.cand ?? card().candidates[card().candidates.length - 1].id });
  if (!final) {
    liveLabel = fr.label ?? liveLabel;
    setFocusChip(liveLabel, fr.label ? 'heard + pointing' : 'pointing');
    render();
  }
  void text;
  return fr;
}

function finalizeUtterance(id: string, t0: number, words: WordTiming[], text: string) {
  const fr = runFusion(words, text, t0, true);
  const c = card();
  const cand = candById(fr.candidate_id);
  const rs = restate(text, `${cand?.label ?? '?'} ${c.title.toLowerCase()}`, fr.label, $<HTMLInputElement>('#rule').checked);
  const utt: UtterancePayload = {
    utterance_id: id,
    card_id: c.id,
    candidate_id: fr.candidate_id,
    t0,
    text,
    words,
    focus: fr.label ? { label: fr.label, ids: fr.ids, confidence: fr.confidence, reason: fr.reason } : null,
    restatement: rs.line,
    confirmed: false,
    rule: rs.scope === 'rule',
  };
  draft = { utt, fusion: fr, card: c };
  emit('utterance', cand, utt);
  if (fr.label) emit('object_focus', cand, { card_id: c.id, candidate_id: fr.candidate_id, label: fr.label, ids: fr.ids, source: 'speech', confidence: fr.confidence });
  // transcript with bound words highlighted
  const bound = new Set<number>();
  for (const s of fr.spans) if (s.label === fr.label) for (let i = s.from; i <= s.to; i++) bound.add(i);
  $('#transcript').innerHTML = words.length ? words.map((w, i) => `<span class="w${bound.has(i) ? ' bound' : ''}">${esc(w.w)}</span>`).join(' ') : esc(text || '(no speech heard)');
  setFocusChip(fr.label, fr.label ? `${Math.round(fr.confidence * 100)}% · ${fr.reason}` : '');
  $<HTMLInputElement>('#restatement').value = rs.line;
  buildFixList(fr);
  render();
}

function buildFixList(fr: FusionResult | null) {
  const sel = $<HTMLSelectElement>('#focus-fix');
  const cand = candById(fr?.candidate_id ?? hover?.cand ?? null);
  const mk = cand ? masks.get(capId(card(), cand)) : null;
  const groups = mk ? [...mk.groups.values()].sort((a, b) => b.area - a.area) : [];
  const scored = fr ? Object.entries(fr.scores).sort((a, b) => b[1] - a[1]).map(([l]) => l) : [];
  const order = [...new Set([...scored, ...groups.map((g) => g.label)])].slice(0, 60);
  sel.innerHTML = `<option value="">— correct the object —</option>` + order.map((l) => `<option>${esc(l)}</option>`).join('') + `<option value="__whole">whole image</option>`;
}

function confirmDraft() {
  if (!draft) {
    const line = $<HTMLInputElement>('#restatement').value.trim();
    if (!line) return;
    // typed note without speech
    draft = {
      utt: { utterance_id: `u_${Date.now().toString(36)}`, card_id: card().id, candidate_id: hover?.cand ?? null, t0: now(), text: line, words: [], focus: null, restatement: line, confirmed: false, rule: $<HTMLInputElement>('#rule').checked },
      fusion: { candidate_id: hover?.cand ?? null, label: null, ids: [], confidence: 0, reason: 'typed', spans: [], scores: {} },
      card: card(),
    };
  }
  const d = draft;
  const line = $<HTMLInputElement>('#restatement').value.trim() || d.utt.restatement;
  const utt = { ...d.utt, restatement: line, confirmed: true, rule: $<HTMLInputElement>('#rule').checked || d.utt.rule };
  const cand = candById(utt.candidate_id);
  emit('utterance', cand, utt);
  if (cand && (state().strokes.get(capId(d.card, cand)) ?? []).length) emit('annotation_commit', cand, { card_id: d.card.id, utterance_id: utt.utterance_id });
  const strokes = cand ? (state().strokes.get(capId(d.card, cand)) ?? []).map((s) => ({ stroke_id: s.stroke_id, tool: s.tool, hit_ids: s.hit_ids, n: s.points.length })) : [];
  fetch('/api/notes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ripple': '1' },
    body: JSON.stringify({
      session_id: M.session_id,
      note_id: utt.utterance_id,
      card_id: d.card.id,
      card_title: d.card.title,
      candidate_id: utt.candidate_id,
      candidate_image: cand ? { path: cand.source.path, sha256: cand.source.sha256 } : null,
      object: utt.focus ?? (focusOverride ? { label: focusOverride, source: 'owner_correction' } : null),
      line,
      transcript: utt.text,
      rule: utt.rule,
      strokes,
      pick: state().picks.get(d.card.id) ?? null,
    }),
  })
    .then((r) => r.json())
    .then(() => toast(`Queued for the agent: ${line}`))
    .catch(() => toast('note queue failed (kept in local events)'));
  draft = null;
  focusOverride = null;
  $<HTMLInputElement>('#restatement').value = '';
  $<HTMLInputElement>('#rule').checked = false;
  setFocusChip(null, '');
  render();
}

function discardDraft() {
  draft = null;
  focusOverride = null;
  liveLabel = null;
  $<HTMLInputElement>('#restatement').value = '';
  $('#transcript').textContent = '';
  setFocusChip(null, '');
  render();
}

// ---------------- wiring ----------------
function inField(e: Event) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'checkbox';
}

function wire() {
  document.querySelectorAll<HTMLButtonElement>('#modes [data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      mode = b.dataset.mode as Mode;
      buildPanes();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('#tools [data-tool]').forEach((b) =>
    b.addEventListener('click', () => {
      tool = b.dataset.tool as ToolMode;
      updateModeUi();
    }),
  );
  $('#sel-a').addEventListener('change', (e) => ((abA = Number((e.target as HTMLSelectElement).value)), buildPanes()));
  $('#sel-b').addEventListener('change', (e) => ((abB = Number((e.target as HTMLSelectElement).value)), buildPanes()));
  $('#opacity').addEventListener('input', (e) => ((opacity = Number((e.target as HTMLInputElement).value) / 100), render()));
  $('#reset-zoom').addEventListener('click', () => ((view = { ...IDENTITY_VIEW }), render()));
  $('#undo').addEventListener('click', () => doUndo(false));
  $('#redo').addEventListener('click', () => doUndo(true));
  const mic = $('#mic');
  mic.addEventListener('pointerdown', (e) => (e.preventDefault(), void startTalk()));
  mic.addEventListener('pointerup', () => void stopTalk());
  mic.addEventListener('pointerleave', () => talk && void stopTalk());
  $('#confirm').addEventListener('click', confirmDraft);
  $('#focus-chip').addEventListener('click', () => {
    const s = $<HTMLSelectElement>('#focus-fix');
    if (!s.options.length) buildFixList(draft?.fusion ?? null);
    s.hidden = !s.hidden;
  });
  $('#focus-fix').addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) return;
    focusOverride = v === '__whole' ? null : v;
    const candId = draft?.fusion.candidate_id ?? hover?.cand ?? null;
    const cand = candById(candId);
    const mk = cand ? masks.get(capId(card(), cand)) : null;
    const ids = focusOverride && mk ? mk.groups.get(focusOverride)?.ids ?? [] : [];
    emit('object_focus', cand, { card_id: card().id, candidate_id: candId, label: focusOverride, ids, source: 'owner_correction', confidence: 1 });
    if (draft) {
      draft.utt.focus = focusOverride ? { label: focusOverride, ids, confidence: 1, reason: 'owner corrected' } : null;
      const rs = restate(draft.utt.text, `${cand?.label ?? '?'} ${card().title.toLowerCase()}`, focusOverride, $<HTMLInputElement>('#rule').checked);
      draft.utt.restatement = rs.line;
      $<HTMLInputElement>('#restatement').value = rs.line;
    }
    setFocusChip(focusOverride ?? 'whole image', 'owner corrected');
    (e.target as HTMLSelectElement).hidden = true;
    render();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !inField(e)) {
      e.preventDefault();
      if (!e.repeat) void startTalk();
      return;
    }
    if (e.key === 'Enter' && (e.target as HTMLElement).id !== 'reason') {
      if (draft || $<HTMLInputElement>('#restatement').value.trim()) {
        e.preventDefault();
        confirmDraft();
      }
      return;
    }
    if (e.key === 'Escape') return discardDraft();
    if (inField(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') return e.preventDefault(), doUndo(e.shiftKey);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') return e.preventDefault(), doUndo(true);
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const c = card();
    const byKey = c.candidates.find((x) => x.key === e.key);
    if (byKey) return pick(byKey.id);
    if (e.key === '=') return pick('=');
    const tools: Record<string, ToolMode> = { p: 'pen', a: 'arrow', o: 'ellipse', b: 'box', t: 'text', n: 'pin', e: 'eraser', h: 'pan' };
    const modes: Record<string, Mode> = { g: 'grid', s: 'swipe', v: 'overlay', f: 'flicker', d: 'diff' };
    const k = e.key.toLowerCase();
    if (tools[k]) return (tool = tools[k]), updateModeUi();
    if (modes[k]) return (mode = modes[k]), buildPanes();
    if (e.key === '0') return (view = { ...IDENTITY_VIEW }), render();
    if (e.key === ']') return openCard(Math.min(M.cards.length - 1, cardIdx + 1));
    if (e.key === '[') return openCard(Math.max(0, cardIdx - 1));
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && talk) void stopTalk();
  });
  window.addEventListener('resize', () => render());
  window.setInterval(() => {
    if (mode === 'flicker') {
      flickerOn = !flickerOn;
      renderPaneChrome();
      render();
    }
  }, 600);
}

// ---------------- test hook (headless smoke) ----------------
(window as any).__RIPPLE_TEST__ = {
  ready: () => !!M && card().candidates.every((x) => !x.mask || masks.has(capId(card(), x))) && card().candidates.every((x) => images.get(capId(card(), x))?.complete),
  /** Inject an utterance as if faster-whisper returned these words for a recording that started `msAgo` ms ago. */
  injectUtterance(words: WordTiming[], text: string, msAgo: number) {
    finalizeUtterance(`u_test_${Date.now().toString(36)}`, now() - msAgo, words, text);
    return (window as any).__RIPPLE_TEST__.state();
  },
  state() {
    const st = state();
    return {
      card: card().id,
      mode,
      events: events.length,
      outbox: outbox.length,
      picks: Object.fromEntries([...st.picks].map(([k, v]) => [k, v.pick])),
      strokes: Object.fromEntries([...st.strokes].map(([k, v]) => [k, v.length])),
      hover,
      focus: draft ? { label: draft.fusion.label, candidate: draft.fusion.candidate_id, confidence: draft.fusion.confidence, reason: draft.fusion.reason } : null,
      chip: $('#focus-chip').textContent,
      restatement: $<HTMLInputElement>('#restatement').value,
      groups: Object.fromEntries(card().candidates.map((x) => [x.id, masks.get(capId(card(), x))?.groups.size ?? 0])),
    };
  },
  /** screen point (pane-relative CSS px) of a group's pixel nearest its bbox centre, for driving the mouse */
  locate(candId: string, label: string) {
    const c = card();
    const cand = c.candidates.find((x) => x.id === candId)!;
    const mk = masks.get(capId(c, cand))!;
    const g = mk.groups.get(label);
    if (!g) return null;
    const set = new Set(g.ids);
    const cx = (g.bbox.x0 + g.bbox.x1) / 2, cy = (g.bbox.y0 + g.bbox.y1) / 2;
    let best: Pt | null = null, bd = Infinity;
    for (let y = 0; y < mk.h; y += 2)
      for (let x = 0; x < mk.w; x += 2) {
        if (!set.has(mk.ids[y * mk.w + x])) continue;
        const u = (x + 0.5) / mk.w, v = (y + 0.5) / mk.h;
        const d = (u - cx) ** 2 + (v - cy) ** 2;
        if (d < bd) (bd = d), (best = { x: u, y: v });
      }
    const pane = panes.find((p) => p.cands.includes(cand))!;
    const s = toScreen(pane, cand, best!);
    const r = pane.canvas.getBoundingClientRect();
    return { x: r.left + s.x, y: r.top + s.y, u: best!.x, v: best!.y };
  },
  groupsBySize(candId: string) {
    const c = card();
    const mk = masks.get(capId(c, c.candidates.find((x) => x.id === candId)!));
    return mk ? [...mk.groups.values()].sort((a, b) => b.area - a.area).map((g) => ({ label: g.label, area: g.area, building: g.building, part: g.part })) : [];
  },
  flush: () => flush(),
};

wire();
load().catch((e) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:20px">Failed to load: ${e}</pre>`;
});

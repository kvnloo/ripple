/**
 * Ripple visual-review local server. Loopback only; no outbound network.
 *
 *   bun server/serve.ts --session /abs/session-dir [--port 43251]
 *
 * Session dir (private, outside git): manifest.json, media/, data/ripple.sqlite,
 * data/events.jsonl (export the agent loop reads), agent-queue.jsonl (notes).
 */
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { eventKey, parseEnvelope } from '../src/review/events';
import { bridgeStatus } from './hermes-bridge';

const args = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const SESSION = resolve(arg('--session', process.env.RIPPLE_SESSION ?? '')!);
if (!SESSION || !existsSync(join(SESSION, 'manifest.json'))) {
  console.error(`no manifest.json in session dir ${SESSION}`);
  process.exit(2);
}
const ROOT = resolve(import.meta.dir, '..');
const DATA = join(SESSION, 'data');
mkdirSync(join(DATA, 'tmp'), { recursive: true });
const NO_WHISPER = args.includes('--no-whisper');

// ---------- store ----------
const db = new Database(join(DATA, 'ripple.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS events (
  key TEXT PRIMARY KEY, session_id TEXT, source_device TEXT, generation INTEGER, sequence INTEGER,
  capture_id TEXT, event_type TEXT, action TEXT, timestamp REAL, body TEXT, received_at REAL);
CREATE INDEX IF NOT EXISTS ev_order ON events(session_id, generation, sequence);`);
const insert = db.prepare(
  'INSERT OR IGNORE INTO events (key, session_id, source_device, generation, sequence, capture_id, event_type, action, timestamp, body, received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
);

// ---------- transcription worker ----------
type Pending = { resolve: (v: unknown) => void };
const pending = new Map<string, Pending>();
let worker: ReturnType<typeof spawn> | null = null;
let workerReady = false;
let workerInfo: unknown = null;
function startWorker() {
  if (NO_WHISPER) return;
  // Dedicated STT venv (faster-whisper) by default; RIPPLE_PYTHON overrides. Clean env, offline model cache.
  const py = process.env.RIPPLE_PYTHON || join(process.env.HOME ?? '', '.local/share/ripple/stt-venv/bin/python');
  const env = { HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin', TMPDIR: join(DATA, 'tmp'), HF_HUB_OFFLINE: '1' };
  worker = spawn(py, [join(ROOT, 'server/transcribe_worker.py')], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  worker.on('error', (e) => console.error('whisper worker failed to start', py, e.message));
  const rl = createInterface({ input: worker.stdout! });
  rl.on('line', (line) => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    if (m.ready) {
      workerReady = true;
      workerInfo = m;
      console.log('whisper ready', m.model);
      return;
    }
    const p = pending.get(String(m.id));
    if (p) {
      pending.delete(String(m.id));
      p.resolve(m);
    }
  });
  worker.on('exit', (c) => {
    workerReady = false;
    console.error('whisper worker exited', c);
  });
}
startWorker();
let partialInFlight = false;

function transcribe(path: string): Promise<Record<string, unknown>> {
  return new Promise((res) => {
    if (!worker || !workerReady) return res({ error: 'transcriber not ready' });
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      res({ error: 'timeout' });
    }, 60_000);
    pending.set(id, { resolve: (v) => (clearTimeout(timer), res(v as Record<string, unknown>)) });
    worker.stdin!.write(JSON.stringify({ id, path }) + '\n');
  });
}

// ---------- http ----------
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const CT: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.bin': 'application/octet-stream' };
const ct = (p: string) => CT[p.slice(p.lastIndexOf('.'))] ?? 'application/octet-stream';

function serveFile(base: string, rel: string): Response {
  const p = normalize(join(base, rel));
  if (!p.startsWith(base + '/') || !existsSync(p)) return new Response('not found', { status: 404 });
  return new Response(Bun.file(p), { headers: { 'content-type': ct(p), 'cache-control': 'no-store' } });
}

let PORT = Number(arg('--port', process.env.RIPPLE_PORT ?? '43251'));

function guard(req: Request): Response | null {
  // CSRF / cross-origin guard: loopback pages of this server only.
  if (req.method === 'GET') return null;
  if (req.headers.get('x-ripple') !== '1') return json({ error: 'missing x-ripple header' }, 403);
  const origin = req.headers.get('origin');
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) return json({ error: 'origin' }, 403);
  return null;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const g = guard(req);
  if (g) return g;
  const path = url.pathname;
  if (path === '/' || path === '/index.html') return serveFile(join(ROOT, 'web'), 'index.html');
  if (path.startsWith('/dist/')) return serveFile(join(ROOT, 'web', 'dist'), path.slice(6));
  if (path === '/style.css') return serveFile(join(ROOT, 'web'), 'style.css');
  if (path === '/manifest.json') return serveFile(SESSION, 'manifest.json');
  if (path.startsWith('/media/')) return serveFile(join(SESSION, 'media'), decodeURIComponent(path.slice(7)));
  if (path === '/api/status')
    return json({ whisper: { ready: workerReady, info: workerInfo, disabled: NO_WHISPER }, bridge: bridgeStatus(), session: SESSION, port: PORT });
  if (path === '/api/events' && req.method === 'GET') {
    const rows = db.query('SELECT body FROM events ORDER BY generation, sequence, source_device').all() as { body: string }[];
    return json(rows.map((r) => JSON.parse(r.body)));
  }
  if (path === '/api/events' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as unknown;
    const list = Array.isArray(body) ? body : [body];
    if (list.length > 500) return json({ error: 'batch too large' }, 413);
    let inserted = 0;
    const errors: string[] = [];
    for (const raw of list) {
      const r = parseEnvelope(raw);
      if (!r.ok) {
        errors.push(r.error);
        continue;
      }
      const e = r.event;
      const res = insert.run(eventKey(e), e.session_id, e.source_device, e.generation, e.sequence, e.capture_id, e.event_type, e.action, e.timestamp, JSON.stringify(e), Date.now());
      if (res.changes > 0) {
        inserted++;
        appendFileSync(join(DATA, 'events.jsonl'), JSON.stringify(e) + '\n');
      }
    }
    return json({ inserted, duplicates: list.length - inserted - errors.length, errors });
  }
  if (path === '/api/transcribe' && req.method === 'POST') {
    const partial = url.searchParams.get('partial') === '1';
    if (partial && partialInFlight) return json({ skipped: 'busy' });
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.length === 0 || buf.length > 25 * 1024 * 1024) return json({ error: 'audio size' }, 413);
    const ext = (req.headers.get('content-type') ?? '').includes('wav') ? 'wav' : 'webm';
    const f = join(DATA, 'tmp', `${crypto.randomUUID()}.${ext}`);
    writeFileSync(f, buf);
    if (partial) partialInFlight = true;
    try {
      const out = await transcribe(f);
      return json({ ...out, partial });
    } finally {
      if (partial) partialInFlight = false;
      rmSync(f, { force: true }); // audio is never retained
    }
  }
  if (path === '/api/notes' && req.method === 'POST') {
    const note = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!note || typeof note.line !== 'string') return json({ error: 'note.line required' }, 400);
    const rec = { ...note, queued_at: new Date().toISOString(), bridge: bridgeStatus().mode };
    appendFileSync(join(SESSION, 'agent-queue.jsonl'), JSON.stringify(rec) + '\n');
    return json({ queued: true, bridge: bridgeStatus() });
  }
  if (path === '/api/export.jsonl') {
    const p = join(DATA, 'events.jsonl');
    return new Response(existsSync(p) ? readFileSync(p) : '', { headers: { 'content-type': 'application/x-ndjson' } });
  }
  return new Response('not found', { status: 404 });
}

let server: ReturnType<typeof Bun.serve> | null = null;
for (let i = 0; i < 20 && !server; i++) {
  try {
    server = Bun.serve({ hostname: '127.0.0.1', port: PORT, fetch: handle });
  } catch {
    PORT++;
  }
}
if (!server) {
  console.error('no free port');
  process.exit(3);
}
writeFileSync(join(SESSION, 'URL.txt'), `http://127.0.0.1:${PORT}/\n`);
console.log(`ripple review on http://127.0.0.1:${PORT}/  session=${SESSION}  bridge=${bridgeStatus().mode}`);

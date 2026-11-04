/**
 * Ripple visual-review local server. Loopback only; no outbound network.
 *
 *   bun server/serve.ts --session /abs/session-dir [--port 43251] [--host 100.x.y.z]
 *
 * Loopback by default (no token). `--host <tailnet 100.x address>` is an explicit opt-in for
 * Dash: every data route then needs the session's review token (bearer header, or `?t=` where
 * a header can't be sent), and the server writes DASH-LINK.txt with the artifact-stage link
 * Dash opens in its stage WebView (`http://100.x:port/#t=<token>`).
 *
 * Session dir (private, outside git): manifest.json, media/, data/ripple.sqlite,
 * data/events.jsonl (export the agent loop reads), agent-queue.jsonl (notes),
 * cards/*.html (ephemeral-ui exports the agent sends; shown sandboxed, see src/review/cards.ts).
 */
import { Database } from 'bun:sqlite';
import { spawn } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { CARD_CSP, docTitle, isDocName, LIMITS, withSizeReporter, type CardDoc } from '../src/review/cards';
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
mkdirSync(join(DATA, 'tmp'), { recursive: true }); // uploaded audio only, deleted after each request
mkdirSync(join(DATA, 'worker-tmp'), { recursive: true }); // library scratch of the STT worker
const NO_WHISPER = args.includes('--no-whisper');
const HOST = arg('--host', process.env.RIPPLE_HOST ?? '127.0.0.1')!;
const LOOPBACK = HOST === '127.0.0.1' || HOST === 'localhost';
const TAILNET = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(HOST);
if (!LOOPBACK && !TAILNET) {
  console.error(`refusing to bind ${HOST}: loopback or a tailnet 100.64/10 address only`);
  process.exit(2);
}
// Review token: tailnet mode only. Fresh per server start unless RIPPLE_TOKEN is set; 0600 on disk.
const TOKEN = LOOPBACK ? '' : (process.env.RIPPLE_TOKEN ?? randomBytes(16).toString('hex'));
if (TOKEN && !/^[a-f0-9]{16,64}$/.test(TOKEN)) {
  console.error('RIPPLE_TOKEN must be 16-64 lowercase hex chars (Dash stage links require it)');
  process.exit(2);
}
if (TOKEN) writeFileSync(join(SESSION, '.token'), TOKEN + '\n', { mode: 0o600 });
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Read-only token for one card doc: the frame's URL never carries the review token. */
const cardToken = (doc: string) => (TOKEN ? createHmac('sha256', TOKEN).update('card:' + doc).digest('hex').slice(0, 32) : '');
function authed(req: Request, url: URL): boolean {
  if (!TOKEN) return true;
  const h = req.headers.get('authorization') ?? '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : (url.searchParams.get('t') ?? '');
  return same(t, TOKEN);
}
const CARDS = join(SESSION, 'cards');
mkdirSync(CARDS, { recursive: true });

// ---------- hosted ephemeral-ui cards ----------
const docCache = new Map<string, { mtime: number; size: number; info: CardDoc }>();
function listCards(): CardDoc[] {
  const out: CardDoc[] = [];
  for (const f of readdirSync(CARDS)) {
    if (!isDocName(f)) continue;
    const st = statSync(join(CARDS, f));
    if (!st.isFile() || st.size > LIMITS.html) continue;
    const hit = docCache.get(f);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
      out.push(hit.info);
      continue;
    }
    const buf = readFileSync(join(CARDS, f));
    const info: CardDoc = { doc: f, title: docTitle(buf.subarray(0, 4096).toString('utf8'), f.replace(/\.html$/, '')), bytes: st.size, mtime: Math.round(st.mtimeMs), sha256: createHash('sha256').update(buf).digest('hex') };
    docCache.set(f, { mtime: st.mtimeMs, size: st.size, info });
    out.push(info);
  }
  return out.sort((a, b) => a.mtime - b.mtime || (a.doc < b.doc ? -1 : 1));
}
function serveCard(doc: string): Response {
  if (!isDocName(doc) || !existsSync(join(CARDS, doc))) return new Response('not found', { status: 404 });
  const html = withSizeReporter(readFileSync(join(CARDS, doc), 'utf8'));
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': CARD_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' },
  });
}

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
  const env = { HOME: process.env.HOME ?? '', PATH: '/usr/bin:/bin', TMPDIR: join(DATA, 'worker-tmp'), HF_HUB_OFFLINE: '1' };
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
    }, 120_000);
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
  if (!p.startsWith(base + '/') || !existsSync(p) || /\/\./.test(p.slice(base.length))) return new Response('not found', { status: 404 });
  return new Response(Bun.file(p), { headers: { 'content-type': ct(p), 'cache-control': 'no-store' } });
}

let PORT = Number(arg('--port', process.env.RIPPLE_PORT ?? '43251'));

function guard(req: Request): Response | null {
  // CSRF / cross-origin guard: loopback pages of this server only.
  if (req.method === 'GET') return null;
  if (req.headers.get('x-ripple') !== '1') return json({ error: 'missing x-ripple header' }, 403);
  const origin = req.headers.get('origin');
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin) && origin !== `http://${HOST}:${PORT}`) return json({ error: 'origin' }, 403);
  return null;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const g = guard(req);
  if (g) return g;
  const path = url.pathname;
  if (path === '/' || path === '/index.html') return serveFile(join(ROOT, 'web'), 'index.html');
  if (path.startsWith('/dist/')) return serveFile(join(ROOT, 'web', 'dist'), path.slice(6));
  if (path === '/favicon.ico') return new Response(null, { status: 204 });
  if (path === '/style.css') return serveFile(join(ROOT, 'web'), 'style.css');
  // Card frames authenticate with their own per-doc token (or the review token from a host tool).
  if (path.startsWith('/cards/') && req.method === 'GET') {
    const doc = decodeURIComponent(path.slice(7));
    if (TOKEN && !authed(req, url) && !same(url.searchParams.get('t') ?? '', cardToken(doc))) return json({ error: 'token' }, 401);
    return serveCard(doc);
  }
  // Everything below reads or writes the session: tailnet mode needs the review token.
  if (!authed(req, url)) return json({ error: 'token' }, 401);
  if (path === '/manifest.json') return serveFile(SESSION, 'manifest.json');
  if (path.startsWith('/media/')) return serveFile(join(SESSION, 'media'), decodeURIComponent(path.slice(7)));
  if (path === '/api/status')
    return json({ whisper: { ready: workerReady, info: workerInfo, disabled: NO_WHISPER }, bridge: bridgeStatus(), session: SESSION, port: PORT, host: HOST, token: !!TOKEN });
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
  if (path === '/api/cards' && req.method === 'GET') return json(listCards().map((c) => (TOKEN ? { ...c, t: cardToken(c.doc) } : c)));
  if (path === '/api/cards' && req.method === 'POST') {
    // Agent push over loopback (same guard as every write). Writing a file into cards/ works too.
    const b = (await req.json().catch(() => null)) as { doc?: unknown; html?: unknown } | null;
    if (!b || !isDocName(b.doc) || typeof b.html !== 'string') return json({ error: 'doc (name.html) and html required' }, 400);
    if (Buffer.byteLength(b.html) > LIMITS.html) return json({ error: 'html too large' }, 413);
    const tmp = join(CARDS, `.${b.doc}.${process.pid}.tmp`);
    writeFileSync(tmp, b.html);
    renameSync(tmp, join(CARDS, b.doc));
    return json({ stored: listCards().find((c) => c.doc === b.doc) });
  }
  if (path === '/api/cards' && req.method === 'DELETE') {
    const doc = url.searchParams.get('doc');
    if (!isDocName(doc)) return json({ error: 'doc' }, 400);
    rmSync(join(CARDS, doc), { force: true });
    return json({ removed: doc });
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
    server = Bun.serve({ hostname: HOST, port: PORT, fetch: handle });
  } catch {
    PORT++;
  }
}
if (!server) {
  console.error('no free port');
  process.exit(3);
}
writeFileSync(join(SESSION, 'URL.txt'), `http://${HOST}:${PORT}/\n`);
if (TOKEN) {
  // What Dash opens: paste the link in a chat reply (Dash shows "Open in stage") or send the deep link.
  const link = `http://${HOST}:${PORT}/#t=${TOKEN}`;
  writeFileSync(join(SESSION, 'DASH-LINK.txt'), `${link}\ndash://stage?url=${encodeURIComponent(link)}\n`, { mode: 0o600 });
}
console.log(`ripple review on http://${HOST}:${PORT}/  session=${SESSION}  bridge=${bridgeStatus().mode}${TOKEN ? `  token in ${join(SESSION, '.token')}, Dash link in DASH-LINK.txt` : ''}`);

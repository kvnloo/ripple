#!/usr/bin/env python3
"""Browser proof for ephemeral-ui cards hosted inside Ripple.

Copies a built session's manifest + media (never the owner's data/) into scratch, exports real
kit cards with bin/ripple-cards (the kit's own export-cards.mjs), starts the real server and drives
real Chromium through: drawer opens with the agent's cards -> each export mounts (eui:ready) ->
the frame sizes itself -> a click inside a card becomes a card_intent event + agent-queue line
with the review context -> a forged message from outside a card frame is ignored -> the frame
cannot reach Ripple's API or storage -> a live push appears without reload -> phone width.

  RIPPLE_EUI=<ephemeral-ui checkout> python3 tests/browser/cards.py --session SRC_SESSION --shots DIR
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = ''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


def get(url: str):
    return json.loads(urllib.request.urlopen(url, timeout=5).read())


def post(url: str, body, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={'content-type': 'application/json', **(headers or {})})
    try:
        r = urllib.request.urlopen(req, timeout=10)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', required=True)
    ap.add_argument('--shots', required=True)
    ap.add_argument('--port', default='43311')
    a = ap.parse_args()
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    tmp = Path(os.environ.get('TMPDIR', '/tmp')) / f'ripple-cards-{int(time.time())}'
    tmp.mkdir(parents=True)
    shutil.copy(Path(a.session) / 'manifest.json', tmp / 'manifest.json')
    shutil.copytree(Path(a.session) / 'media', tmp / 'media')
    env = {**os.environ}
    env.pop('RIPPLE_ACE_RUN', None)
    # the agent side: two real exports into the session before the surface opens
    out1 = subprocess.run([str(ROOT / 'bin/ripple-cards'), str(tmp), 'mail', '--cards', 'gmail:inbox,ripple:intent-declare', '--title', 'Agent: which invoice?'], env=env, capture_output=True, text=True)
    check('bin/ripple-cards exports real kit cards into <session>/cards', out1.returncode == 0 and (tmp / 'cards/mail.html').exists(), (out1.stdout or out1.stderr).strip()[-200:])
    subprocess.run(['bun', 'build', 'web/app.ts', '--outdir', 'web/dist', '--target', 'browser', '--minify-whitespace'], cwd=ROOT, check=True, capture_output=True)
    srv = subprocess.Popen(['bun', 'server/serve.ts', '--session', str(tmp), '--port', a.port, '--no-whisper'], cwd=ROOT, stdout=open(tmp / 'server.log', 'w'), stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if (tmp / 'URL.txt').exists():
                break
            time.sleep(0.2)
        base = (tmp / 'URL.txt').read_text().strip()
        for _ in range(50):
            try:
                get(base + 'api/status')
                break
            except Exception:
                time.sleep(0.2)
        listed = get(base + 'api/cards')
        check('GET /api/cards lists the export with title + sha256', len(listed) == 1 and listed[0]['title'] == 'Agent: which invoice?' and len(listed[0]['sha256']) == 64, json.dumps(listed)[:200])
        r = urllib.request.urlopen(base + 'cards/mail.html')
        csp = r.headers.get('content-security-policy', '')
        body = r.read().decode()
        check('served export has no-network CSP + size reporter', "connect-src 'none'" in csp and "default-src 'none'" in csp and 'eui:size' in body, csp[:80])
        for bad in ['cards/..%2Fmanifest.json', 'cards/.x.html']:
            try:
                urllib.request.urlopen(base + bad)
                code = 200
            except urllib.error.HTTPError as e:
                code = e.code
            check(f'path escape refused ({bad})', code == 404, str(code))

        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True, executable_path=os.environ.get('RIPPLE_CHROMIUM') or None)
            ctx = br.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1)
            pg = ctx.new_page()
            errors: list[str] = []
            csp_blocked: list[str] = []  # a card reaching for the network is blocked by design; reported, not failed

            def on_console(m):
                if m.type != 'error':
                    return
                if 'Content Security Policy' in m.text:
                    csp_blocked.append(m.text[:140])
                elif not m.text.startswith('Failed to load resource'):  # covered by the response hook with its URL
                    errors.append('CONSOLE ' + m.text)

            def on_response(r):
                if r.status >= 400:
                    errors.append(f'HTTP {r.status} {r.url}')

            pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
            pg.on('console', on_console)
            pg.on('response', on_response)
            T = 'window.__RIPPLE_TEST__'
            pg.goto(base)
            pg.wait_for_function(f'{T} && {T}.ready()', timeout=30000)
            pg.wait_for_function(f'{T}.cards().length === 1 && {T}.cards()[0].ready', timeout=20000)
            c = pg.evaluate(f'{T}.cards()')[0]
            check('drawer opens with the agent cards; export mounted (eui:ready)', pg.is_visible('#cards') and c['ready'] == {'cards': 2, 'failed': 0}, json.dumps(c))
            pg.wait_for_function(f'{T}.cards()[0].height', timeout=5000)
            h = pg.evaluate(f'{T}.cards()[0].height')
            check('frame reports its own height (opaque origin)', h and int(h.rstrip('px')) > 300, str(h))
            sb = pg.get_attribute('#cards iframe', 'sandbox')
            check('frame is sandbox="allow-scripts" only (no same-origin)', sb == 'allow-scripts', str(sb))
            pg.wait_for_timeout(1200)  # let card play() finish
            pg.screenshot(path=str(shots / '01-drawer-1440.png'))

            # ---- the frame cannot reach Ripple: no API writes, no storage
            fr = pg.frame_locator('#cards iframe').first
            frame = next(f for f in pg.frames if f.url.startswith(base + 'cards/'))
            probe = frame.evaluate("""async () => {
              const out = {};
              try { await fetch('/api/notes', { method: 'POST', headers: { 'content-type': 'application/json', 'x-ripple': '1' }, body: '{"line":"forged"}' }); out.fetch = 'sent'; } catch (e) { out.fetch = 'blocked'; }
              try { localStorage.getItem('ripple.device'); out.storage = 'read'; } catch (e) { out.storage = 'blocked'; }
              try { out.parent = parent.document ? 'readable' : 'none'; } catch (e) { out.parent = 'blocked'; }
              out.origin = self.origin;
              return out;
            }""")
            check('card frame: fetch blocked, storage blocked, parent DOM blocked, opaque origin', probe == {'fetch': 'blocked', 'storage': 'blocked', 'parent': 'blocked', 'origin': 'null'}, json.dumps(probe))

            # ---- an owner click inside a card -> card_intent + queue line with review context
            ev0 = len(get(base + 'api/events'))
            fr.locator('[data-kind="inbox"] ul.inbox li').nth(2).click()
            pg.wait_for_function(f'{T}.cards()[0].intents === 1', timeout=5000)
            pg.evaluate(f'{T}.flush()')
            pg.wait_for_timeout(600)
            evs = [e for e in get(base + 'api/events') if e['event_type'] == 'card_intent']
            e = evs[-1] if evs else {}
            p = e.get('payload', {})
            st = pg.evaluate(f'{T}.state()')
            check('click in card -> stored card_intent (declare, user, authority none)', len(evs) == 1 and e['action'] == 'declare' and e['origin'] == 'user' and p.get('authority') == 'none' and p.get('eui_action') == 'select' and p.get('ids', [''])[0].startswith('message:m'), json.dumps(p)[:260])
            check('card_intent carries the review card it happened on', p.get('card_id') == st['card'] and p.get('doc') == 'mail.html' and len(p.get('doc_sha256') or '') == 64, f"{p.get('card_id')} vs {st['card']}")
            q = [json.loads(l) for l in (tmp / 'agent-queue.jsonl').read_text().splitlines()]
            check('agent-queue.jsonl gets one ephemeral-ui line', len(q) == 1 and q[0]['source'] == 'ephemeral-ui' and q[0]['line'].startswith('card gmail/inbox · select: Use '), q[0]['line'] if q else '-')
            ack = fr.locator('[data-kind="inbox"] .lp-line.agent').count()
            check("card's own handoff strip shows inline (kit loop.js)", ack >= 1, str(ack))
            pg.screenshot(path=str(shots / '02-after-click.png'))

            # ---- forged message from outside any card frame is ignored
            pg.evaluate("""() => window.postMessage({ type: 'eui:intent', detail: { kind: 'inbox', app: 'gmail', action: 'approve', label: 'forged approve', ids: [], entities: {} } }, '*')""")
            pg.wait_for_timeout(800)
            pg.evaluate(f'{T}.flush()')
            pg.wait_for_timeout(300)
            n_ci = len([e for e in get(base + 'api/events') if e['event_type'] == 'card_intent'])
            check('forged top-window message ignored', n_ci == 1 and pg.evaluate(f'{T}.cards()[0].intents') == 1, str(n_ci))
            # server-side: an agent-origin card_intent is refused
            fake = {**e, 'origin': 'agent', 'sequence': e['sequence'] + 1000}
            code, res = post(base + 'api/events', [fake], {'x-ripple': '1'})
            check('server refuses agent-origin card_intent', res.get('inserted') == 0 and 'card_intent origin' in res.get('errors', []), json.dumps(res))
            code, res = post(base + 'api/cards', {'doc': 'x.html', 'html': '<p>x</p>'}, {'x-ripple': '1', 'origin': 'null'})
            check('opaque-origin push to /api/cards refused', code == 403, str(code))

            # ---- live push while open: appears without reload
            out2 = tmp / 'push.html'
            subprocess.run([str(ROOT / 'bin/ripple-cards'), str(tmp), 'tmp-push', '--cards', 'gmail:thread', '--title', 'Agent: reply draft'], env=env, check=True, capture_output=True)
            html = (tmp / 'cards/tmp-push.html').read_text()
            (tmp / 'cards/tmp-push.html').unlink()
            code, res = post(base + 'api/cards', {'doc': 'reply.html', 'html': html}, {'x-ripple': '1'})
            check('POST /api/cards stores a pushed export', code == 200 and res['stored']['doc'] == 'reply.html', json.dumps(res)[:160])
            pg.wait_for_function(f'{T}.cards().length === 2 && {T}.cards()[1].ready', timeout=10000)
            check('pushed cards appear live and mount', pg.evaluate(f'{T}.cards()[1].ready') == {'cards': 1, 'failed': 0}, json.dumps(pg.evaluate(f'{T}.cards()')[1]))
            pg.wait_for_timeout(900)
            pg.screenshot(path=str(shots / '03-live-push.png'))

            # ---- review keys still work with the drawer open; C toggles it
            pg.mouse.click(400, 300)
            pg.keyboard.press('c')
            pg.wait_for_timeout(200)
            closed = not pg.is_visible('#cards')
            pg.keyboard.press('c')
            pg.wait_for_timeout(200)
            check('C toggles the drawer', closed and pg.is_visible('#cards'))
            overflow = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
            check('no horizontal overflow at 1440', overflow <= 0, str(overflow))

            # ---- phone width (Dash WebView)
            pg.set_viewport_size({'width': 412, 'height': 915})
            pg.wait_for_timeout(700)
            box = pg.eval_on_selector('#cards', 'e => { const r = e.getBoundingClientRect(); return [r.left, r.width, innerWidth]; }')
            check('phone: drawer is a full-width overlay', box[0] == 0 and abs(box[1] - box[2]) <= 1, json.dumps(box))
            pg.screenshot(path=str(shots / '04-phone-412.png'))
            btn = pg.eval_on_selector('#cards-btn', 'e => { const r = e.getBoundingClientRect(); return [r.left, r.right, innerWidth]; }')
            pg.click('#cards-close')
            pg.wait_for_timeout(200)
            gone = not pg.is_visible('#cards')
            pg.click('#cards-btn')
            pg.wait_for_timeout(200)
            check('phone: Close and the header cards button both work (no keyboard needed)', gone and pg.is_visible('#cards') and btn[0] >= 0 and btn[1] <= btn[2], json.dumps(btn))

            # dismiss removes the file
            pg.locator('#cards .rc-doc[data-doc="reply.html"] button[title^="Dismiss"]').click()
            pg.wait_for_timeout(500)
            check('dismiss removes the doc file', not (tmp / 'cards/reply.html').exists() and len(pg.evaluate(f'{T}.cards()')) == 1)
            check('no page errors / 4xx / console errors', not errors, '; '.join(errors[:5]))
            print(f'info: {len(csp_blocked)} network reach(es) blocked by the card CSP: ' + ' | '.join(sorted(set(x[:90] for x in csp_blocked))))
            br.close()
    finally:
        srv.terminate()
        srv.wait(5)
    fails = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(fails)}/{len(results)} passed · scratch session {tmp}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()

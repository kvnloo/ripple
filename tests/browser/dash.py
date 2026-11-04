#!/usr/bin/env python3
"""Tailnet / Dash-stage mode proof: `serve.ts --host <tailnet ip>` with a review token.

Starts the real server on the tailnet address against a scratch copy of a session, then checks
the token gate over HTTP and drives Chromium at phone size through the exact link Dash opens
(`http://100.x:port/#t=<token>?channel=dash` as stage-link.forDash builds it): the surface loads,
the token leaves the address bar, card frames get a per-doc token (never the review token),
a card click is stored as card_intent from a `dash-` device, and the mic degrades honestly.

  RIPPLE_EUI=<ephemeral-ui checkout> python3 tests/browser/dash.py --session SRC --host 100.x.y.z --shots DIR
"""
from __future__ import annotations

import argparse
import json
import os
import re
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


def code(url: str, headers=None, method='GET', body=None) -> int:
    req = urllib.request.Request(url, headers=headers or {}, method=method, data=body)
    try:
        return urllib.request.urlopen(req, timeout=5).status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, ConnectionError):
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', required=True)
    ap.add_argument('--host', required=True)
    ap.add_argument('--shots', required=True)
    ap.add_argument('--port', default='43341')
    ap.add_argument('--keep', action='store_true', help='leave the server running for a device check; prints the link')
    a = ap.parse_args()
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    tmp = Path(os.environ.get('TMPDIR', '/tmp')) / f'ripple-dash-{int(time.time())}'
    tmp.mkdir(parents=True)
    shutil.copy(Path(a.session) / 'manifest.json', tmp / 'manifest.json')
    shutil.copytree(Path(a.session) / 'media', tmp / 'media')
    subprocess.run([str(ROOT / 'bin/ripple-cards'), str(tmp), 'mail', '--cards', 'gmail:inbox,ripple:intent-declare', '--title', 'Agent: which invoice?'], check=True, capture_output=True)
    subprocess.run(['bun', 'build', 'web/app.ts', '--outdir', 'web/dist', '--target', 'browser', '--minify-whitespace'], cwd=ROOT, check=True, capture_output=True)
    srv = subprocess.Popen(['bun', 'server/serve.ts', '--session', str(tmp), '--host', a.host, '--port', a.port, '--no-whisper'], cwd=ROOT, stdout=open(tmp / 'server.log', 'w'), stderr=subprocess.STDOUT)
    try:
        for _ in range(100):
            if (tmp / 'DASH-LINK.txt').exists():
                break
            time.sleep(0.2)
        link, deep = (tmp / 'DASH-LINK.txt').read_text().split()
        token = (tmp / '.token').read_text().strip()
        base = link.split('#')[0]
        mode = oct((tmp / '.token').stat().st_mode & 0o777)
        # Dash's own matcher (app/src/lib/stage-link.ts STAGE_RE + isStageUrl)
        stage_ok = re.fullmatch(r'https?://[\w.-]+(?::\d{2,5})?/(?:\?[^\s#)]*)?#t=[a-f0-9]{16,64}', link) and re.match(r'http://100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.', link)
        check("DASH-LINK.txt matches Dash's stage-link matcher (tailnet host + #t=hex)", bool(stage_ok), link.replace(token, '<token>'))
        check('deep link is dash://stage?url=<encoded link>', deep.startswith('dash://stage?url=http%3A%2F%2F100.'), deep[:40] + '…')
        check('.token is 0600', mode == '0o600', mode)
        check('shell is public (/, /dist/app.js)', code(base) == 200 and code(base + 'dist/app.js') == 200)
        no = {p: code(base + p) for p in ['manifest.json', 'api/events', 'api/cards', 'cards/mail.html', 'media/x.jpg', 'api/status']}
        check('every data route is 401 without the token', all(v == 401 for v in no.values()), json.dumps(no))
        check('wrong token is 401', code(base + 'manifest.json', {'authorization': 'Bearer ' + '0' * 32}) == 401)
        check('bearer token reads data', code(base + 'manifest.json', {'authorization': f'Bearer {token}'}) == 200)
        cards = json.loads(urllib.request.urlopen(urllib.request.Request(base + 'api/cards', headers={'authorization': f'Bearer {token}'})).read())
        ct = cards[0].get('t', '')
        check('card docs get their own token (not the review token)', len(ct) == 32 and ct != token)
        check('card token opens only its doc', code(base + f'cards/mail.html?t={ct}') == 200 and code(base + f'manifest.json?t={ct}') == 401)
        check('loopback is not bound in tailnet mode (no unauthenticated side door)', code(f'http://127.0.0.1:{a.port}/manifest.json') == 0)

        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True, executable_path=os.environ.get('RIPPLE_CHROMIUM') or None)
            ua = 'Mozilla/5.0 (Linux; Android 15; SM-S938U; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36'
            ctx = br.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=ua)
            pg = ctx.new_page()
            errors: list[str] = []
            pg.on('pageerror', lambda e: errors.append('PAGEERROR ' + str(e)))
            pg.on('response', lambda r: errors.append(f'HTTP {r.status} {r.url}') if r.status >= 400 else None)
            requested: list[str] = []
            pg.on('request', lambda r: requested.append(r.url))
            # stage-link.forDash: adds ?channel=dash before the fragment
            dash_url = base + '?channel=dash#t=' + token
            T = 'window.__RIPPLE_TEST__'
            pg.goto(dash_url)
            pg.wait_for_function(f'{T} && {T}.ready()', timeout=30000)
            check('surface loads through the Dash stage URL', True)
            check('token removed from the address bar', '#t=' not in pg.url and token not in pg.url, pg.url.replace(token, '<token>'))
            pg.wait_for_function(f'{T}.cards().length === 1 && {T}.cards()[0].ready', timeout=20000)
            check('agent cards mount in the stage (eui:ready)', pg.evaluate(f'{T}.cards()[0].ready') == {'cards': 2, 'failed': 0})
            src = pg.get_attribute('#cards iframe', 'src') or ''
            check('card frame URL carries the per-doc token, not the review token', token not in src and f't={ct}' in src, src.replace(token, '<token>'))
            leaks = [u for u in requested if token in u and '/media/' not in u and '/manifest' not in u]
            check('review token only in URLs that cannot carry headers (images)', not leaks, '; '.join(x.replace(token, '<T>') for x in leaks[:3]))
            pg.wait_for_timeout(1200)
            pg.screenshot(path=str(shots / 'dash-01-cards.png'))
            fr = pg.frame_locator('#cards iframe').first
            fr.locator('[data-kind="inbox"] ul.inbox li').nth(2).tap()
            pg.wait_for_function(f'{T}.cards()[0].intents === 1', timeout=5000)
            pg.evaluate(f'{T}.flush()')
            pg.wait_for_timeout(600)
            evs = json.loads(urllib.request.urlopen(urllib.request.Request(base + 'api/events', headers={'authorization': f'Bearer {token}'})).read())
            ci = [e for e in evs if e['event_type'] == 'card_intent']
            check('tap in a card -> card_intent stored from a dash- device', len(ci) == 1 and ci[0]['source_device'].startswith('dash-'), ci[0]['source_device'] if ci else '-')
            q = (tmp / 'agent-queue.jsonl').read_text().splitlines()
            check('queue line written', len(q) == 1 and json.loads(q[0])['source'] == 'ephemeral-ui')
            pill = pg.text_content('#mic-pill')
            check('mic says it needs https on plain-http tailnet (not a silent failure)', pill == 'mic: needs https', pill)
            pg.click('#cards-close')
            pg.wait_for_timeout(300)
            pg.screenshot(path=str(shots / 'dash-02-review.png'))
            check('no page errors / 4xx', not errors, '; '.join(e.replace(token, '<T>') for e in errors[:5]))
            br.close()
        if a.keep:
            print(f'KEEP server pid {srv.pid} session {tmp}\nLINK_FILE {tmp / "DASH-LINK.txt"}', flush=True)
            fails = [r for r in results if not r[1]]
            print(f'\n{len(results) - len(fails)}/{len(results)} passed')
            os._exit(1 if fails else 0)
    finally:
        if not a.keep:
            srv.terminate()
            srv.wait(5)
    fails = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(fails)}/{len(results)} passed · scratch session {tmp}')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()

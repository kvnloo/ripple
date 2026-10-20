#!/usr/bin/env python3
"""Headless browser smoke for the Ripple visual-review surface.

Copies a built session (manifest + media, NOT the owner's data/) into a scratch
session so test events never touch the owner's store, starts the real server,
and drives real Chromium (Playwright) through: load -> pick -> draw -> hover ->
injected transcript with word timings -> tracked object -> undo/redo -> confirm
note -> real mic path (Chromium fake audio device fed a WAV of real speech)
-> reload persistence -> server dedupe. Screenshots go to --shots.

  python3 tests/browser/smoke.py --session SRC_SESSION --shots DIR [--wav speech.wav]
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = ''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


def wait_url(url: str, timeout=30):
    t = time.time()
    while time.time() - t < timeout:
        try:
            urllib.request.urlopen(url, timeout=2)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', required=True)
    ap.add_argument('--shots', required=True)
    ap.add_argument('--wav', default='')
    ap.add_argument('--port', default='43299')
    a = ap.parse_args()
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    tmp = Path(os.environ.get('TMPDIR', '/tmp')) / f'ripple-smoke-{int(time.time())}'
    tmp.mkdir(parents=True)
    shutil.copy(Path(a.session) / 'manifest.json', tmp / 'manifest.json')
    shutil.copytree(Path(a.session) / 'media', tmp / 'media')
    subprocess.run(['bun', 'build', 'web/app.ts', '--outdir', 'web/dist', '--target', 'browser'], cwd=ROOT, check=True, capture_output=True)
    srv = subprocess.Popen(['bun', 'server/serve.ts', '--session', str(tmp), '--port', a.port], cwd=ROOT,
                           stdout=open(tmp / 'server.log', 'w'), stderr=subprocess.STDOUT)
    url = (tmp / 'URL.txt')
    try:
        for _ in range(100):
            if url.exists():
                break
            time.sleep(0.2)
        base = url.read_text().strip()
        assert wait_url(base + 'api/status'), 'server did not start'
        # wait for whisper
        for _ in range(120):
            st = json.loads(urllib.request.urlopen(base + 'api/status').read())
            if st['whisper']['ready']:
                break
            time.sleep(0.5)
        check('server up on loopback with whisper ready', base.startswith('http://127.0.0.1:') and st['whisper']['ready'], base)
        check('Hermes bridge is OFF (queue file)', st['bridge']['enabled'] is False and st['bridge']['mode'] == 'queue-file')

        args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
        if a.wav:
            args.append(f'--use-file-for-fake-audio-capture={a.wav}')
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True, args=args, executable_path=os.environ.get('RIPPLE_CHROMIUM') or None)
            ctx = br.new_context(viewport={'width': 1680, 'height': 1000}, device_scale_factor=1)
            ctx.grant_permissions(['microphone'], origin=base.rstrip('/'))
            pg = ctx.new_page()
            logs: list[str] = []
            pg.on('console', lambda m: logs.append(m.text))
            pg.on('pageerror', lambda e: logs.append('PAGEERROR ' + str(e)))
            pg.goto(base)
            pg.wait_for_function('window.__RIPPLE_TEST__ && window.__RIPPLE_TEST__.ready()', timeout=30000)
            T = 'window.__RIPPLE_TEST__'
            s0 = pg.evaluate(f'{T}.state()')
            check('page loads arrival card with masks', s0['card'] == 'arrival' and s0['groups'].get('current', 0) > 0, json.dumps(s0['groups']))
            pg.screenshot(path=str(shots / '01-arrival-grid.png'))

            # ---- option selector ----
            pg.keyboard.press('3')
            pg.wait_for_timeout(300)
            s = pg.evaluate(f'{T}.state()')
            check('key 3 picks V2 for arrival (decision_pick)', s['picks'].get('arrival') == 'v2', json.dumps(s['picks']))
            pg.keyboard.press('=')
            pg.wait_for_timeout(200)
            check('= records a tie (latest pick wins)', pg.evaluate(f'{T}.state()')['picks'].get('arrival') == '=')
            pg.keyboard.press('3')

            # ---- aerial card: draw on CURRENT, hover, talk ----
            pg.keyboard.press(']')
            pg.wait_for_function(f'{T}.ready() && {T}.state().card === "aerial"', timeout=20000)
            groups = pg.evaluate(f'{T}.groupsBySize("current")')
            # pick two distinct labelled building groups with real area
            named = [g for g in groups if g['building'] and g['area'] > 400]
            check('CURRENT aerial mask has labelled building groups', len(named) >= 2, ', '.join(g['label'] for g in named[:6]))
            g1 = named[0]
            g2 = next(g for g in named if g['building'] != g1['building'])
            p1 = pg.evaluate(f'{T}.locate("current", {json.dumps(g1["label"])})')
            # draw a circle-ish pen loop around g1's point
            pg.keyboard.press('p')
            import math
            pts = [(p1['x'] + 22 * math.cos(t / 10 * 2 * math.pi), p1['y'] + 14 * math.sin(t / 10 * 2 * math.pi)) for t in range(11)]
            pg.mouse.move(*pts[0])
            pg.mouse.down()
            for x, y in pts[1:]:
                pg.mouse.move(x, y, steps=3)
            pg.mouse.up()
            pg.wait_for_timeout(200)
            s = pg.evaluate(f'{T}.state()')
            check('pen stroke stored on aerial/current', s['strokes'].get('aerial/current') == 1, json.dumps(s['strokes']))
            # hover on g2 for ~1.2 s, then inject "this ..." spoken during the hover
            p2 = pg.evaluate(f'{T}.locate("current", {json.dumps(g2["label"])})')
            for k in range(8):
                pg.mouse.move(p2['x'] + (k % 2), p2['y'], steps=2)
                pg.wait_for_timeout(150)
            hv = pg.evaluate(f'{T}.state()')['hover']
            check('hover reads the object under the pointer from the ID mask', hv and hv['label'] == g2['label'], json.dumps(hv))
            words = [{'w': 'this', 'start': 0.2, 'end': 0.4}, {'w': 'roof', 'start': 0.45, 'end': 0.7}, {'w': 'should', 'start': 0.75, 'end': 0.9},
                     {'w': 'be', 'start': 0.92, 'end': 1.0}, {'w': 'warmer', 'start': 1.02, 'end': 1.3}]
            r = pg.evaluate(f'{T}.injectUtterance({json.dumps(words)}, "this roof should be warmer", 1300)')
            want = g2['label']
            got = (r['focus'] or {}).get('label')
            # "roof" may legitimately refine to the pointed building's roof group
            ok = got == want or (got and g2['building'] and got.startswith(g2['building'] + ' ') and 'roof' in got)
            check('deixis: "this" binds to the hovered object (or its building\'s roof)', bool(ok), f'hovered={want} focus={got} reason={(r["focus"] or {}).get("reason")}')
            check('restatement line produced', r['restatement'].count('/') >= 5, r['restatement'])
            pg.wait_for_timeout(200)
            pg.screenshot(path=str(shots / '02-aerial-deixis-focus.png'))

            # explicit mention of a different building while pointer sits elsewhere
            syn = None
            for g in named:
                if g['building'] != g2['building']:
                    syn = g
                    break
            bw = {'R': 'tennis hall', 'Q': 'racquet hall', 'T': 'team hall', 'M': 'movement', 'A': 'apex', 'C': 'commons', 'W': 'aquatics', 'I': 'ice', 'L': 'greenhouse', 'S': 'operations'}[syn['building']]
            phrase = f"the {bw} {syn['part'] or ''} is too boxy".replace('  ', ' ')
            toks = phrase.split()
            words2 = [{'w': w, 'start': 0.1 + 0.25 * i, 'end': 0.3 + 0.25 * i} for i, w in enumerate(toks)]
            r2 = pg.evaluate(f'{T}.injectUtterance({json.dumps(words2)}, {json.dumps(phrase)}, 2500)')
            got2 = (r2['focus'] or {}).get('label') or ''
            check('mention: naming a building/part tracks that object even while pointing elsewhere', got2.startswith(syn['building'] + ' '), f'said="{phrase}" focus={got2}')
            pg.screenshot(path=str(shots / '03-aerial-mention-focus.png'))

            # candidate binding by speech
            r3 = pg.evaluate(f'{T}.injectUtterance({json.dumps([{"w": "honestly", "start": 0.1, "end": 0.4}, {"w": "the", "start": 0.45, "end": 0.5}, {"w": "old", "start": 0.55, "end": 0.7}, {"w": "one", "start": 0.72, "end": 0.9}, {"w": "was", "start": 0.95, "end": 1.1}, {"w": "bolder", "start": 1.15, "end": 1.5}])}, "honestly the old one was bolder", 1600)')
            check('speech binds the candidate ("the old one" -> OLD)', (r3['focus'] or {}).get('candidate') == 'old', json.dumps(r3['focus']))
            pg.keyboard.press('Escape')

            # ---- undo / redo ----
            pg.keyboard.press('Control+z')
            pg.wait_for_timeout(150)
            u = pg.evaluate(f'{T}.state()')['strokes'].get('aerial/current', 0)
            pg.keyboard.press('Control+Shift+z')
            pg.wait_for_timeout(150)
            rdo = pg.evaluate(f'{T}.state()')['strokes'].get('aerial/current', 0)
            check('undo hides the stroke, redo restores it', u == 0 and rdo == 1, f'after undo={u} after redo={rdo}')

            # ---- confirm a note -> agent queue ----
            pg.evaluate(f'{T}.injectUtterance({json.dumps(words)}, "this roof should be warmer", 1300)')
            pg.keyboard.press('Enter')
            pg.wait_for_timeout(600)
            q = tmp / 'agent-queue.jsonl'
            lines = q.read_text().strip().splitlines() if q.exists() else []
            check('Enter confirms -> structured note queued for the agent', len(lines) == 1 and json.loads(lines[0])['line'], lines[0][:220] if lines else 'none')

            # ---- compare modes ----
            for key, name in (('s', 'swipe'), ('v', 'overlay'), ('d', 'diff'), ('f', 'flicker')):
                pg.keyboard.press(key)
                pg.wait_for_timeout(400)
                check(f'mode {name}', pg.evaluate(f'{T}.state()')['mode'] == name)
                if name in ('swipe', 'diff'):
                    pg.screenshot(path=str(shots / f'04-aerial-{name}.png'))
            pg.keyboard.press('g')

            # ---- real mic path (fake device fed with real speech) ----
            if a.wav:
                p3 = pg.evaluate(f'{T}.locate("current", {json.dumps(g1["label"])})')
                pg.mouse.move(p3['x'], p3['y'])
                pg.keyboard.down('Space')
                for k in range(26):
                    pg.mouse.move(p3['x'] + (k % 3), p3['y'], steps=1)
                    pg.wait_for_timeout(150)
                pg.keyboard.up('Space')
                try:
                    pg.wait_for_function('document.querySelector("#restatement").value.length > 0 || /failed|denied|unavailable/.test(document.querySelector("#transcript").textContent)', timeout=60000)
                except Exception as ex:
                    print('mic path timeout:', pg.inner_text('#transcript'), pg.inner_text('#mic-pill'), logs[-8:], str(ex)[:120])
                tr = pg.inner_text('#transcript')
                s = pg.evaluate(f'{T}.state()')
                check('real audio via MediaRecorder -> local faster-whisper transcript', len(tr.strip()) > 3 and not any(x in tr for x in ('failed', 'denied', 'unavailable')), tr[:160])
                check('real-audio utterance tracked an object (pointer + "this"/"that")', bool(s['focus'] and s['focus']['label']), json.dumps(s['focus']))
                pg.screenshot(path=str(shots / '05-real-audio-utterance.png'))
                pg.keyboard.press('Escape')

            pg.evaluate(f'{T}.flush()')
            pg.wait_for_timeout(800)
            n_before = pg.evaluate(f'{T}.state()')['events']
            pg.reload()
            pg.wait_for_function(f'{T} && {T}.ready()', timeout=30000)
            s = pg.evaluate(f'{T}.state()')
            check('reload replays the local store (picks + strokes persist)', s['picks'].get('arrival') == 'v2' and s['strokes'].get('aerial/current') == 1 and s['events'] >= n_before - 2,
                  f"events={s['events']} picks={s['picks']} strokes={s['strokes']}")
            # V2 arrival: point at the biosphere dome and talk about it
            pg.keyboard.press('[')
            pg.wait_for_function(f'{T}.ready() && {T}.state().card === "arrival"', timeout=20000)
            v2g = pg.evaluate(f'{T}.groupsBySize("v2")')
            dome = next((g for g in v2g if 'dome' in g['label']), None)
            if dome:
                pd = pg.evaluate(f'{T}.locate("v2", {json.dumps(dome["label"])})')
                for k in range(8):
                    pg.mouse.move(pd['x'] + (k % 2), pd['y'], steps=2)
                    pg.wait_for_timeout(120)
                wd = [{'w': w, 'start': 0.15 + 0.3 * i, 'end': 0.4 + 0.3 * i} for i, w in enumerate('these domes should be bigger and greener'.split())]
                rd = pg.evaluate(f'{T}.injectUtterance({json.dumps(wd)}, "these domes should be bigger and greener", 2400)')
                check('V2 arrival: pointing + "these domes" tracks the biosphere dome', (rd['focus'] or {}).get('label') == dome['label'] and (rd['focus'] or {}).get('candidate') == 'v2', json.dumps(rd['focus']))
                pg.wait_for_timeout(200)
                pg.screenshot(path=str(shots / '06-arrival-v2-dome-focus.png'))
                pg.keyboard.press('Escape')
            errs = [l for l in logs if 'PAGEERROR' in l]
            check('no page errors', not errs, '; '.join(errs)[:300])
            br.close()

        # ---- server dedupe / validation ----
        db = sqlite3.connect(tmp / 'data' / 'ripple.sqlite')
        rows = db.execute('SELECT body FROM events ORDER BY generation, sequence LIMIT 3').fetchall()
        batch = [json.loads(r[0]) for r in rows]
        req = urllib.request.Request(base + 'api/events', data=json.dumps(batch).encode(), headers={'content-type': 'application/json', 'x-ripple': '1'})
        res = json.loads(urllib.request.urlopen(req).read())
        check('re-posting stored events is idempotent', res['inserted'] == 0 and res['duplicates'] == len(batch), json.dumps(res))
        bad = urllib.request.Request(base + 'api/events', data=b'{}', headers={'content-type': 'application/json'})
        try:
            urllib.request.urlopen(bad)
            check('POST without x-ripple header is refused', False)
        except urllib.error.HTTPError as e:
            check('POST without x-ripple header is refused', e.code == 403)
        types = dict(db.execute('SELECT event_type, count(*) FROM events GROUP BY event_type').fetchall())
        check('event types stored', all(t in types for t in ('capture_open', 'annotation_delta', 'annotation_undo', 'decision_pick', 'utterance', 'object_focus')), json.dumps(types))
        tmpfiles = [p for p in (tmp / 'data').rglob('*') if p.suffix in ('.webm', '.wav', '.ogg', '.mp4', '.opus')]
        check('no audio retained on disk after transcription', not tmpfiles, str(tmpfiles[:3]))
    finally:
        srv.send_signal(signal.SIGTERM)
        try:
            srv.wait(5)
        except Exception:
            srv.kill()
    passed = sum(1 for _, ok, _ in results if ok)
    summary = {'passed': passed, 'total': len(results), 'session_copy': str(tmp), 'results': [{'name': n, 'ok': ok, 'detail': d} for n, ok, d in results]}
    (shots / 'smoke-results.json').write_text(json.dumps(summary, indent=1))
    print(f'{passed}/{len(results)} passed')
    sys.exit(0 if passed == len(results) else 1)


if __name__ == '__main__':
    main()

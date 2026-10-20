#!/usr/bin/env python3
"""Build a Ripple review session manifest for ACE render review from real files.

Pointer-per-request (Quackles HITL lineage): every run re-resolves the newest
candidate files on disk and stamps each with path, mtime, sha256 and round, so a
stale image can never masquerade as current. Writes (outside git):

  <session>/manifest.json
  <session>/media/<card>-<cand>.jpg        preview (<=1600 px wide)
  <session>/media/<card>-<cand>.ids.bin    uint32 LE object ids (when a mask exists)

Usage: build_ace_manifest.py --session DIR --run ACE_RUN_DIR --idmask DIR --labels ace_idmask_labels.py
(or env RIPPLE_ACE_RUN / RIPPLE_IDMASK / RIPPLE_LABELS)
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import time
from pathlib import Path

import numpy as np
from PIL import Image

# Paths are private and come from the caller (CLI flags or env), never from git.
RUN = ARCH = FINALS = OLD = Path('.')

ALIASES = {
    'old': ['old', 'old one', 'original', 'single building', 'the old building', 'first one', 'option one', 'option 1', 'before'],
    'current': ['current', 'current one', 'existing', 'current campus', 'second one', 'option two', 'option 2', 'the boxes', 'middle one'],
    'v2': ['v2', 'v 2', 'version two', 'new one', 'new version', 'new design', 'third one', 'option three', 'option 3', 'the domes'],
    'v2alt': ['other aerial', 'alternate', 'alternative', 'fourth one', 'option four', 'option 4'],
}


def newest(pattern_dir: Path, name: str) -> Path | None:
    hits = sorted(pattern_dir.glob(f'**/{name}'), key=lambda p: p.stat().st_mtime)
    return hits[-1] if hits else None


def stamp(p: Path, round_: str) -> dict:
    st = p.stat()
    return {
        'path': str(p),
        'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
        'mtime': time.strftime('%m-%d %H:%M', time.localtime(st.st_mtime)),
        'mtime_epoch': int(st.st_mtime),
        'round': round_,
    }


def preview(src: Path, dst: Path, max_w: int = 1600) -> tuple[int, int]:
    im = Image.open(src).convert('RGB')
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    im.save(dst, quality=90)
    return im.size


def load_labeler(path: Path):
    spec = importlib.util.spec_from_file_location('ace_idmask_labels', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def edge_agreement(ids: np.ndarray, image: Path) -> float | None:
    """Mean image gradient on mask boundaries / mean gradient everywhere.
    ~1 = mask unrelated to the pixels; >1.5 = boundaries sit on image edges."""
    h, w = ids.shape
    g = np.asarray(Image.open(image).convert('L').resize((w, h), Image.BILINEAR), dtype=np.float32)
    gx = np.abs(np.diff(g, axis=1))[:-1, :]
    gy = np.abs(np.diff(g, axis=0))[:, :-1]
    grad = gx + gy
    b = (ids[:-1, :-1] != ids[:-1, 1:]) | (ids[:-1, :-1] != ids[1:, :-1])
    if b.sum() < 50:
        return None
    return round(float(grad[b].mean() / max(1e-6, grad.mean())), 2)


def mask_for(idmask: Path, variant: str, camera: str, labeler, image: Path, dst: Path) -> dict | None:
    d = idmask / variant
    leg_p = d / 'legend.json'
    ids_p = d / f'{camera}.ids.bin'
    if not leg_p.exists() or not ids_p.exists():
        return None
    legend = json.loads(leg_p.read_text())
    cam = next((c for c in legend['cameras'] if c['camera'] == camera), None)
    if not cam:
        return None
    w, h = cam['w'], cam['h']
    src_dtype = '<u4' if 'uint32' in str(cam.get('encoding', '')) else '<u2'
    ids = np.frombuffer(ids_p.read_bytes(), dtype=src_dtype).reshape(h, w)
    present, counts = np.unique(ids, return_counts=True)
    by_id = {o['id']: o for o in legend['objects']}
    entries = []
    for i, n in zip(present.tolist(), counts.tolist()):
        if i == 0 or i not in by_id:
            continue
        r = labeler.label_record({k: by_id[i].get(k) for k in ('id', 'object', 'type', 'collections', 'materials', 'center')})
        entries.append({k: r.get(k) for k in ('id', 'object', 'label', 'building', 'part', 'synonyms', 'building_synonyms', 'part_synonyms')} | {'area': n})
    dst.write_bytes(ids.astype('<u4').tobytes())  # served as uint32 LE
    return {
        'file': f'media/{dst.name}',
        'w': w,
        'h': h,
        'sha256': hashlib.sha256(dst.read_bytes()).hexdigest(),
        'legend': entries,
        'alignment': edge_agreement(ids, image),
        'provenance': {
            'variant': legend.get('variant'),
            'source_note': legend.get('source_note'),
            'camera': camera,
            'legend_sha256': hashlib.sha256(leg_p.read_bytes()).hexdigest()[:16],
            'nonint_frac': cam.get('nonint_frac'),
            'renderer': 'Blender Cycles 1 spp object-index emission pass (render_idmask.py)',
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--session', required=True)
    ap.add_argument('--run', default=os.environ.get('RIPPLE_ACE_RUN'), help='ACE build-out run dir (review/img, wave2/...)')
    ap.add_argument('--idmask', default=os.environ.get('RIPPLE_IDMASK'), help='dir with <variant>/legend.json + <CAM>.ids.bin')
    ap.add_argument('--labels', default=os.environ.get('RIPPLE_LABELS'), help='path to ace_idmask_labels.py (ACE twin repo)')
    a = ap.parse_args()
    if not (a.run and a.idmask and a.labels):
        ap.error('--run, --idmask and --labels (or RIPPLE_ACE_RUN / RIPPLE_IDMASK / RIPPLE_LABELS) are required')
    global RUN, ARCH, FINALS, OLD
    RUN = Path(a.run)
    ARCH, FINALS, OLD = RUN / 'wave2/architecture-v2', RUN / 'wave2/campus-exterior/finals', RUN / 'review/img'
    S = Path(a.session)
    (S / 'media').mkdir(parents=True, exist_ok=True)
    labeler = load_labeler(Path(a.labels))
    idm = Path(a.idmask)

    v2_arrival = newest(ARCH, 'CAM_Campus_Arrival.png')
    v2_aerial = newest(ARCH, 'CAM_Campus_Aerial.png')
    v2_aerial_alt = newest(ARCH, 'CAM_Campus_Aerial_v2.png')
    cur_arrival = sorted(FINALS.glob('*_ace_campus_arrival_h10.png'))[-1]
    cur_aerial = sorted(FINALS.glob('*_ace_campus_aerial_h10.png'))[-1]
    lane_round = lambda p: f'arch-v2 {p.parent.name} (lane preview, VISION)'  # noqa: E731

    spec = [
        dict(id='arrival', title='Arrival', question='Arrival: OLD single building vs CURRENT campus vs V2 — which direction for the arrival?',
             note='Cameras differ: OLD is CAM_Hero_Exterior from the stacked-building era; CURRENT is CAM_Campus_Arrival (128 spp final); '
                  'V2 moved CAM_Campus_Arrival to face the domes (lane preview, low spp). Use side by side; overlay/difference compare framing only.',
             cands=[
                 ('old', '1', 'OLD', 'OLD single building · hero exterior', OLD / 'CAM_Hero_Exterior_after.jpg', 'review/img after (stacked building)', None),
                 ('current', '2', 'CURRENT', 'CURRENT campus · arrival final', cur_arrival, 'campus-exterior final 128 spp', ('current', 'CAM_Campus_Arrival')),
                 ('v2', '3', 'V2', 'V2 architecture · arrival', v2_arrival, lane_round(v2_arrival) if v2_arrival else '', ('v2', 'CAM_Campus_Arrival')),
             ]),
        dict(id='aerial', title='Aerial', question='Aerial: OLD vs CURRENT vs V2 — which campus massing and roofscape?',
             note='CURRENT and V2 share CAM_Campus_Aerial, so overlay / flicker / difference between 2 and 3 are pixel-meaningful. '
                  '4 is V2 from its own new aerial camera.',
             cands=[
                 ('old', '1', 'OLD', 'OLD single building · hero aerial', OLD / 'CAM_Hero_Aerial_after.jpg', 'review/img after (stacked building)', None),
                 ('current', '2', 'CURRENT', 'CURRENT campus · aerial final', cur_aerial, 'campus-exterior final 128 spp', ('current', 'CAM_Campus_Aerial')),
                 ('v2', '3', 'V2', 'V2 architecture · aerial', v2_aerial, lane_round(v2_aerial) if v2_aerial else '', ('v2', 'CAM_Campus_Aerial')),
                 ('v2alt', '4', 'V2 ALT', 'V2 · new aerial camera', v2_aerial_alt, lane_round(v2_aerial_alt) if v2_aerial_alt else '', ('v2', 'CAM_Campus_Aerial_v2')),
             ]),
    ]
    cards = []
    for c in spec:
        cands = []
        for cid, key, label, title, src, round_, mk in c['cands']:
            if not src or not Path(src).exists():
                continue
            src = Path(src)
            dst = S / 'media' / f"{c['id']}-{cid}.jpg"
            w, h = preview(src, dst)
            mask = mask_for(idm, mk[0], mk[1], labeler, src, S / 'media' / f"{c['id']}-{cid}.ids.bin") if mk else None
            cands.append(dict(id=cid, key=key, label=label, title=title, image=f'media/{dst.name}', w=w, h=h,
                              source=stamp(src, round_), aliases=ALIASES[cid], mask=mask))
        cards.append(dict(id=c['id'], title=c['title'], question=c['question'], note=c['note'], candidates=cands))
    manifest = dict(schema='ripple.review.manifest/v1', session_id='ace-arch-v2-review-20261020',
                    title='ACE architecture v2 · old vs new', built=time.strftime('%Y-%m-%d %H:%M:%S'),
                    builder='ripple tools/ace/build_ace_manifest.py', cards=cards)
    (S / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    for c in cards:
        for x in c['candidates']:
            m = x['mask']
            print(f"{c['id']:8s} {x['label']:8s} {x['source']['mtime']} {x['source']['sha256'][:10]} {x['source']['round']:40s} "
                  f"mask={'none' if not m else str(len(m['legend'])) + ' objs, align ' + str(m['alignment'])}")


if __name__ == '__main__':
    main()

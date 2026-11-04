# Visual review intent surface

Ripple's first visual slice: a still-image review surface where the owner **picks** between candidate renders, **draws** on them and **talks**, and the surface keeps track of **which scene object** is being talked about. Built for ACE render review (architecture v2: old vs new); generic over any image + optional object-ID mask.

Credit: the interaction ideas (talk + point + ink on one clock; "this" means what is under the mark; text carries meaning, images stay visual) come from Kit Langton's [Scrawl](https://github.com/kitlangton/scrawl) ([demo post](https://x.com/kitlangton/status/2111955962781384846), MIT). No Scrawl code is used. Source evidence and the REA-derived spec live with the session artifacts, not in git.

## Run

```bash
bin/ripple-review /abs/session-dir          # builds the ACE manifest, bundles, serves 127.0.0.1:43251 (next free port)
bin/ripple-review /abs/session-dir --no-whisper   # without local speech-to-text
```

Private paths (ACE run dir, ID-mask dir, labeler) come from `<session>/../ripple.env` (`RIPPLE_ACE_RUN`, `RIPPLE_IDMASK`, `RIPPLE_LABELS`), never from git. Speech-to-text runs in `~/.local/share/ripple/stt-venv` (`uv venv -p /usr/bin/python3 ~/.local/share/ripple/stt-venv && uv pip install -p ~/.local/share/ripple/stt-venv/bin/python faster-whisper==1.2.1 av==18.1.0`; PyAV 19 breaks faster-whisper 1.2.1's decoder) or `RIPPLE_PYTHON`.

`bin/ripple-review` runs `tools/ace/build_ace_manifest.py` (fresh pointers, sha256/mtime stamps, ID masks), `bun build web/app.ts`, then `bun server/serve.ts`. The session dir is private: `manifest.json`, `media/`, `data/ripple.sqlite`, `data/events.jsonl`, `agent-queue.jsonl`. Nothing from it belongs in git.

## Controls

| Key / gesture | Action |
|---|---|
| 1 2 3 4 · = | pick candidate · tie (`decision_pick`, Ripple action `gate`) |
| hold Space or 🎙 | talk; release to transcribe locally (faster-whisper small.en); audio deleted after |
| Enter · Esc | confirm restatement (queues a note for the agent) · discard |
| P A O B T N E H | pen, arrow, circle, box, text, pin, eraser, pan |
| Ctrl+Z · Ctrl+Shift+Z | undo · redo (`annotation_undo {undone}`) |
| G S V F D | side by side, swipe, overlay, flicker, difference (synced zoom) |
| wheel · Alt-drag · 0 | zoom · pan · reset |
| [ ] | previous / next card |
| S Pen | tip draws with pressure; eraser end or barrel button erases |

## Layers

- `src/review/geometry.ts` — source-normalized coords, explicit crop/rotate/flip transform, zoom/pan; pinned numbers.
- `src/review/events.ts` — wire envelope (issue #2 contract + `decision_pick`, `utterance`, `object_focus`), boundary parser (`unknown` in), sequencer.
- `src/review/store.ts` — pure replay: dedupe, total order, undo/redo, gated agent suggestions.
- `src/review/mask.ts` — object-ID mask lookups, legend groups, what a stroke marks (underline → above, circle → enclosed, arrow → tip).
- `src/review/fusion.ts` — speech → object binding (mentions, deixis at word time, pointer dwell, strokes, candidate aliases).
- `src/review/restate.ts` — one structured line per note.
- `src/review/stylus.ts` — pointer/S-Pen event contract (`hover down move up erase`).
- `src/review/cards.ts` — hosted ephemeral-ui cards: frame message parser, `card_intent` payload, queue line, served-document CSP.
- `web/` — desktop surface (vanilla TS, no framework); `server/` — Bun loopback server, SQLite store, faster-whisper worker, Hermes bridge (OFF).

The core in `src/review` has no DOM or React dependency so a React Native `IntentSurface` child can reuse it in Dash.

## Agent cards (ephemeral-ui inside Ripple)

The agent can put interactive [ephemeral-ui](https://kvnloo.github.io/ephemeral-ui/) cards beside the review: a question with options, an inbox pick, an intent declaration. They open in a drawer on the right (phone: a full-screen overlay; header **▦ cards** button or `C`).

```bash
# real kit cards, exported by the kit's own tools/export-cards.mjs (RIPPLE_EUI = kit checkout, env or ../ripple.env)
bin/ripple-cards /abs/session-dir mail --cards gmail:inbox,ripple:intent-declare --title "Which invoice?"
bin/ripple-cards /abs/session-dir picks --playlist 'https://kvnloo.github.io/ephemeral-ui/#pl=…'
bin/ripple-cards /abs/session-dir mine --file cards.html          # an export you built yourself
bin/ripple-cards /abs/session-dir --rm mail
# or push over loopback: POST /api/cards {doc:"name.html", html} with header x-ripple: 1
```

The open surface polls `GET /api/cards` every 3 s: a new or replaced document appears without a reload and the header pill turns yellow if the drawer is closed.

What happens when the owner acts inside a card:

1. The kit card mirrors `eui:intent` (`{kind, app, action, label, ids:["type:id"…], entities}`) to its parent frame (kit `loop.js`).
2. Ripple accepts it only from a frame it created (`event.source`), parses it at the boundary (`src/review/cards.ts`), and adds the review context it happened in: review card, candidate under the pointer or picked, focused object.
3. It records a `card_intent` event (action `declare`) in the store and appends one line to `agent-queue.jsonl` (`source: "ephemeral-ui"`, e.g. `card gmail/inbox · select: Use "Invoice 4471" [message:m4471] · on Arrival/new (dome roof)`), next to spoken notes.

Isolation: each document runs in `iframe sandbox="allow-scripts"` (opaque origin: no cookies, storage or parent DOM) and is served with a no-network CSP (`connect-src 'none'`, no remote styles/fonts/images). A card cannot call Ripple's API (the write guard refuses `Origin: null`). `card_intent` payloads always carry `authority: "none"`; the server refuses agent-origin or approving ones. A card's Approve/Pay/Sign button is context for the agent, never an approval. Ripple appends a small script to each served export that reports its height, because the parent cannot measure an opaque-origin frame.

Limits: the inline "Agent: …" reply line under a card is the card's own scripted acknowledgement (kit `tell(ack)`), not a reply from the real agent; the real agent sees the queue line. Card intents don't feed back into speech fusion yet.

## Object-ID masks

A candidate may ship `ids.bin` (uint32 LE, row-major, top-down; 0 = background) rendered from the same camera, plus a legend `{id, object, label, building, part, building_synonyms, part_synonyms, area}`. For ACE these come from `gfx/blender/scripts/render_idmask.py` in the (private) ACE twin repo: a Cycles 1 spp emission pass whose R channel is the object pass index (EXR float, exact). Images without a mask still work; the surface says "no ID mask (speech only)" and never invents objects.

## Mounting in Dash

Dash (kvnloo/dash) is Expo Go: no native modules, so this slice mounts as a **WebView route** pointing at the loopback server through the Dash bridge's tailnet address, e.g. a `review` screen that opens `http://<laptop-tailnet-ip>:43251/` once the bridge forwards it with the Dash token. Until that forward exists (it needs the bridge's auth, kvnloo/.files#26 pairing), use the desktop browser. The React Native `IntentSurface` mount described in README stays the chat/composer path; visual review is a sibling surface fed by the same events.

## Agent side

Confirmed notes append one JSON line to `<session>/agent-queue.jsonl` (`line`, `object`, `candidate_image.sha256`, `strokes[].hit_ids`, `pick`). The Hermes `/v1/responses` bridge (`server/hermes-bridge.ts`) is designed but **off**: it needs the owner to approve `API_SERVER_ENABLED` in Hermes.

## Tests

```bash
bun test src                                    # unit: transforms, events, replay, masks, fusion, restatement
python3 tests/browser/smoke.py --session DIR --shots OUT [--wav speech.wav]   # real Chromium + real server
RIPPLE_EUI=<kit> python3 tests/browser/cards.py --session DIR --shots OUT       # hosted ephemeral-ui cards
```

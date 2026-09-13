# Ripple

**Gloss:** Ephemeral Intent Surface.

The object Dash mounts: one contextually aware interaction whose job is to get **declared intent** out of a person quickly. S-Pen is an input, not the product.

AODL ([kvnloo/aodl](https://github.com/kvnloo/aodl)) owns the language and the intent/participation contract. Ripple owns the interaction. It consumes AODL as data (declared text, visual ids, harness catalog ids). It does not own HOTL schema or `tests/validate.py`.

## Why this exists

A ChatGPT thread proposed an ephemeral intent surface: a live projection of unresolved intent that disappears as context arrives, with multimodal input (type, draw, talk). Kevin course-corrected: that UI does **not** belong in AODL. AODL stays IR. Dash is the phone. **Ripple** is the object in between.

It is not:

- a 16-topology gallery
- spinning orbs / OpenAvatar
- a catalog of $\mathcal{O}_t$
- a scheduler
- `aodl-ui` (former working name)

## First-class export

```ts
import { Ripple } from "@kvnloo/ripple";

<KeyboardDock>
  <Ripple harnessId="omp" docked onDeclare={(doc) => send(doc.declared)}>
    <Composer onSend={onSend} />
  </Ripple>
</KeyboardDock>
```

Dash (`kvnloo/dash`) imports `@kvnloo/ripple` and mounts `Ripple` on the chat/composer path — the main human↔AI interaction — not Orchestra.

## Zoom language

One node. Three depths, same object:

| Level | What you see |
|---|---|
| unit | Large declared-intent unit (the sentence) |
| pattern | Dots and wires **inside** that node |
| node | Still a node (not a new orb, not a silhouette picker) |

Visual topology ids (`solo`, `mesh`, …) are opaque data from AODL `encodings/visual.json`. They are not a picker in this UI.

## S-Pen (Galaxy S25 Ultra)

Input. Typed events: `hover` · `down` · `move` · `up` · `erase` · `handwriting`. Actions Ripple can record: `annotation` · `gate` · `declare`.

Finger + IME still work. Samsung Keyboard handwriting-to-text still lands in the host `TextInput`.

Expo Go cannot see `MotionEvent.TOOL_TYPE_STYLUS`. The JS contract is closed; web/debug uses Pointer Events. Native gap: [docs/s-pen.md](docs/s-pen.md).

## Keyboard

Ripple does **not** dock itself. On the S25, Expo Go ignores `softwareKeyboardLayoutMode: resize`. Host in Dash `KeyboardDock`. Do not add `paddingBottom: insets.bottom` here.

## Develop

```bash
bun test src
```

Workers never merge `main`.

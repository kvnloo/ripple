# aodl-ui — notes for agents

This repository is the **human↔AI intent surface**. Dash mounts the export. AODL stays language + intent contract.

## Own

- One interaction object: `IntentSurface`. Capture **declared intent** fast.
- S-Pen / pointer event contract (`hover` `down` `move` `up` `erase` `handwriting`) with a web/debug fallback.
- Zoom language: large unit → pattern (dots/wires) → the node stays a node. Not more orbs. Not a 16-topology gallery.
- Consume AODL as **data**: intent document fields, `visualId` from `encodings/visual.json`, harness ids from `harnesses/catalog.json`.

## Do not

- HOTL schema, `tests/validate.py`, EBNF, KaTeX catalog, or language formalization. That is [kvnloo/aodl](https://github.com/kvnloo/aodl).
- OpenAvatar, spinning orbs as product, Timebound / Orchestra galleries.
- Native modules outside the Expo SDK. Dash must stay Expo Go. S-Pen native APIs are a documented gap + optional future config plugin, not a dependency here.
- A second scheduler, Keel port, or payment executor.
- Merge `main`. Workers open PRs.

## Export Dash mounts

```ts
import { IntentSurface } from "@kvnloo/aodl-ui";
```

`IntentSurface` is the first-class object. Pretotype state may be in-memory. The component is the product.

Peer deps: `react`, `react-native` only. No Reanimated in this package (Dash docks it in `KeyboardDock` and owns Reanimated 4). Transforms/opacity only if you add motion later. No `GOLD_GLOW`. No `entering=` on list rows.

## Proof

```bash
bun test src
```

Pin geometry numbers in `src/geometry.ts`. Stylus parsers take `unknown` at the boundary.

## Device (Dash)

Galaxy S25 Ultra, Android 15 edge-to-edge. `softwareKeyboardLayoutMode: resize` does not lift the UI. Host must put this surface in `KeyboardDock` / `KeyboardStickyView`. Do not ship `paddingBottom: insets.bottom` here and assume resize.

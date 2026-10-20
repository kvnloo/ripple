# Fast controls

The small questions an agent puts in front of the owner while it works: pick one of a few options,
set a number, confirm or decline, pick one of several candidate artifacts. One JSON shape
(`src/fast-controls/schema.ts`) that every surface renders natively, and one interaction model
(`state.ts`) every renderer drives, so a number key, a click or a spoken "the second one" gives the
same declared intent on a phone, in the browser and in a terminal.

```ts
type FastControl =
  | { id; kind: 'choice'; prompt; options: { id; label; detail? }[]; multiple? }
  | { id; kind: 'slider'; prompt; min; max; step?; value?; unit? }
  | { id; kind: 'confirm'; prompt; confirmLabel?; cancelLabel?; detail? }
  | { id; kind: 'candidates'; prompt; candidates: { id; label; detail?; artifactVersion? }[] }

interface Intent { controlId; value: string | number | boolean | string[]; label?; artifactVersion?; surface? }
```

2 to 8 options, ids `[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}`, bounded text. Anything else is refused,
never repaired, so a model cannot put markup or script into a native surface.

## The interaction model

`step(state, input, surface)` takes what a renderer saw and returns the next state, plus an outcome
once the owner answered (`{kind: 'answer', intent}`) or put the control away (`{kind: 'dismiss'}`).

| Input | choice / candidates | multiple choice | slider | confirm |
| --- | --- | --- | --- | --- |
| `1`…`9` | answers that row | toggles that row | | 1 confirms, 2 declines |
| ↑ ↓ ← → | move (wraps) | move | ± one step | move |
| PgUp PgDn · Home End | · first/last | · first/last | ± ten steps · min/max | |
| Enter | answers the highlighted row | answers the checked rows (the highlighted one if none) | answers the value | answers the highlighted button |
| Space | | toggles the highlighted row | | |
| `y` / `n` | | | | confirm / decline |
| Esc | put away | put away | put away | put away |
| pointer pick | answers | toggles | | answers |
| pointer set | | | snaps to a step | |
| transcript | the one row it names (number, ordinal, label or id); ambiguous is ignored | | the first number | yes / no words |

`src/fast-controls/vectors.json` holds conformance cases for parsing, answering and answer text. Every
port runs them: this package's `bun test`, z0bridge's TypeScript parser, and hermes-tern's Python
tool and Tern renderer.

## Surfaces

| Surface | Renderer | Answer goes back as |
| --- | --- | --- |
| Dash (React Native) | `IntentSurface` (Expo Go) | `Intent` to z0bridge `POST /intent` |
| Web review | `web/` | `Intent` to the local store |
| Tern | hermes-tern's `ask_control` tool and sheet, over the Tern Surface Protocol | `intentText()` as the owner's next chat message |

### Tern

hermes-tern vendors this directory unchanged (`frontend/src/vendor/ripple/`) and draws a control as
a bottom sheet in Tern's own components: the option list, a meter for a slider, buttons for a
confirm. Keys are the table above; a click on a row or button answers. The answer is sent through
the shared Hermes gateway as the owner's next message (`Picked "SQLite" for: … (db = sqlite)`), so it
lands in the session's history like anything the owner types.

Tern's Surface Protocol reports clicks and named actions on nodes, not pointer positions, drags or
strokes. Ink and spatial pick (drawing on an image, circling an object) are therefore not
available in Tern; they stay on the Dash and web surfaces. A slider in Tern moves by keys and by its
−/+ buttons.

Voice: the interaction model takes a transcript (`{kind: 'say', text}`). The Tern store exposes `hear(text)` for the open control; dictation can call it once the composer has a microphone. It is not wired to one yet.

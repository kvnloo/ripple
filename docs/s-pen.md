# S-Pen on Galaxy S25 Ultra

Dash’s phone is a **Samsung Galaxy S25 Ultra**, Android 15 edge-to-edge, Expo Go (`host.exp.exponent`).

## Implemented in this package (JS)

Closed event contract (`src/stylus.ts`):

| `phase` | Meaning |
|---|---|
| `hover` | Pen in range, not writing |
| `down` | Contact start (pen or finger) |
| `move` | Contact move |
| `up` | Contact end |
| `erase` | Eraser end / erase mode stroke |
| `handwriting` | Stroke classified as writing, not a gate/declare flick |

Actions the intent object may attach: `annotation`, `gate`, `declare`.

`stylusEventFromUnknown` parses pointer/touch payloads (`unknown` at the boundary). Web/debug maps Pointer Events (`pointerType: "pen"`). Finger still emits `pointerType: "touch"`. IME is owned by the host `TextInput` (Composer). The stylus layer is the **intent strip only**, so it does not steal the keyboard.

Erase without hardware: the strip has an erase control that tags the next stroke `erase`.

Samsung Keyboard handwriting-to-text already becomes typed characters in Expo Go. That path is **IME**, not a native S-Pen SDK. Treat those characters as declared intent via the composer.

## Documented native gap (not shipped)

Expo Go cannot read:

- `android.view.MotionEvent.TOOL_TYPE_STYLUS` / `TOOL_TYPE_ERASER`
- hover distance / tilt / button id for the S-Pen side button
- Samsung `SpenEvent` / Remote S-Pen APIs
- HOVER_MOVE while Expo Go’s view does not forward hover

Do **not** add a native module that takes Dash out of Expo Go.

Later (optional): an Expo config plugin in a **dev client** that forwards those fields into the same `IntentStylusEvent` shape. The JS contract stays frozen. Until then, `EXPO_GO_STYLUS_NATIVE` is `false` and `debugFallback` on web (Dash debug on 8099) is the proof surface.

## Keyboard (host)

`softwareKeyboardLayoutMode: resize` does not lift the UI on this device. Dash must wrap `Ripple` in `KeyboardDock` (`KeyboardStickyView`). This package never sets `paddingBottom: insets.bottom` as a substitute.

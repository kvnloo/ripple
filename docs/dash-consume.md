# How Dash consumes Ripple

`Ripple` is the first-class object (ephemeral intent surface). Mount it on the **chat/composer** path, not Orchestra / Bots.

```tsx
import { Ripple } from "@kvnloo/ripple";

<KeyboardDock>
  <Ripple
    harnessId={harnessId}
    docked
    debugFallback={Platform.OS === "web"}
    onDeclare={(doc, stylus) => sendChat({ text: doc.declared, intent: toIntentWire(doc, stylus) })}
  >
    <Composer ... />
  </Ripple>
</KeyboardDock>
```

## Package install (Expo Go)

From `app/`:

```bash
bunx expo install @kvnloo/ripple
```

If the package is not on npm yet, `file:vendor/ripple` or `github:kvnloo/ripple#<sha>`. Still run the install from `app/`. Never hand-edit `package.json`. No native modules.

Metro must compile the TypeScript source (this package ships `src/*.ts`, not a prebuild). Add `vendor/ripple` (or `node_modules/@kvnloo/ripple`) to `watchFolders`.

## Protocol

`shared/protocol.ts` may carry an optional `intent` object on `chat`. Old clients omit it. This package does not import the Dash protocol (dependency-free both ways). Use `toIntentWire` to build the payload.

Streaming tokens stay in Dash `app/src/store/text.ts`.

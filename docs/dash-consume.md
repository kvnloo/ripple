# How Dash consumes this package

`IntentSurface` is the first-class object. Mount it on the **chat/composer** path, not Orchestra / Bots.

```tsx
import { IntentSurface } from "@kvnloo/aodl-ui";

<KeyboardDock>
  <IntentSurface
    harnessId={harnessId}
    docked
    debugFallback={Platform.OS === "web"}
    onDeclare={(doc, stylus) => sendChat({ text: doc.declared, intent: toIntentWire(doc, stylus) })}
  >
    <Composer ... />
  </IntentSurface>
</KeyboardDock>
```

## Package install (Expo Go)

From `app/`:

```bash
bunx expo install @kvnloo/aodl-ui
```

If the package is not on npm yet, `file:vendor/aodl-ui` or `github:kvnloo/aodl-ui#<sha>`. Still run the install from `app/`. Never hand-edit `package.json`. No native modules.

Metro must compile the TypeScript source (this package ships `src/*.ts`, not a prebuild). Add `vendor/aodl-ui` (or `node_modules/@kvnloo/aodl-ui`) to `watchFolders`.

## Protocol

`shared/protocol.ts` may carry an optional `intent` object on `chat`. Old clients omit it. This package does not import the Dash protocol (dependency-free both ways). Use `toIntentWire` to build the payload.

Streaming tokens stay in Dash `app/src/store/text.ts`.

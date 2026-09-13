import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("IntentSurface source contract", () => {
  test("exports IntentSurface as the Dash-mounted object", () => {
    const index = read("src/index.ts");
    expect(index).toContain("export { IntentSurface }");
    expect(index).not.toContain("Orchestra");
    expect(index).not.toContain("OpenAvatar");
  });

  test("pins node geometry and zoom language inside one node", () => {
    const src = read("src/IntentSurface.tsx");
    expect(src).toContain("INTENT_NODE_SIZE");
    expect(src).toContain("INTENT_STRIP_HEIGHT");
    expect(src).toContain("INTENT_PATTERN_DOT");
    expect(src).toContain("INTENT_WIRE_WIDTH");
    expect(src).toContain("transform: [{ scale }]");
    expect(src).not.toContain("GOLD_GLOW");
    expect(src).not.toContain("entering=");
    expect(src).not.toContain("react-native-reanimated");
    expect(src).not.toMatch(/paddingBottom:\s*insets\.bottom/);
    expect(src).toContain("KeyboardDock");
    expect(src).toContain('accessibilityLabel="S-Pen erase"');
    expect(src).toContain("StylusCapture");
  });

  test("stylus layer does not wrap children so IME/finger still own Composer", () => {
    const src = read("src/IntentSurface.tsx");
    const stylusAt = src.indexOf("<StylusCapture");
    const childrenAt = src.indexOf("{children}");
    expect(stylusAt).toBeGreaterThan(0);
    expect(childrenAt).toBeGreaterThan(stylusAt);
    const capture = read("src/StylusCapture.tsx");
    expect(capture).toContain("onHoverIn");
    expect(capture).toContain("onResponderGrant");
    expect(capture).not.toContain("expo-");
  });

  test("repo does not own HOTL or a validator", () => {
    const names = readdirSync(root);
    expect(names).not.toContain("schema");
    expect(names).not.toContain("tests");
    const agents = read("AGENTS.md");
    expect(agents).toContain("Do not");
    expect(agents).toContain("HOTL");
    expect(agents).toContain("Expo Go");
    expect(read("package.json")).toContain('"name": "@kvnloo/aodl-ui"');
    expect(read("package.json")).not.toContain("react-native-reanimated");
  });
});

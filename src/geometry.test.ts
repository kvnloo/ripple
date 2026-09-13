import { describe, expect, test } from "bun:test";
import {
  INTENT_CHIP_HEIGHT,
  INTENT_CHIP_MAX,
  INTENT_NODE_SIZE,
  INTENT_PATTERN_DOT,
  INTENT_PATTERN_DOTS,
  INTENT_STRIP_HEIGHT,
  INTENT_WIRE_HEIGHT,
  INTENT_WIRE_WIDTH,
  OWNS_KEYBOARD_DOCK,
} from "./geometry";

describe("geometry", () => {
  test("pins the composer-path strip so it stays a node, not a gallery", () => {
    expect(INTENT_NODE_SIZE).toBe(36);
    expect(INTENT_STRIP_HEIGHT).toBe(52);
    expect(INTENT_PATTERN_DOT).toBe(4);
    expect(INTENT_PATTERN_DOTS).toBe(4);
    expect(INTENT_WIRE_WIDTH).toBe(10);
    expect(INTENT_WIRE_HEIGHT).toBe(1);
    expect(INTENT_CHIP_HEIGHT).toBe(28);
    expect(INTENT_CHIP_MAX).toBe(2);
    expect(OWNS_KEYBOARD_DOCK).toBe(false);
  });
});

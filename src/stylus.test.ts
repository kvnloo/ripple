import { describe, expect, test } from "bun:test";
import { EXPO_GO_STYLUS_NATIVE, classifyStroke, parseStylusEvent, stylusEventFromUnknown, toIntentWire } from "./stylus";

describe("stylus contract", () => {
  test("Expo Go has no native S-Pen module", () => {
    expect(EXPO_GO_STYLUS_NATIVE).toBe(false);
  });

  test("parses pointer payloads including pen hover and eraser bit", () => {
    const hover = stylusEventFromUnknown("hover", { pointerType: "pen", locationX: 10, locationY: 4 }, 1);
    expect(hover).toEqual({
      phase: "hover",
      pointerType: "pen",
      x: 10,
      y: 4,
      t: 1,
    });
    const erase = stylusEventFromUnknown("move", { pointerType: "pen", x: 1, y: 2, buttons: 32 }, 2);
    expect(erase?.phase).toBe("erase");
    const finger = stylusEventFromUnknown("down", { pointerType: "touch", pageX: 3, pageY: 4 }, 3);
    expect(finger?.pointerType).toBe("touch");
    expect(stylusEventFromUnknown("down", { pointerType: "pen" }, 4)).toBeNull();
  });

  test("rejects unknown phases at the boundary", () => {
    expect(parseStylusEvent({ phase: "swirl", x: 1, y: 1, t: 1 })).toBeNull();
    expect(parseStylusEvent({ phase: "down", x: 1, y: 1, t: 1, pointerType: "pen" })).toEqual({
      phase: "down",
      pointerType: "pen",
      x: 1,
      y: 1,
      t: 1,
    });
  });

  test("classifies flick-up as declare, check as gate, dense stroke as handwriting", () => {
    expect(classifyStroke([{ x: 0, y: 80 }, { x: 2, y: 20 }])).toBe("declare");
    expect(
      classifyStroke([
        { x: 0, y: 10 },
        { x: 8, y: 28 },
        { x: 16, y: 50 },
        { x: 28, y: 24 },
        { x: 40, y: 8 },
      ]),
    ).toBe("gate");
    const dense = [];
    for (let i = 0; i < 12; i++) dense.push({ x: i, y: 10 + (i % 3) });
    expect(classifyStroke(dense)).toBe("handwriting");
    expect(classifyStroke([{ x: 0, y: 0 }])).toBe("annotation");
  });

  test("wire payload stays tiny", () => {
    expect(
      toIntentWire("Ship it", "solo", "omp", [
        { phase: "down", pointerType: "pen", x: 0, y: 0, t: 1 },
        { phase: "up", pointerType: "pen", x: 1, y: 1, t: 2 },
      ]),
    ).toEqual({ declared: "Ship it", visualId: "solo", harnessId: "omp", stylusCount: 2 });
  });
});

import { describe, expect, test } from "bun:test";
import { INTENT_CHIP_MAX } from "./geometry";
import { createIntentSession, sessionCycleZoom, sessionDeclare, sessionRecord, sessionResolve } from "./pretotype";

describe("in-memory pretotype", () => {
  test("starts with one unresolved question and records stylus", () => {
    const s = createIntentSession();
    expect(s.document.unresolved.length).toBe(1);
    expect(s.document.unresolved.length).toBeLessThanOrEqual(INTENT_CHIP_MAX);
    const recorded = sessionRecord(s, { phase: "hover", pointerType: "pen", x: 1, y: 1, t: 1 });
    expect(recorded.stylus).toHaveLength(1);
    const declared = sessionDeclare(recorded, "Ship the intent surface on chat");
    expect(declared.document.unresolved).toEqual([]);
    expect(sessionResolve(s, "outcome").document.unresolved).toEqual([]);
  });

  test("zoom stays on the same session object kind", () => {
    const z = sessionCycleZoom(createIntentSession());
    expect(z.zoom).toBe(1);
  });
});

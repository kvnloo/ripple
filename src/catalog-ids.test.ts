import { describe, expect, test } from "bun:test";
import { AODL_HARNESS_IDS, AODL_VISUAL_IDS, isAodlHarnessId, isAodlVisualId } from "./catalog-ids";

describe("catalog ids", () => {
  test("knows Dash harness ids as data, not as a scheduler", () => {
    expect(AODL_HARNESS_IDS).toEqual(["hermes", "omp", "o8", "grok", "codex", "claude", "pi", "fx"]);
    expect(isAodlHarnessId("omp")).toBe(true);
    expect(isAodlHarnessId("langchain")).toBe(false);
  });

  test("visual ids are opaque and include unknown — not a 16-picker UI", () => {
    expect(AODL_VISUAL_IDS.length).toBe(16);
    expect(isAodlVisualId("solo")).toBe(true);
    expect(isAodlVisualId("orb")).toBe(false);
  });
});

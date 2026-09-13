import { describe, expect, test } from "bun:test";
import { parseIntentDocument, questionsFor, resolveQuestion, withDeclared } from "./document";

describe("intent document", () => {
  test("ignores HOTL schema fields and unknown visual ids", () => {
    const doc = parseIntentDocument({
      specVersion: "0.2",
      intentGraph: { nodes: [] },
      declared: "Ship the intent surface",
      visualId: "mesh",
      harnessId: "omp",
      openQuestions: [{ id: "nope" }],
    });
    expect(doc).toEqual({
      declared: "Ship the intent surface",
      visualId: "mesh",
      harnessId: "omp",
      unresolved: [],
    });
    expect("specVersion" in doc).toBe(false);
  });

  test("drops unknown harness and visual ids instead of inferring", () => {
    const doc = parseIntentDocument({ declared: "x", visualId: "orb", harnessId: "langchain" });
    expect(doc.visualId).toBeUndefined();
    expect(doc.harnessId).toBeUndefined();
  });

  test("asks only when the declaration is too thin", () => {
    expect(questionsFor("").length).toBe(1);
    expect(questionsFor("fix it").length).toBe(1);
    expect(questionsFor("Ship the intent surface on chat").length).toBe(0);
  });

  test("resolved chips disappear", () => {
    const next = resolveQuestion(withDeclared({ declared: "", unresolved: [] }, "hi"), "outcome");
    expect(next.unresolved).toEqual([]);
  });
});

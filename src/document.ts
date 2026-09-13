import { isAodlHarnessId, isAodlVisualId, type AodlHarnessId, type AodlVisualId } from "./catalog-ids";

export type QuestionWhy = "specification" | "knowledge" | "observability" | "capability";

export type UnresolvedQuestion = {
  id: string;
  text: string;
  why: QuestionWhy;
};

export type IntentDocument = {
  declared: string;
  visualId?: AodlVisualId;
  harnessId?: AodlHarnessId;
  unresolved: UnresolvedQuestion[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asQuestionWhy(value: unknown): QuestionWhy | undefined {
  if (value === "specification" || value === "knowledge" || value === "observability" || value === "capability") {
    return value;
  }
  return undefined;
}

function parseQuestion(value: unknown): UnresolvedQuestion | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") return undefined;
  const why = asQuestionWhy(value.why);
  if (!why) return undefined;
  return { id: value.id, text: value.text, why };
}

/**
 * Consume a UI-side intent document. Ignores HOTL fields (`specVersion`,
 * `intentGraph`, …). Unknown visual/harness ids are dropped, not inferred.
 */
export function parseIntentDocument(raw: unknown): IntentDocument {
  if (!isRecord(raw)) {
    return { declared: "", unresolved: [] };
  }
  const declared = typeof raw.declared === "string" ? raw.declared : "";
  const visualId = typeof raw.visualId === "string" && isAodlVisualId(raw.visualId) ? raw.visualId : undefined;
  const harnessId = typeof raw.harnessId === "string" && isAodlHarnessId(raw.harnessId) ? raw.harnessId : undefined;
  const unresolved: UnresolvedQuestion[] = [];
  if (Array.isArray(raw.unresolved)) {
    for (const item of raw.unresolved) {
      const q = parseQuestion(item);
      if (q) unresolved.push(q);
    }
  }
  return { declared, visualId, harnessId, unresolved };
}

export function questionsFor(declared: string): UnresolvedQuestion[] {
  const trimmed = declared.trim();
  if (trimmed.length === 0) {
    return [{ id: "outcome", text: "What would make this done?", why: "specification" }];
  }
  if (trimmed.length < 24) {
    return [{ id: "outcome", text: "What would make this done?", why: "specification" }];
  }
  return [];
}

export function withDeclared(doc: IntentDocument, declared: string): IntentDocument {
  return {
    declared,
    visualId: doc.visualId,
    harnessId: doc.harnessId,
    unresolved: questionsFor(declared),
  };
}

export function resolveQuestion(doc: IntentDocument, id: string): IntentDocument {
  return {
    declared: doc.declared,
    visualId: doc.visualId,
    harnessId: doc.harnessId,
    unresolved: doc.unresolved.filter((q) => q.id !== id),
  };
}

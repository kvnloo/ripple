import { INTENT_CHIP_MAX } from "./geometry";
import {
  parseIntentDocument,
  questionsFor,
  resolveQuestion,
  withDeclared,
  type IntentDocument,
} from "./document";
import type { IntentStylusEvent } from "./stylus";
import { ZOOM_UNIT, nextZoom, type ZoomLevel } from "./zoom";

export type IntentSession = {
  document: IntentDocument;
  stylus: IntentStylusEvent[];
  zoom: ZoomLevel;
  eraseMode: boolean;
};

export function createIntentSession(raw?: unknown): IntentSession {
  const parsed = parseIntentDocument(raw ?? {});
  const unresolved = parsed.unresolved.length > 0 ? parsed.unresolved : questionsFor(parsed.declared);
  return {
    document: {
      declared: parsed.declared,
      visualId: parsed.visualId,
      harnessId: parsed.harnessId,
      unresolved: unresolved.slice(0, INTENT_CHIP_MAX),
    },
    stylus: [],
    zoom: ZOOM_UNIT,
    eraseMode: false,
  };
}

export function sessionDeclare(session: IntentSession, declared: string): IntentSession {
  const document = withDeclared(session.document, declared);
  return {
    document: {
      declared: document.declared,
      visualId: document.visualId,
      harnessId: document.harnessId,
      unresolved: document.unresolved.slice(0, INTENT_CHIP_MAX),
    },
    stylus: session.stylus,
    zoom: session.zoom,
    eraseMode: session.eraseMode,
  };
}

export function sessionRecord(session: IntentSession, event: IntentStylusEvent): IntentSession {
  return {
    document: session.document,
    stylus: [...session.stylus, event],
    zoom: session.zoom,
    eraseMode: session.eraseMode,
  };
}

export function sessionResolve(session: IntentSession, questionId: string): IntentSession {
  return {
    document: resolveQuestion(session.document, questionId),
    stylus: session.stylus,
    zoom: session.zoom,
    eraseMode: session.eraseMode,
  };
}

export function sessionCycleZoom(session: IntentSession): IntentSession {
  return {
    document: session.document,
    stylus: session.stylus,
    zoom: nextZoom(session.zoom),
    eraseMode: session.eraseMode,
  };
}

export function sessionSetErase(session: IntentSession, eraseMode: boolean): IntentSession {
  return {
    document: session.document,
    stylus: session.stylus,
    zoom: session.zoom,
    eraseMode,
  };
}

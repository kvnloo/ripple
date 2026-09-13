/** Dash mounts this inside KeyboardDock. Do not pad the Android safe-area bottom. */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  INTENT_CHIP_HEIGHT,
  INTENT_NODE_SIZE,
  INTENT_PATTERN_DOT,
  INTENT_PATTERN_DOTS,
  INTENT_STRIP_HEIGHT,
  INTENT_WIRE_HEIGHT,
  INTENT_WIRE_WIDTH,
} from "./geometry";
import type { IntentDocument } from "./document";
import {
  createIntentSession,
  sessionCycleZoom,
  sessionDeclare,
  sessionRecord,
  sessionResolve,
  sessionSetErase,
  type IntentSession,
} from "./pretotype";
import { StylusCapture } from "./StylusCapture";
import {
  classifyStroke,
  toHandwriting,
  toIntentWire,
  withAction,
  type IntentStylusEvent,
  type IntentWire,
  type StrokePoint,
} from "./stylus";
import { surfaceColors } from "./tokens";
import { ZOOM_NODE, ZOOM_PATTERN, zoomLabel } from "./zoom";

export type IntentSurfaceHandle = {
  snapshot(): { document: IntentDocument; stylus: IntentStylusEvent[]; wire: IntentWire };
};

export type IntentSurfaceProps = {
  harnessId?: string;
  visualId?: string;
  docked?: boolean;
  disabled?: boolean;
  debugFallback?: boolean;
  initialDeclared?: string;
  children?: ReactNode;
  onDeclare?(document: IntentDocument, stylus: IntentStylusEvent[]): void;
  onStylus?(event: IntentStylusEvent): void;
  surfaceRef?: { current: IntentSurfaceHandle | null };
};

export function IntentSurface({
  harnessId,
  visualId,
  docked = false,
  disabled = false,
  debugFallback = false,
  initialDeclared = "",
  children,
  onDeclare,
  onStylus,
  surfaceRef,
}: IntentSurfaceProps) {
  const [session, setSession] = useState<IntentSession>(() =>
    createIntentSession({ declared: initialDeclared, harnessId, visualId }),
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const stroke = useRef<StrokePoint[]>([]);

  const snapshot = useCallback(() => {
    const current = sessionRef.current;
    return {
      document: current.document,
      stylus: current.stylus,
      wire: toIntentWire(
        current.document.declared,
        current.document.visualId,
        current.document.harnessId,
        current.stylus,
      ),
    };
  }, []);

  useEffect(() => {
    if (!surfaceRef) return;
    surfaceRef.current = { snapshot };
    return () => {
      surfaceRef.current = null;
    };
  }, [snapshot, surfaceRef]);

  const onEvent = useCallback(
    (event: IntentStylusEvent) => {
      if (disabled) return;
      if (event.phase === "down") {
        stroke.current = [{ x: event.x, y: event.y }];
        setSession((s) => sessionRecord(s, event));
        onStylus?.(event);
        return;
      }
      if (event.phase === "hover") {
        setSession((s) => sessionRecord(s, event));
        onStylus?.(event);
        return;
      }
      if (event.phase === "move" || event.phase === "erase") {
        stroke.current.push({ x: event.x, y: event.y });
        setSession((s) => sessionRecord(s, event));
        onStylus?.(event);
        return;
      }
      if (event.phase !== "up") return;
      const kind = classifyStroke(stroke.current);
      stroke.current = [];
      const finished =
        kind === "handwriting"
          ? toHandwriting(event)
          : withAction(event, kind === "gate" || kind === "declare" ? kind : "annotation");
      const recorded = sessionRecord(sessionRef.current, finished);
      setSession(recorded);
      onStylus?.(finished);
      if (kind === "declare" && recorded.document.declared.trim().length > 0) {
        onDeclare?.(recorded.document, recorded.stylus);
      }
    },
    [disabled, onDeclare, onStylus],
  );

  const cycleZoom = useCallback(() => {
    setSession(sessionCycleZoom);
  }, []);

  const toggleErase = useCallback(() => {
    setSession((s) => sessionSetErase(s, !s.eraseMode));
  }, []);

  const dismiss = useCallback((id: string) => {
    setSession((s) => sessionResolve(s, id));
  }, []);

  const chips = session.document.unresolved;
  const label = zoomLabel(session.zoom);
  const preview = session.document.declared.trim().length > 0 ? session.document.declared : "Declare intent";

  return (
    <View style={[styles.root, docked ? styles.docked : null]} testID="aodl-intent-surface" accessibilityLabel="Intent surface">
      {chips.length > 0 ? (
        <View style={styles.chips} accessibilityLabel="Unresolved intent">
          {chips.map((q) => (
            <Pressable
              key={q.id}
              onPress={() => dismiss(q.id)}
              style={styles.chip}
              accessibilityRole="button"
              accessibilityLabel={`Resolve ${q.text}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {q.text}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.strip}>
        <Pressable
          onPress={cycleZoom}
          style={styles.nodeHit}
          accessibilityRole="button"
          accessibilityLabel={`Intent node ${label}`}
        >
          <IntentNode zoom={session.zoom} />
        </Pressable>
        <View style={styles.previewWrap}>
          <Text style={styles.preview} numberOfLines={2}>
            {preview}
          </Text>
          {debugFallback ? <Text style={styles.debug}>stylus debug</Text> : null}
          <StylusCapture eraseMode={session.eraseMode} enabled={!disabled} onEvent={onEvent} />
        </View>
        <Pressable
          onPress={toggleErase}
          style={[styles.erase, session.eraseMode ? styles.eraseOn : null]}
          accessibilityRole="button"
          accessibilityLabel="S-Pen erase"
        >
          <Text style={[styles.eraseText, session.eraseMode ? styles.eraseTextOn : null]}>E</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

function IntentNode({ zoom }: { zoom: number }) {
  if (zoom === ZOOM_PATTERN) {
    return (
      <View style={styles.node} accessibilityLabel="pattern">
        <View style={styles.patternRow}>
          {range(INTENT_PATTERN_DOTS).map((i) => (
            <View key={i} style={styles.dotWrap}>
              <View style={styles.dot} />
              {i < INTENT_PATTERN_DOTS - 1 ? <View style={styles.wire} /> : null}
            </View>
          ))}
        </View>
      </View>
    );
  }
  const scale = zoom === ZOOM_NODE ? 0.78 : 1;
  return (
    <View style={[styles.node, { transform: [{ scale }] }]} accessibilityLabel={zoom === ZOOM_NODE ? "node" : "unit"}>
      <View style={styles.unitFill} />
    </View>
  );
}

function range(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}

const styles = StyleSheet.create({
  root: { backgroundColor: surfaceColors.bg, width: "100%" },
  docked: { paddingBottom: 0 },
  chips: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  chip: {
    height: INTENT_CHIP_HEIGHT,
    borderRadius: 14,
    paddingHorizontal: 10,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColors.hair,
  },
  chipText: { color: surfaceColors.muted, fontSize: 12 },
  strip: {
    height: INTENT_STRIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  nodeHit: {
    width: INTENT_NODE_SIZE,
    height: INTENT_NODE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  node: {
    width: INTENT_NODE_SIZE,
    height: INTENT_NODE_SIZE,
    borderRadius: INTENT_NODE_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColors.hair,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  unitFill: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: surfaceColors.node,
  },
  patternRow: { flexDirection: "row", alignItems: "center" },
  dotWrap: { flexDirection: "row", alignItems: "center" },
  dot: {
    width: INTENT_PATTERN_DOT,
    height: INTENT_PATTERN_DOT,
    borderRadius: INTENT_PATTERN_DOT / 2,
    backgroundColor: surfaceColors.node,
  },
  wire: {
    width: INTENT_WIRE_WIDTH,
    height: INTENT_WIRE_HEIGHT,
    backgroundColor: surfaceColors.wire,
  },
  previewWrap: { flex: 1, height: INTENT_STRIP_HEIGHT, justifyContent: "center" },
  preview: { color: surfaceColors.text, fontSize: 13 },
  debug: { color: surfaceColors.faint, fontSize: 10 },
  erase: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaceColors.hair,
  },
  eraseOn: { backgroundColor: surfaceColors.accent },
  eraseText: { color: surfaceColors.muted, fontSize: 12, fontWeight: "700" },
  eraseTextOn: { color: surfaceColors.onAccent },
});

export function applyComposerText(session: IntentSession, text: string): IntentSession {
  return sessionDeclare(session, text);
}

import { useCallback, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { STYLUS_HIT_SLOP } from "./geometry";
import { stylusEventFromUnknown, type IntentStylusEvent, type StylusPhase } from "./stylus";

type TouchLike = { nativeEvent: unknown };

type Props = {
  eraseMode: boolean;
  enabled: boolean;
  onEvent(event: IntentStylusEvent): void;
  children?: ReactNode;
};

/**
 * Maps finger / mouse / pen into the closed stylus contract.
 * Does not cover the host TextInput. Expo Go: no TOOL_TYPE_STYLUS.
 */
export function StylusCapture({ eraseMode, enabled, onEvent, children }: Props) {
  const emit = useCallback(
    (phase: StylusPhase, nativeEvent: unknown) => {
      if (!enabled) return;
      const event = stylusEventFromUnknown(phase, nativeEvent, Date.now(), eraseMode);
      if (event) onEvent(event);
    },
    [enabled, eraseMode, onEvent],
  );

  const grant = useCallback((e: TouchLike) => emit("down", e.nativeEvent), [emit]);
  const move = useCallback((e: TouchLike) => emit("move", e.nativeEvent), [emit]);
  const release = useCallback((e: TouchLike) => emit("up", e.nativeEvent), [emit]);
  const hoverIn = useCallback((e: TouchLike) => emit("hover", e.nativeEvent), [emit]);

  return (
    <View
      testID="aodl-stylus-layer"
      style={styles.layer}
      hitSlop={STYLUS_HIT_SLOP}
      onStartShouldSetResponder={() => enabled}
      onMoveShouldSetResponder={() => enabled}
      onResponderGrant={grant}
      onResponderMove={move}
      onResponderRelease={release}
      onHoverIn={hoverIn}
      accessibilityLabel="Intent stylus"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
});

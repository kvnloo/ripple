// React Native renderer for Ripple fast controls (Expo Go: react + react-native only, no
// Reanimated, no native modules). Each control is a proposal the owner picks or puts away; every
// tap goes through the shared `step()` so a tap here answers exactly as a number key or a spoken
// "the second one" does elsewhere, and the answer leaves as declared intent.

import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { FastControl, Intent } from '../fast-controls/schema.js'
import { type ControlInput, initialState, step } from '../fast-controls/state.js'
import { CONTROL_MIN, viewOf } from './view.js'

export interface FastControlTheme {
  text: string
  muted: string
  accent: string
  surface: string
  hairline: string
}

/** zerOS Living Night defaults; hosts pass their own tokens. */
export const LIVING_NIGHT: FastControlTheme = {
  accent: '#d7b986',
  hairline: 'rgba(236,232,223,0.10)',
  muted: '#B4AFA3',
  surface: 'rgba(24,26,23,0.46)',
  text: '#ECE8DF'
}

export interface FastControlViewProps {
  control: FastControl
  onIntent: (intent: Intent) => void
  onDismiss?: () => void
  /** Recorded on the intent, e.g. `dash-live-surface`. Default `ripple-fast-control`. */
  surface?: string
  theme?: FastControlTheme
}

export function FastControlView({ control, onIntent, onDismiss, surface = 'ripple-fast-control', theme = LIVING_NIGHT }: FastControlViewProps) {
  const [state, setState] = useState(() => initialState(control))
  const [answered, setAnswered] = useState<string | null>(null)
  const send = useCallback((input: ControlInput) => {
    const next = step(state, input, surface)

    setState(next.state)
    if (next.outcome?.kind === 'answer') {
      setAnswered(next.outcome.intent.label ?? String(next.outcome.intent.value))
      onIntent(next.outcome.intent)
    } else if (next.outcome?.kind === 'dismiss') {
      onDismiss?.()
    }
  }, [state, surface, onIntent, onDismiss])
  const view = viewOf(state)
  const styles = themed(theme)

  return (
    <View accessibilityLabel={view.prompt} accessibilityRole={view.kind === 'slider' ? 'adjustable' : 'radiogroup'} style={styles.card}>
      <Text style={styles.prompt}>{view.prompt}</Text>
      {view.rows.map(row => {
        const on = row.checked || answered === row.label

        return (
          <Pressable
            accessibilityLabel={row.a11y}
            accessibilityRole={view.submit ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: on }}
            key={row.id}
            onPress={() => send({ id: row.id, kind: 'pick' })}
            style={[styles.row, on && styles.rowOn]}
          >
            <Text style={[styles.index, on && styles.accent]}>{row.index}</Text>
            <View style={styles.flex}>
              <Text style={styles.label}>{row.label}{on ? '  · Selected' : ''}</Text>
              {row.detail ? <Text style={styles.detail}>{row.detail}</Text> : null}
            </View>
          </Pressable>
        )
      })}
      {view.slider ? (
        <View style={styles.ticks}>
          {view.slider.ticks.map(tick => (
            <Pressable
              accessibilityLabel={`Set ${tick}`}
              accessibilityRole="button"
              key={tick}
              onPress={() => send({ kind: 'set', value: tick })}
              style={[styles.tick, view.slider?.value === tick && styles.rowOn]}
            >
              <Text style={styles.label}>{tick}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        {view.slider ? (
          <Pressable accessibilityRole="button" onPress={() => send({ key: 'enter', kind: 'key' })} style={[styles.primary]}>
            <Text style={styles.primaryText}>Use {view.slider.label}</Text>
          </Pressable>
        ) : null}
        {view.submit ? (
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: !view.submit.enabled }} disabled={!view.submit.enabled}
            onPress={() => send({ key: 'enter', kind: 'key' })} style={[styles.primary, !view.submit.enabled && styles.disabled]}>
            <Text style={styles.primaryText}>{view.submit.label}</Text>
          </Pressable>
        ) : null}
        {onDismiss ? (
          <Pressable accessibilityRole="button" onPress={() => send({ key: 'escape', kind: 'key' })} style={styles.ghost}>
            <Text style={styles.detail}>Not now</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function themed(t: FastControlTheme) {
  return StyleSheet.create({
    accent: { color: t.accent },
    actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    card: { backgroundColor: t.surface, borderColor: t.hairline, borderRadius: 14, borderWidth: 1, gap: 8, padding: 12 },
    detail: { color: t.muted, fontSize: 13, lineHeight: 18 },
    disabled: { opacity: 0.5 },
    flex: { flex: 1 },
    ghost: { alignItems: 'center', justifyContent: 'center', minHeight: CONTROL_MIN, paddingHorizontal: 12 },
    index: { color: t.muted, fontSize: 12, width: 16 },
    label: { color: t.text, fontSize: 16, fontWeight: '600', lineHeight: 22 },
    primary: { alignItems: 'center', backgroundColor: t.accent, borderRadius: 999, justifyContent: 'center', minHeight: CONTROL_MIN, paddingHorizontal: 16 },
    primaryText: { color: '#0c0c0a', fontSize: 16, fontWeight: '600' },
    prompt: { color: t.text, fontSize: 16, fontWeight: '600', lineHeight: 22 },
    row: { alignItems: 'center', borderColor: t.hairline, borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, minHeight: CONTROL_MIN, paddingHorizontal: 12, paddingVertical: 8 },
    rowOn: { borderColor: t.accent },
    tick: { alignItems: 'center', borderColor: t.hairline, borderRadius: 8, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: CONTROL_MIN },
    ticks: { flexDirection: 'row', gap: 6 }
  })
}

// What a native renderer draws for a fast control, derived from the shared interaction state
// (`../fast-controls/state.ts`). Pure, so the React Native component stays a thin mapping and the
// geometry and wording are tested without a device.

import { type ControlState, rowsOf, stepOf } from '../fast-controls/state.js'

/** Minimum touch target, as in Dash (zerOS `--z-control-min`). */
export const CONTROL_MIN = 44

export interface RowView {
  id: string
  /** 1-based, the number key that answers it. */
  index: number
  label: string
  detail?: string
  artifactVersion?: number
  focused: boolean
  checked: boolean
  /** Spoken by screen readers; says the state in words so meaning survives without colour. */
  a11y: string
}

export interface ControlView {
  id: string
  kind: ControlState['control']['kind']
  prompt: string
  rows: RowView[]
  /** Multiple choice: an explicit Done button sends the checked rows. */
  submit?: { label: string; enabled: boolean }
  slider?: { value: number; min: number; max: number; step: number; label: string; ticks: number[] }
}

export function viewOf(state: ControlState): ControlView {
  const { control } = state
  const multiple = control.kind === 'choice' && control.multiple === true
  const rows = rowsOf(control).map((row, i): RowView => {
    const checked = multiple ? state.picked.includes(row.id) : false
    const focused = state.focus === i
    const version = 'artifactVersion' in row && row.artifactVersion !== undefined ? row.artifactVersion : undefined

    return {
      a11y: `${i + 1}. ${row.label}${row.detail ? `, ${row.detail}` : ''}${checked ? ', selected' : ''}${version ? `, design v${version}` : ''}`,
      checked,
      focused,
      id: row.id,
      index: i + 1,
      label: row.label,
      ...(row.detail ? { detail: row.detail } : {}),
      ...(version !== undefined ? { artifactVersion: version } : {})
    }
  })
  const view: ControlView = { id: control.id, kind: control.kind, prompt: control.prompt, rows }

  if (multiple) {
    view.submit = { enabled: state.picked.length > 0, label: state.picked.length ? `Done (${state.picked.length})` : 'Done' }
  }

  if (control.kind === 'slider') {
    const step = stepOf(control)
    // At most five ticks the owner can tap, always including both ends.
    const count = Math.min(5, Math.floor((control.max - control.min) / step) + 1)
    const ticks = Array.from({ length: count }, (_, i) => Number((control.min + ((control.max - control.min) * i) / Math.max(1, count - 1)).toFixed(6)))

    view.slider = { label: `${state.value}${control.unit ? ` ${control.unit}` : ''}`, max: control.max, min: control.min, step, ticks, value: state.value }
  }

  return view
}

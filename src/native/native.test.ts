import { expect, test } from 'bun:test'
import { parseFastControl } from '../fast-controls/schema.js'
import { initialState, step } from '../fast-controls/state.js'
import { controlOf, intentBody } from './live.js'
import { CONTROL_MIN, viewOf } from './view.js'

const header = parseFastControl({
  id: 'header', kind: 'candidates', prompt: 'Pick a header layout',
  candidates: [{ id: 'split', label: 'Split', detail: 'title left, actions right', artifactVersion: 2 }, { id: 'stacked', label: 'Stacked' }, { id: 'compact', label: 'Compact' }]
})!

test('a worker turn event carries a control only when it matches the schema exactly', () => {
  expect(controlOf({ type: 'control', control: header })).toEqual(header)
  expect(controlOf({ type: 'control', control: { ...header, kind: 'html' } })).toBeNull()
  expect(controlOf({ type: 'delta', text: 'x' })).toBeNull()
  expect(controlOf(null)).toBeNull()
})

test('the view says state in words, numbers rows for keys, and keeps 44 px targets', () => {
  const view = viewOf(initialState(header))
  expect(CONTROL_MIN).toBe(44)
  expect(view.rows.map(r => [r.index, r.label])).toEqual([[1, 'Split'], [2, 'Stacked'], [3, 'Compact']])
  expect(view.rows[0]?.a11y).toBe('1. Split, title left, actions right, design v2')
  expect(view.submit).toBeUndefined()
})

test('a tap answers as declared intent with the fx0 version it was made on', () => {
  const next = step(initialState(header), { id: 'split', kind: 'pick' }, 'dash-live-surface')
  expect(next.outcome).toEqual({ kind: 'answer', intent: { artifactVersion: 2, controlId: 'header', label: 'Split', surface: 'dash-live-surface', value: 'split' } })
  expect(intentBody(next.outcome?.kind === 'answer' ? next.outcome.intent : ({} as never))).toEqual({ continue: true, intent: { artifactVersion: 2, controlId: 'header', label: 'Split', surface: 'dash-live-surface', value: 'split' } })
  expect(() => intentBody({ controlId: '<x>', value: 'a' })).toThrow()
})

test('multiple choice and sliders get explicit Done and tappable ticks', () => {
  const langs = parseFastControl({ id: 'langs', kind: 'choice', multiple: true, prompt: 'Which?', options: [{ id: 'ts', label: 'TS' }, { id: 'py', label: 'Py' }] })!
  const picked = step(initialState(langs), { id: 'py', kind: 'pick' }, 's').state
  expect(viewOf(picked).submit).toEqual({ enabled: true, label: 'Done (1)' })
  expect(viewOf(picked).rows[1]?.a11y).toBe('2. Py, selected')
  const budget = parseFastControl({ id: 'b', kind: 'slider', prompt: 'Budget', min: 0, max: 200, step: 10, value: 50, unit: 'ms' })!
  const slider = viewOf(initialState(budget)).slider
  expect(slider).toMatchObject({ label: '50 ms', ticks: [0, 50, 100, 150, 200] })
  expect(step(initialState(budget), { kind: 'set', value: 150 }, 's').state.value).toBe(150)
})

import { describe, expect, test } from 'bun:test'

import { describeIntent, type FastControl, initialState, intentText, parseFastControl, parseIntent, step, type ControlInput } from './index.js'
import vectors from './vectors.json'

type Vectors = {
  controls: Record<string, unknown>
  parse: { name: string; raw: unknown; ok: boolean; normalized?: unknown }[]
  answer: { name: string; control: string; inputs: ControlInput[]; intent?: Record<string, unknown> | null; dismiss?: boolean }[]
  text: { control: string; intent: unknown; text: string }[]
}

const v = vectors as unknown as Vectors
const control = (name: string) => parseFastControl(v.controls[name]) as FastControl

describe('parse vectors', () => {
  for (const c of v.parse) {
    test(c.name, () => {
      const raw = typeof c.raw === 'string' ? v.controls[c.raw] : c.raw
      const parsed = parseFastControl(raw)

      expect(parsed !== null).toBe(c.ok)

      if (c.normalized) {
        expect(parsed as unknown).toEqual(c.normalized)
      } else if (c.ok) {
        expect(parsed as unknown).toEqual(raw)
      }
    })
  }

  test('the long-prompt vector is really over the limit', () => {
    const long = v.parse.find(c => c.name.includes('201-char'))?.raw as { prompt: string }

    expect(long.prompt.length).toBeGreaterThan(200)
  })
})

describe('answer vectors', () => {
  for (const c of v.answer) {
    test(c.name, () => {
      let state = initialState(control(c.control))
      let outcome

      for (const input of c.inputs) {
        const next = step(state, input, 'test')

        state = next.state
        outcome = next.outcome

        if (outcome) {
          break
        }
      }

      if (c.dismiss) {
        expect(outcome).toEqual({ kind: 'dismiss' })
      } else if (c.intent) {
        expect(outcome).toEqual({ intent: { ...c.intent, surface: 'test' }, kind: 'answer' })
        expect(parseIntent(outcome?.kind === 'answer' ? outcome.intent : null)).not.toBeNull()
      } else {
        expect(outcome).toBeUndefined()
      }
    })
  }
})

describe('answer text', () => {
  for (const c of v.text) {
    test(c.text, () => {
      const intent = parseIntent(c.intent)

      expect(intent).not.toBeNull()
      expect(intentText(control(c.control), intent!)).toBe(c.text)
    })
  }

  test('describeIntent stays the one-line receipt form', () => {
    expect(describeIntent({ artifactVersion: 4, controlId: 'hero', label: 'Noon', value: 'b' })).toBe('hero = Noon (html v4)')
  })
})

describe('state', () => {
  test('a slider starts at its value, else the middle, snapped', () => {
    expect(initialState(control('budget')).value).toBe(50)
    expect(initialState({ id: 's', kind: 'slider', max: 1, min: 0, prompt: 'p', step: 0.1 }).value).toBe(0.5)
  })

  test('float steps do not drift', () => {
    let state = initialState({ id: 's', kind: 'slider', max: 1, min: 0, prompt: 'p', step: 0.1, value: 0 })

    for (let i = 0; i < 3; i++) {
      state = step(state, { key: 'right', kind: 'key' }, 't').state
    }

    expect(state.value).toBe(0.3)
  })

  test('an unknown key is reported as ignored, not an answer', () => {
    const next = step(initialState(control('db')), { key: 'x', kind: 'key' }, 't')

    expect(next.ignored).toBe(true)
    expect(next.outcome).toBeUndefined()
  })
})

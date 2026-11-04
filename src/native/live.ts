// Fast controls from a libfx worker (fx) attached to a Hermes session through z0bridge. The worker
// proposes a control with its `propose_control` tool (or fx0's `ask_user_question`), the turn stream
// carries it as `{type: "control", control}`, and the owner's pick goes back as declared intent to
// `POST /v1/sessions/fx/:profile/:worker/intents`, which records it in the Hermes session.
// Transport stays with the host app (Dash's bridge holds z0bridge's token, never the phone).

import { type FastControl, type Intent, parseFastControl, parseIntent } from '../fast-controls/schema.js'

/** The control a worker turn event carries, or null when the event is not one (or is malformed). */
export function controlOf(event: unknown): FastControl | null {
  if (typeof event !== 'object' || event === null) {
    return null
  }

  const value = event as Record<string, unknown>

  return value['type'] === 'control' ? parseFastControl(value['control']) : null
}

/** The body for z0bridge's intents route. `continueWorker` lets the worker react to the pick. */
export function intentBody(intent: Intent, continueWorker = true): { intent: Intent; continue: boolean } {
  const checked = parseIntent(intent)

  if (!checked) {
    throw new Error('not a declared intent')
  }

  return { continue: continueWorker, intent: checked }
}

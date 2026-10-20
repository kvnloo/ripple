/**
 * Hermes bridge (DESIGNED, OFF). Do not enable without the owner's approval.
 *
 * When the owner approves API_SERVER_ENABLED in Hermes, each confirmed note can
 * be forwarded to the Hermes API server on loopback:
 *   POST http://127.0.0.1:8642/v1/responses
 *   { model: "hermes", conversation: "ace-ripple-review", stream: true,
 *     input: [{ role: "user", content: <structured note as text + image paths> }] }
 * The key stays server-side (read from the Hermes profile env, never sent to the
 * browser); replies stream back to the surface over SSE into the note's thread.
 *
 * Until then the server only appends notes to <session>/agent-queue.jsonl,
 * which the parent Hermes session reads (pull, no network).
 */
export interface BridgeStatus {
  enabled: boolean;
  mode: 'queue-file' | 'hermes-api';
  reason: string;
}

export function bridgeStatus(env: Record<string, string | undefined> = process.env): BridgeStatus {
  if (env.RIPPLE_HERMES_BRIDGE === '1' && env.RIPPLE_HERMES_APPROVED === 'owner') {
    return { enabled: true, mode: 'hermes-api', reason: 'owner-approved via RIPPLE_HERMES_APPROVED=owner' };
  }
  return {
    enabled: false,
    mode: 'queue-file',
    reason: 'Hermes API server bridge is designed but off: needs owner approval for API_SERVER_ENABLED. Notes queue to agent-queue.jsonl.',
  };
}

/** Only ever called when bridgeStatus().enabled; loopback only. */
export async function forwardNote(note: unknown, apiKey: string): Promise<Response> {
  const body = {
    model: 'hermes',
    conversation: 'ace-ripple-review',
    stream: true,
    input: [{ role: 'user', content: JSON.stringify(note) }],
  };
  return fetch('http://127.0.0.1:8642/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
}

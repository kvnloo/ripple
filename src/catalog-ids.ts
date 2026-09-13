/**
 * Opaque ids consumed as data from kvnloo/aodl.
 * Source of truth: encodings/visual.json and harnesses/catalog.json.
 * This file is a snapshot of ids, not the IR and not a gallery.
 */

export const AODL_HARNESS_IDS = [
  "hermes",
  "omp",
  "o8",
  "grok",
  "codex",
  "claude",
  "pi",
  "fx",
] as const;

export type AodlHarnessId = (typeof AODL_HARNESS_IDS)[number];

export const AODL_VISUAL_IDS = [
  "solo",
  "paired",
  "council",
  "hierarchy",
  "mesh",
  "ring",
  "star",
  "swarm",
  "cluster",
  "parallel",
  "pipeline",
  "supervisor",
  "blackboard",
  "marketplace",
  "hybrid",
  "unknown",
] as const;

export type AodlVisualId = (typeof AODL_VISUAL_IDS)[number];

export function isAodlHarnessId(value: string): value is AodlHarnessId {
  return AODL_HARNESS_IDS.some((id) => id === value);
}

export function isAodlVisualId(value: string): value is AodlVisualId {
  return AODL_VISUAL_IDS.some((id) => id === value);
}

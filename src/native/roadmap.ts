export type RoadmapStage = 'planned' | 'partial' | 'candidate' | 'preview' | 'verified'
export interface RoadmapItem { id: string; title: string; stage: RoadmapStage; area: string; detail: string; evidence: string; next: string }
export interface RoadmapDocument { id: string; title: string; updated: string; items: RoadmapItem[] }
export type RoadmapFilter = 'needs-work' | 'preview' | 'all'
export const STAGES: Record<RoadmapStage, { label: string; value: number }> = {
  planned: { label: 'Not built', value: 0 }, partial: { label: 'Partial', value: 25 },
  candidate: { label: 'In review', value: 50 }, preview: { label: 'In preview', value: 75 }, verified: { label: 'Verified', value: 100 }
}
export function visibleItems(items: RoadmapItem[], filter: RoadmapFilter): RoadmapItem[] {
  return items.filter(item => filter === 'all' || (filter === 'preview' ? item.stage === 'preview' || item.stage === 'verified' : item.stage !== 'preview' && item.stage !== 'verified'))
}
export function roadmapCounts(items: RoadmapItem[]) {
  return { total: items.length, preview: items.filter(i => i.stage === 'preview' || i.stage === 'verified').length, verified: items.filter(i => i.stage === 'verified').length, remaining: visibleItems(items, 'needs-work').length }
}

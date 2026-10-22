// Ripple ephemeral roadmap. Host supplies receipt-backed data; no inference or network in render.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { roadmapCounts, STAGES, visibleItems, type RoadmapDocument, type RoadmapFilter } from './roadmap'
export function RoadmapView({ document }: { document: RoadmapDocument }) {
  const [filter, setFilter] = useState<RoadmapFilter>('needs-work')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const c = roadmapCounts(document.items)
  if (dismissed) return <Pressable onPress={() => setDismissed(false)} style={s.tucked} accessibilityLabel="Show roadmap"><Text style={s.small}>Roadmap · {c.preview}/{c.total} in preview · Show</Text></Pressable>
  return <View style={s.root} accessibilityLabel="Ripple roadmap">
    <View style={s.top}><View style={s.grow}><Text style={s.eyebrow}>RIPPLE · DELIVERY SNAPSHOT</Text><Text style={s.title}>{document.title}</Text></View><Pressable onPress={() => setDismissed(true)} style={s.close} accessibilityLabel="Tuck roadmap"><Text style={s.closeText}>−</Text></Pressable></View>
    <Text style={s.small}>{document.updated} · Tap a feature for evidence and next check.</Text>
    <View style={s.stats}><Text style={s.summary}>{c.preview}<Text style={s.small}>/{c.total} in preview</Text></Text><Text style={s.small}>{c.remaining} need work · {c.verified} fully verified</Text></View>
    <View style={s.filters}>{(['needs-work', 'preview', 'all'] as const).map((f, i) => <Pressable key={f} onPress={() => { setFilter(f); setExpanded(null) }} style={[s.filter, filter === f && s.filterOn]} accessibilityRole="button" accessibilityState={{ selected: filter === f }}><Text style={[s.filterText, filter === f && s.selected]}>{['Needs work', 'In preview', 'All'][i]}</Text></Pressable>)}</View>
    <Text style={s.legend}>Bars are delivery stages—not estimates of effort. Preview ≠ phone-verified.</Text>
    {visibleItems(document.items, filter).map(item => {
      const stage = STAGES[item.stage], open = expanded === item.id
      return <View key={item.id} style={s.item}>
        <Pressable onPress={() => setExpanded(open ? null : item.id)} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${item.title}, ${stage.label}`} style={s.itemButton}>
          <View style={s.row}><Text style={s.itemTitle}>{item.title}</Text><Text style={[s.stage, item.stage === 'planned' && s.muted]}>{stage.label} {open ? '−' : '+'}</Text></View>
          <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: stage.value, text: stage.label }}><View style={[s.fill, { width: `${stage.value}%` }]} /></View>
          <Text style={s.small}>{item.area} · {item.detail}</Text>
        </Pressable>
        {open ? <View style={s.details}><Text style={s.detailLabel}>EVIDENCE</Text><Text selectable style={s.detail}>{item.evidence}</Text><Text style={s.detailLabel}>NEXT ACCEPTANCE CHECK</Text><Text selectable style={s.detail}>{item.next}</Text></View> : null}
      </View>
    })}
    <Text style={s.legend}>Local cached snapshot · no model calls on filter, tap or scroll.</Text>
  </View>
}
const s = StyleSheet.create({
  root: { backgroundColor: '#090a08', borderColor: '#24251f', borderWidth: 1, borderRadius: 16, padding: 14, gap: 10, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 }, grow: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#908b7e', fontSize: 9, letterSpacing: 1.1 }, title: { color: '#ece8df', fontSize: 21, lineHeight: 27, fontWeight: '500', marginTop: 4 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, closeText: { color: '#b4afa3', fontSize: 24 },
  small: { color: '#a39e91', fontSize: 11, lineHeight: 16, flexShrink: 1 },
  stats: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }, summary: { color: '#d7b986', fontSize: 25, lineHeight: 32 },
  filters: { flexDirection: 'row', gap: 4, borderRadius: 12, padding: 3, backgroundColor: '#12130f' }, filter: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9 }, filterOn: { backgroundColor: '#29271e' }, filterText: { color: '#a39e91', fontSize: 12 }, selected: { color: '#ece8df' },
  legend: { color: '#888477', fontSize: 10, lineHeight: 15 }, item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#292a23' }, itemButton: { paddingVertical: 11, minHeight: 66, gap: 7 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 }, itemTitle: { flex: 1, minWidth: 0, color: '#ece8df', fontSize: 14, lineHeight: 20, fontWeight: '500' }, stage: { color: '#d7b986', fontSize: 10, lineHeight: 20, flexShrink: 0 }, muted: { color: '#999487' },
  track: { height: 3, backgroundColor: '#23241e', borderRadius: 2, overflow: 'hidden' }, fill: { height: 3, backgroundColor: '#b69b6d', borderRadius: 2 },
  details: { paddingTop: 2, paddingBottom: 14, gap: 5 }, detailLabel: { color: '#8d887b', fontSize: 9, letterSpacing: 0.8, marginTop: 5 }, detail: { color: '#c4bfb2', fontSize: 12, lineHeight: 18 },
  tucked: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }
})

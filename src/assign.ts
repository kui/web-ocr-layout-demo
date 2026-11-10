import { area, intersect } from './image'
import { toGrid } from './table'
import type { Box, LayoutLabel, Line, Recognized, Region, RegionText } from './types'

/** A box to recognize and the region its text belongs to (`null` = outside every region). */
export type PlannedLine = { regionId: number | null; box: Box }

const MIN_OVERLAP_PX = 3
const MIN_COVERAGE = 0.15
/** Two regions claim separate parts of a line when their spans along it overlap less than this. */
const MAX_SHARED_SPAN = 0.2
const SINGLE_LINE_RATIO = 1.5

const NO_TEXT: ReadonlySet<LayoutLabel> = new Set([
  'image',
  'chart',
  'seal',
  'header_image',
  'footer_image',
  'table',
])

type Claim = { region: Region; coverage: number; from: number; to: number }

/**
 * Decides which boxes to recognize. A detected line goes to the region covering most of it; a line
 * that runs across separate regions (e.g. both columns) is cut at their edges; a text region left
 * without any line is recognized whole if it is shaped like a single line.
 */
export function planLines(regions: readonly Region[], lineBoxes: readonly Box[]): PlannedLine[] {
  const planned: PlannedLine[] = []
  const filled = new Set<number>()

  for (const line of lineBoxes) {
    const vertical = line.y2 - line.y1 > line.x2 - line.x1
    const claims: Claim[] = []
    for (const region of regions) {
      const hit = intersect(line, region.box)
      if (hit.x2 - hit.x1 <= MIN_OVERLAP_PX || hit.y2 - hit.y1 <= MIN_OVERLAP_PX) continue
      const coverage = area(hit) / area(line)
      if (coverage < MIN_COVERAGE) continue
      claims.push({
        region,
        coverage,
        from: vertical ? hit.y1 : hit.x1,
        to: vertical ? hit.y2 : hit.x2,
      })
    }
    claims.sort((a, b) => b.coverage - a.coverage || area(a.region.box) - area(b.region.box))

    const accepted: Claim[] = []
    for (const claim of claims) {
      const shared = accepted.reduce(
        (sum, a) => sum + Math.max(0, Math.min(a.to, claim.to) - Math.max(a.from, claim.from)),
        0,
      )
      if (shared < (claim.to - claim.from) * MAX_SHARED_SPAN) accepted.push(claim)
    }

    if (accepted.length === 0) {
      planned.push({ regionId: null, box: line })
    } else if (accepted.length === 1) {
      planned.push({ regionId: accepted[0]!.region.id, box: line })
    } else {
      for (const { region, from, to } of accepted) {
        planned.push({
          regionId: region.id,
          box: vertical ? { ...line, y1: from, y2: to } : { ...line, x1: from, x2: to },
        })
      }
    }
    for (const { region } of accepted) filled.add(region.id)
  }

  for (const region of regions) {
    if (filled.has(region.id) || NO_TEXT.has(region.label)) continue
    const w = region.box.x2 - region.box.x1
    const h = region.box.y2 - region.box.y1
    if (Math.max(w, h) >= Math.min(w, h) * SINGLE_LINE_RATIO)
      planned.push({ regionId: region.id, box: region.box })
  }
  return planned
}

/** Top-to-bottom, then left-to-right within lines that share a row. */
function readingOrder(a: Line, b: Line): number {
  const overlap = Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1)
  const sameRow = overlap > 0.5 * Math.min(a.box.y2 - a.box.y1, b.box.y2 - b.box.y1)
  return sameRow ? a.box.x1 - b.box.x1 : a.box.y1 - b.box.y1
}

export function groupByRegion(
  regions: readonly Region[],
  planned: readonly PlannedLine[],
  texts: readonly Recognized[],
): { regions: RegionText[]; orphans: Line[] } {
  const byRegion = new Map<number, Line[]>(regions.map((r) => [r.id, []]))
  const orphans: Line[] = []
  planned.forEach(({ regionId, box }, i) => {
    const recognized = texts[i]!
    if (recognized.text.trim() === '') return
    const bucket = regionId === null ? orphans : byRegion.get(regionId)!
    bucket.push({ box, ...recognized })
  })
  orphans.sort(readingOrder)
  return {
    orphans,
    regions: regions.map((region) => {
      const lines = byRegion.get(region.id)!.sort(readingOrder)
      const table = region.label === 'table' ? toGrid(lines) : null
      if (table)
        return { region, lines, table, text: table.map((row) => row.join('\t')).join('\n') }
      return { region, lines, text: lines.map((l) => l.text).join('\n') }
    }),
  }
}

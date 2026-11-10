import { iou } from './image'
import { LAYOUT_LABELS, type Region } from './types'

/** Detections below this are never useful; the UI filters further without re-running the model. */
export const MIN_SCORE = 0.3
const IOU_SAME_LABEL = 0.6
const IOU_OTHER_LABEL = 0.98

/** Rows are `[class, score, x1, y1, x2, y2, readingOrder]` in source-image pixels. */
export function parseDetections(rows: Float32Array, width: number, height: number): Region[] {
  const found: (Omit<Region, 'id' | 'order'> & { rank: number })[] = []
  for (let i = 0; i + 7 <= rows.length; i += 7) {
    const label = LAYOUT_LABELS[rows[i]!]
    const score = rows[i + 1]!
    if (!label || score < MIN_SCORE) continue
    const box = {
      x1: Math.max(0, rows[i + 2]!), y1: Math.max(0, rows[i + 3]!),
      x2: Math.min(width, rows[i + 4]!), y2: Math.min(height, rows[i + 5]!),
    }
    if (box.x2 - box.x1 < 1 || box.y2 - box.y1 < 1) continue
    found.push({ label, score, box, rank: rows[i + 6]! })
  }

  found.sort((a, b) => b.score - a.score)
  const kept: typeof found = []
  for (const d of found) {
    const duplicate = kept.some((k) => iou(k.box, d.box) > (k.label === d.label ? IOU_SAME_LABEL : IOU_OTHER_LABEL))
    if (!duplicate) kept.push(d)
  }

  return kept
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _rank, ...d }, order) => ({ ...d, id: order, order }))
}

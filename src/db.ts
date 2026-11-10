import type { Box } from './types'

export type DbOptions = { thresh: number; boxThresh: number; unclipRatio: number; minSize: number }
export const DB_DEFAULTS: DbOptions = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5, minSize: 3 }

/**
 * DB post-processing restricted to axis-aligned boxes: each connected blob of the thresholded
 * probability map becomes its bounding rectangle, grown by the DB unclip distance.
 */
export function dbBoxes(prob: Float32Array, width: number, height: number, opts: DbOptions): Box[] {
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const boxes: Box[] = []

  for (let start = 0; start < prob.length; start++) {
    if (seen[start] || prob[start]! <= opts.thresh) continue
    let x1 = width,
      y1 = height,
      x2 = -1,
      y2 = -1,
      sum = 0,
      count = 0
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      const x = i % width
      const y = (i - x) / width
      x1 = Math.min(x1, x)
      x2 = Math.max(x2, x)
      y1 = Math.min(y1, y)
      y2 = Math.max(y2, y)
      sum += prob[i]!
      count++
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const n = ny * width + nx
          if (!seen[n] && prob[n]! > opts.thresh) {
            seen[n] = 1
            stack.push(n)
          }
        }
      }
    }
    const w = x2 - x1 + 1
    const h = y2 - y1 + 1
    if (Math.min(w, h) < opts.minSize || sum / count < opts.boxThresh) continue
    const grow = (w * h * opts.unclipRatio) / (2 * (w + h))
    boxes.push({ x1: x1 - grow, y1: y1 - grow, x2: x2 + 1 + grow, y2: y2 + 1 + grow })
  }
  return boxes
}

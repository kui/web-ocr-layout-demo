import type { Box } from './types'

export type Norm = {
  mean: readonly [number, number, number]
  std: readonly [number, number, number]
  bgr: boolean
}

export function context(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2D canvas is unavailable')
  ctx.imageSmoothingQuality = 'high'
  return ctx
}

/** Writes RGBA pixels as normalized planar CHW floats at `offset`; `out` rows may be wider than the image. */
export function writeChw(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  out: Float32Array,
  offset: number,
  outWidth: number,
  norm: Norm,
): void {
  const plane = outWidth * height
  for (let c = 0; c < 3; c++) {
    const src = norm.bgr ? 2 - c : c
    const scale = 1 / (255 * norm.std[c]!)
    const shift = norm.mean[c]! / norm.std[c]!
    const base = offset + c * plane
    for (let y = 0; y < height; y++) {
      const row = base + y * outWidth
      const srcRow = y * width * 4 + src
      for (let x = 0; x < width; x++) out[row + x] = rgba[srcRow + x * 4]! * scale - shift
    }
  }
}

export const area = (b: Box): number => Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1)

export const intersect = (a: Box, b: Box): Box => ({
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
  x2: Math.min(a.x2, b.x2),
  y2: Math.min(a.y2, b.y2),
})

export function iou(a: Box, b: Box): number {
  const inter = area(intersect(a, b))
  return inter === 0 ? 0 : inter / (area(a) + area(b) - inter)
}

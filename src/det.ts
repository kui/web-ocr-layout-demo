import { context, writeChw } from './image'
import { ort } from './ort'
import { DB_DEFAULTS, dbBoxes } from './db'
import type { Box } from './types'

const MAX_SIDE = 960
const STRIDE = 32

export async function detectLines(session: ort.InferenceSession, image: ImageBitmap): Promise<Box[]> {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height))
  const snap = (side: number) => Math.max(STRIDE, Math.round((side * scale) / STRIDE) * STRIDE)
  const width = snap(image.width)
  const height = snap(image.height)

  const ctx = context(width, height)
  ctx.drawImage(image, 0, 0, width, height)
  const pixels = new Float32Array(3 * width * height)
  writeChw(ctx.getImageData(0, 0, width, height).data, width, height, pixels, 0, width,
    { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], bgr: true })

  const out = await session.run({ [session.inputNames[0]!]: new ort.Tensor('float32', pixels, [1, 3, height, width]) })
  const prob = out[session.outputNames[0]!]!.data as Float32Array
  return dbBoxes(prob, width, height, DB_DEFAULTS).map((b) => ({
    x1: Math.max(0, (b.x1 * image.width) / width), y1: Math.max(0, (b.y1 * image.height) / height),
    x2: Math.min(image.width, (b.x2 * image.width) / width), y2: Math.min(image.height, (b.y2 * image.height) / height),
  }))
}

import { context, writeChw } from './image'
import { ort } from './ort'
import { ctcDecode } from './ctc'
import type { Box, Recognized } from './types'

const HEIGHT = 48
/** Fixed widths keep the number of distinct input shapes small, which WebGPU compiles per shape. */
const WIDTHS = [320, 480, 640, 960, 1280, 1920, 2560, 3200] as const
const MAX_BATCH = 8
const VERTICAL_RATIO = 1.5

type Crop = { index: number; width: number; bucket: number; box: Box; vertical: boolean }

function planCrop(box: Box, index: number): Crop {
  const w = Math.max(1, box.x2 - box.x1)
  const h = Math.max(1, box.y2 - box.y1)
  const vertical = h >= w * VERTICAL_RATIO
  const widest = WIDTHS[WIDTHS.length - 1]!
  const width = Math.min(widest, Math.max(1, Math.round(HEIGHT * (vertical ? h / w : w / h))))
  return { index, width, bucket: WIDTHS.find((b) => b >= width) ?? widest, box, vertical }
}

function drawCrop(image: ImageBitmap, crop: Crop): Uint8ClampedArray {
  const { x1, y1, x2, y2 } = crop.box
  const ctx = context(crop.width, HEIGHT)
  if (crop.vertical) {
    // Tall lines are turned 90° counter-clockwise so the top of the line becomes its left end.
    ctx.translate(0, HEIGHT)
    ctx.rotate(-Math.PI / 2)
    ctx.drawImage(image, x1, y1, x2 - x1, y2 - y1, 0, 0, HEIGHT, crop.width)
  } else {
    ctx.drawImage(image, x1, y1, x2 - x1, y2 - y1, 0, 0, crop.width, HEIGHT)
  }
  return ctx.getImageData(0, 0, crop.width, HEIGHT).data
}

export async function recognize(
  session: ort.InferenceSession,
  image: ImageBitmap,
  boxes: readonly Box[],
  charset: readonly string[],
): Promise<Recognized[]> {
  const crops = boxes.map(planCrop).sort((a, b) => a.bucket - b.bucket)
  const results = new Array<Recognized>(boxes.length)
  const norm = { mean: [0.5, 0.5, 0.5], std: [0.5, 0.5, 0.5], bgr: true } as const

  for (let at = 0; at < crops.length;) {
    const bucket = crops[at]!.bucket
    let end = at
    while (end < crops.length && end - at < MAX_BATCH && crops[end]!.bucket === bucket) end++
    const batch = crops.slice(at, end)
    at = end

    const stride = 3 * HEIGHT * bucket
    const pixels = new Float32Array(batch.length * stride)
    batch.forEach((crop, i) =>
      writeChw(drawCrop(image, crop), crop.width, HEIGHT, pixels, i * stride, bucket, norm),
    )

    const out = await session.run({
      [session.inputNames[0]!]: new ort.Tensor('float32', pixels, [
        batch.length,
        3,
        HEIGHT,
        bucket,
      ]),
    })
    const { data, dims } = out[session.outputNames[0]!]!
    const steps = dims[1]!
    const classes = dims[2]!
    if (classes !== charset.length)
      throw new Error(
        `recognition model has ${classes} classes but the dictionary has ${charset.length}`,
      )
    batch.forEach((crop, i) => {
      results[crop.index] = ctcDecode(
        data as Float32Array,
        i * steps * classes,
        steps,
        classes,
        charset,
      )
    })
  }
  return results
}

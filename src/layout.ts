import { parseDetections } from './detections'
import { context, writeChw } from './image'
import { ort } from './ort'
import type { Region } from './types'

const SIZE = 800
export async function detectLayout(
  session: ort.InferenceSession,
  image: ImageBitmap,
): Promise<Region[]> {
  const ctx = context(SIZE, SIZE)
  ctx.drawImage(image, 0, 0, SIZE, SIZE)
  const pixels = new Float32Array(3 * SIZE * SIZE)
  writeChw(ctx.getImageData(0, 0, SIZE, SIZE).data, SIZE, SIZE, pixels, 0, SIZE, {
    mean: [0, 0, 0],
    std: [1, 1, 1],
    bgr: false,
  })

  const boxesName = session.outputNames[0]!
  const out = await session.run(
    {
      image: new ort.Tensor('float32', pixels, [1, 3, SIZE, SIZE]),
      im_shape: new ort.Tensor('float32', [SIZE, SIZE], [1, 2]),
      scale_factor: new ort.Tensor('float32', [SIZE / image.height, SIZE / image.width], [1, 2]),
    },
    [boxesName],
  )
  return parseDetections(out[boxesName]!.data as Float32Array, image.width, image.height)
}

import { createWriteStream } from 'node:fs'
import { mkdir, rename, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models')
const hf = (repo, file) => `https://huggingface.co/PaddlePaddle/${repo}/resolve/main/${file}`

const files = [
  { name: 'layout.onnx', url: hf('PP-DocLayoutV3_onnx', 'inference.onnx'), bytes: 130502049 },
  { name: 'det.onnx', url: hf('PP-OCRv6_small_det_onnx', 'inference.onnx'), bytes: 9880512 },
  { name: 'rec.onnx', url: hf('PP-OCRv6_small_rec_onnx', 'inference.onnx'), bytes: 21159378 },
  { name: 'rec.yml', url: hf('PP-OCRv6_small_rec_onnx', 'inference.yml') },
]

const sizeOf = (path) =>
  stat(path).then(
    (s) => s.size,
    () => -1,
  )

await mkdir(outDir, { recursive: true })
for (const { name, url, bytes } of files) {
  const path = join(outDir, name)
  const have = await sizeOf(path)
  if (bytes ? have === bytes : have > 0) {
    console.log(`skip  ${name}`)
    continue
  }
  console.log(`fetch ${name}  <- ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const tmp = `${path}.part`
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp))
  const got = await sizeOf(tmp)
  if (bytes && got !== bytes) throw new Error(`${name}: expected ${bytes} bytes, got ${got}`)
  await rename(tmp, path)
  console.log(`done  ${name}  ${got} bytes`)
}

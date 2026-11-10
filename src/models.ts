import type { ModelName } from './types'

const hf = (repo: string, revision: string, file: string) =>
  `https://huggingface.co/PaddlePaddle/${repo}/resolve/${revision}/${file}`

/** Each URL names a fixed revision, so the bytes behind it never change and can be cached forever. */
const SOURCES: Record<ModelName, { url: string; bytes: number }> = {
  layout: {
    url: hf('PP-DocLayoutV3_onnx', '46bbdf188bb0a772c08aed74882ce7e51a8f1ea6', 'inference.onnx'),
    bytes: 130502049,
  },
  det: {
    url: hf(
      'PP-OCRv6_small_det_onnx',
      '28fe5895c24fd108c19eb3e8479f4ab385fbfc62',
      'inference.onnx',
    ),
    bytes: 9880512,
  },
  rec: {
    url: hf(
      'PP-OCRv6_small_rec_onnx',
      'b8f84f0b80c529de40b4fbb3544b84fa7233a513',
      'inference.onnx',
    ),
    bytes: 21159378,
  },
  charset: {
    url: hf('PP-OCRv6_small_rec_onnx', 'b8f84f0b80c529de40b4fbb3544b84fa7233a513', 'inference.yml'),
    bytes: 150579,
  },
}

let opened: Promise<Cache | null> | null = null

/** Null where the Cache API is missing (an insecure origin) or refuses to open; models are then downloaded every time. */
function openCache(): Promise<Cache | null> {
  return (opened ??= (async () => {
    if (!('caches' in globalThis)) return null
    try {
      const cache = await caches.open('models')
      const current = new Set(Object.values(SOURCES).map((s) => s.url))
      for (const request of await cache.keys())
        if (!current.has(request.url)) await cache.delete(request)
      return cache
    } catch {
      return null
    }
  })())
}

async function download(
  name: ModelName,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const { url, bytes } = SOURCES[name]
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`${name}: HTTP ${response.status} (${url})`)
  const data = new Uint8Array(bytes)
  const reader = response.body.getReader()
  const step = bytes / 100
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (loaded + value.length > bytes) throw new Error(`${name}: larger than ${bytes} bytes`)
    data.set(value, loaded)
    const before = Math.floor(loaded / step)
    loaded += value.length
    if (Math.floor(loaded / step) > before) onProgress(loaded, bytes)
  }
  if (loaded !== bytes) throw new Error(`${name}: expected ${bytes} bytes, got ${loaded}`)
  return data
}

/** Returns the model's bytes from the browser cache, downloading and caching them on the first use. */
export async function fetchModel(
  name: ModelName,
  onProgress: (loaded: number, total: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const { url } = SOURCES[name]
  const cache = await openCache()
  const hit = await cache?.match(url)
  if (hit) return new Uint8Array(await hit.arrayBuffer())
  const data = await download(name, onProgress)
  // A full disk must not stop the analysis: the bytes are already in memory.
  await cache?.put(url, new Response(data)).catch(() => {})
  return data
}

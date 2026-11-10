/// <reference lib="webworker" />
import { groupByRegion, planLines } from './assign'
import { parseCharset } from './ctc'
import { detectLines } from './det'
import { detectLayout } from './layout'
import { fetchModel } from './models'
import { createSession, type ort } from './ort'
import { recognize } from './rec'
import type { Backend, ModelName, PageResult, Request, Response, Stage } from './types'

type Models = {
  backend: Backend
  det: ort.InferenceSession
  rec: ort.InferenceSession
  layout: ort.InferenceSession | null
}

let models: Models | null = null
let charset: string[] | null = null

const post = (message: Response) => self.postMessage(message)

const fetchBytes = (model: ModelName) =>
  fetchModel(model, (loaded, total) => post({ type: 'download', model, loaded, total }))

/** Sessions are created one at a time because the WebGPU provider rejects concurrent creation. */
async function load(backend: Backend, withLayout: boolean): Promise<Models> {
  if (models?.backend !== backend) {
    const previous = models
    models = null
    if (previous)
      await Promise.all(
        [previous.det, previous.rec, previous.layout].map((s) => s?.release() ?? Promise.resolve()),
      )
    charset ??= parseCharset(new TextDecoder().decode(await fetchBytes('charset')))
    const det = await createSession(await fetchBytes('det'), backend)
    const rec = await createSession(await fetchBytes('rec'), backend)
    models = { backend, det, rec, layout: null }
  }
  if (withLayout) models.layout ??= await createSession(await fetchBytes('layout'), backend)
  return models
}

async function analyze(
  image: ImageBitmap,
  backend: Backend,
  withLayout: boolean,
): Promise<PageResult> {
  const timings = { load: 0, layout: 0, det: 0, rec: 0 }
  const timed = async <T>(stage: Stage, work: () => Promise<T>): Promise<T> => {
    post({ type: 'progress', stage })
    const start = performance.now()
    const value = await work()
    timings[stage] = performance.now() - start
    return value
  }

  const { layout, det, rec } = await timed('load', () => load(backend, withLayout))
  const regions =
    withLayout && layout ? await timed('layout', () => detectLayout(layout, image)) : []
  const lineBoxes = await timed('det', () => detectLines(det, image))
  const planned = planLines(regions, lineBoxes)
  const texts = await timed('rec', () =>
    recognize(
      rec,
      image,
      planned.map((p) => p.box),
      charset!,
    ),
  )
  return {
    layout: withLayout,
    width: image.width,
    height: image.height,
    ...groupByRegion(regions, planned, texts),
    timings,
    backend,
  }
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    try {
      post({ type: 'result', result: await analyze(data.image, data.backend, data.layout) })
    } catch (error) {
      if (data.backend !== 'webgpu') throw error
      const result = await analyze(data.image, 'wasm', data.layout)
      post({ type: 'result', result: { ...result, fallbackReason: describe(error) } })
    }
  } catch (error) {
    post({ type: 'error', message: describe(error) })
  } finally {
    data.image.close()
  }
}

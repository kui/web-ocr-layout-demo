import * as ort from 'onnxruntime-web/webgpu'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type { Backend } from './types'

ort.env.wasm.wasmPaths = { mjs: mjsUrl, wasm: wasmUrl }

export { ort }

export function createSession(url: string, backend: Backend): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(url, {
    executionProviders: [backend],
    graphOptimizationLevel: 'all',
    logSeverityLevel: 3,
  })
}

import { defineConfig } from 'vite'

// SharedArrayBuffer (WASM threads) is only available on cross-origin isolated pages.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
})

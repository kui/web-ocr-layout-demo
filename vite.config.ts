import { defineConfig } from 'vite-plus'

// SharedArrayBuffer (WASM threads) is only available on cross-origin isolated pages.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
    sortPackageJson: false,
    ignorePatterns: ['dist/', 'public/models/', 'package-lock.json'],
  },
  server: { headers: isolation },
  preview: { headers: isolation },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  worker: { format: 'es' },
})

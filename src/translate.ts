import { Wllama } from '@wllama/wllama'
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url'
import { buildPrompt, STOP } from './prompt'

const MODEL_URL =
  'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/1cf96ae02133958a20074bfdfab76517bb737d00/plamo-3-translate-0.8b-Q4_K_M.gguf'

type Progress = (loaded: number, total: number) => void

let model: Promise<Wllama> | null = null
let onDownload: Progress = () => {}
let previous: Promise<unknown> = Promise.resolve()

function load(): Promise<Wllama> {
  if (model) return model
  const loading = (async () => {
    const wllama = new Wllama({ default: wasmUrl }, { suppressNativeLog: true })
    await wllama.loadModelFromUrl(MODEL_URL, {
      n_ctx: 4096,
      progressCallback: ({ loaded, total }) => onDownload(loaded, total),
    })
    return wllama
  })()
  loading.catch(() => (model = null))
  return (model = loading)
}

export async function translate(
  text: string,
  options: { onDownload: Progress; onPartial: (text: string) => void; signal: AbortSignal },
): Promise<void> {
  onDownload = options.onDownload
  const wllama = await load()
  let translated = ''
  // An aborted completion keeps the model busy until it returns.
  const completion = previous.then(() => {
    options.signal.throwIfAborted()
    return wllama.createCompletion({
      prompt: buildPrompt(text),
      max_tokens: 1024,
      temperature: 0,
      stop: STOP,
      abortSignal: options.signal,
      stream: true,
      onData: (chunk) => {
        translated += chunk.choices[0]?.text ?? ''
        options.onPartial(translated)
      },
    })
  })
  previous = completion.catch(() => {})
  await completion
  options.signal.throwIfAborted()
}

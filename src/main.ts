import {
  LAYOUT_LABELS,
  type Backend,
  type Box,
  type Char,
  type LayoutLabel,
  type Line,
  type PageResult,
  type Request,
  type Response,
  type ModelName,
  type Stage,
} from './types'
import { reflow } from './prompt'
import { translate } from './translate'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const status = $('status')
const page = $('page')
const image = $<HTMLImageElement>('image')
const boxes = $('boxes')
const panel = $('panel')
const tip = $('tip')
const labels = $('labels')
const score = $<HTMLInputElement>('score')
const layout = $<HTMLInputElement>('layout')
const copyAll = $<HTMLButtonElement>('copy-all')
const download = $<HTMLButtonElement>('download')
const translateAll = $<HTMLButtonElement>('translate')

/** One entry shown both as a box on the page and as a block in the text panel. */
type Item = {
  key: string
  title: string
  box: Box
  text: string
  lines: Line[]
  table?: string[][]
  color: string
  order: string
  orphan: boolean
}

const STAGE_TEXT: Record<Stage, string> = {
  load: 'モデルを読み込み中…',
  layout: 'レイアウトを認識中…',
  det: '文字を検出中…',
  rec: '文字を認識中…',
}
const MODEL_TEXT: Record<ModelName, string> = {
  layout: 'レイアウト認識モデル',
  det: '文字検出モデル',
  rec: '文字認識モデル',
  charset: '文字辞書',
}
const megabytes = (bytes: number) => (bytes / 1e6).toFixed(1)
const ORPHAN_COLOR = '#8a8d93'
/** Characters recognized with less confidence than this are marked and listed with their alternatives. */
const UNSURE = 0.8
const MAX_LISTED = 8
const LINE_COLOR = 'hsl(215 70% 45%)'

// Where the server does not send the isolation headers, a service worker adds them. They apply
// from the next page load, so the page reloads once when the worker first takes control.
if (!crossOriginIsolated && 'serviceWorker' in navigator) {
  const uncontrolled = !navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (uncontrolled) location.reload()
  })
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}coi-sw.js`)
}

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const hasWebGpu = 'gpu' in navigator

let backend: Backend = hasWebGpu ? 'webgpu' : 'wasm'
let source: Blob | null = null
let result: PageResult | null = null
let busy = false
let translating: AbortController | null = null
const translations = new Map<string, string>()
const hidden = new Set<LayoutLabel>()

const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')]

function syncTranslateButton() {
  translateAll.disabled = busy || !result || translating !== null
}

/** Switches are locked during a run so they always match the result on screen. */
function setBusy(value: boolean) {
  busy = value
  layout.disabled = value
  syncTranslateButton()
  for (const radio of radios) radio.disabled = value || (radio.value === 'webgpu' && !hasWebGpu)
}

const colorOf = (label: LayoutLabel) =>
  `hsl(${Math.round((LAYOUT_LABELS.indexOf(label) * 360) / LAYOUT_LABELS.length)} 70% 45%)`
const ms = (value: number) => `${Math.round(value)} ms`

function setStatus(text: string, error = false) {
  status.textContent = text
  status.classList.toggle('error', error)
}

const regionKey = (region: { id: number }) => `r${region.id}`
const orphanKey = (index: number) => `o${index}`

function visibleItems(): Item[] {
  if (!result) return []
  const minScore = Number(score.value)
  const regions = result.regions
    .filter(({ region }) => region.score >= minScore && !hidden.has(region.label))
    .map(({ region, text, lines, table }): Item => ({
      key: regionKey(region),
      title: `${region.order + 1}. ${region.label}（${region.score.toFixed(2)}）`,
      box: region.box,
      text,
      lines,
      table,
      color: colorOf(region.label),
      order: String(region.order + 1),
      orphan: false,
    }))
  const numbered = !result.layout
  const orphans = result.orphans.map((line, i): Item => ({
    key: orphanKey(i),
    title: numbered ? `${i + 1}. 行（${line.score.toFixed(2)}）` : '領域外のテキスト',
    box: line.box,
    text: line.text,
    lines: [line],
    color: numbered ? LINE_COLOR : ORPHAN_COLOR,
    order: numbered ? String(i + 1) : '',
    orphan: !numbered,
  }))
  return [...regions, ...orphans]
}

function element(tag: string, className: string, text?: string): HTMLElement {
  const el = document.createElement(tag)
  el.className = className
  if (text !== undefined) el.textContent = text
  return el
}

const percent = (value: number) => `${Math.round(value * 100)}%`
const SPACE_NAMES: Record<string, string> = { ' ': '空白', '\u3000': '全角空白' }
const candidates = (c: Char) =>
  [c, ...c.alts].map((a) => `${SPACE_NAMES[a.char] ?? a.char} ${percent(a.score)}`).join(' ／ ')
const unsureChars = (item: Item) =>
  item.lines.flatMap((line) => line.chars).filter((c) => c.score < UNSURE)

function content(item: Item): HTMLElement {
  if (!item.table) {
    const text = element('div', 'text')
    item.lines.forEach((line, i) => {
      if (i > 0) text.append('\n')
      for (const c of line.chars) {
        if (c.score >= UNSURE) {
          text.append(c.char)
          continue
        }
        text.appendChild(element('span', 'unsure', c.char)).title = candidates(c)
      }
    })
    text.normalize()
    return text
  }
  const table = element('table', 'grid')
  for (const cells of item.table) {
    const row = table.appendChild(document.createElement('tr'))
    for (const cell of cells) row.appendChild(document.createElement('td')).textContent = cell
  }
  return table
}

function setActive(key: string | null, scrollPanel = false) {
  for (const el of document.querySelectorAll<HTMLElement>('[data-key]'))
    el.classList.toggle('active', el.dataset.key === key)
  if (key && scrollPanel)
    panel.querySelector(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest' })
}

function showTip(item: Item, event: MouseEvent) {
  const unsure = unsureChars(item)
  const listed = unsure.slice(0, MAX_LISTED).map((c) => element('div', 'candidates', candidates(c)))
  if (unsure.length > MAX_LISTED)
    listed.push(element('div', 'meta', `ほか ${unsure.length - MAX_LISTED} 文字`))
  if (listed.length) listed.unshift(element('div', 'meta', '自信のない文字と候補'))
  tip.replaceChildren(element('div', 'meta', item.title), content(item), ...listed)
  tip.hidden = false
  const { width, height } = tip.getBoundingClientRect()
  tip.style.left = `${Math.max(8, Math.min(event.clientX + 14, innerWidth - width - 8))}px`
  tip.style.top = `${Math.max(8, Math.min(event.clientY + 14, innerHeight - height - 8))}px`
}

async function copy(text: string, what: string) {
  await navigator.clipboard.writeText(text)
  setStatus(`${what}をコピーしました。`)
}

function render() {
  const items = visibleItems()
  const { width = 1, height = 1 } = result ?? {}

  boxes.replaceChildren(
    ...items.map((item) => {
      const el = element('div', item.orphan ? 'box orphan' : 'box')
      el.dataset.key = item.key
      el.dataset.order = item.order
      el.style.setProperty('--c', item.color)
      el.style.left = `${(item.box.x1 / width) * 100}%`
      el.style.top = `${(item.box.y1 / height) * 100}%`
      el.style.width = `${((item.box.x2 - item.box.x1) / width) * 100}%`
      el.style.height = `${((item.box.y2 - item.box.y1) / height) * 100}%`
      el.addEventListener('mouseenter', () => setActive(item.key, true))
      el.addEventListener('mousemove', (event) => showTip(item, event))
      el.addEventListener('mouseleave', () => {
        setActive(null)
        tip.hidden = true
      })
      el.addEventListener('click', () => copy(item.text, item.title))
      return el
    }),
  )

  panel.replaceChildren(
    ...items.map((item) => {
      const el = element('div', 'block')
      el.dataset.key = item.key
      el.style.setProperty('--c', item.color)
      el.append(element('div', 'meta', item.title), content(item))
      const translation = translations.get(item.key)
      if (translation) el.append(element('div', 'translation', translation))
      el.addEventListener('mouseenter', () => setActive(item.key))
      el.addEventListener('mouseleave', () => setActive(null))
      el.addEventListener('click', () => copy(item.text, item.title))
      return el
    }),
  )

  const present = [...new Set(result?.regions.map(({ region }) => region.label))]
  labels.replaceChildren(
    ...present.map((label) => {
      const chip = element('button', 'chip', label) as HTMLButtonElement
      chip.type = 'button'
      chip.style.setProperty('--c', colorOf(label))
      chip.setAttribute('aria-pressed', String(!hidden.has(label)))
      chip.addEventListener('click', () => {
        if (!hidden.delete(label)) hidden.add(label)
        render()
      })
      return chip
    }),
  )

  $('score-value').textContent = Number(score.value).toFixed(2)
  copyAll.disabled = download.disabled = !result
  syncTranslateButton()
}

const withTranslations = (r: PageResult | null) =>
  r && {
    ...r,
    regions: r.regions.map((entry) => ({
      ...entry,
      translation: translations.get(regionKey(entry.region)),
    })),
    orphans: r.orphans.map((line, i) => ({ ...line, translation: translations.get(orphanKey(i)) })),
  }

function report(r: PageResult) {
  const t = r.timings
  const total = t.layout + t.det + t.rec
  const parts = [
    `${r.backend === 'webgpu' ? 'WebGPU' : 'WASM'}: 合計 ${ms(total)}`,
    r.layout ? `レイアウト ${ms(t.layout)}` : 'レイアウト なし',
    `文字検出 ${ms(t.det)}`,
    `文字認識 ${ms(t.rec)}`,
    `モデル読み込み ${ms(t.load)}`,
    r.layout ? `領域 ${r.regions.length} 件` : `行 ${r.orphans.length} 件`,
  ]
  if (r.fallbackReason)
    parts.unshift(`WebGPU で失敗したため WASM で実行しました（${r.fallbackReason}）`)
  setStatus(parts.join(' ／ '), Boolean(r.fallbackReason))
}

function showTranslation(key: string, text: string) {
  translations.set(key, text)
  const block = panel.querySelector(`[data-key="${key}"]`)
  if (!block) return
  const el = block.querySelector('.translation') ?? block.appendChild(element('div', 'translation'))
  el.textContent = text
}

async function translateVisible() {
  const { signal } = (translating = new AbortController())
  render()
  const items = visibleItems().filter(
    (item) => !item.table && item.text.trim() && !translations.has(item.key),
  )
  let current = ''
  try {
    for (const [i, item] of items.entries()) {
      current = item.key
      const progress = `翻訳中… ${i + 1} / ${items.length}`
      setStatus(progress)
      await translate(reflow(item.lines.map((line) => line.text)), {
        signal,
        onDownload: (loaded, total) =>
          signal.aborted ||
          setStatus(
            loaded < total
              ? `翻訳モデルをダウンロード中… ${megabytes(loaded)} / ${megabytes(total)} MB`
              : progress,
          ),
        onPartial: (text) => signal.aborted || showTranslation(item.key, text),
      })
    }
    setStatus(`${items.length} 件を翻訳しました。`)
  } catch (error) {
    if (signal.aborted) return
    translations.delete(current)
    setStatus(`翻訳に失敗しました: ${error instanceof Error ? error.message : String(error)}`, true)
  } finally {
    if (translating?.signal === signal) {
      translating = null
      render()
    }
  }
}

async function run() {
  if (!source || busy) return
  translating?.abort()
  translating = null
  translations.clear()
  setBusy(true)
  try {
    const bitmap = await createImageBitmap(source)
    worker.postMessage(
      { type: 'run', image: bitmap, backend, layout: layout.checked } satisfies Request,
      [bitmap],
    )
  } catch {
    setBusy(false)
    setStatus('この画像は読み込めませんでした。', true)
  }
}

function open(blob: Blob) {
  if (busy) return
  source = blob
  result = null
  URL.revokeObjectURL(image.src)
  image.src = URL.createObjectURL(blob)
  page.hidden = false
  $('drop').hidden = true
  render()
  void run()
}

worker.onmessage = ({ data }: MessageEvent<Response>) => {
  if (data.type === 'progress') return setStatus(STAGE_TEXT[data.stage])
  if (data.type === 'download')
    return setStatus(
      data.loaded < data.total
        ? `${MODEL_TEXT[data.model]}をダウンロード中… ${megabytes(data.loaded)} / ${megabytes(data.total)} MB`
        : STAGE_TEXT.load,
    )
  setBusy(false)
  if (data.type === 'error') return setStatus(`解析に失敗しました: ${data.message}`, true)
  result = data.result
  report(result)
  render()
}
worker.onerror = (event) => {
  setBusy(false)
  setStatus(`解析に失敗しました: ${event.message}`, true)
}

setBusy(false)
for (const radio of radios) {
  radio.checked = radio.value === backend
  radio.addEventListener('change', () => {
    backend = radio.value as Backend
    void run()
  })
}

const firstImage = (files: FileList | undefined | null) =>
  [...(files ?? [])].find((f) => f.type.startsWith('image/'))

$('pick').addEventListener('click', () => $('file').click())
$<HTMLInputElement>('file').addEventListener('change', (event) => {
  const input = event.currentTarget as HTMLInputElement
  const file = firstImage(input.files)
  if (file) open(file)
  input.value = ''
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sample]'))
  button.addEventListener('click', async () =>
    open(await (await fetch(`${import.meta.env.BASE_URL}samples/${button.dataset.sample}`)).blob()),
  )
translateAll.addEventListener('click', () => void translateVisible())
score.addEventListener('input', render)
layout.addEventListener('change', () => void run())

window.addEventListener('dragover', (event) => {
  event.preventDefault()
  document.body.classList.add('dragging')
})
window.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) document.body.classList.remove('dragging')
})
window.addEventListener('drop', (event) => {
  event.preventDefault()
  document.body.classList.remove('dragging')
  const file = firstImage(event.dataTransfer?.files)
  if (file) open(file)
  else setStatus('画像ファイルをドロップしてください。', true)
})
window.addEventListener('paste', (event) => {
  const file = firstImage(event.clipboardData?.files)
  if (file) open(file)
})

copyAll.addEventListener('click', () =>
  copy(
    visibleItems()
      .map((item) => item.text)
      .filter(Boolean)
      .join('\n\n'),
    '全文',
  ),
)
download.addEventListener('click', () => {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(
    new Blob([JSON.stringify(withTranslations(result), null, 2)], { type: 'application/json' }),
  )
  link.download = 'ocr-result.json'
  link.click()
  URL.revokeObjectURL(link.href)
})

render()

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
  type Stage,
} from './types'

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
const ORPHAN_COLOR = '#8a8d93'
/** Characters recognized with less confidence than this are marked and listed with their alternatives. */
const UNSURE = 0.8
const MAX_LISTED = 8
const LINE_COLOR = 'hsl(215 70% 45%)'

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const hasWebGpu = 'gpu' in navigator

let backend: Backend = hasWebGpu ? 'webgpu' : 'wasm'
let source: Blob | null = null
let result: PageResult | null = null
let busy = false
const hidden = new Set<LayoutLabel>()

const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="backend"]')]

/** Switches are locked during a run so they always match the result on screen. */
function setBusy(value: boolean) {
  busy = value
  layout.disabled = value
  for (const radio of radios) radio.disabled = value || (radio.value === 'webgpu' && !hasWebGpu)
}

const colorOf = (label: LayoutLabel) =>
  `hsl(${Math.round((LAYOUT_LABELS.indexOf(label) * 360) / LAYOUT_LABELS.length)} 70% 45%)`
const ms = (value: number) => `${Math.round(value)} ms`

function setStatus(text: string, error = false) {
  status.textContent = text
  status.classList.toggle('error', error)
}

function visibleItems(): Item[] {
  if (!result) return []
  const minScore = Number(score.value)
  const regions = result.regions
    .filter(({ region }) => region.score >= minScore && !hidden.has(region.label))
    .map(({ region, text, lines, table }): Item => ({
      key: `r${region.id}`,
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
    key: `o${i}`,
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

async function run() {
  if (!source || busy) return
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
$('sample').addEventListener('click', async () =>
  open(await (await fetch('/samples/sample-ja.png')).blob()),
)
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
    new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
  )
  link.download = 'ocr-result.json'
  link.click()
  URL.revokeObjectURL(link.href)
})

render()

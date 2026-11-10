export const LAYOUT_LABELS = [
  'abstract', 'algorithm', 'aside_text', 'chart', 'content', 'display_formula', 'doc_title',
  'figure_title', 'footer', 'footer_image', 'footnote', 'formula_number', 'header', 'header_image',
  'image', 'inline_formula', 'number', 'paragraph_title', 'reference', 'reference_content', 'seal',
  'table', 'text', 'vertical_text', 'vision_footnote',
] as const
export type LayoutLabel = (typeof LAYOUT_LABELS)[number]

/** Source-image pixel coordinates. */
export type Box = { x1: number; y1: number; x2: number; y2: number }

export type Region = { id: number; label: LayoutLabel; score: number; box: Box; order: number }
export type Candidate = { char: string; score: number }
/** One recognized character; `alts` are the next most likely characters at the same position. */
export type Char = Candidate & { alts: Candidate[] }
/** `text` is `chars` joined; `score` is their mean. */
export type Recognized = { text: string; score: number; chars: Char[] }
export type Line = Recognized & { box: Box }
/** `table` is the grid guessed for a table region; `text` is then its rows as tab-separated values. */
export type RegionText = { region: Region; lines: Line[]; text: string; table?: string[][] }

export type Backend = 'webgpu' | 'wasm'
export type Stage = 'load' | 'layout' | 'det' | 'rec'
export type Timings = Record<Stage, number>

export type PageResult = {
  /** False when layout detection was skipped; every line is then in `orphans`. */
  layout: boolean
  width: number
  height: number
  regions: RegionText[]
  orphans: Line[]
  timings: Timings
  backend: Backend
  /** Set when the requested backend failed and WASM ran instead. */
  fallbackReason?: string
}

export type Request = { type: 'run'; image: ImageBitmap; backend: Backend; layout: boolean }
export type Response =
  | { type: 'progress'; stage: Stage }
  | { type: 'result'; result: PageResult }
  | { type: 'error'; message: string }

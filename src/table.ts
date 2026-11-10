import type { Line } from './types'

type Span = { from: number; to: number }

const overlap = (a: Span, b: Span) => Math.min(a.to, b.to) - Math.max(a.from, b.from)

/**
 * Guesses a table's grid from where its text lines sit: lines that share a vertical band form a
 * row, and horizontal bands that lines occupy form the columns. Returns `null` when the lines do
 * not form at least a 2×2 grid. A line that spans several columns is placed in the first of them.
 */
export function toGrid(lines: readonly Line[]): string[][] | null {
  const rows: { span: Span; lines: Line[] }[] = []
  for (const line of [...lines].sort((a, b) => a.box.y1 + a.box.y2 - (b.box.y1 + b.box.y2))) {
    const span = { from: line.box.y1, to: line.box.y2 }
    const row = rows.at(-1)
    if (row && overlap(row.span, span) > 0.5 * Math.min(span.to - span.from, row.span.to - row.span.from)) {
      row.lines.push(line)
      row.span = { from: Math.min(row.span.from, span.from), to: Math.max(row.span.to, span.to) }
    } else {
      rows.push({ span, lines: [line] })
    }
  }

  // Narrow lines define the columns first, so a wide line bridging several of them does not merge them.
  const columns: Span[] = []
  for (const line of [...lines].sort((a, b) => a.box.x2 - a.box.x1 - (b.box.x2 - b.box.x1))) {
    const span = { from: line.box.x1, to: line.box.x2 }
    const hits = columns.filter((c) => overlap(c, span) > 0)
    if (hits.length === 0) columns.push(span)
    else if (hits.length === 1) Object.assign(hits[0]!, { from: Math.min(hits[0]!.from, span.from), to: Math.max(hits[0]!.to, span.to) })
  }
  columns.sort((a, b) => a.from - b.from)
  if (rows.length < 2 || columns.length < 2) return null

  return rows.map((row) => {
    const cells = columns.map(() => [] as Line[])
    for (const line of row.lines) {
      const span = { from: line.box.x1, to: line.box.x2 }
      const first = columns.findIndex((c) => overlap(c, span) > 0)
      cells[Math.max(0, first)]!.push(line)
    }
    return cells.map((cell) => cell.sort((a, b) => a.box.x1 - b.box.x1).map((l) => l.text).join(' '))
  })
}

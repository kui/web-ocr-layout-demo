import { describe, expect, it } from 'vite-plus/test'
import { ctcDecode, parseCharset } from '../src/ctc'
import { dbBoxes } from '../src/db'
import { parseDetections } from '../src/detections'

describe('parseCharset', () => {
  it('reads plain and quoted entries, with blank first and space last', () => {
    const yml =
      "PostProcess:\n  name: CTCLabelDecode\n  character_dict:\n  - '!'\n  - ''''\n  - $\n  - あ\n"
    expect(parseCharset(yml)).toEqual(['', '!', "'", '$', 'あ', ' '])
  })
})

describe('ctcDecode', () => {
  it('collapses repeats, skips blanks, and averages the kept probabilities', () => {
    const charset = ['', 'a', 'b']
    const steps = [
      [0.1, 0.8, 0.1],
      [0.1, 0.6, 0.3],
      [0.9, 0.05, 0.05],
      [0.1, 0.8, 0.1],
      [0.2, 0.2, 0.6],
    ]
    const decoded = ctcDecode(new Float32Array(steps.flat()), 0, steps.length, 3, charset)
    expect(decoded.text).toBe('aab')
    expect(decoded.score).toBeCloseTo((0.8 + 0.8 + 0.6) / 3)
  })

  it('lists the runner-up characters at each position, most likely first, without noise', () => {
    const charset = ['', 'a', 'b', 'c', 'd']
    const steps = [
      [0.05, 0.6, 0.05, 0.3, 0],
      [0.002, 0.002, 0.002, 0.99, 0.004],
    ]
    const { chars } = ctcDecode(new Float32Array(steps.flat()), 0, steps.length, 5, charset)
    expect(chars.map((c) => c.char)).toEqual(['a', 'c'])
    expect(chars[0]!.alts).toEqual([
      { char: 'c', score: expect.closeTo(0.3) },
      { char: 'b', score: expect.closeTo(0.05) },
    ])
    expect(chars[1]!.alts).toEqual([])
  })
})

describe('dbBoxes', () => {
  const options = { thresh: 0.3, boxThresh: 0.6, unclipRatio: 1.5, minSize: 3 }
  const map = (
    width: number,
    height: number,
    blobs: [number, number, number, number, number][],
  ) => {
    const prob = new Float32Array(width * height)
    for (const [x1, y1, x2, y2, p] of blobs)
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) prob[y * width + x] = p
    return prob
  }

  it('returns one grown box per confident blob', () => {
    const boxes = dbBoxes(
      map(100, 40, [
        [10, 10, 50, 20, 0.9],
        [60, 10, 90, 20, 0.9],
      ]),
      100,
      40,
      options,
    )
    const grow = (40 * 10 * 1.5) / (2 * 50)
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).toEqual({ x1: 10 - grow, y1: 10 - grow, x2: 50 + grow, y2: 20 + grow })
  })

  it('drops faint and tiny blobs', () => {
    expect(
      dbBoxes(
        map(100, 40, [
          [10, 10, 50, 20, 0.4],
          [60, 10, 62, 12, 0.9],
        ]),
        100,
        40,
        options,
      ),
    ).toEqual([])
  })
})

describe('parseDetections', () => {
  it('filters by score, removes same-label duplicates, and numbers regions in reading order', () => {
    const rows = new Float32Array([
      22, 0.9, 0, 100, 200, 200, 1, 22, 0.5, 2, 101, 201, 199, 2, 6, 0.8, 0, 0, 200, 50, 0, 22, 0.1,
      0, 300, 200, 400, 3,
    ])
    expect(parseDetections(rows, 1000, 1000).map((r) => [r.order, r.label, r.score])).toEqual([
      [0, 'doc_title', expect.closeTo(0.8)],
      [1, 'text', expect.closeTo(0.9)],
    ])
  })
})

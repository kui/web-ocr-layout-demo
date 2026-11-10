import { describe, expect, it } from 'vite-plus/test'
import { groupByRegion, planLines } from '../src/assign'
import type { Box, LayoutLabel, Region } from '../src/types'

const box = (x1: number, y1: number, x2: number, y2: number): Box => ({ x1, y1, x2, y2 })
const region = (id: number, b: Box, label: LayoutLabel = 'text'): Region => ({
  id,
  label,
  score: 0.9,
  box: b,
  order: id,
})

describe('planLines', () => {
  it('gives a line to the region that contains it', () => {
    const regions = [region(0, box(0, 0, 400, 300)), region(1, box(0, 400, 400, 700))]
    expect(planLines(regions, [box(10, 410, 390, 440)])).toEqual([
      { regionId: 1, box: box(10, 410, 390, 440) },
    ])
  })

  it('cuts a line that runs across two columns at the column edges', () => {
    const regions = [region(0, box(0, 0, 400, 300)), region(1, box(450, 0, 850, 300))]
    expect(planLines(regions, [box(10, 50, 840, 80)])).toEqual([
      { regionId: 0, box: box(10, 50, 400, 80) },
      { regionId: 1, box: box(450, 50, 840, 80) },
    ])
  })

  it('prefers the inner region when regions are nested', () => {
    const regions = [region(0, box(0, 0, 800, 600), 'table'), region(1, box(100, 100, 300, 140))]
    expect(planLines(regions, [box(105, 105, 295, 135)])).toEqual([
      { regionId: 1, box: box(105, 105, 295, 135) },
    ])
  })

  it('keeps a line outside every region as an orphan', () => {
    const line = box(500, 500, 700, 530)
    expect(planLines([region(0, box(0, 0, 400, 300))], [line])).toEqual([
      { regionId: null, box: line },
    ])
  })

  it('recognizes a line-shaped text region whole when no line was detected in it', () => {
    const title = region(0, box(0, 0, 400, 40), 'doc_title')
    expect(planLines([title], [])).toEqual([{ regionId: 0, box: title.box }])
  })

  it('leaves empty image regions and block-shaped text regions alone', () => {
    expect(
      planLines([region(0, box(0, 0, 400, 40), 'image'), region(1, box(0, 100, 400, 400))], []),
    ).toEqual([])
  })
})

describe('groupByRegion', () => {
  it('joins lines top to bottom and left to right, and drops blank results', () => {
    const regions = [region(0, box(0, 0, 400, 100))]
    const planned = [
      { regionId: 0, box: box(0, 50, 400, 80) },
      { regionId: 0, box: box(200, 0, 400, 30) },
      { regionId: 0, box: box(0, 2, 190, 32) },
      { regionId: 0, box: box(0, 90, 400, 100) },
      { regionId: null, box: box(0, 500, 100, 530) },
    ]
    const texts = ['二行目', '右', '左', ' ', '欄外'].map((text) => ({ text, score: 1, chars: [] }))
    const grouped = groupByRegion(regions, planned, texts)
    expect(grouped.regions[0]!.text).toBe('左\n右\n二行目')
    expect(grouped.orphans.map((o) => o.text)).toEqual(['欄外'])
  })
})

import { describe, expect, it } from 'vitest'
import { toGrid } from '../src/table'
import type { Line } from '../src/types'

const line = (text: string, x1: number, y1: number, x2: number, y2: number): Line => ({ text, score: 1, chars: [], box: { x1, y1, x2, y2 } })

describe('toGrid', () => {
  it('arranges lines into rows and columns, leaving missing cells empty', () => {
    const grid = toGrid([
      line('9.9 MB', 215, 52, 290, 78), line('モデル', 20, 10, 90, 36), line('用途', 420, 12, 470, 38),
      line('サイズ', 220, 11, 285, 37), line('Det', 30, 50, 70, 76),
    ])
    expect(grid).toEqual([['モデル', 'サイズ', '用途'], ['Det', '9.9 MB', '']])
  })

  it('puts a line that spans several columns in the first of them', () => {
    const grid = toGrid([
      line('見出し', 20, 0, 470, 26), line('a', 20, 40, 90, 66), line('b', 220, 40, 290, 66), line('c', 420, 40, 470, 66),
    ])
    expect(grid).toEqual([['見出し', '', ''], ['a', 'b', 'c']])
  })

  it('returns null when the lines do not form a grid', () => {
    expect(toGrid([line('一行目', 0, 0, 300, 20), line('二行目', 0, 30, 300, 50)])).toBeNull()
    expect(toGrid([line('a', 0, 0, 50, 20), line('b', 100, 0, 150, 20)])).toBeNull()
  })
})

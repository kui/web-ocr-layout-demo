import { describe, expect, it } from 'vite-plus/test'
import { buildPrompt, reflow } from '../src/prompt'

describe('reflow', () => {
  it('joins wrapped lines with spaces', () => {
    expect(reflow(['The meeting has been', 'moved to Monday.'])).toBe(
      'The meeting has been moved to Monday.',
    )
  })

  it('rejoins a word hyphenated at a line end', () => {
    expect(reflow(['an inter-', 'national standard'])).toBe('an international standard')
  })

  it('ignores blank lines and surrounding spaces', () => {
    expect(reflow([' one ', '', 'two'])).toBe('one two')
  })

  it('joins lines of a language written without spaces directly', () => {
    expect(reflow(['図書館は平日の', '夜9時まで開館します。'])).toBe(
      '図書館は平日の夜9時まで開館します。',
    )
  })

  it('returns an empty string for no lines', () => {
    expect(reflow([])).toBe('')
  })
})

describe('buildPrompt', () => {
  it('places the source text as the input and asks for Japanese', () => {
    expect(buildPrompt('Hello.')).toBe(
      '<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>Hello.<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>',
    )
  })
})

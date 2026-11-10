const UNSPACED = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/

export function reflow(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((text, line) => {
      if (text === '') return line
      if (text.endsWith('-')) return text.slice(0, -1) + line
      const unspaced = UNSPACED.test(text.at(-1) ?? '') && UNSPACED.test(line[0] ?? '')
      return unspaced ? text + line : `${text} ${line}`
    }, '')
}

/** PLaMo's raw translation prompt. The model writes the Japanese text after the last marker. */
export const buildPrompt = (text: string) =>
  `<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>${text}<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>`

export const STOP = ['<|plamo:tag|>', '<|plamo:bos|>']

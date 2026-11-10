export function reflow(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce(
      (text, line) =>
        text === '' ? line : text.endsWith('-') ? text.slice(0, -1) + line : `${text} ${line}`,
      '',
    )
}

/** PLaMo's raw translation prompt. The model writes the Japanese text after the last marker. */
export const buildPrompt = (text: string) =>
  `<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:msg|>${text}<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>`

export const STOP = ['<|plamo:tag|>', '<|plamo:bos|>']

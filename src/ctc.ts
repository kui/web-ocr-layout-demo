import type { Candidate, Char, Recognized } from './types'

/** Reads `PostProcess.character_dict` from the model's inference.yml into the CTC class table. */
export function parseCharset(yml: string): string[] {
  const lines = yml.split('\n')
  const start = lines.findIndex((l) => l.trimEnd() === '  character_dict:')
  if (start < 0) throw new Error('character_dict not found in recognition config')
  const chars = ['']
  for (let i = start + 1; lines[i]?.startsWith('  - '); i++) {
    const raw = lines[i]!.slice(4)
    chars.push(raw.startsWith("'") ? raw.slice(1, -1).replaceAll("''", "'") : raw)
  }
  chars.push(' ')
  return chars
}

/** Runner-up characters below this probability are noise. */
const MIN_ALT_SCORE = 0.01
const MAX_ALTS = 2

function runnersUp(
  probs: Float32Array,
  row: number,
  classes: number,
  best: number,
  charset: readonly string[],
): Candidate[] {
  const alts: { index: number; score: number }[] = []
  for (let c = 1; c < classes; c++) {
    const score = probs[row + c]!
    if (c === best || score < MIN_ALT_SCORE) continue
    alts.push({ index: c, score })
  }
  return alts
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ALTS)
    .map(({ index, score }) => ({ char: charset[index] ?? '', score }))
}

/** Greedy CTC over `steps` rows of `classes` probabilities; class 0 is the blank. */
export function ctcDecode(
  probs: Float32Array,
  offset: number,
  steps: number,
  classes: number,
  charset: readonly string[],
): Recognized {
  const chars: Char[] = []
  let previous = 0
  for (let t = 0; t < steps; t++) {
    const row = offset + t * classes
    let best = 0
    for (let c = 1; c < classes; c++) if (probs[row + c]! > probs[row + best]!) best = c
    if (best !== 0 && best !== previous) {
      chars.push({
        char: charset[best] ?? '',
        score: probs[row + best]!,
        alts: runnersUp(probs, row, classes, best, charset),
      })
    }
    previous = best
  }
  const total = chars.reduce((sum, c) => sum + c.score, 0)
  return {
    text: chars.map((c) => c.char).join(''),
    score: chars.length ? total / chars.length : 0,
    chars,
  }
}

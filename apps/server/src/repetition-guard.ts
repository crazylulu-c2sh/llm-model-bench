/**
 * Heuristic detector for degenerate (non-terminating) generation loops in streamed model output.
 *
 * Deliberately conservative — it must NOT fire on legitimate short or structured output (e.g. the
 * three overlapping dates of `chat_time_calendar`, normal prose, or short markdown lists). It only
 * flags substantial, unambiguous repetition so the bench loop guard can cancel the stream early.
 *
 * Two signals (either triggers):
 *   1. Trailing block repeat — the tail consists of a short unit (≤ MAX_UNIT chars) repeated
 *      ≥ MIN_BLOCK_REPEATS times AND spanning ≥ MIN_BLOCK_SPAN chars (so "aaaa…" needs many copies,
 *      a 30-char unit needs only a few).
 *   2. Trailing line repeat — the last MIN_LINE_REPEATS non-empty lines collapse to ≤ 2 distinct
 *      strings (a sentence/line echoed over and over).
 */

const MIN_LEN = 600; // ignore short outputs entirely
const TAIL_LEN = 400; // window examined for block repetition
const MAX_UNIT = 80; // max repeated-unit length to consider
const MIN_BLOCK_REPEATS = 4;
const MIN_BLOCK_SPAN = 120; // repeated span must dominate this many chars
const MIN_LINE_REPEATS = 6;
const MIN_LINE_LEN = 3; // ignore repeated tiny tokens (e.g. bullet dashes)

export type RepetitionLoopResult = { looping: boolean; kind?: string };

/** Count how many times the trailing `u`-char unit repeats consecutively at the end of `s`. */
function trailingRepeatCount(s: string, u: number): number {
  const unit = s.slice(s.length - u);
  let count = 1;
  let pos = s.length - 2 * u;
  while (pos >= 0 && s.slice(pos, pos + u) === unit) {
    count++;
    pos -= u;
  }
  return count;
}

function detectTrailingBlockRepeat(tail: string): string | null {
  const maxU = Math.min(MAX_UNIT, Math.floor(tail.length / 2));
  for (let u = 1; u <= maxU; u++) {
    const unit = tail.slice(tail.length - u);
    if (unit.trim().length === 0) continue; // skip whitespace-only units
    const repeats = trailingRepeatCount(tail, u);
    if (repeats >= MIN_BLOCK_REPEATS && u * repeats >= MIN_BLOCK_SPAN) {
      return `block_unit${u}_x${repeats}`;
    }
  }
  return null;
}

function detectTrailingLineRepeat(text: string): string | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < MIN_LINE_REPEATS) return null;
  const lastN = lines.slice(-MIN_LINE_REPEATS);
  const distinct = new Set(lastN);
  if (distinct.size <= 2 && [...distinct].every((l) => l.length >= MIN_LINE_LEN)) {
    return `lines_${distinct.size}distinct`;
  }
  return null;
}

export function detectRepetitionLoop(text: string): RepetitionLoopResult {
  if (!text || text.length < MIN_LEN) return { looping: false };
  const block = detectTrailingBlockRepeat(text.slice(-TAIL_LEN));
  if (block) return { looping: true, kind: block };
  const line = detectTrailingLineRepeat(text);
  if (line) return { looping: true, kind: line };
  return { looping: false };
}

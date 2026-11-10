/* A SIGN'S WORDS, broken into the lines that fit it (2026-11-08; world/sign-art
 * draws them). `measure(text)` is how wide some text is. */
/* `text` broken into lines no wider than `width` by `measure`: at its own
 * line breaks, then between words, and inside a word too long for a line. */
export function wrapLines(text, width, measure) {
  const out = [];
  for (const para of String(text ?? '').replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= width) { line = next; continue; }
      if (line) out.push(line);
      line = '';
      let rest = word;
      while (measure(rest) > width && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && measure(rest.slice(0, n)) > width) n--;
        out.push(rest.slice(0, n)); rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}

/* The lines that fit `rows`, the last ending in "…" when some did not. */
export function fitLines(lines, rows, width, measure) {
  if (lines.length <= rows) return lines;
  const kept = lines.slice(0, Math.max(0, rows));
  if (!kept.length) return kept;
  let last = `${kept[kept.length - 1]}…`;
  while (last.length > 1 && measure(last) > width) last = `${last.slice(0, -2)}…`;
  kept[kept.length - 1] = last;
  return kept;
}

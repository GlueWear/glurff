const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Bios are plain text with one convenience: http(s) links. Scan the raw text
 * and escape each segment after splitting so markup in a bio can never become
 * markup in Glurff. */
const BIO_URL_RE = /https?:\/\/[^\s<>"']+/g;
export function bioHtml(raw) {
  const src = String(raw ?? '');
  let out = '', last = 0, match;
  BIO_URL_RE.lastIndex = 0;
  while ((match = BIO_URL_RE.exec(src)) !== null) {
    let url = match[0], trail = '';
    for (;;) {
      const c = url.slice(-1);
      if (c && '.,;:!?'.includes(c)) { trail = c + trail; url = url.slice(0, -1); continue; }
      if (c === ')' && (url.split('(').length - 1) < (url.split(')').length - 1)) {
        trail = c + trail; url = url.slice(0, -1); continue;
      }
      break;
    }
    out += esc(src.slice(last, match.index));
    out += url
      ? `<a class="card-bio-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${esc(trail)}`
      : esc(match[0]);
    last = match.index + match[0].length;
  }
  return (out + esc(src.slice(last))).replace(/\n/g, '<br>');
}

export function externalAvatar(url) {
  const value = String(url ?? '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return value;
  } catch { return null; }
}

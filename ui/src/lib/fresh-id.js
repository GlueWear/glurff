/* A FRESH LABEL (2026-11-17): a random id that tells one thing from another --
 * this tab, our presence, a chat message, a roll, a poll, an arrow, a nock.
 *
 * `crypto.randomUUID` is the browser's own, but browsers give it only to a
 * secure page (https://, or localhost). A ship opened over plain http:// has
 * none, and calling it there threw while the page was starting, which left
 * the loading screen frozen for good. These labels are never secrets, only
 * names for things, so without it we make the same shape of label from the
 * browser's random numbers (which every page has), or at worst Math.random. */
export function freshId(c = globalThis.crypto) {
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;   // version 4
  b[8] = (b[8] & 0x3f) | 0x80;   // variant 10
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* For the modules that take a `random` with a randomUUID, as tests give them. */
export const freshIds = { randomUUID: () => freshId() };

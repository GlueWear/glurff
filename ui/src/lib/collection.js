/* WHAT WE HAVE COLLECTED (2026-11-08): the collectibles we have found, in
 * every Glurff, kept in our own settings (lib/clocks) so they follow us to
 * any browser -- `found`, each host's ids. Nobody else's ship keeps them.
 *
 * In the Glurff we are in, which of its collectibles we have rides our
 * presence, as their places in its list (`found`), so the people here see
 * them on our profile card. It is our own word: a collection is ours, and
 * nothing is won by it. */
export const FOUND_MAX = 256;
/* Our settings stay under what our agent keeps (prefs-max in sur/glurff). */
export const SETTINGS_MAX = 30_000;

const ids = (settings, host) => {
  const list = settings?.found?.[host];
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
};

/* Of `items` (this Glurff's collectibles), the ids we have found. */
export const foundIn = (settings, host, items) => {
  const have = new Set(ids(settings, host));
  return items.filter((it) => have.has(it.id)).map((it) => it.id);
};

/* Our settings with one more found, or null if they would grow too big. */
export function withFound(settings, host, id) {
  const list = ids(settings, host);
  if (list.includes(id)) return settings;
  const next = { ...settings, found: { ...(settings?.found ?? {}), [host]: [...list, id].slice(-FOUND_MAX) } };
  return JSON.stringify(next).length > SETTINGS_MAX ? null : next;
}

/* Every other Glurff we have found things in: {host, count}. */
export const elsewhere = (settings, host) => Object.entries(settings?.found ?? {})
  .filter(([h, list]) => h !== host && Array.isArray(list) && list.length)
  .map(([h, list]) => ({ host: h, count: list.length }));

/* What somebody's presence says they have, as places in `items`: checked. */
export const foundFrom = (raw, items) => (Array.isArray(raw)
  ? [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 0 && n < items.length))].slice(0, FOUND_MAX) : []);

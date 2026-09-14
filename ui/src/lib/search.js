/* Search, the way Noltbook's own sidebar does it.
 *
 * Three groups: notes by name; messages by body, which only the ship can
 * search, so those arrive later as a `search-result`; and people by @p or
 * display name. A whole @p that nobody here has heard of is offered as a
 * lookup. The rules -- two characters before bodies are searched, cover and
 * the ars-* system notes skipped, contacts then pals then names -- are
 * Noltbook's, so the two bars agree.
 *
 * Pure: the caller passes Noltbook's state in.
 */
import * as ob from 'urbit-ob';

/* The bundler exposes urbit-ob's functions by name; plain Node only as default. */
const isValidPatp = ob.isValidPatp ?? ob.default?.isValidPatp;

export const MIN_BODY_QUERY = 2;
export const normalizeSearch = (s) => String(s ?? '').trim().toLowerCase().replace(/^[@~]+/, '');

/* A typed string that is a real @p, other than our own. */
export function shipCandidate(query, our) {
  const s = normalizeSearch(query);
  if (!s || s.length > 64) return null;
  const ship = '~' + s;
  if (ship === our) return null;
  try { return isValidPatp(ship) ? ship : null; } catch { return null; }
}

export function searchableShips(state, our) {
  const set = new Set([
    ...Object.keys(state.contacts ?? {}), ...Object.keys(state.pals ?? {}), ...Object.keys(state.profiles ?? {}),
  ]);
  for (const n of Object.values(state.notes ?? {})) {
    for (const s of n?.users ?? []) set.add(s);
    for (const s of n?.removed ?? []) set.add(s);
  }
  for (const [id, rows] of Object.entries(state.messages ?? {})) {
    if (id.startsWith('ars-')) continue;            //  rumor authors are a placeholder, not people
    for (const m of rows ?? []) if (m?.author) set.add(m.author);
  }
  set.delete(our);
  return set;
}

export function runSearch(query, state, { our, hits = null } = {}) {
  const q = String(query ?? '').trim(), nq = normalizeSearch(q);
  if (!nq) return { notes: [], messages: [], people: [], unknownShip: null, tooShort: false, capped: false };
  /* DMs are reached through PEOPLE, which opens the conversation, so they are
   * not listed a second time as notes. */
  const notes = Object.values(state.notes ?? {})
    .filter((n) => n?.id && n.id !== 'cover' && !String(n.id).startsWith('ars-') && n.type !== 'dm' &&
      String(n.name ?? '').toLowerCase().includes(nq))
    .sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
  const tooShort = nq.length < MIN_BODY_QUERY;
  /* Only an answer to exactly what is typed now; fast typing leaves stale ones. */
  const current = !tooShort && !!hits && hits.query === q;
  const messages = current && Array.isArray(hits.hits) ? hits.hits : [];
  const name = (s) => state.profiles?.[s]?.displayName || '';
  const known = searchableShips(state, our);
  const people = [...known]
    .filter((s) => s.toLowerCase().includes(nq) || name(s).toLowerCase().includes(nq))
    .sort((a, b) => (state.contacts?.[a] ? 0 : 1) - (state.contacts?.[b] ? 0 : 1) ||
      (state.pals?.[a] ? 0 : 1) - (state.pals?.[b] ? 0 : 1) ||
      (name(a) || a).toLowerCase().localeCompare((name(b) || b).toLowerCase()));
  const candidate = shipCandidate(q, our);
  return {
    notes, messages, people, tooShort, capped: current && !!hits.capped,
    unknownShip: candidate && !known.has(candidate) ? candidate : null,
  };
}

/* A NOTE'S LINK, as Noltbook copies one (Copy Note Link): ~ref[note|~host|name],
 * the name url-encoded. A Glurff's invite link is its note's, so pasted into
 * Noltbook it is that note's link there too (lib/glurffs); in Glurff it is
 * drawn as the note (ui/media, ui/content-card). A secret note has none. */
export const NOTE_REF = /~ref\[([^\]|\s]+)\|(~[a-z-]+)(?:\|([^\]\s]*))?\]/;
export const inviteLink = (note, host, name = '') =>
  `~ref[${note}|${host}${name ? `|${encodeURIComponent(name)}` : ''}]`;
export const noteName = (s) => { try { return decodeURIComponent(s ?? ''); } catch { return s ?? ''; } };

/* A NOTE'S ICON (2026-11-07), where Noltbook's own page finds it
 * (resolveNoteIconUrl): one uploaded to a note of ours is ours to serve; one
 * uploaded to a note somebody else hosts our own ship fetches from them, for
 * a note we are in; an icon given as an https address is that address.
 * Anything else -- a pointer naming another note, a note we do not have --
 * is no icon. `rev`, after a change, makes the browser fetch it again. */
export function noteIconUrl(note, our, rev = null) {
  const url = note?.iconUrl;
  if (!url) return null;
  const q = rev ? `?v=${rev}` : '';
  if (url.startsWith('/apps/noltbook/icon/')) {
    if (url !== `/apps/noltbook/icon/${note.id}`) return null;
    if (note.creator === our) return url + q;
    if (!/^~[a-z-]+$/.test(note.creator ?? '')) return null;
    return `/apps/noltbook/note-icon/${encodeURIComponent(note.creator)}/${encodeURIComponent(note.id)}${q}`;
  }
  return /^https:\/\/[^\s"'<>]+$/.test(url) ? url : null;
}

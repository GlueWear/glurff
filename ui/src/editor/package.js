/* THE PORTABLE WORLD (2026-11-05): one file carrying a whole Glurff -- its
 * project document and every image it uses, the original imports included --
 * to be built on one ship and installed on another without drawing anything
 * again. The format, "GWP1":
 *
 *   "GWP1\n"            five bytes
 *   header length       four bytes, big-endian
 *   header              UTF-8 JSON:
 *     { format: 'glurff-world', version: 1, made, from: {host, note, release},
 *       doc,            the world document (world/world-doc), as it was saved
 *       bindings,       what in it points outside the world (see `bindingsOf`)
 *       assets: [{hash, mime, size, w, h, offset}] }
 *   the assets          their bytes, one after another, at their offsets
 *
 * An asset's hash is the SHA-256 of its bytes, as the host's store names it,
 * so every byte is checked on the way in; a package with a missing, extra or
 * altered asset is refused whole. Nothing of a host's live state travels:
 * not its members, calls, visitors, moderation or credentials -- only the
 * world.
 */
const MAGIC = new TextEncoder().encode('GWP1\n');

export async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* Every hash a project needs: its assets table, and each map's original
 * import, kept so the owner can crop it again. */
export function hashesOf(doc) {
  const out = new Set(Object.keys(doc.assets ?? {}));
  for (const m of doc.maps ?? []) if (m.source?.src) out.add(m.source.src);
  return [...out];
}

/* WHAT POINTS OUTSIDE THE WORLD, to be looked at when it is installed
 * somewhere else: notes areas are bound to, the notes artifacts come from,
 * other Glurffs travelled to, and apps' publishers and contexts. A world's
 * own host is written HOST in an app spot and needs no retargeting. */
export function bindingsOf(doc) {
  const out = [];
  for (const m of doc.maps ?? []) {
    for (const a of m.areas ?? []) if (a.mode === 'note') out.push({ kind: 'note', where: `area ${a.id}`, note: a.note, host: a.noteHost ?? null });
    for (const it of m.items ?? []) {
      const d = it.do ?? {};
      if (d.kind === 'artifact') out.push({ kind: 'note', where: `item ${it.id}`, note: d.note, host: null });
      if (d.kind === 'travel') out.push({ kind: 'world', where: `item ${it.id}`, host: d.host });
      if (d.kind === 'app' && d.publisher !== 'HOST') out.push({ kind: 'app', where: `item ${it.id}`, desk: d.desk, host: d.publisher });
      if (d.kind === 'app') for (const [k, v] of Object.entries(d.context ?? {})) if (/^~[a-z-]+$/.test(v) || /^note-/.test(v)) out.push({ kind: 'context', where: `item ${it.id}`, key: k, value: v });
      /* A character's choices (2026-11-08) point out of the world as items do. */
      for (const [i, c] of (d.kind === 'npc' ? d.choices ?? [] : []).entries()) {
        if (c.do?.kind === 'travel') out.push({ kind: 'world', where: `item ${it.id} choice ${i + 1}`, host: c.do.host });
        if (c.do?.kind === 'app' && c.do.publisher !== 'HOST') out.push({ kind: 'app', where: `item ${it.id} choice ${i + 1}`, desk: c.do.desk, host: c.do.publisher });
      }
    }
  }
  return out;
}

/* A package, from a document and its assets' bytes (hash -> Uint8Array);
 * `meta` says what an asset outside the assets table is (an original
 * import): hash -> {mime, w, h}. */
export function pack(doc, bytes, from = {}, meta = {}) {
  const known = { ...meta, ...(doc.assets ?? {}) };
  const assets = [];
  let offset = 0;
  for (const hash of hashesOf(doc)) {
    const b = bytes.get(hash);
    if (!b) throw new Error(`the asset ${hash.slice(0, 8)} is missing`);
    const m = known[hash] ?? {};
    if (!m.mime) throw new Error(`what the asset ${hash.slice(0, 8)} is, is not known`);
    assets.push({ hash, mime: m.mime, size: b.length, w: m.w ?? null, h: m.h ?? null, offset });
    offset += b.length;
  }
  const header = new TextEncoder().encode(JSON.stringify({ format: 'glurff-world', version: 1, made: new Date().toISOString(),
    from, doc, bindings: bindingsOf(doc), assets }));
  const out = new Uint8Array(MAGIC.length + 4 + header.length + offset);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, header.length);
  out.set(header, MAGIC.length + 4);
  const base = MAGIC.length + 4 + header.length;
  for (const a of assets) out.set(bytes.get(a.hash), base + a.offset);
  return out;
}

/* A package opened and checked: {header, doc, assets: hash -> {mime, w, h,
 * bytes}}. Throws, saying why, on anything not exactly as it claims. */
export async function unpack(file) {
  const all = new Uint8Array(file);
  if (all.length < MAGIC.length + 4 || MAGIC.some((b, i) => all[i] !== b)) throw new Error('This is not a Glurff world package.');
  const n = new DataView(all.buffer, all.byteOffset).getUint32(MAGIC.length);
  const start = MAGIC.length + 4;
  if (start + n > all.length) throw new Error('The package is cut short.');
  let header;
  try { header = JSON.parse(new TextDecoder().decode(all.subarray(start, start + n))); } catch { throw new Error('The package\'s header is not readable.'); }
  if (header.format !== 'glurff-world' || header.version !== 1) throw new Error(`Unsupported package (${header.format} ${header.version}).`);
  const base = start + n;
  const assets = new Map();
  let end = base;
  for (const a of header.assets ?? []) {
    const from = base + a.offset, to = from + a.size;
    if (!Number.isInteger(a.offset) || !Number.isInteger(a.size) || to > all.length) throw new Error(`The asset ${String(a.hash).slice(0, 8)} is cut short.`);
    if (typeof a.mime !== 'string' || !a.mime) throw new Error(`The package does not say what ${String(a.hash).slice(0, 8)} is.`);
    const bytes = all.slice(from, to);
    if (await sha256(bytes) !== a.hash) throw new Error(`The asset ${String(a.hash).slice(0, 8)} does not match its hash.`);
    assets.set(a.hash, { mime: a.mime, w: a.w, h: a.h, bytes });
    end = Math.max(end, to);
  }
  if (end !== all.length) throw new Error('The package has bytes it does not account for.');
  for (const h of hashesOf(header.doc)) if (!assets.has(h)) throw new Error(`The package is missing the asset ${h.slice(0, 8)}.`);
  return { header, doc: header.doc, assets };
}

/* The document with its outside references moved: `map` is
 * {notes: {old: {note, host}}, worlds: {old: new}, publishers: {old: new}}. */
export function retarget(doc, map = {}) {
  const d = structuredClone(doc);
  const note = (id) => map.notes?.[id] ?? null;
  for (const m of d.maps ?? []) {
    for (const a of m.areas ?? []) if (a.mode === 'note' && note(a.note)) { const n = note(a.note); a.note = n.note; if (n.host) a.noteHost = n.host; else delete a.noteHost; }
    for (const it of m.items ?? []) {
      const x = it.do ?? {};
      if (x.kind === 'artifact' && note(x.note)) x.note = note(x.note).note;
      if (x.kind === 'travel' && map.worlds?.[x.host]) x.host = map.worlds[x.host];
      if (x.kind === 'app' && map.publishers?.[x.publisher]) x.publisher = map.publishers[x.publisher];
      if (x.kind === 'app') for (const [k, v] of Object.entries(x.context ?? {})) {
        if (map.notes?.[v]) x.context[k] = map.notes[v].note;
        else if (map.publishers?.[v]) x.context[k] = map.publishers[v];
      }
      for (const c of (x.kind === 'npc' ? x.choices ?? [] : [])) {
        if (c.do?.kind === 'travel' && map.worlds?.[c.do.host]) c.do.host = map.worlds[c.do.host];
        if (c.do?.kind === 'app' && map.publishers?.[c.do.publisher]) c.do.publisher = map.publishers[c.do.publisher];
      }
    }
  }
  return d;
}

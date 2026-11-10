/* THE HOST'S WORLD API, from its own browser (2026-11-05): what the editor
 * and the playtest ask our own agent. Every call is refused unless this page
 * is logged into the host ship itself and its operator has turned editing on
 * (app/glurff.hoon, `world-http` and `operate`): this page holds no
 * permission of its own.
 *
 *   home()                  hosting? its note, edit, live release, draft
 *   draft()                 {rev, doc (hash), at} or null
 *   documentOf(hash)        a document we hold, parsed
 *   putAsset(blob, mime)    keep some bytes: {hash, mime, size, w, h}
 *   saveDraft(doc, base)    save over revision `base`: {rev, doc}; a newer
 *                           saved draft refuses it (`conflict`)
 *   publish(rev)            check draft `rev` and make it live: {release, doc},
 *                           or the reasons it cannot be (`errors`)
 *   makeLive(n)             give visitors release n again
 *   releases()              {live, releases: [{release, doc, rev, schema, at}]}
 *   forget(n)               delete release n (never the live one): what is
 *                           left, as releases() says it
 *   start()                 host a Glurff, with editing on, if we do not --
 *                           with no note yet (2026-11-10): home() again
 *   setNote(id)             give it its note, made at its first publish;
 *                           once only: home() again
 */
const API = '/apps/glurff/api';

export class HostError extends Error {
  constructor(status, body) {
    super(body?.errors?.[0] ?? `the host answered ${status}`);
    this.status = status; this.body = body; this.errors = body?.errors ?? []; this.conflict = status === 409;
  }
}

/* A SHIP THAT DOES NOT ANSWER (2026-11-07): one busy with something long --
 * writing a snapshot, say -- answers nothing for a while, and a page waiting
 * on it forever looks frozen. Every call gives up after `wait`, saying so;
 * what it asked may still be done when the ship catches up. */
export const WAIT = { read: 30_000, save: 60_000, long: 120_000 };
export async function reach(url, init = {}, wait = WAIT.read) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), wait);
  try {
    const r = await fetch(url, { credentials: 'include', ...init, signal: ctrl.signal });
    return { r, body: await (/json/.test(r.headers.get('content-type') ?? '') ? r.json().catch(() => null) : r.arrayBuffer().then(() => null)) };
  } catch (e) {
    throw new HostError(0, { errors: [ctrl.signal.aborted ? `your ship did not answer for ${Math.round(wait / 1000)} seconds` : 'your ship could not be reached'] });
  } finally { clearTimeout(timer); }
}

async function call(path, init = {}, wait = WAIT.read) {
  const { r, body } = await reach(`${API}/${path}`, init, wait);
  if (!r.ok) throw new HostError(r.status, body);
  return body;
}

export const ourShip = () => `~${String(globalThis.window?.ship ?? '').replace(/^~/, '')}`;
export const assetUrl = (hash) => `/apps/glurff/world/${ourShip()}/asset/${hash}`;

export const home = () => call('home');
export const draft = () => call('draft');
export const releases = () => call('releases');
export const makeLive = (n) => call(`live?release=${n}`, { method: 'POST' }, WAIT.save);
export const forget = (n) => call(`forget?release=${n}`, { method: 'POST' }, WAIT.save);
export const publish = (rev) => call(`publish?rev=${rev}`, { method: 'POST' }, WAIT.long);
export const start = () => call('start', { method: 'POST' }, WAIT.save);
export const setNote = (id) => call(`note?id=${encodeURIComponent(id)}`, { method: 'POST' }, WAIT.save);

export async function documentOf(hash) {
  const { r, body } = await reach(assetUrl(hash));
  if (!r.ok || !body) throw new HostError(r.status, null);
  return body;
}

export async function putAsset(blob, mime) {
  return call('asset', { method: 'PUT', headers: { 'Content-Type': mime }, body: blob }, WAIT.long);
}

export async function saveDraft(doc, base) {
  return call(`draft?base=${base}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) }, WAIT.save);
}

/* The project to edit: the saved draft, else the live release, else none. */
export async function openProject() {
  const h = await home();
  if (!h.hosting) return { home: h, doc: null, rev: 0 };
  const d = h.edit ? await draft() : null;
  if (d) return { home: h, doc: await documentOf(d.doc), rev: d.rev };
  if (h.live != null) {
    const all = await releases();
    const live = all.releases.find((r) => r.release === all.live);
    if (live) return { home: h, doc: await documentOf(live.doc), rev: 0 };
  }
  return { home: h, doc: null, rev: 0 };
}

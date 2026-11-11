/* THE WAY IN, first: WHICH GLURFF (2026-11-05).
 *
 * A page visits one Glurff. Before the app is loaded, this settles which and
 * what it is: the world named in the address (?w=~host), or the official one
 * if none is; its host's card, which says its note and its published release;
 * and that release's document, fetched through our own ship and checked.
 * Then lib/world-config is set, and only then is the app loaded, so every
 * module reads the right host, note and maps from its first line. Going to
 * another Glurff is loading the page again: nothing of the old visit -- a
 * call, a relay packet, a timer -- can reach into the new one.
 *
 * Every world, the official one too (2026-11-10: the app carries no map of
 * its own), must be there and published: one that cannot be had is said so,
 * with Try again and the way back -- never silently swapped for another, which
 * would only look like being in it.
 *
 * HOME (2026-11-07): with no Glurff named, the one our settings call home
 * (lib/glurffs), read from our agent before anything else -- the official one
 * until another is chosen. A Glurff we are not a member of offers to join it,
 * as its note would: a public one lets us straight in, a private one asks.
 * The official one is joined for us instead (2026-11-10): everybody is in it,
 * as when the app carried its map and joined its note behind it.
 */
import { DEFAULT_HOST, setWorld } from './lib/world-config.js';
import { validate } from './world/world-doc.js';
import { cardOf } from './lib/world-card.js';
import { OFFLINE, whyOffline } from './lib/glurff-online.js';
import * as ob from 'urbit-ob';
/* The bundler exposes urbit-ob's functions by name; plain Node only as default. */
const isPatp = ob.isValidPatp ?? ob.default?.isValidPatp;

const screen = globalThis.glurffLoading ?? null;

/* The host named in the address, the official one if none is, or null for
 * something that is not a ship. */
export function chosenHost(search = globalThis.location?.search ?? '') {
  const w = new URLSearchParams(search).get('w');
  if (!w) return DEFAULT_HOST;
  const host = `~${w.trim().replace(/^~/, '').toLowerCase()}`;
  return /^~[a-z]{3}(-?[a-z]{3}){0,7}$/.test(host) && isPatp(host) ? host : null;
}

/* The published document, as the host's ship holds it, checked here too:
 * a world that would not load is not started. */
async function documentOf(host, live, card = null) {
  const r = await fetch(`/apps/glurff/world/${host}/asset/${live.doc}`, { credentials: 'include' });
  if (r.status === 403) throw Object.assign(refusal(`You are not in ${card?.name ?? 'this Glurff'} yet`,
    `Its members are its note's. Join it, as you would the note: a public Glurff lets you straight in, and a private one asks ${host}.`),
  { join: card && { host, note: card.note, name: card.name, live } });
  if (!r.ok) throw refusal('This Glurff did not load', `Its map did not arrive (${r.status}).`);
  let doc;
  try { doc = await r.json(); } catch { throw refusal('This Glurff did not load', 'Its map is not readable.'); }
  const errors = validate(doc, null, { loading: true });
  if (errors.length) throw refusal('This Glurff did not load', `Its map is not usable: ${errors[0]}.`);
  return doc;
}

const refusal = (title, detail) => Object.assign(new Error(title), { title, detail });

/* Where Glurff opens with no Glurff named: home, from our settings. */
async function homeHost() {
  try {
    const r = await fetch('/~/scry/glurff/prefs.json', { credentials: 'include' });
    if (!r.ok) return DEFAULT_HOST;
    const home = JSON.parse((await r.json()) || '{}')?.home;
    return typeof home === 'string' && chosenHost(`?w=${home}`) === home ? home : DEFAULT_HOST;
  } catch { return DEFAULT_HOST; }
}
const named = () => new URLSearchParams(globalThis.location?.search ?? '').has('w');

export async function chooseWorld() {
  const host = named() ? chosenHost() : await homeHost();
  if (!host) throw refusal('That is not a ship', 'A Glurff is named by the ship that hosts it.');
  screen?.to?.('Glurff', host);
  screen?.progress?.(0.01, host === DEFAULT_HOST ? 'Setting off…' : `Finding ${host}…`);
  const card = await cardOf(host);
  if (card?.live) {
    screen?.to?.(card.name, host);
    screen?.progress?.(0.03, 'Fetching its map…');
    const doc = await documentOf(host, card.live, card)
      .catch((e) => (e.join && host === DEFAULT_HOST ? joinOfficial(e.join) : Promise.reject(e)))
      .catch((e) => Promise.reject(Object.assign(e, { host })));
    setWorld({ host, note: card.note, name: card.name, doc, release: card.live.release });
    return;
  }
  /* The official one hosting none is offline as well: it is never "none". */
  if (card === null && host !== DEFAULT_HOST) throw Object.assign(refusal(`${host} hosts no Glurff`, 'Nothing has been published there.'), { host });
  /* Hosted, and not published yet -- or taken down (2026-11-08) -- or its
   * host silent: offline, the one way (lib/glurff-online, 2026-11-10). */
  throw Object.assign(refusal(OFFLINE, whyOffline({ card, name: card?.name, host })), { host });
}

/* Said on the way in, with Try again -- or Join -- and the way back: home, or
 * the official world when it is home that did not load; none when it is the
 * official world itself. */
function stopped(e) {
  console.error('glurff: no world', e);
  screen?.notice?.({ title: e.title ?? 'This Glurff did not load', detail: e.detail ?? String(e.message ?? e),
    stop: true, action: e.join ? { label: 'Join', run: () => joinFrom(e.join) } : { label: 'Try again', run: () => location.reload() } });
  const box = document.querySelector('.loading-notice');
  const official = (named() ? chosenHost() : e.host) === DEFAULT_HOST;
  if (box && !official && !box.querySelector('.loading-back')) {
    const back = document.createElement('a');
    back.className = 'loading-back';
    back.href = named() ? '/apps/glurff/' : `/apps/glurff/?w=${DEFAULT_HOST}`;
    back.textContent = named() ? 'Back to Glurff' : 'Go to the official Glurff';
    box.appendChild(back);
  }
}

/* Noltbook's request-join on a Glurff's note, from a channel of its own. */
async function askToJoin(host, note) {
  const url = `/~/channel/glurff-join-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const put = (body) => fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ship = String(globalThis.window?.ship ?? '').replace(/^~/, '');
  const r = await put([{ id: 1, action: 'poke', ship, app: 'noltbook', mark: 'noltbook-action', json: { action: 'request-join', data: { noteId: note, host } } }]);
  put([{ id: 2, action: 'delete' }]).catch(() => {});
  if (!r.ok) throw new Error(`the request was refused (${r.status})`);
}

/* THE OFFICIAL GLURFF, JOINED ON THE WAY IN (2026-11-10): its map refused
 * to somebody not in it yet, its note is joined for them -- it is public, so
 * its host lets them in at once -- and the map fetched again until it comes.
 * Nothing to press. A host that does not let them in within `wait` (they
 * were removed, or it is slow) is said so, with Try again. */
export const JOIN_WAIT_MS = 30000;
export async function joinOfficial({ host, note, name, live }, wait = JOIN_WAIT_MS, every = 1000) {
  screen?.progress?.(0.03, `Joining ${name}…`);
  try { await askToJoin(host, note); }
  catch (error) { throw refusal(`Could not join ${name}`, String(error.message ?? error)); }
  const card = { note, name };
  for (let waited = 0; waited < wait; waited += every) {
    await new Promise((ok) => setTimeout(ok, every));
    try { return await documentOf(host, live, card); } catch (e) { if (!e.join) throw e; }
  }
  throw refusal(`Could not join ${name}`, `${host} has not let you in yet. Try again in a moment.`);
}

/* JOIN, from the way in: Noltbook's request-join on the Glurff's note, then
 * in as soon as its host lets us fetch the map -- at once for a public one.
 * A private one waits for its host, and says so. */
async function joinFrom({ host, note, name, live }) {
  screen?.notice?.({ title: `Joining ${name}…`, detail: 'Asking its host.', stop: true });
  try {
    await askToJoin(host, note);
    for (let waited = 0; waited < 20000; waited += 2000) {
      await new Promise((ok) => setTimeout(ok, 2000));
      try { await documentOf(host, live); location.reload(); return; } catch {}
    }
    screen?.notice?.({ title: `Asked to join ${name}`, detail: `${host} lets people in. It will be in your Glurffs when they do.`,
      stop: true, action: { label: 'Try again', run: () => location.reload() } });
  } catch (error) {
    screen?.notice?.({ title: 'That did not work', detail: String(error.message ?? error), stop: true,
      action: { label: 'Retry', run: () => location.reload() } });
  }
}

if (globalThis.window) {
  chooseWorld().then(() => import('./main.js'), stopped);
}

/* YOUR GLURFFS (2026-11-07): the Glurffs you are a member of, which one is
 * home, and how many people are in each right now.
 *
 * A Glurff's members are its note's (lib/world-membership), so these are the
 * Noltbook notes you are in that are somebody's Glurff. Which notes those are
 * nothing in Noltbook says, so it is learnt and remembered: the official one;
 * every one we have been in or joined here; and any whose host's card names
 * it, asked of the creators of the group notes we are in (a ship hosts one
 * Glurff at most). Home and the list are kept in our settings (lib/clocks
 * keeps keys it does not know of), so they follow us to any browser.
 *
 * How many are in one: Noltbook's own activity rows on its note -- the
 * "in Glurff" every visitor's page keeps there (lib/noltbook), the same thing
 * Noltbook shows -- read from our own ship. Nothing new goes over the network.
 *
 * Joining, asking and being let in are Noltbook's, exactly as for a note: a
 * public Glurff takes anybody who asks, a private one asks its host or an
 * admin, a secret one is never offered (its host does not even show it).
 *
 * OFFLINE (2026-11-10, lib/glurff-online): one taken down, or whose host has
 * not answered, stays in the list greyed out; a Visit asks again.
 */
import { our, api } from 'lib/api';
import { nb, onChange, requestRemoteNotes, joinRequests, askToJoinNote, joinAsked, nbAction, nbApi } from 'lib/noltbook';
import { cardOf } from 'lib/world-card';
import { DEFAULT_HOST, DEFAULT_NOTE } from 'lib/world-config';
import { noteIconUrl } from 'lib/note-link';
import { CARD_WAIT_MS, isOffline } from 'lib/glurff-online';

const MAX_KEPT = 32;
const CARD_FRESH_MS = 60_000;
/* No answer is kept this long, so asking twice in a row waits once. */
const SILENT_KEEP_MS = 15_000;
const ASKED_KEEP_MS = 14 * 864e5;
const CHECKED_KEEP_MS = 864e5;
const ACTIVITY_MS = 30_000;
const isShip = (s) => typeof s === 'string' && /^~[a-z]{3}(-?[a-z]{3}){0,7}$/.test(s);

export { inviteLink } from 'lib/note-link';

const local = (key) => ({
  get() { try { return JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch {} },
});

/* settings: lib/clocks' settings object. current: the Glurff this page is in,
 * {host, note, name}. hosting(): {note} for the world we host, or null.
 * keep: false for a playtest, which changes no setting of ours. */
export function createGlurffs({ settings, current, hosting = () => null, keep = true }) {
  const checkedStore = local(`glurff-hosts/${our}`), askedStore = local(`glurff-asked/${our}`);
  /* Our settings are only changed once they have come from our agent: a
   * change before then would be saved over them. */
  let waiting = [];
  const once = (fn) => { if (!keep) return; if (settings.loaded()) fn(); else waiting.push(fn); };
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };
  /* host -> {card, at}: answers -- card undefined when none came in time --
   * and questions on their way. */
  const cards = new Map(), asking = new Map();
  /* host -> {id, at, heard, timer}: the hosts we follow (see follow). */
  const followed = new Map();
  /* note -> distinct ships in it now. */
  const counts = new Map();

  const kept = () => (Array.isArray(settings.get().glurffs) ? settings.get().glurffs : [])
    .filter((g) => isShip(g?.host) && typeof g?.note === 'string');
  const home = () => (isShip(settings.get().home) ? settings.get().home : DEFAULT_HOST);
  const member = (note) => (nb.notes[note]?.users ?? []).includes(our);

  function remember(host, note, name) {
    if (!isShip(host) || !note) return;
    if (!settings.loaded()) return once(() => remember(host, note, name));
    const list = kept(), at = list.findIndex((g) => g.note === note);
    if (at >= 0 && list[at].host === host && (!name || list[at].name === name)) return;
    /* Small: our settings all fit in 8 KB (prefs-max), clocks included. */
    const entry = { host, note, name: String(name || list[at]?.name || '').slice(0, 40) };
    settings.update((s) => ({ ...s, glurffs: [entry, ...kept().filter((g) => g.note !== note && g.host !== host)].slice(0, MAX_KEPT) }));
    notify();
  }
  function forget(note) {
    if (!settings.loaded()) return once(() => forget(note));
    if (!kept().some((g) => g.note === note)) return;
    settings.update((s) => ({ ...s, glurffs: kept().filter((g) => g.note !== note) }));
  }
  const setHome = (host) => once(() => { settings.update((s) => ({ ...s, home: host })); notify(); });

  /* Every Glurff we know of, by note. */
  function known() {
    const all = new Map();
    const add = (host, note, name) => { if (isShip(host) && note && !all.has(note)) all.set(note, { host, note, name }); };
    add(current.host, current.note, current.name);
    add(DEFAULT_HOST, DEFAULT_NOTE, 'Glurff');
    const ours = hosting(); if (ours?.note) add(our, ours.note, '');
    for (const g of kept()) add(g.host, g.note, g.name);
    for (const [host, c] of Object.entries(checkedStore.get())) if (c?.note) add(host, c.note, c.name);
    /* A note with Glurff's "in Glurff" on it is a Glurff, whoever's. */
    for (const [note, rows] of Object.entries(nb.active ?? {})) {
      const n = nb.notes[note];
      if (n?.type === 'group' && (rows ?? []).some((r) => r?.desk === 'glurff')) add(n.creator, note, n.name);
    }
    return all;
  }

  /* Asked to join and not let in yet. Once in, the asking is over: leaving
   * later is not asking again. */
  const asked = () => {
    const a = askedStore.get(), now = Date.now();
    const live = Object.entries(a).filter(([note, x]) => x && now - x.at < ASKED_KEEP_MS && !member(note));
    if (live.length !== Object.keys(a).length) askedStore.set(Object.fromEntries(live));
    return Object.fromEntries(live);
  };
  const markAsked = (host, note, name) => { askedStore.set({ ...asked(), [note]: { host, name, at: Date.now() } }); notify(); };

  /* What the list shows: the ones we are in, home first, then the one we are
   * in, then the busiest; and the ones we asked to join, waiting. */
  function rows() {
    const out = [], checked = checkedStore.get();
    for (const g of known().values()) {
      const n = nb.notes[g.note];
      const isHere = g.note === current.note;
      if (!member(g.note) && !isHere && g.host !== DEFAULT_HOST) continue;
      const admin = g.host === our || (nb.noteAdmins[g.note] ?? []).includes(our);
      /* OFFLINE (2026-11-10): taken down, or its host silent -- as its card
       * says, or, not asked yet this visit, as it last said. The official
       * world as well (the app carries no copy of it); the one we are in is
       * here. */
      const offline = !isHere && isOffline(cards.get(g.host), checked[g.host]?.off);
      out.push({ ...g, name: n?.name || g.name || `${g.host}'s Glurff`, icon: noteIconUrl(n, our), visibility: n?.visibility ?? null,
        here: isHere, home: g.host === home(), own: g.host === our, admin, offline,
        count: offline ? 0 : countIn(g.note, isHere), requests: admin ? joinRequests().filter((r) => r.noteId === g.note && r.ship !== our && !(n?.users ?? []).includes(r.ship)) : [] });
    }
    out.sort((a, b) => (b.home - a.home) || (b.here - a.here) || (b.count - a.count) || a.name.localeCompare(b.name));
    for (const [note, x] of Object.entries(asked())) {
      if (!out.some((r) => r.note === note)) out.push({ host: x.host, note, name: x.name || `${x.host}'s Glurff`, waiting: true, count: 0, requests: [] });
    }
    return out;
  }
  /* Somebody in it now: their Glurff page keeps an "in Glurff" row there.
   * Elsewhere we are not counted -- a row of ours is another tab's. */
  function countIn(note, isHere) {
    const ships = new Set(counts.get(note) ?? []);
    const now = Date.now();
    for (const r of nb.active?.[note] ?? []) if (r?.desk === 'glurff' && r.setBy && !(r.expiresAt < now)) ships.add(r.setBy);
    if (isHere) ships.add(our); else ships.delete(our);
    return ships.size;
  }
  /* Everybody in them, as the list counts them, and the people waiting for
   * us to let them in. */
  const badge = () => {
    const r = rows();
    return { people: r.reduce((n, g) => n + (g.waiting ? 0 : g.count), 0),
      requests: r.reduce((n, g) => n + g.requests.length, 0) };
  };

  /* The activity rows, read afresh from our own Noltbook: what arrives as
   * facts is only what changed. */
  async function refreshActivity() {
    const notes = rows().filter((g) => !g.waiting).map((g) => g.note);
    await Promise.all(notes.map(async (note) => {
      try {
        const r = await fetch(`/~/scry/noltbook/api/notes/${note}/meta.json`, { credentials: 'include' });
        if (!r.ok) return;
        const m = await r.json(), now = Date.now();
        counts.set(note, (m.gossipActive ?? []).filter((x) => x?.desk === 'glurff' && x.setBy && !(x.expiresAt < now)).map((x) => x.setBy));
      } catch {}
    }));
    notify();
  }

  /* A host's card, asked through our own agent and kept a minute -- for as
   * long as we follow its host, which keeps it up to date; no answer, a few
   * seconds. `fresh` asks again whatever is kept. */
  function card(host, { fresh = false } = {}) {
    const c = cards.get(host);
    const kept = c && (c.card === undefined ? Date.now() - c.at < SILENT_KEEP_MS
      : followed.get(host)?.heard || Date.now() - c.at < CARD_FRESH_MS);
    if (kept && !fresh) return Promise.resolve(c.card);
    if (asking.has(host)) return asking.get(host);
    const p = cardOf(host).then((answer) => { asking.delete(host); heard(host, answer); return answer; });
    asking.set(host, p);
    return p;
  }
  /* An answer, or none in time, and what it is remembered as: whether it was
   * offline, so the list opens next time as it last was. */
  function heard(host, answer) {
    cards.set(host, { card: answer, at: Date.now() });
    const was = checkedStore.get()[host];
    if (answer !== undefined) {
      checkedStore.set({ ...checkedStore.get(), [host]: { note: answer?.note ?? null, name: answer?.name ?? '', at: Date.now(), off: !answer?.live } });
      if (answer?.note && member(answer.note)) remember(host, answer.note, answer.name);
    } else if (was?.note && !was.off) checkedStore.set({ ...checkedStore.get(), [host]: { ...was, off: true } });
    notify();
  }

  /* FOLLOWED WHILE WE ARE HERE (2026-11-10): the hosts of the Glurffs in the
   * list, watched on the page's own channel -- one connection, however many
   * -- so one taken down, or published again, shows as soon as its host says.
   * A ship that is down says nothing: asked, and silent for CARD_WAIT_MS, it
   * is offline until it answers, and its watch stays for when it does. Asked
   * again (`again`) when the list is opened, at most once a minute. */
  function follow(host, again = false) {
    const was = followed.get(host);
    if (was && (!again || Date.now() - was.at < CARD_FRESH_MS)) return;
    if (!api) return;
    if (was) { clearTimeout(was.timer); if (was.id != null) { try { api.unsubscribe(was.id); } catch {} } }
    const f = { id: null, at: Date.now(), heard: false, timer: null };
    followed.set(host, f);
    const mine = () => followed.get(host) === f;
    f.timer = setTimeout(() => { if (mine() && !f.heard) heard(host, undefined); }, CARD_WAIT_MS);
    const drop = () => { clearTimeout(f.timer); if (mine()) followed.delete(host); };
    api.subscribe({
      app: 'glurff', path: `/card/${host}`,
      event: (u) => {
        const c = u?.['world-card'];
        if (c?.host !== host || !mine()) return;
        f.heard = true; clearTimeout(f.timer);
        heard(host, c.card ?? null);
      },
      err: drop, quit: drop,
    }).then((id) => { f.id = id; if (!mine()) { try { api.unsubscribe(id); } catch {} } }, drop);
  }
  /* Every listed Glurff's host followed; `again`, asked afresh. */
  function check(again = false) {
    for (const r of rows()) if (!r.waiting && !r.here) follow(r.host, again);
  }
  /* ...as soon as one is in the list, which fills in after the page starts,
   * as our settings and notes arrive: looked at a second after a change. */
  let checkSoon = null;
  const followSoon = () => { checkSoon ??= setTimeout(() => { checkSoon = null; check(); }, 1000); };

  /* Everything we can say about `host`'s Glurff, for a profile card or a door:
   * whether there is one we may know of, whether we are in it, and how open it
   * is -- Noltbook's own answer for a note we are not in, the list its
   * profile card shows. A secret one we are not in has no card at all. No
   * answer in time: what we knew of it, to say it is offline. */
  async function look(host, wait = 5000, fresh = false) {
    const c = await card(host, { fresh });
    if (c === undefined) {
      const k = [...known().values()].find((g) => g.host === host);
      return k ? { card: c, host, note: k.note, name: nb.notes[k.note]?.name || k.name || `${host}'s Glurff`, member: member(k.note) } : { card: c, host };
    }
    if (!c) return { card: c, host };
    const note = c.note, name = c.name;
    if (member(note)) return { card: c, host, note, name, member: true, icon: noteIconUrl(nb.notes[note], our), visibility: nb.notes[note]?.visibility ?? null };
    if (joinAsked(note) || asked()[note]) return { card: c, host, note, name, asked: true };
    const listed = () => (nb.remoteNotes[host] ?? []).find((n) => n?.id === note);
    if (!listed()) {
      requestRemoteNotes(host).catch(() => {});
      await new Promise((resolve) => {
        const off = onChange(() => { if (listed() || member(note)) done(); }, (x) => x.field === 'remoteNotes' || x.field === 'notes');
        const timer = setTimeout(done, wait);
        function done() { clearTimeout(timer); off(); resolve(); }
      });
    }
    if (member(note)) return { card: c, host, note, name, member: true, icon: noteIconUrl(nb.notes[note], our) };
    /* Not in it: only an icon given as an address can be shown -- an uploaded
     * one is fetched for members alone. */
    const icon = /^https:\/\//.test(listed()?.iconUrl ?? '') ? noteIconUrl({ ...listed(), creator: host }, our) : null;
    return { card: c, host, note, name, icon, visibility: listed()?.visibility ?? null };
  }

  /* JOIN, as on a note: public lets us straight in, private asks. Resolves
   * true once we are a member, false if we are waiting to be let in. */
  async function join(host, note, name, ms = 20000) {
    if (member(note)) { remember(host, note, name); return true; }
    await askToJoinNote(note, host);
    const inNow = await new Promise((resolve) => {
      const off = onChange(() => { if (member(note)) done(true); }, (x) => x.field === 'notes');
      const timer = setTimeout(() => done(false), ms);
      function done(v) { clearTimeout(timer); off(); resolve(v); }
    });
    if (inNow) remember(host, note, name);
    else markAsked(host, note, name);
    return inNow;
  }
  async function leave(note) {
    await nbAction('leave-note', { id: note });
    /* What its host showed us as a member is not what it shows us now. */
    const host = known().get(note)?.host;
    if (host) cards.delete(host);
    forget(note); notify();
  }
  const invite = (note, ship) => nbApi('add-member', { noteId: note, ship });
  const answer = (note, ship, how) => nbApi({ in: 'approve-join', out: 'deny-join', block: 'deny-block-join' }[how], { noteId: note, ship });

  /* Whether the Glurff we host is published, asked afresh: it changes in the
   * editor, on this page. */
  function checkOwn() {
    if (!hosting()) return;
    cards.delete(our);
    card(our).then(notify, () => {});
  }

  /* Which of the hosts of the notes we are in host a Glurff: asked a few at a
   * time, each at most once a day. */
  let discovering = null;
  function discover(max = 12) {
    if (discovering) return discovering;
    const checked = checkedStore.get(), now = Date.now(), knownNotes = known();
    const hosts = [...new Set(Object.values(nb.notes)
      .filter((n) => n?.type === 'group' && isShip(n.creator) && (n.users ?? []).includes(our) && !knownNotes.has(n.id))
      .map((n) => n.creator))]
      .filter((h) => !(checked[h] && now - checked[h].at < CHECKED_KEEP_MS)).slice(0, max);
    discovering = (async () => {
      for (let i = 0; i < hosts.length; i += 3) await Promise.all(hosts.slice(i, i + 3).map((h) => card(h).catch(() => null)));
    })().finally(() => { discovering = null; notify(); });
    return discovering;
  }

  /* Kept in step: the notes we are in, their activity, the requests. Turned
   * away, we are no longer asking. */
  onChange((c) => {
    if (c.field === 'joinStatus' && c.noteId && !joinAsked(c.noteId) && askedStore.get()[c.noteId]) {
      const { [c.noteId]: gone, ...rest } = askedStore.get(); askedStore.set(rest);
    }
    followSoon();
    notify();
  }, (c) => ['notes', 'joinRequests', 'active', 'noteAdmins', 'joinStatus'].includes(c.field));
  settings.on(() => {
    if (settings.loaded() && waiting.length) { const run = waiting; waiting = []; run.forEach((fn) => fn()); }
    followSoon();
    notify();
  });
  remember(current.host, current.note, current.name);
  setInterval(() => { if (!document.hidden) void refreshActivity(); }, ACTIVITY_MS);
  setTimeout(() => { void refreshActivity(); check(); void discover().then(() => check()); }, 4000);

  return { rows, home, setHome, badge, look, join, leave, invite, answer, remember, discover, checkOwn, check,
    refreshActivity, member, markAsked, on(fn) { listeners.add(fn); return () => listeners.delete(fn); } };
}

/* THE GLURFFS A SHIP IS IN (2026-11-08): [{host, note, name, members}], the
 * public ones, as it says -- asked through our own agent, as a card is, but
 * on the page's own channel: each channel of its own is a connection held
 * open, and a browser keeps only six to a ship. null from a Glurff from
 * before this; undefined if no answer came in time. */
export function glurffsOf(host, ms = 15000) {
  return new Promise((resolve) => {
    let done = false, id = null;
    const finish = (list) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (id != null) { try { api.unsubscribe(id); } catch {} }
      resolve(list);
    };
    const timer = setTimeout(() => finish(undefined), ms);
    if (!api) return finish(undefined);
    api.subscribe({
      app: 'glurff', path: `/glurffs/${host}`,
      event: (u) => {
        if (u?.['glurff-list']?.host === host) finish(u['glurff-list'].glurffs ?? []);
        else if (u?.['glurff-list-shut']?.host === host) finish(null);
      },
      err: () => finish(undefined), quit: () => {},
    }).then((n) => { id = n; if (done) { try { api.unsubscribe(n); } catch {} } }, () => finish(undefined));
  });
}

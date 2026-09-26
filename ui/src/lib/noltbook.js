import { createGossip } from 'lib/gossip';
import { mergeMessages, messageKey } from 'lib/timeline';
import { createWorldMembership } from 'lib/world-membership';
import { WORLD_HOST, WORLD_NOTE } from 'lib/world-config';
import { diagnostic } from 'lib/diagnostics';
import { tabLease, ACTIVE_TTL, ACTIVE_REFRESH_MS, TAB_REFRESH_MS } from 'lib/activity';
/* The Noltbook seam.
 *
 * Glurff stores no message, no DM, no contact list and no call roster. All of
 * that is Noltbook's, reached over the same Eyre channel that serves this page.
 * The %noltbook desk is never modified.
 *
 * Two poke surfaces. `nbAction` is direct; `nbApi` carries a requestId and
 * reports a typed outcome on /api/results, so it fails loudly instead of
 * silently. Prefer nbApi wherever the action exists there.
 */
import { api, poke, subscribe, our } from 'lib/api';

/* Posts made through Glurff are stamped `via` this desk, which is what makes
 * them read as "via Glurff" in Noltbook. */
export const GLURFF_APP = { desk: 'glurff', title: 'Glurff' };
const glurffApp = () => ({ ...GLURFF_APP, publisher: our });

/* The Commons is the distributor's existing shared note. Never install or
 * replace it locally; old gossip notes and their histories remain untouched. */
export const COMMONS_NOTE = WORLD_NOTE;
export const RUMORS_NOTE = 'ars-rumors';
/* Rooms have no notes of their own: their chat is session-only, in the browser
 * (see lib/room-events.js and ui/hud.js). The commons is a shared group, and the
 * war room is Rumors, Noltbook's own anonymous note. */
/* The war room is the Rumors room: anonymous, and Noltbook's own note. */
export const RUMORS_ROOM = 13;
/* Noltbook delivers BOTH our own and remote rumors as `rumor-message`, stored
 * under ars-rumors. An earlier reading of this traced remote rumors to the
 * `cover` note; that was wrong, and merging cover also pulled ordinary cover
 * posts into the Rumors room. */

export const nb = {
  ready: false,
  /* Noltbook's own note calls, by note id. A leased room's call is one of
   * these: see lib/notecall. */
  calls: {},
  dial: 0,
  palsReady: false,
  dialReady: false,
  world: { phase: 'waiting', joined: false, members: [], reason: '' },
  notes: {},      //  id -> note
  messages: {},   //  noteId -> [message]
  pals: {},       //  ship -> status
  profiles: {},   //  ship -> profile
  contacts: {},   //  ship -> true
  callMods: {},   //  noteId -> {noteId, rev, mod}  moderation of that note's call
  noteAdmins: {}, //  noteId -> [ship]
  /* Durable unread, straight from Noltbook: a note is unread when its unread
   * activity is later than the last time it was marked read. Both survive a
   * reload and both arrive on the global /notes watch, so the DM dot is right
   * without subscribing to every conversation. */
  reads: {},      //  noteId -> @da-as-ms
  unreadAt: {},   //  noteId -> @da-as-ms
  activity: {},   //  noteId -> @da-as-ms, for ordering
  remoteNotes: {},//  ship -> [note], their public notes for the profile card
  /* Private-note admission requests delivered to this note's host/admins.
   * Noltbook remains the authority; Glurff only gives the same request a
   * second place to be answered while the room is in use. */
  joinRequests: {}, //  `${noteId}/${ship}` -> {noteId, ship, noteName}
  lookups: {},    //  ship -> 'looking' | 'reachable' | 'ok' | 'unreachable' | 'noltbook-unavailable'
  search: null,   //  newest message-search answer: {reqId, query, hits, capped}
  active: {},     //  gossip note id -> rows of members active on it, from Noltbook
};
const avatarRevisions = new Map();
if (typeof window !== 'undefined') window.nb = nb;   // debug handle

/* State changes stay synchronous; visual subscribers schedule their own paint.
 * A badge or an unrelated note must not wake chat, names and proximity logic. */
const listeners = new Set();
export const onChange = (fn, accepts = () => true) => {
  const record = {fn, accepts}; listeners.add(record);
  return () => listeners.delete(record);
};
const changed = (field, noteId = null, ship = null, message = null) => {
  const change = {field, noteId, ship, message};
  for (const {fn, accepts} of listeners) {
    try { if (accepts(change)) fn(change); } catch (e) { console.error(e); }
  }
};
const liveWorldPeers = new Set();
let memberShips = new Set();
let membership = null;
const createMembership = () => createWorldMembership({
  our, host: WORLD_HOST, noteId: WORLD_NOTE,
  requestJoin: data => nbApi('request-join', data, { timeout: 10000 }),
  refresh: () => refreshNotes(),
  trace: diagnostic,
  changed: state => {
    nb.world = state;
    memberShips = new Set(state.members);
    for (const ship of liveWorldPeers) if (!worldMember(ship)) liveWorldPeers.delete(ship);
    changed('world', WORLD_NOTE);
  },
});
export const worldStatus = () => nb.world;
/* The pal list is read only for blocks here, never for friendship/reach. */
export const worldJoined = () => nb.world.joined && nb.palsReady;
export const worldBanned = ship => (nb.notes[WORLD_NOTE]?.creator === WORLD_HOST &&
  (nb.notes[WORLD_NOTE]?.removed ?? []).includes(ship));
export const worldMember = ship => worldJoined() && memberShips.has(ship) &&
  nb.pals[ship] !== 'blocked' && !worldBanned(ship);
export const worldMembers = () => [...memberShips].filter(worldMember);
export const retryWorld = () => membership?.retry();
export const stopWorld = () => membership?.stop();
export const setWorldPresence = ships => {
  liveWorldPeers.clear();
  for (const ship of ships) if (ship !== our && worldMember(ship)) liveWorldPeers.add(ship);
};
const deleted = new Set(), views = new Map(), visibilityRevisions = new Map();
/* Noltbook gives a local browser at most 300 messages on first subscription.
 * The complete response to fetch-note-history arrives as another message-list
 * on the same note path, so this state distinguishes it from a capped opening
 * snapshot. */
const NOTE_SNAPSHOT_LIMIT = 300;
const historyState = new Map();
const noteHistory = noteId => {
  let state = historyState.get(noteId);
  if (!state) {
    state = { mayHaveMore: false, loading: false, fetchedAll: false, timer: null };
    historyState.set(noteId, state);
  }
  return state;
};
let socialRevision = 0;
/* Chat history can be held back while the world starts. Only main.js holds it,
 * so anything loading this module on its own behaves exactly as before. Live
 * posts are never held. */
let historyHeld = false;
export const holdHistory = () => { historyHeld = true; };
export const releaseHistory = () => { if (!historyHeld) return; historyHeld = false; gossip.socialChanged(); };
const gossip = createGossip({our: () => our, social: () => ({pals: nb.pals, dial: nb.dial, ready: nb.palsReady && nb.dialReady}),
  messages: id => nb.messages[id] ?? [], fetch: data => nbAction('fetch-cover-msg', data),
  backgroundReady: () => !historyHeld && api?.backgroundReady?.() !== false,
  changed: id => { visibilityRevisions.set(id, (visibilityRevisions.get(id) ?? 0) + 1); changed('visibility', id); },
});
if (typeof window !== 'undefined') window.addEventListener('glurff-exit', () => gossip.close());
function receiveMessages(noteId, incoming) {
  if (!noteId) return false;
  const rows = incoming.filter(m => !deleted.has(noteId + '/' + messageKey(m)) && !deleted.has(noteId + '/id:' + m.id));
  const old = nb.messages[noteId] ?? [];
  const gossiped = noteId !== COMMONS_NOTE && (noteId === 'cover' || nb.notes[noteId]?.type === 'gossip');
  nb.messages[noteId] = mergeMessages(old, rows, gossiped ? gossip.retained(noteId, rows) : null);
  if (gossiped) gossip.content(noteId, rows);
  return nb.messages[noteId] !== old;
}

let nextRequestId = 1;
const pending = new Map();
let resultsLive = false;

export function nbAction(action, data = {}) {
  return poke('noltbook', 'noltbook-action', { action, data });
}

/* The mark REQUIRES a nested `data` object and reads every argument out of it;
 * `action`, `requestId` and `app` are the only top-level keys. Spreading the
 * arguments at the top level fails the JSON cast -- loudly on the ship and
 * SILENTLY in the browser, which is a very expensive way to find out. */
export function nbApi(action, data = {}, { attribute = false, timeout = 20000 } = {}) {
  if (!resultsLive) return Promise.reject(new Error('nbApi before /api/results'));
  const requestId = nextRequestId++;
  const json = { action, requestId, data };
  if (attribute) json.app = glurffApp();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`noltbook-api ${action} timed out`));
    }, timeout);
    pending.set(requestId, { resolve, reject, timer, action });
    api.poke({ app: 'noltbook', mark: 'noltbook-api', json }).catch((e) => {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(e);
    });
  });
}

function settle(r) {
  const e = pending.get(r.requestId);
  if (!e) return;
  clearTimeout(e.timer);
  pending.delete(r.requestId);
  if (r.ok) e.resolve(r);
  else e.reject(Object.assign(new Error(`${e.action}: ${r.code}`), { result: r }));
}

/* ------------------------------------------------------------ state feed */

export function applyFact(name, p) {
  let field, noteId = null, ship = p?.ship ?? null, joinsChanged = false, liveMessage = null;
  switch (name) {
    case 'note-list': {
      nb.notes = Object.fromEntries((p.notes ?? p).map(n => [n.id, n]));
      nb.ready = true; field = 'notes'; break;
    }
    case 'note-created':
      nb.notes[p.id] = p; field = 'notes'; noteId = p.id;
      pendingJoins.delete(p.id);   //  we are in it now
      break;
    case 'note-type-updated': {
      const n = nb.notes[p.id];
      if (!n) return;
      nb.notes[p.id] = { ...n, type: p.type };
      field = 'notes'; noteId = p.id; break;
    }
    /* A note's call: who is in it, and which incarnation it is. */
    case 'call-snap':
      if (!p?.noteId) return;
      nb.calls[p.noteId] = p; field = 'calls'; noteId = p.noteId; break;
    case 'call-list':
      nb.calls = Object.fromEntries((Array.isArray(p) ? p : []).filter(c => c?.noteId).map(c => [c.noteId, c]));
      field = 'calls'; break;
    /* Moderation of a note's call, which is Noltbook's own; a leased room
     * inherits it rather than keeping a second set of rules. */
    case 'call-mod-snap':
      if (!p?.noteId) return;
      nb.callMods[p.noteId] = p; field = 'callMods'; noteId = p.noteId; break;
    case 'call-mod-list':
      nb.callMods = Object.fromEntries((Array.isArray(p) ? p : []).filter(m => m?.noteId).map(m => [m.noteId, m]));
      field = 'callMods'; break;
    case 'admins-updated':
      if (!p?.id) return;
      nb.noteAdmins[p.id] = p.admins ?? []; field = 'noteAdmins'; noteId = p.id; break;
    case 'note-deleted': delete nb.notes[p.id]; field = 'notes'; noteId = p.id; break;
    /* A note's SETTINGS changed -- public, private, secret, read-only. Without
     * this a note that was opened up an hour ago still reads closed, and
     * anybody standing in the room it is leased to is still locked out of it. */
    case 'note-meta-updated': {
      const n = nb.notes[p.id];
      if (!n) return;
      nb.notes[p.id] = { ...n, visibility: p.visibility ?? n.visibility,
        iconUrl: p.iconUrl ?? n.iconUrl, writable: p.writable !== false };
      field = 'notes'; noteId = p.id; break;
    }
    /* Who is in it. A join approved in Noltbook opens the room here. */
    case 'note-users-updated': {
      const n = nb.notes[p.id];
      if (!n) return;
      const users = p.users ?? n.users;
      nb.notes[p.id] = { ...n, users, removed: p.removed ?? n.removed };
      pendingJoins.delete(p.id);
      /* Approval removes the host-side request even if its explicit removal
       * fact and the membership update cross on the wire. */
      for (const [key, request] of Object.entries(nb.joinRequests)) {
        if (request.noteId === p.id && users.includes(request.ship)) {
          delete nb.joinRequests[key]; joinsChanged = true;
        }
      }
      field = 'notes'; noteId = p.id; break;
    }
    case 'message-list': {
      noteId = p.noteId;
      const incoming = p.messages ?? [];
      const history = noteHistory(noteId);
      if (history.loading) {
        history.loading = false; history.fetchedAll = true; history.mayHaveMore = false;
        clearTimeout(history.timer); history.timer = null;
      } else if (!history.fetchedAll) history.mayHaveMore = incoming.length >= NOTE_SNAPSHOT_LIMIT;
      if (!receiveMessages(noteId, incoming)) return;
      field = 'messages'; break;
    }
    case 'new-message':
    case 'gossip-message':
    case 'message-edited':
    case 'cover-msg-content': {
      const m = p.message ?? p.msg ?? p; noteId = m.noteId ?? p.noteId;
      if (name === 'gossip-message' && Number.isFinite(p.hops)) gossip.envelope(noteId, m, p.hops);
      if (!receiveMessages(noteId, [m])) return;
      if (name === 'new-message' || name === 'gossip-message') liveMessage = m;
      field = 'messages'; break;
    }
    case 'message-deleted': {
      noteId = p.noteId;
      const rows = nb.messages[noteId] ?? [];
      for (const m of rows) if (p.eid ? m.meta?.eid === p.eid : m.id === p.msgId) deleted.add(noteId + '/' + messageKey(m));
      deleted.add(noteId + '/' + (p.eid ?? 'id:' + p.msgId));
      gossip.remove(noteId, p);
      nb.messages[noteId] = rows.filter(m => !deleted.has(noteId + '/' + messageKey(m)) && !deleted.has(noteId + '/id:' + m.id));
      if (nb.messages[noteId].length === rows.length) return;
      field = 'messages'; break;
    }
    case 'rumor-message':
      noteId = RUMORS_NOTE;
      if (!receiveMessages(noteId, [p.message ?? p])) return;
      field = 'messages'; break;
    case 'gossip-envelope': gossip.envelope(p.noteId, p.envelope ?? p.env, p.hops); return;
    /* The author has answered that they no longer hold this message. Noltbook
     * reports it rather than letting the request time out, so stop asking. */
    case 'gossip-msg-unavailable': gossip.unavailable(p.noteId ?? 'cover', {eid: p.eid ?? null, msgId: p.msgId}); return;
    case 'envelope-list': gossip.snapshot(p.noteId, p.envelopes ?? []); return;
    case 'envelope-hops': gossip.hops(p.noteId, p.hops ?? []); return;
    case 'contact-list': nb.contacts = Object.fromEntries(p.map(s => [s, true])); field = 'contacts'; break;
    case 'note-read':
      if (nb.reads[p.noteId] === p.read) return;
      nb.reads[p.noteId] = p.read; field = 'reads'; noteId = p.noteId; break;
    case 'note-read-list':
      for (const r of p.reads ?? p) nb.reads[r.noteId] = r.read;
      field = 'reads'; break;
    case 'note-unread-activity':
      nb.unreadAt[p.noteId] = p.activity; field = 'unreadAt'; noteId = p.noteId; break;
    case 'note-unread-activity-list':
      for (const a of p.activities ?? p) nb.unreadAt[a.noteId] = a.activity;
      field = 'unreadAt'; break;
    case 'note-activity':
      nb.activity[p.noteId] = p.activity; field = 'activity'; noteId = p.noteId; break;
    case 'note-activity-list':
      for (const a of p.activities ?? p) nb.activity[a.noteId] = a.activity;
      field = 'activity'; break;
    case 'note-sidebar-signal': {
      /* A control signal represents a hidden call marker. It must not move a
       * conversation, change its preview, or light an unread dot. */
      if (!p?.noteId || p.kind === 'control') return;
      noteId = p.noteId;
      const at = Number.isFinite(p.time) ? p.time : Date.now();
      const newest = at >= (nb.activity[noteId] ?? 0);
      nb.activity[noteId] = Math.max(nb.activity[noteId] ?? 0, at);
      if (p.author && p.author !== our)
        nb.unreadAt[noteId] = Math.max(nb.unreadAt[noteId] ?? 0, at);
      const note = nb.notes[noteId];
      if (note && newest) nb.notes[noteId] = { ...note, lastAuthor: p.author ?? note.lastAuthor,
        ...(p.preview == null ? {} : { lastPreview: p.preview }) };
      field = 'activity'; break;
    }
    case 'remote-note-list': nb.remoteNotes[p.ship] = p.notes ?? []; field = 'remoteNotes'; break;
    case 'join-request-list': {
      const requests = Array.isArray(p) ? p : p?.requests ?? [];
      nb.joinRequests = Object.fromEntries(requests
        .filter((r) => r?.noteId && r?.ship)
        .map((r) => [`${r.noteId}/${r.ship}`, r]));
      field = 'joinRequests'; break;
    }
    case 'join-request-received':
      if (!p?.noteId || !p?.ship) return;
      nb.joinRequests[`${p.noteId}/${p.ship}`] = p;
      field = 'joinRequests'; noteId = p.noteId; break;
    case 'join-requested':
      if (!p?.noteId) return;
      pendingJoins.add(p.noteId); field = 'joinStatus'; noteId = p.noteId; break;
    case 'join-denied':
    case 'join-removed':
      if (!p?.noteId) return;
      if (p.noteId === WORLD_NOTE && p.host === WORLD_HOST)
        membership?.deny(name === 'join-removed' ? 'removed' : 'denied');
      pendingJoins.delete(p.noteId); field = 'joinStatus'; noteId = p.noteId; break;
    case 'profile-lookup-result': {
      /* Only the answer to the lookup we have out; a late one changes nothing. */
      const out = inFlight.get(p.ship);
      if (!out || (p.reqId != null && p.reqId !== out.reqId)) return;
      nb.lookups[p.ship] = p.status;
      if (p.status !== 'reachable') settleLookup(p.ship);   //  'reachable' is still in flight
      field = 'lookups'; break;
    }
    case 'search-result': nb.search = p; field = 'search'; break;
    case 'pal-list':
      nb.pals = Object.fromEntries(p.map(e => [e.ship, e.status]));
      nb.palsReady = true; field = 'pals'; break;
    case 'pal-update': nb.pals[p.ship] = p.status; field = 'pals'; break;
    case 'pal-removed': delete nb.pals[p.ship]; field = 'pals'; break;
    case 'dial-update':
      if (nb.dialReady && nb.dial === p) return;
      nb.dial = p; nb.dialReady = true; field = 'dial'; break;
    case 'profile-list':
      for (const row of p) if (row?.ship) {
        nb.profiles[row.ship] = row.profile ?? {};
        if (row.profile?.avatar?.type === 'urbit' && !avatarRevisions.has(row.ship))
          avatarRevisions.set(row.ship, Date.now());
        else if (row.profile?.avatar?.type !== 'urbit') avatarRevisions.delete(row.ship);
      }
      field = 'profiles'; break;
    case 'profile-updated':
      nb.profiles[p.ship] = p.profile ?? {};
      if (p.profile?.avatar?.type === 'urbit') avatarRevisions.set(p.ship, Date.now());
      else avatarRevisions.delete(p.ship);
      if (lookupActive(p.ship)) { settleLookup(p.ship); nb.lookups[p.ship] = 'ok'; }
      field = 'profiles'; break;
    case 'gossip-active-updated':
      nb.active[p.noteId] = Array.isArray(p.active) ? p.active : [];
      field = 'active'; noteId = p.noteId; break;
    case 'api-result': settle(p); return;
    default: return;
  }
  if (field === 'pals' || field === 'dial') { socialRevision++; gossip.socialChanged(); }
  if (field === 'notes') membership?.update({ ready: nb.ready, notes: nb.notes });
  changed(field, noteId, ship, liveMessage);
  if (joinsChanged) changed('joinRequests', noteId);
}

/* ------------------------------------------------------------- selectors */

export const displayName = (ship) => nb.profiles[ship]?.displayName || ship;
export const avatarUrl = (ship) => {
  const avatar = nb.profiles[ship]?.avatar;
  if (!avatar) return null;
  if (avatar.type === 'urbit') {
    const base = `/apps/noltbook/user-avatar/${encodeURIComponent(ship)}`;
    const revision = avatarRevisions.get(ship);
    return revision ? `${base}?v=${revision}` : base;
  }
  return avatar.url || null;
};
export const profileBio = (ship) => nb.profiles[ship]?.azimuthAddress || '';
export const palStatus = (ship) => nb.pals[ship] ?? 'none';
export const isContact = (ship) => !!nb.contacts[ship];

/* ---------------------------------------------------------------- DMs */

/* A DM is an ordinary note of type %dm whose `users` are the two ends. There
 * is no DM store here: the note list Noltbook already sends IS the list. */
/* The group notes THIS ship made. Only these can be leased to a room: the
 * note's own creator is the only person who may bind it, which is also the
 * ship that has to mint for the room's call. */
export const myGroupNotes = () => Object.values(nb.notes)
  .filter((n) => n?.type === 'group' && n.creator === our)
  .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
export const noteName = (id) => nb.notes[id]?.name ?? null;
export const noteVisibility = (id) => nb.notes[id]?.visibility ?? null;
export const noteCreator = (id) => nb.notes[id]?.creator ?? null;
export const noteMembers = (id) => nb.notes[id]?.users ?? [];
/* A note's call, as Noltbook reports it, and its moderation record. */
export const noteCall = (id) => nb.calls[id] ?? null;
export const noteCallMod = (id) => {
  const snap = nb.callMods[id], call = nb.calls[id]?.call;
  if (!snap?.mod || !call || snap.mod.callId !== call.callId) return null;
  return snap.mod;
};
/* Who may moderate that call: the note's creator, its admins, and anybody the
 * call itself promoted. Noltbook's rule, not a second one of ours. */
export const noteCallRole = (id, ship) => {
  const n = nb.notes[id], call = nb.calls[id]?.call;
  if (!n || !call || !ship) return null;
  if (ship === n.creator) return 'host';
  if ((nb.noteAdmins[id] ?? []).includes(ship)) return 'admin';
  const mod = noteCallMod(id);
  if (mod ? (mod.admins ?? []).includes(ship) : (call.startedBy === ship && call.startedBy !== n.creator)) return 'admin';
  return null;
};
export const noteCallMuted = (id, ship) => (noteCallMod(id)?.muted ?? []).includes(ship);
export const noteCallBooted = (id, ship) => (noteCallMod(id)?.booted ?? []).includes(ship);
export const noteCallRecording = (id) => noteCallMod(id)?.recording ?? null;
/* Ask for something. The host's ship decides; this only asks. */
export const noteModerate = (noteId, ship, op) => nbAction('call-mod', { noteId, ship, op });

/* Are we in this note? Membership is Noltbook's, and it is what decides
 * whether a leased room will talk to us at all. */
export const inNote = (id) => (nb.notes[id]?.users ?? []).includes(our);
/* A note we are NOT in, as its host's ship described it. This is Noltbook's
 * own discovery: `request-remote-notes` answers with a ship's public and
 * private group notes, which is what its profile card lists. A secret note is
 * never in that answer, and never should be. */
export const remoteNote = (host, id) =>
  (nb.remoteNotes[host] ?? []).find((n) => n?.id === id) ?? null;
/* What we can say about a note whether or not we are in it. */
export const noteFacts = (host, id) => {
  const n = nb.notes[id] ?? remoteNote(host, id);
  if (!n) return null;
  return { id, name: n.name ?? id, headline: n.headline ?? null,
    visibility: n.visibility ?? null, creator: n.creator ?? host,
    users: n.users ?? [], member: (n.users ?? []).includes(our),
    removed: (n.removed ?? []).includes(our) };
};
/* Asked to join and waiting. Noltbook shows REQUESTED; so do we. */
export const joinAsked = (id) => pendingJoins.has(id);
const pendingJoins = new Set();
/* Ask to be let in. What happens next is the note's business: a public note
 * takes anybody, a private one asks its host, a secret one was never offered. */
export const askToJoinNote = (id, host) => {
  /* One action for both: Noltbook's own host auto-approves a PUBLIC note and
   * queues a PRIVATE one for its host or an admin. A secret note drops it,
   * which is why we never offer it. */
  pendingJoins.add(id);
  return nbAction('request-join', { noteId: id, host });
};

export const joinRequests = () => Object.values(nb.joinRequests);
export async function answerJoinRequest(noteId, ship, accept) {
  const key = `${noteId}/${ship}`;
  const request = nb.joinRequests[key];
  if (!request) return false;
  delete nb.joinRequests[key];
  changed('joinRequests', noteId, ship);
  try {
    await nbAction(accept ? 'approve-join' : 'deny-join', { noteId, ship });
    return true;
  } catch (error) {
    nb.joinRequests[key] = request;
    changed('joinRequests', noteId, ship);
    throw error;
  }
}

export const isDm = (n) => n?.type === 'dm';
export const counterparty = (n) =>
  (n?.users ?? []).find((s) => s !== our) ?? n?.creator ?? null;

export const unread = (noteId) => (nb.unreadAt[noteId] ?? 0) > (nb.reads[noteId] ?? 0);

/* Most recently active first, which is where you look for the one that just
 * buzzed. */
export const dmList = () =>
  Object.values(nb.notes)
    .filter(isDm)
    .map((n) => ({ note: n, ship: counterparty(n), unread: unread(n.id), at: nb.activity[n.id] ?? 0 }))
    .filter((d) => d.ship)
    .sort((a, b) => (b.unread - a.unread) || (b.at - a.at));

export const dmWith = (ship) =>
  Object.values(nb.notes).find((n) => isDm(n) && counterparty(n) === ship) ?? null;

export const anyUnreadDm = () => dmList().some((d) => d.unread);

/* Everyone we could plausibly start a conversation with: pals, contacts, and
 * anyone whose profile we have seen -- which includes the people standing in
 * the world with us. */
export const knownShips = () => [...new Set([
  ...Object.keys(nb.pals),
  ...Object.keys(nb.contacts),
  ...Object.keys(nb.profiles),
])].filter((s) => s !== our);

/* Presence alone says who is running Glurff. Room rosters, contacts and other
 * notes never expand this set. Membership changes are applied on every read. */
export const visiblePeers = () => [...liveWorldPeers].filter(worldMember);
export const glurffAudience = visiblePeers;

export const setDial = value => nbAction('set-dial', {dial:Math.max(0,Math.min(3,Number(value)))});

export function messagesFor(noteId) {
  const rows = nb.messages[noteId] ?? [];
  if (noteId === COMMONS_NOTE) return worldJoined() ? rows.filter(m => nb.pals[m.author] !== 'blocked') : [];
  if (noteId !== 'cover' && nb.notes[noteId]?.type !== 'gossip') return rows;
  const rev = `${socialRevision}/${visibilityRevisions.get(noteId) ?? 0}`, old = views.get(noteId);
  if (old?.rows === rows && old.rev === rev) return old.visible;
  const filtered = rows.filter(m => gossip.visible(noteId, m));
  const visible = old && old.visible.length === filtered.length && filtered.every((m, i) => m === old.visible[i]) ? old.visible : filtered;
  views.set(noteId, {rows, rev, visible}); return visible;
}

/* ---------------------------------------------------------------- actions */

export const postMessage = (noteId, text, replyToEid = null) => {
  if (noteId === COMMONS_NOTE && !worldJoined()) return Promise.reject(new Error('Join Glurff before chatting.'));
  return nbApi('post-message', replyToEid ? { noteId, text, replyToEid } : { noteId, text },
        { attribute: true });
};
export const openDm = (ship) => nbApi('find-or-create-dm', { ship }).then((r) => r?.noteId ?? null);
export const markRead = (noteId) => {
  /* Move the local read mark now. The fact comes back too, but the dot has to
   * clear on the click rather than on the round trip. */
  nb.reads[noteId] = Date.now();
  changed('reads', noteId);
  return nbAction('mark-note-read', { noteId });
};

/* Pals, contacts and blocking are Noltbook's graph, poked straight at it.
 * These go through the API surface so a refusal is reported rather than lost. */
export const addPal = (ship) => nbApi('add-pal', { ship });
export const removePal = (ship) => nbApi('remove-pal', { ship });
/* Noltbook's API mark does not expose this action yet, but its ordinary action
 * mark does. This clears THEIR incoming request without creating an outgoing
 * relationship of our own. */
export const dismissPalRequest = (ship) => nbAction('dismiss-pal-request', { ship });
export const blockPal = (ship) => nbApi('block-pal', { ship });
export const unblockPal = (ship) => nbApi('unblock-pal', { ship });
export const addContact = (ship) => nbApi('add-contact', { ship });
export const removeContact = (ship) => nbApi('remove-contact', { ship });

/* Noltbook calls this stored field `azimuthAddress`; its current UI presents
 * it as Bio. Use the same field and partial API so edits in either app are one
 * profile, while wallet fields Glurff does not expose remain untouched. */
export const updateOwnProfile = ({ displayName: name, bio, avatar } = {}) => {
  const data = {};
  if (name !== undefined) data.displayName = String(name).trim() || null;
  if (bio !== undefined) data.azimuthAddress = String(bio).trim() || null;
  if (avatar !== undefined) data.avatar = avatar;
  return nbApi('update-profile', data);
};

export async function uploadOwnAvatar(blob, profile = {}) {
  const response = await fetch('/apps/noltbook/upload-avatar', {
    method: 'POST', body: blob, credentials: 'include',
  });
  if (!response.ok) {
    const message = response.status === 413 ? 'The profile picture is too large.'
      : response.status === 503 ? 'Noltbook could not store the profile picture.'
      : 'Noltbook rejected the profile picture.';
    throw new Error(message);
  }
  return updateOwnProfile({ ...profile, avatar: { type: 'urbit', url: '' } });
}

/* Someone we have never seen. The profile itself comes back as an ordinary
 * `profile-updated`; the reqId only reports whether they were reachable. */
let lookupId = 1;
/* Looking up somebody, the way Noltbook does it: 'looking' the moment we ask,
 * 'reachable' once their ship answers at all, then a verdict -- their profile
 * ('ok'), 'noltbook-unavailable' or 'unreachable'. The agent gives the verdict
 * after 27 seconds; when it cannot tell, this 28-second backstop decides, as
 * Noltbook's own page does. The state exists before the card opens, so the card
 * shows it at once. One lookup per ship at a time: asking again while one is out
 * only starts the wait over. */
const LOOKUP_MS = 28000;
const inFlight = new Map();   //  ship -> {reqId, timer}
const setLookup = (ship, status) => { nb.lookups[ship] = status; changed('lookups', null, ship); };
function settleLookup(ship) { clearTimeout(inFlight.get(ship)?.timer); inFlight.delete(ship); }
export const lookupActive = (ship) => nb.lookups[ship] === 'looking' || nb.lookups[ship] === 'reachable';
export const requestProfile = (ship) => {
  if (lookupActive(ship)) return Promise.resolve();
  settleLookup(ship);
  const reqId = lookupId++;
  const timer = setTimeout(() => {
    if (inFlight.get(ship)?.reqId !== reqId) return;
    inFlight.delete(ship);
    if (lookupActive(ship)) setLookup(ship, nb.lookups[ship] === 'reachable' ? 'noltbook-unavailable' : 'unreachable');
  }, LOOKUP_MS);
  inFlight.set(ship, { reqId, timer });
  setLookup(ship, 'looking');
  return nbAction('request-profile', { ship, reqId }).catch(() => {
    if (inFlight.get(ship)?.reqId === reqId) { settleLookup(ship); setLookup(ship, 'unreachable'); }
  });
};
export const retryProfile = (ship) => { settleLookup(ship); delete nb.lookups[ship]; return requestProfile(ship); };
/* Message bodies are searched by the ship, exactly as Noltbook's sidebar asks;
 * the answer comes back as a `search-result` carrying this id. */
let searchId = 1;
export const searchMessages = (query) => {
  const reqId = searchId++;
  nbAction('search-messages', { query, reqId, limit: 50 }).catch(() => {});
  return reqId;
};
/* Noltbook opens a note named by `?note=` in its URL. */
export const noteUrl = (id) => `/apps/noltbook/?note=${encodeURIComponent(id)}`;
export const requestRemoteNotes = (ship) => nbAction('request-remote-notes', { ship });
export const grantApp = () => nbApi('set-app-grant', { desk: 'glurff', enabled: true });

/* ------------------------------------------------------------------ boot */

export async function initNoltbook() {
  membership ??= createMembership();
  membership.start();
  await api.subscribe({
    app: 'noltbook',
    path: '/api/results',
    onRestored: () => (resultsLive = true),
    event: (f) => f?.['api-result'] && settle(f['api-result']),
    err: () => (resultsLive = false),
    quit: () => (resultsLive = false),
  });
  resultsLive = true;
  await subscribe('noltbook', '/notes', applyFact);
  membership.update({ ready: nb.ready, notes: nb.notes });
  grantApp().catch(() => {});
  return nb;
}

/* Opening the room menu asks Noltbook for a fresh authoritative note list.
 * The permanent /notes watch remains the live feed; this short-lived second
 * watch repairs a missed `note-created` without requiring a page restart. */
let notesRefresh = null;
export function refreshNotes() {
  if (notesRefresh) return notesRefresh;
  let handle = null, finished = false, timer = null;
  let finish;
  const pendingRefresh = new Promise((resolve, reject) => {
    finish = (error = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (handle != null) api.unsubscribe(handle).catch(() => {});
      if (error) reject(error); else resolve(nb);
    };
    timer = setTimeout(() => finish(new Error('note list refresh timed out')), 5000);
    subscribe('noltbook', '/notes', (name, payload) => {
      applyFact(name, payload);
      if (name === 'note-list') finish();
    }, '/notes refresh').then((id) => {
      handle = id;
      if (finished) api.unsubscribe(id).catch(() => {});
    }, finish);
  });
  notesRefresh = pendingRefresh.finally(() => {
    if (notesRefresh === pendingRefresh || notesRefresh === wrapped) notesRefresh = null;
  });
  const wrapped = notesRefresh;
  return wrapped;
}

/* Watch a note's messages -- or several, since the Rumors room needs both
 * halves of the feed. */
const noteSubs = new Map();
let roomNotes = [], roomHistory = 3, watchesClosed = false;
const extraNotes = new Map();
const WATCH_GRACE_MS = 5000;
const updateWanted = () => {
  const gossiped = id => id !== COMMONS_NOTE && (id === 'cover' || nb.notes[id]?.type === 'gossip');
  gossip.setWanted([...noteSubs.keys(), ...roomNotes, ...extraNotes.keys()]
    .filter(gossiped));
  for(const id of noteSubs.keys())if(gossiped(id))gossip.setHistory(id,extraNotes.has(id)?100:roomNotes.includes(id)?roomHistory:0);
};
export function setChatHistory(size) {
  roomHistory=Math.max(0,Math.min(500,Math.trunc(size)));
  updateWanted();
}
export const chatHistoryCount=id=>Math.min(500,Math.max(messagesFor(id).length,gossip.available(id)));
export const hasEarlierMessages = id => !!id && noteHistory(id).mayHaveMore;
export function loadEarlierMessages(noteId) {
  const history = noteHistory(noteId);
  const gossiped = noteId === 'cover' || nb.notes[noteId]?.type === 'gossip';
  if (!noteId || gossiped || history.loading || history.fetchedAll || !history.mayHaveMore)
    return Promise.resolve(false);
  history.loading = true;
  clearTimeout(history.timer);
  history.timer = setTimeout(() => { history.loading = false; history.timer = null; }, 10000);
  return nbAction('fetch-note-history', { noteId }).then(() => true, error => {
    history.loading = false; clearTimeout(history.timer); history.timer = null; throw error;
  });
}
function retireWatch(id,record) {
  if(record.closing)return record.closing;
  clearTimeout(record.timer);
  record.closing=record.promise.then(handle=>api.unsubscribe(handle)).catch(()=>{}).finally(()=>{
    if(noteSubs.get(id)===record)noteSubs.delete(id);
    updateWanted();
  });
  return record.closing;
}
export function watchNotes(...noteIds) {
  if(watchesClosed)return Promise.resolve();
  roomNotes=[...new Set(noteIds)];
  for(const [id,r] of noteSubs) {
    if(roomNotes.includes(id)){clearTimeout(r.timer);r.timer=null;}
    else if(!r.timer && !r.closing)r.timer=setTimeout(()=>{
      r.timer=null;if(!roomNotes.includes(id))void retireWatch(id,r);
    },WATCH_GRACE_MS);
  }
  updateWanted();
  const ensure=async id=>{
    if(watchesClosed || !roomNotes.includes(id))return;
    let r=noteSubs.get(id);
    if(r?.closing){await r.closing;return ensure(id);}
    if(r)return r.promise;
    // Commons and Rumors share a maximum of two room-chat watches. A third
    // destination waits for one inactive watch to close, never a growing queue.
    if(noteSubs.size>=2){
      const idle=[...noteSubs].find(([key])=>!roomNotes.includes(key));
      if(!idle)return;
      await retireWatch(...idle);return ensure(id);
    }
    r={timer:null,closing:null,promise:null};noteSubs.set(id,r);updateWanted();
    r.promise=subscribe('noltbook',`/notes/${id}`,applyFact).then(handle=>{
      if(!watchesClosed && roomNotes.includes(id))markRead(id).catch(()=>{});
      return handle;
    }).catch(error=>{if(noteSubs.get(id)===r)noteSubs.delete(id);updateWanted();throw error;});
    return r.promise;
  };
  return Promise.all(roomNotes.map(ensure));
}
if(typeof window!=='undefined'){
  window.glurffChatDiagnostics=()=>({...gossip.stats(),subscriptions:noteSubs.size,activeNotes:[...roomNotes]});
  window.addEventListener('glurff-exit',()=>{
    watchesClosed=true;roomNotes=[];
    for(const r of noteSubs.values())clearTimeout(r.timer);
    // api.js owns ordered channel deletion; do not race it with unsubscribe.
    noteSubs.clear();
  });
}
export const watchNote = (noteId) => watchNotes(noteId);

/* A watch that stands apart from the room-chat one above.
 *
 * `watchNotes` keeps only a short grace for the previous room; the chat column
 * follows you and only ever shows one place at a time. A DM window is open
 * ALONGSIDE that, so it keeps its own handle and tears down only itself. */
export async function subscribeNote(noteId) {
  extraNotes.set(noteId, (extraNotes.get(noteId) ?? 0) + 1); updateWanted();
  const id = await subscribe('noltbook', `/notes/${noteId}`, applyFact, `/notes/${noteId}`);
  markRead(noteId);
  return () => {
    const count = (extraNotes.get(noteId) ?? 1) - 1;
    if (count) extraNotes.set(noteId, count); else extraNotes.delete(noteId);
    updateWanted(); return api.unsubscribe(id).catch(() => {});
  };
}

/* Each member of the official shared note owns one [ship, desk] active row.
 * This is deliberately separate from calls: opening Glurff publishes it even
 * when the member is standing alone, and the TTL cleans up a crashed tab. */
let activeAt = -Infinity, activeBusy = false, activeSet = false;
let activeLease = null, activeClosed = false, leaseAt = -Infinity;
const activeMember = () => resultsLive && worldJoined() &&
  (nb.notes[COMMONS_NOTE]?.users ?? []).includes(our);
function touchActiveTab() {
  if (typeof window === 'undefined') return;
  if (!activeLease) {
    let storage;
    try { storage = window.localStorage; } catch {}
    activeLease = tabLease(storage, `glurff-active/${our}/`, crypto.randomUUID());
  }
  if (Date.now() - leaseAt >= TAB_REFRESH_MS) {
    leaseAt = Date.now(); activeLease.touch();
  }
}
function clearActiveRow(exit = false) {
  const lease = activeLease;
  activeLease = null; leaseAt = -Infinity; activeAt = -Infinity;
  const shouldClear = activeSet && (!lease || lease.close());
  activeSet = false;
  if (!shouldClear) return Promise.resolve(false);
  /* api.js queues the exit variant into its ordered departure beacon. */
  if (exit) return poke('noltbook', 'noltbook-api', { action: 'clear-note-active',
    requestId: nextRequestId++, app: glurffApp(), data: { noteId: COMMONS_NOTE } })
    .then(() => true, () => false);
  if (!resultsLive) return Promise.resolve(false);
  return nbApi('clear-note-active', { noteId: COMMONS_NOTE }, { attribute: true, timeout: 7000 })
    .then(() => true, error => {
      console.warn('Could not clear Glurff active status:', error.message); return false;
    });
}
export function stopActiveStatus() { return clearActiveRow(false); }
export async function updateActiveCount(count) {
  if (activeClosed || !activeMember()) return;
  touchActiveTab();
  if (activeBusy || Date.now() - activeAt < ACTIVE_REFRESH_MS) return;
  activeAt = Date.now(); activeBusy = true; activeSet = true;
  try {
    await nbApi('set-note-active', { noteId: COMMONS_NOTE, label: 'in Glurff',
      count: Math.max(1, Math.min(999, Math.trunc(count) || 1)), ttl: ACTIVE_TTL },
      { attribute: true, timeout: 7000 });
  } catch (error) { console.warn('Glurff active status unavailable:', error.message); }
  finally { activeBusy = false; }
}
if (typeof window !== 'undefined') window.addEventListener('glurff-exit', () => {
  activeClosed = true; void clearActiveRow(true);
});

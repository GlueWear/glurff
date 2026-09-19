/* Who is in a room with whom, and who else may know.
 *
 * "Room" here covers commons huddles too: a huddle is a room without walls,
 * with the same list, the same sharing and the same introductions.
 *
 * A ROOM INSTANCE is a host and a guest list. The host keeps the list: asking
 * the host for the room's call is asking to be on it, walking out takes you off
 * it, and a guest who crashes drops off when they leave the call or stop
 * renewing. The host sends the list to everyone on it whenever it changes.
 *
 * EVERYONE ON THE LIST SEES EVERYONE ELSE ON IT, pals or not: they are in the
 * same call already.
 *
 * AT LEAST ONE PERSON YOU CAN SEE IN A ROOM, AND YOU KNOW EVERYBODY IN IT.
 *   - Everyone in a room carries its list in their presence answer, so somebody
 *     who opens Glurff after the room filled up still learns who is inside.
 *   - They introduce each of their viewers to their room-mates. A room-mate
 *     accepts an introduction only from someone on its own list.
 *   - The room-mate then sends that viewer its state directly. The viewer
 *     accepts it only from someone on a list reported by a person it can already
 *     see.
 *   - When that person leaves the room, the list they reported goes with them,
 *     and so does everybody the viewer could only see through it.
 *
 * Nobody outside sees into a room where they cannot see anybody. Such a room
 * looks empty, and they can host their own copy of it.
 *
 * ORDER IS NOT GUARANTEED ACROSS SHIPS. A room-mate's state can arrive before
 * the list that vouches for it, so anything not yet vouched for is held for a
 * short while and admitted the moment a list does vouch for it.
 *
 * Everything here is transient. The pal graph and Noltbook are never changed,
 * and nothing is kept beyond this page.
 */
export const MAX_GUESTS = 32;
export const MAX_VIEWERS = 64;
/* A guest renews by asking for the call again, at least once a minute. */
export const GUEST_LEASE_MS = 150000;
/* A guest who was in the call and is not any more is gone after this long. */
export const CALL_GONE_MS = 20000;
/* Introductions are repeated this often, and lapse if they stop. */
export const INTRO_RENEW_MS = 120000;
export const INTRO_LEASE_MS = 300000;
/* How long something not yet vouched for is held. */
export const HOLD_MS = 30000;
const MODES = new Set(['open', 'pals', 'ask', 'locked']);
const MAX_INTRODUCED = 512, MAX_HELD = 64;

const isShip = (s) => typeof s === 'string' && /^~[a-z-]{3,70}$/.test(s);
/* Rooms are places 1-999 and huddles 1000-900999; both keep lists. Movement
 * sessions, from 950001, never do. */
export const MAX_PLACE = 901000;
const isRoom = (p) => Number.isSafeInteger(p) && p > 0 && p < MAX_PLACE;
const num = (n) => Number.isSafeInteger(n) && n >= 0;

/* A presence-style `here`: position, look revision, room host, movement claim. */
export function validHere(h) {
  if (!h || typeof h !== 'object' || !h.spot) return false;
  const s = h.spot;
  return s.place === 0 && num(s.x) && num(s.y) && s.x <= 1024 && s.y <= 736 &&
    ['up', 'down', 'left', 'right'].includes(s.dir) && num(h.rev) &&
    (h.host === null || h.host === undefined || isShip(h.host)) &&
    (h.stamp === undefined || Number.isFinite(h.stamp));
}

/* A list as it travels: host, place, revision and guests. */
function readList(m) {
  if (!m || !isRoom(m.place) || !isShip(m.host) || !num(m.rev) || !Array.isArray(m.guests) ||
      m.guests.length > MAX_GUESTS || !m.guests.every(isShip)) return null;
  const guests = new Set(m.guests);
  if (!guests.has(m.host)) return null;          //  the host is always on its own list
  return { place: m.place, host: m.host, rev: m.rev,
           mode: MODES.has(m.mode) ? m.mode : 'open', share: m.share !== false, guests };
}

export function createRoommates({ our, send, now = Date.now, trace = () => {}, changed = () => {},
  blocked = () => false, pal = () => false, here = () => null,
  /* Who already sees us through presence. They get nothing from a room that
   * presence is not already giving them. */
  watchers = () => new Set() } = {}) {
  let hosted = null;        //  {place, rev, mode, share, guests: Map<ship, {at, seen, missing}>}
  let following = null;     //  {place, host}
  let list = null;          //  the list we are on: {place, host, rev, mode, share, guests:Set}
  const reports = new Map();       //  visible ship -> the list they say they are on
  const viewers = new Map();       //  viewer -> {place, host, via: Map<introducer, ms>}
  const introduced = new Map();    //  `${mate}/${viewer}` -> ms we last introduced them
  const states = new Map();        //  ship -> {place, host, here, sequence, at}
  const held = new Map();          //  ship -> a state or introduction not yet vouched for
  let sequence = 0;

  const emit = (to, message) => {
    if (to === our || blocked(to)) return;
    try { Promise.resolve(send(to, message)).catch(() => {}); } catch {}
  };
  const notify = (why) => { try { changed(why); } catch {} };

  /* ------------------------------------------------------- visibility */

  function allowed(ship, place, hostShip) {
    if (!isShip(ship) || ship === our || blocked(ship)) return false;
    if (list && list.place === place && list.host === hostShip && list.guests.has(ship)) return true;
    for (const r of reports.values()) {
      if (r.share && r.place === place && r.host === hostShip && r.guests.has(ship)) return true;
    }
    return false;
  }
  function introValid(v) {
    if (!list || list.place !== v.place || list.host !== v.host) return false;
    const t = now();
    for (const [via, at] of v.via) if (list.guests.has(via) && t - at < INTRO_LEASE_MS) return true;
    return false;
  }

  /* Everyone who gets our state from us because of a room -- and only because
   * of it: anyone presence already reaches is left to presence. */
  function audience() {
    const out = new Set();
    let seen;
    try { seen = watchers(); } catch { seen = new Set(); }
    if (list) for (const s of list.guests) if (s !== our && !blocked(s) && !seen.has(s)) out.add(s);
    for (const [v, i] of viewers) if (introValid(i) && !blocked(v) && !seen.has(v)) out.add(v);
    return out;
  }

  /* Our state to our room audience, or to the named part of it. */
  function publish(only = null) {
    if (!list) return;
    const h = here();
    if (!validHere(h)) return;
    const message = { kind: 'room-state', place: list.place, host: list.host, sequence: ++sequence, here: h };
    for (const s of audience()) if (!only || only.has(s)) emit(s, message);
  }

  /* Drop whatever our lists no longer justify, and admit whatever they now do. */
  function reconcile() {
    for (const [s, st] of states) if (!allowed(s, st.place, st.host)) states.delete(s);
    for (const [v, i] of viewers) if (!introValid(i) || list?.guests.has(v)) viewers.delete(v);
    const t = now();
    for (const [key, h] of held) {
      if (t - h.at >= HOLD_MS) { held.delete(key); continue; }
      if (h.kind === 'state' && allowed(h.from, h.m.place, h.m.host)) { held.delete(key); acceptState(h.from, h.m); }
      else if (h.kind === 'intro' && list && list.place === h.m.place && list.host === h.m.host && list.guests.has(h.from)) {
        held.delete(key); acceptIntro(h.from, h.m);
      }
    }
  }
  function hold(kind, from, m) {
    const key = kind + '/' + from + (kind === 'intro' ? '/' + m.viewer : '');
    if (!held.has(key) && held.size >= MAX_HELD) return;
    held.set(key, { kind, from, m, at: now() });
  }

  /* ---------------------------------------------------------- the host */

  const hostedList = () => ({ place: hosted.place, host: our, rev: hosted.rev, mode: hosted.mode,
    share: hosted.share, guests: new Set(hosted.guests.keys()) });
  const listMessage = (l) => ({ kind: 'room-roster', place: l.place, host: l.host, rev: l.rev,
    mode: l.mode, share: l.share, guests: [...l.guests].sort() });

  /* The list changed: everyone on it hears the new one, and only newcomers get
   * our state -- everyone else already has it. */
  function publishList() {
    const before = list?.guests ?? new Set();
    list = hostedList();
    const message = listMessage(list);
    for (const s of list.guests) emit(s, message);
    reconcile();
    notify('list');
    publish(new Set([...list.guests].filter((s) => !before.has(s))));
  }

  /* We host this room. We are the first guest on our own list. */
  function host(place, { mode = 'open', share = true } = {}) {
    if (!isRoom(place) || hosted?.place === place) return;
    leave();
    hosted = { place, rev: 1, mode: MODES.has(mode) ? mode : 'open', share,
               guests: new Map([[our, { at: now(), seen: true, missing: null }]]) };
    following = { place, host: our };
    list = hostedList();
    trace('room-list', { place, host: our, reason: 'hosting', count: 1 });
    reconcile();
    notify('hosting');
  }

  /* Somebody asked us for this room's call. That is asking to be on the list,
   * and the answer follows the room's mode. Asking again renews. */
  function admit(who, place) {
    if (!hosted || hosted.place !== place || !isShip(who) || blocked(who)) return false;
    if (who === our) return true;
    const ok = hosted.mode === 'open' || (hosted.mode === 'pals' && pal(who));
    if (!ok) return false;
    const g = hosted.guests.get(who);
    if (g) { g.at = now(); return true; }
    if (hosted.guests.size >= MAX_GUESTS) return false;
    hosted.guests.set(who, { at: now(), seen: false, missing: null });
    hosted.rev++;
    trace('room-list', { place, host: our, who, reason: 'joined', count: hosted.guests.size });
    publishList();
    return true;
  }

  /* They left the room's call: walked out, or moved to another host. */
  function left(who, place) {
    if (!hosted || hosted.place !== place || who === our || !hosted.guests.delete(who)) return;
    hosted.rev++;
    trace('room-list', { place, host: our, who, reason: 'left', count: hosted.guests.size });
    publishList();
  }

  /* Who the call server says is connected, for noticing a guest who crashed. */
  function inCall(ships) {
    if (!hosted) return;
    const t = now();
    for (const [who, g] of hosted.guests) {
      if (who === our) continue;
      if (ships.has(who)) { g.seen = true; g.missing = null; }
      else if (g.seen && g.missing === null) g.missing = t;
    }
  }

  /* ------------------------------------------------------ being a guest */

  /* We are in this room, following this host. Its list arrives from the host. */
  function follow(place, hostShip) {
    if (!isRoom(place) || !isShip(hostShip)) return;
    if (hostShip === our) { host(place); return; }
    if (!hosted && following?.place === place && following.host === hostShip) return;
    leave();
    following = { place, host: hostShip };
    notify('following');
  }

  /* Out of the room. Everyone who could see us through it is told at once. */
  function leave() {
    if (list) {
      const cut = { kind: 'room-cut', place: list.place, host: list.host };
      for (const s of audience()) emit(s, cut);
      for (const key of introduced.keys()) {
        const [mate, viewer] = key.split('/');
        emit(mate, { kind: 'room-unintro', place: list.place, host: list.host, viewer });
      }
    }
    const had = !!(hosted || following || list);
    hosted = null; following = null; list = null;
    viewers.clear(); introduced.clear();
    reconcile();
    if (had) notify('left');
  }

  /* ---------------------------------------------------- what we can see */

  /* The lists the people we can see say they are on, from their presence. */
  function heard(peers) {
    let moved = false;
    const present = new Set();
    for (const [ship, m] of peers) {
      const r = readList(m?.room);
      if (!r || ship === our) continue;
      present.add(ship);
      const old = reports.get(ship);
      if (!old || old.rev !== r.rev || old.host !== r.host || old.place !== r.place) moved = true;
      reports.set(ship, r);
    }
    for (const ship of [...reports.keys()]) if (!present.has(ship)) { reports.delete(ship); moved = true; }
    if (!moved) return;
    reconcile();
    notify('reports');
  }

  /* Introduce the people who can see us to our room-mates, once, and again
   * every couple of minutes while it still holds. */
  function introduce(ourViewers) {
    if (!list || !list.share) return;
    const mates = [...list.guests].filter((s) => s !== our);
    const wanted = new Set();
    const t = now();
    for (const v of ourViewers) {
      if (!isShip(v) || v === our || list.guests.has(v) || blocked(v)) continue;
      for (const mate of mates) {
        const key = mate + '/' + v;
        wanted.add(key);
        const at = introduced.get(key);
        if (at !== undefined && t - at < INTRO_RENEW_MS) continue;
        if (at === undefined && introduced.size >= MAX_INTRODUCED) continue;
        introduced.set(key, t);
        emit(mate, { kind: 'room-intro', place: list.place, host: list.host, viewer: v });
      }
    }
    for (const key of [...introduced.keys()]) {
      if (wanted.has(key)) continue;
      introduced.delete(key);
      const [mate, viewer] = key.split('/');
      emit(mate, { kind: 'room-unintro', place: list.place, host: list.host, viewer });
    }
  }

  /* ------------------------------------------------------------- inbox */

  function acceptIntro(from, m) {
    let v = viewers.get(m.viewer);
    const fresh = !v || !introValid(v);
    if (!v) {
      if (viewers.size >= MAX_VIEWERS) return;
      v = { place: list.place, host: list.host, via: new Map() };
      viewers.set(m.viewer, v);
    }
    v.via.set(from, now());
    if (fresh) { notify('audience'); publish(new Set([m.viewer])); }
  }
  function acceptState(from, m) {
    const old = states.get(from);
    if (old && old.place === m.place && old.host === m.host && m.sequence <= old.sequence) return;
    states.set(from, { place: m.place, host: m.host, here: m.here, sequence: m.sequence, at: now() });
    notify(old ? 'state' : 'visibility');
  }

  function receive(from, m) {
    if (!isShip(from) || from === our || blocked(from) || !m || typeof m.kind !== 'string') return;
    switch (m.kind) {
      case 'room-roster': {
        const r = readList(m);
        if (!r || hosted || r.host !== from || !following || following.place !== r.place || following.host !== from) return;
        if (list && list.host === r.host && list.place === r.place && r.rev <= list.rev) return;
        const before = list?.guests ?? new Set();
        list = r;
        if (!r.guests.has(our)) trace('room-list', { place: r.place, host: from, reason: 'not-on-list', count: r.guests.size });
        reconcile();
        notify('list');
        if (r.guests.has(our)) publish(new Set([...r.guests].filter((s) => !before.has(s))));
        return;
      }
      case 'room-intro': {
        if (!isRoom(m.place) || !isShip(m.host) || !isShip(m.viewer) || m.viewer === our || blocked(m.viewer)) return;
        if (!list || list.place !== m.place || list.host !== m.host || !list.guests.has(from)) { hold('intro', from, m); return; }
        if (list.guests.has(m.viewer)) return;
        acceptIntro(from, m);
        return;
      }
      case 'room-unintro': {
        const v = viewers.get(m.viewer);
        if (!v || v.place !== m.place || v.host !== m.host || !v.via.delete(from)) return;
        if (!introValid(v)) { viewers.delete(m.viewer); notify('audience'); }
        return;
      }
      case 'room-state': {
        if (!isRoom(m.place) || !isShip(m.host) || !num(m.sequence) || !validHere(m.here)) return;
        if (!allowed(from, m.place, m.host)) { hold('state', from, m); return; }
        acceptState(from, m);
        return;
      }
      case 'room-cut': {
        held.delete('state/' + from);
        const st = states.get(from);
        if (st && st.place === m.place && st.host === m.host) { states.delete(from); notify('visibility'); }
        return;
      }
      default:
    }
  }

  /* ------------------------------------------------------------ upkeep */

  function tick() {
    const t = now();
    if (hosted) {
      let dropped = false;
      for (const [who, g] of hosted.guests) {
        if (who === our) continue;
        const lapsed = t - g.at >= GUEST_LEASE_MS;
        const vanished = g.missing !== null && t - g.missing >= CALL_GONE_MS;
        if (!lapsed && !vanished) continue;
        hosted.guests.delete(who);
        trace('room-list', { place: hosted.place, host: our, who, reason: lapsed ? 'lapsed' : 'left-call', count: hosted.guests.size });
        dropped = true;
      }
      if (dropped) { hosted.rev++; publishList(); }
    }
    const before = viewers.size;
    reconcile();
    if (viewers.size !== before) notify('audience');
  }

  return {
    host, admit, left, inCall, follow, leave, heard, introduce, publish, receive, tick, audience,
    /* The people we can see because of a room, with their latest state. */
    peers() {
      const out = new Map();
      for (const [s, st] of states) if (allowed(s, st.place, st.host)) out.set(s, { ...st.here, at: st.at, place: st.place, roomHost: st.host });
      return out;
    },
    /* What rides our presence answer: the list we are on, if it may be shared. */
    summary: () => (list && list.share
      ? { place: list.place, host: list.host, rev: list.rev, mode: list.mode, guests: [...list.guests].sort() }
      : null),
    /* The copies of a room the people we can see are in: host -> how many are in it. */
    instances(place) {
      const out = new Map();
      for (const r of reports.values()) if (r.share && r.place === place) out.set(r.host, Math.max(out.get(r.host) ?? 0, r.guests.size));
      if (list?.place === place) out.set(list.host, Math.max(out.get(list.host) ?? 0, list.guests.size));
      return out;
    },
    current: () => (list ? { place: list.place, host: list.host, rev: list.rev, guests: [...list.guests].sort() } : null),
    guests: () => (hosted ? hosted.guests.size : list?.guests.size ?? 0),
    stats: () => ({ hosting: hosted?.place ?? null, following: following ? `${following.place}/${following.host}` : null,
      guests: list?.guests.size ?? 0, reports: reports.size, viewers: viewers.size,
      introduced: introduced.size, visible: states.size, held: held.size }),
  };
}

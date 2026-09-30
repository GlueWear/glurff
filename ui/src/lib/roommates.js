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
 * Room lists coordinate calls and leases. They never grant world membership:
 * every sender, recipient and listed participant is checked against the
 * shared world's membership independently of friendship.
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
/* How often a leased room repeats its list to the note's members. It is their
 * only route to a secret note's id, so it has to arrive without them having
 * been present when anything changed. */
export const MEMBER_REFRESH_MS = 20000;
/* How long something not yet vouched for is held. */
export const HOLD_MS = 30000;
/* A FOLLOWER'S LIST GOES STALE. An ordinary room's host sends its list only
 * when it changes, so one lost update used to be believed until we walked
 * out. A follower now asks again (room-hello) when its list is this old, and
 * sooner -- backed off -- while it has no list at all. */
export const LIST_RESYNC_MS = 60000;
export const LIST_ASK_MS = [3000, 8000, 20000, 60000];
/* Three missed resyncs and the list is not believed any more. */
export const LIST_EXPIRE_MS = 200000;
const MODES = new Set(['open', 'ask', 'locked']);
const MAX_INTRODUCED = 512, MAX_HELD = 64;

const isShip = (s) => typeof s === 'string' && /^~[a-z-]{3,70}$/.test(s);
/* A Noltbook note id, as it travels. Theirs, not ours: only the shape is
 * checked here, and an unknown id simply finds no note. */
const isNote = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 && /^[a-z0-9~_.-]+$/i.test(s);
/* Noltbook's three, as they travel. A room leased to a SECRET note says only
 * that -- never the note's id, which is the one thing a stranger must not
 * learn. Public and private carry the id so a stranger can look the note up
 * the ordinary way and ask to join. */
const VIS = new Set(['public', 'private', 'secret']);
const isVis = (v) => VIS.has(v);
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
    ['up', 'down', 'left', 'right'].includes(s.dir) &&
    (s.scene === undefined || s.scene === 'main' || s.scene === 'vatican') && num(h.rev) &&
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
           mode: MODES.has(m.mode) ? m.mode : 'open', share: m.share !== false, guests,
           /* The note this room is leased to, and how open it is. A secret
            * note sends its visibility and nothing else. */
           note: isNote(m.note) ? m.note : null,
           vis: isVis(m.vis) ? m.vis : null,
           /* Which incarnation of the lease this is, so a seat is renewed
            * against the lease it was taken in and no other. */
           gen: num(m.gen) ? m.gen : 0 };
}

export function createRoommates({ our, send, now = Date.now, trace = () => {}, changed = () => {},
  blocked = () => false, member = () => true, here = () => null,
  /* The room we are standing in. A list for anywhere else is not ours to take. */
  standing = () => null,
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
  /* Rooms we have been told we may walk into: place -> {host, note, vis, at}.
   * A SECRET room is covered over and solid to everybody who cannot name the
   * note it is leased to, and a secret note's id never rides presence -- so
   * without this a member of the note could not get through their own door.
   * Being invited is not being in the room: this decides nothing but the
   * door. */
  const invites = new Map();
  /* AN INVITE IS NOT A DEED. While a lease owner has a browser open the roster
   * refreshes every MEMBER_REFRESH_MS, so a live invite is never more than a
   * few seconds stale. Once that browser closes nothing refreshes it, and a
   * lease that has since ended would be believed forever -- leaving a room
   * reading as a note nobody holds. Outliving several refreshes is enough to be
   * invisible in normal use and self-healing when the owner is gone. */
  const INVITE_TTL_MS = 90000;
  let sequence = 0;
  let saidMembers = 0;
  let listAt = 0;           //  when the host last gave us the list we follow
  let helloAt = 0, hellos = 0;
  const eligible = ship => isShip(ship) && member(our) && member(ship) && !blocked(ship);
  const guestsOf = r => [...r.guests].filter(eligible);

  const emit = (to, message) => {
    if (to === our || !eligible(to)) return;
    try { Promise.resolve(send(to, message)).catch(() => {}); } catch {}
  };
  const notify = (why) => { try { changed(why); } catch {} };

  /* ------------------------------------------------------- visibility */

  function allowed(ship, place, hostShip) {
    if (ship === our || !eligible(ship) || !eligible(hostShip)) return false;
    if (list && list.place === place && list.host === hostShip && list.guests.has(ship)) return true;
    for (const r of reports.values()) {
      if (r.share && r.place === place && r.host === hostShip && r.guests.has(ship)) return true;
    }
    return false;
  }
  function introValid(v) {
    if (!list || !eligible(list.host) || list.place !== v.place || list.host !== v.host) return false;
    const t = now();
    for (const [via, at] of v.via) if (eligible(via) && list.guests.has(via) && t - at < INTRO_LEASE_MS) return true;
    return false;
  }

  /* Everyone who gets our state from us because of a room -- and only because
   * of it: anyone presence already reaches is left to presence. */
  function audience() {
    const out = new Set();
    let seen;
    try { seen = watchers(); } catch { seen = new Set(); }
    if (list) for (const s of list.guests) if (s !== our && eligible(s) && !seen.has(s)) out.add(s);
    for (const [v, i] of viewers) if (introValid(i) && eligible(v) && !seen.has(v)) out.add(v);
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
    for (const [v, i] of viewers) if (!eligible(v) || !introValid(i) || list?.guests.has(v)) viewers.delete(v);
    const t = now();
    for (const [key, h] of held) {
      if (!eligible(h.from) || (h.kind === 'intro' && !eligible(h.m.viewer)) || t - h.at >= HOLD_MS) { held.delete(key); continue; }
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
    share: hosted.share, guests: new Set(hosted.guests.keys()),
    note: hosted.note ?? null, vis: hosted.vis ?? null, gen: hosted.gen ?? 0 });
  /* THE LIST GOES TO THE PEOPLE ON IT, and for a leased room that is the
   * note's own members -- so it carries the note's id whatever the note's
   * visibility. Withholding it from members too is what left two people
   * standing in the same secret room unable to see each other: neither could
   * tell which note the room was, so neither could tell they were both in it.
   *
   * The SUMMARY below is the one that must stay quiet: it rides presence to
   * anybody who can see us, members or not. */
  /* An invite nobody has refreshed inside INVITE_TTL_MS is dropped rather than
   * trusted; see the note on the constant. */
  const fresh = (place) => {
    const asked = invites.get(place);
    if (!asked) return null;
    if (now() - (asked.at ?? 0) < INVITE_TTL_MS) return asked;
    invites.delete(place);
    return null;
  };
  const listMessage = (l) => ({ kind: 'room-roster', place: l.place, host: l.host, rev: l.rev,
    mode: l.mode, share: l.share, guests: [...l.guests].sort(),
    ...(l.note ? { note: l.note } : {}),
    ...(l.vis ? { vis: l.vis } : {}),
    /* The lease's generation, so a guest renews its seat against the lease it
     * actually joined. The presence summary carried it; this direct roster --
     * the one a guest follows -- did not, and a guest could end up renewing
     * against generation 0 and being refused. */
    ...(l.gen ? { gen: l.gen } : {}) });

  /* The list changed: everyone on it hears the new one, and only newcomers get
   * our state -- everyone else already has it.
   *
   * COALESCED. Several things can change a list in one beat -- a guest joins
   * while the note updates while the lease is republished -- and each send is
   * one poke per guest. Collapsing a burst into a single round costs nothing
   * in latency (it lands in the same tick) and is the difference between one
   * send and thirteen. Genuine joins, removals and lease changes all still go
   * out at once; only duplicates within the same beat are dropped. */
  /* A LIST IS NEVER SENT TWICE.
   *
   * The storm was not a burst of different lists, it was the SAME list sent
   * over and over: `setMembers` published unconditionally, and it is called on
   * every occupancy change and every note update, once per guest. Thirteen
   * guests gave 21,806 sends with 17,716 still queued and requests 48 seconds
   * old, which starved presence, room-state and call control on the same
   * channel.
   *
   * Refusing to repeat a message we have already sent is the whole fix, and
   * it is better than a timer: a genuine change is never delayed by even a
   * tick, because a genuine change produces a different message. A newcomer
   * still gets the list even when its content is unchanged -- being new to it
   * is itself the difference. */
  let lastSent = '';
  function publishList(before = list?.guests ?? new Set(), force = false) {
    list = hostedList();
    const message = listMessage(list);
    const key = JSON.stringify(message);
    const newcomers = new Set([...list.guests].filter((s) => !before.has(s)));
    if (key === lastSent && !newcomers.size && !force) { reconcile(); return; }
    lastSent = key;
    for (const s of list.guests) emit(s, message);
    reconcile();
    notify('list');
    publish(newcomers);
  }

  /* We host this room. We are the first guest on our own list. */
  function host(place, { mode = 'open', share = true, note = null } = {}) {
    if (!eligible(our) || !isRoom(place) || hosted?.place === place) return;
    leave();
    lastSent = '';
    hosted = { place, rev: 1, mode: MODES.has(mode) ? mode : 'open', share,
               note: isNote(note) ? note : null, vis: null,
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
    if (!hosted || hosted.place !== place || !eligible(who)) return false;
    if (who === our) return true;
    const ok = hosted.mode === 'open';
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
    if (!isRoom(place) || !eligible(hostShip)) return;
    if (hostShip === our) { host(place); return; }
    if (!hosted && following?.place === place && following.host === hostShip) return;
    leave();
    following = { place, host: hostShip };
    helloAt = now(); hellos = 1;
    /* ASK FOR THE LIST. Joining an ordinary room's call is itself the request
     * to be on its list, and the host answers with one. A LEASED room's call
     * is Noltbook's and Glurff asks it for nothing, so without this the host
     * has no idea we have walked in and we wait for their next broadcast. */
    emit(hostShip, { kind: 'room-hello', place, host: hostShip });
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
    lastSent = '';
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
      if (!r || ship === our || !eligible(ship) || !eligible(r.host)) continue;
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
    const mates = [...list.guests].filter((s) => s !== our && eligible(s));
    const wanted = new Set();
    const t = now();
    for (const v of ourViewers) {
      if (!eligible(v) || v === our || list.guests.has(v)) continue;
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
    if (!eligible(from) || from === our || !m || typeof m.kind !== 'string') return;
    switch (m.kind) {
      case 'room-roster': {
        const r = readList(m);
        if (!r || hosted || r.host !== from) return;
        /* AN INVITATION TO THE ROOM WE ARE STANDING IN.
         *
         * Normally we only take a list from a host we are already following,
         * because following is what asking to join their call made us. A
         * LEASED room has no call of ours to ask for -- it is the note's --
         * so nothing ever made us follow anybody, and two members of the same
         * secret note stood in the same room unable to see each other.
         *
         * A list that names the room we are standing in and has us on it is
         * that room reaching us. Nothing else is accepted: not a list for
         * somewhere else, and not one we are not on. */
        if (r.guests.has(our)) invites.set(r.place, { host: from, note: r.note ?? null, vis: r.vis ?? null, gen: r.gen ?? 0, at: now() });
        else if (invites.get(r.place)?.host === from) invites.delete(r.place);
        if (!following || following.place !== r.place || following.host !== from) {
          if (!r.guests.has(our) || standing() !== r.place) return;
          leave();
          following = { place: r.place, host: from };
        }
        /* The same list again is not news, but it IS the host still being
         * there and still saying so: the list stays fresh. */
        if (list && list.host === r.host && list.place === r.place && r.rev <= list.rev) { listAt = now(); hellos = 0; return; }
        const before = list?.guests ?? new Set();
        list = r;
        listAt = now(); hellos = 0;
        if (!r.guests.has(our)) trace('room-list', { place: r.place, host: from, reason: 'not-on-list', count: r.guests.size });
        reconcile();
        notify('list');
        if (r.guests.has(our)) publish(new Set([...r.guests].filter((s) => !before.has(s))));
        return;
      }
      /* Somebody on the list has walked in and wants it. Only somebody on it:
       * this answers no questions about a room you do not belong to. */
      case 'room-hello': {
        if (!hosted || hosted.place !== m.place || !hosted.guests.has(from)) return;
        emit(from, listMessage(hostedList()));
        return;
      }
      case 'room-intro': {
        if (!isRoom(m.place) || !eligible(m.host) || !eligible(m.viewer) || m.viewer === our) return;
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
        if (!isRoom(m.place) || !eligible(m.host) || !num(m.sequence) || !validHere(m.here)) return;
        if (!allowed(from, m.place, m.host)) { hold('state', from, m); return; }
        acceptState(from, m);
        return;
      }
      /* The host has taken us off this room's list. */
      case 'room-drop': {
        if (!isRoom(m.place) || m.host !== from) return;
        if (invites.get(m.place)?.host === from) invites.delete(m.place);
        if (following?.place === m.place && following.host === from) { leave(); notify('dropped'); }
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

  /* A roster removal revokes existing routes as well as future admission.
   * Called on world membership changes, independently of position updates. */
  function refreshMembership() {
    let touched = false;
    if ((!eligible(our) && (hosted || following || list)) || (following && !eligible(following.host))) {
      leave(); touched = true;
    }
    if (hosted) {
      for (const ship of hosted.guests.keys()) if (ship !== our && !eligible(ship)) {
        hosted.guests.delete(ship); touched = true;
      }
      if (touched) { hosted.rev++; publishList(); }
    }
    for (const [ship, r] of reports) if (!eligible(ship) || !eligible(r.host)) {
      reports.delete(ship); touched = true;
    }
    for (const [place, invite] of invites) if (!eligible(invite.host)) {
      invites.delete(place); touched = true;
    }
    for (const key of introduced.keys()) if (key.split('/').some(s => !eligible(s))) {
      introduced.delete(key); touched = true;
    }
    const count = states.size + viewers.size + held.size;
    reconcile();
    if (touched || count !== states.size + viewers.size + held.size) notify('membership');
  }

  /* Ask the host we follow for its list, at most every so often. */
  function askList(t, force = false) {
    if (!following || following.host === our) return false;
    const has = !!list && list.place === following.place && list.host === following.host;
    const wait = has && !force ? LIST_RESYNC_MS : LIST_ASK_MS[Math.min(hellos, LIST_ASK_MS.length - 1)];
    if (t - (has && !force ? Math.max(listAt, helloAt) : helloAt) < wait) return false;
    helloAt = t; hellos++;
    trace('room-list', { place: following.place, host: following.host, reason: has ? 'resync' : 'ask', count: hellos });
    emit(following.host, { kind: 'room-hello', place: following.place, host: following.host });
    return true;
  }

  function tick() {
    refreshMembership();
    const t = now();
    if (following && following.host !== our) {
      const has = !!list && list.place === following.place && list.host === following.host;
      /* Not heard for three resyncs: whatever it said then is not the room now. */
      if (has && t - listAt >= LIST_EXPIRE_MS) {
        trace('room-list', { place: list.place, host: list.host, reason: 'expired', count: list.guests.size });
        list = null;
        reconcile();
        notify('expired');
      }
      askList(t);
    }
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
      /* A LEASED ROOM SAYS ITS LIST AGAIN EVERY SO OFTEN. The list is what
       * carries a secret note's id to its members, and it is what gets them
       * through the room's door -- so somebody who opened Glurff after the
       * last change would otherwise stand outside a room that is theirs. */
      /* The one send that is allowed to repeat itself. A secret note's id
       * travels nowhere else, so a member who was not around when the list
       * last changed has no other way to hear it -- the deduplication above
       * must not swallow this. Bounded by MEMBER_REFRESH_MS, and only while a
       * note is actually attached. */
      else if (hosted.note && t - saidMembers >= MEMBER_REFRESH_MS) {
        saidMembers = t;
        publishList(list?.guests ?? new Set(), true);
      }
    }
    const before = viewers.size;
    reconcile();
    if (viewers.size !== before) notify('audience');
  }

  return {
    host, admit, left, inCall, follow, leave, heard, introduce, publish, receive, tick, audience, refreshMembership,
    /* Ask for the list now -- the call watchdog's first repair. Still rate
     * limited, by the no-list back-off. */
    resync: () => (hosted ? (publishList(list?.guests ?? new Set(), true), true) : askList(now(), true)),
    /* The people we can see because of a room, with their latest state. */
    peers() {
      const out = new Map();
      for (const [s, st] of states) if (allowed(s, st.place, st.host)) out.set(s, { ...st.here, at: st.at, place: st.place, roomHost: st.host });
      return out;
    },
    /* What rides our presence answer: the list we are on, if it may be shared. */
    summary: () => (list && eligible(list.host) && list.share
      ? { place: list.place, host: list.host, rev: list.rev, mode: list.mode,
          guests: guestsOf(list).sort(),
          ...(list.note && list.vis !== 'secret' ? { note: list.note } : {}),
          ...(list.vis ? { vis: list.vis } : {}),
          /* The generation rides presence too. Reports are built from this, so
           * without it anybody who learned the lease from a summary rather than
           * the roster had generation 0 and could not renew a seat. It is a
           * counter and gives nothing away, so a secret room carries it even
           * while its note id stays behind. */
          ...(list.gen ? { gen: list.gen } : {}) }
      : null),
    /* The copies of a room the people we can see are in: host -> how many are
     * in it, and the note it is leased to. A copy we cannot see is not here --
     * which is the whole point: a room can be genuinely empty from where you
     * are standing while somebody else is holding it. */
    instances(place) {
      const out = new Map();
      const put = (host, count, note, vis) => {
        if (!eligible(host)) return;
        const had = out.get(host);
        out.set(host, { count: Math.max(had?.count ?? 0, count),
          note: note ?? had?.note ?? null, vis: vis ?? had?.vis ?? null });
      };
      for (const [ship,r] of reports) if (eligible(ship) && r.share && r.place === place) put(r.host, guestsOf(r).length, r.note, r.vis);
      if (list?.place === place) put(list.host, guestsOf(list).length, list.note, list.vis);
      return out;
    },
    /* Bind or unbind the room we are hosting. The list's revision moves, so
     * everybody on it learns about it the same way they learn about a guest. */
    /* THE ROOM'S PEOPLE ARE THE NOTE'S PEOPLE. A leased room's call is
     * Noltbook's, so nobody asks Glurff to join it and nothing else would ever
     * put them on this list -- which is how two members of a secret note ended
     * up in the same room, invisible to one another. The host sets the list
     * from the note itself. */
    setMembers(ships, first = []) {
      if (!hosted) return false;
      if (!eligible(our)) return false;
      /* ONE LIMIT, BOTH ENDS. A receiver refuses any list longer than
       * MAX_GUESTS, and a leased note can have more members than that -- at 33
       * every member refused the whole list and nobody learned anything. The
       * list is cut here instead, keeping the people actually in the room
       * first, then everybody else in a stable order. Members beyond the limit
       * are not on the list; for a SECRET note that means they cannot be told
       * the room's note until somebody leaves it. */
      const pool = (ships ?? []).filter(eligible).filter((s) => s !== our);
      const here = new Set((first ?? []).filter((s) => pool.includes(s)));
      const ordered = [...[...here].sort(), ...pool.filter((s) => !here.has(s)).sort()];
      const kept = ordered.slice(0, MAX_GUESTS - 1);
      if (ordered.length > kept.length)
        trace('room-list', { place: hosted.place, host: our, reason: 'capped',
          count: kept.length + 1, left: ordered.length - kept.length });
      const want = new Set([our, ...kept]);
      const same = want.size === hosted.guests.size && [...want].every((s) => hosted.guests.has(s));
      for (const who of [...hosted.guests.keys()]) if (!want.has(who)) {
        hosted.guests.delete(who);
        /* SAY SO TO THEIR FACE. The new list goes only to the people on it, so
         * somebody taken out of the note would never hear that they are out of
         * the room: they would keep the last list they were sent, and with it
         * the note's id and sight of everybody in it. */
        emit(who, { kind: 'room-drop', place: hosted.place, host: our });
      }
      /* Membership is the lease here: an ordinary guest renews by asking for
       * the call again, and nobody asks a leased room for anything. */
      for (const who of want) {
        const g = hosted.guests.get(who);
        if (g) g.at = now();
        else hosted.guests.set(who, { at: now(), seen: false, missing: null });
      }
      /* PUBLISH ONLY WHEN THE LIST ACTUALLY CHANGED.
       *
       * This used to send every time it was called, so that a member who had
       * just walked in or reloaded would hear the list. That was wrong twice
       * over: `republishLease` calls it on every occupancy change and on every
       * note update, and one call is one poke PER GUEST. A thirteen-person
       * note room produced 21,806 room-list sends with 17,716 still queued and
       * requests forty-eight seconds old -- which then starved presence,
       * room-state and call control on the same channel.
       *
       * The two cases it was covering are both served without this: somebody
       * arriving asks for the list themselves (room-hello, see follow), and
       * the periodic refresh in tick() catches anyone else. */
      if (!same) {
        hosted.rev++;
        trace('room-list', { place: hosted.place, host: our, reason: 'note-members', count: hosted.guests.size });
        publishList();
      }
      return same ? false : true;
    },
    /* Drop anybody the room will no longer have. Taking a lease on a room
     * with people already standing in it, or a member being removed from the
     * note, must take them off the list too -- admission is checked when
     * somebody asks, and that is not the only moment it can change. */
    keepOnly(allow) {
      if (!hosted) return false;
      let dropped = false;
      for (const who of [...hosted.guests.keys()]) {
        if (who === our || allow(who)) continue;
        hosted.guests.delete(who);
        dropped = true;
        trace('room-list', { place: hosted.place, host: our, who, reason: 'not-a-member',
          count: hosted.guests.size });
      }
      if (!dropped) return false;
      hosted.rev++;
      publishList();
      return true;
    },
    setNote(note, vis = null, gen = 0) {
      if (!hosted) return false;
      const next = isNote(note) ? note : null;
      const how = next && isVis(vis) ? vis : null;
      /* The generation counts as part of the lease. A room re-leased to the same
       * note is a different lease, and everybody on the list has to hear which
       * one they are renewing a seat against. */
      const g = next && Number.isSafeInteger(gen) && gen > 0 ? gen : 0;
      if ((hosted.note ?? null) === next && (hosted.vis ?? null) === how
          && (hosted.gen ?? 0) === g) return false;
      hosted.note = next;
      hosted.vis = how;
      hosted.gen = g;
      hosted.rev++;
      trace('room-list', { place: hosted.place, host: our, reason: next ? 'leased' : 'unleased',
        count: hosted.guests.size });
      publishList();
      return true;
    },
    /* The note a copy of a room is leased to, as far as we can see, and how
     * open it is. A secret room answers `{note: null, vis: 'secret'}`: closed,
     * and nothing else. */
    leaseOf(place, host) {
      const none = { note: null, vis: null, gen: 0 };
      if (!eligible(host)) return none;
      if (list?.place === place && list.host === host)
        return { note: list.note ?? null, vis: list.vis ?? null, gen: list.gen ?? 0 };
      /* BEFORE THE PRESENCE SUMMARY, not after it. Both describe the same
       * lease, but a SECRET room's summary carries no note -- it cannot, it
       * rides presence -- so letting it answer first buries the one thing we
       * were sent the list for. */
      const asked = fresh(place);
      if (asked && asked.host === host && asked.note)
        return { note: asked.note, vis: asked.vis, gen: asked.gen ?? 0 };
      for (const r of reports.values()) if (r.share && r.place === place && r.host === host)
        return { note: r.note ?? null, vis: r.vis ?? null, gen: r.gen ?? 0 };
      if (asked && asked.host === host)
        return { note: asked.note, vis: asked.vis, gen: asked.gen ?? 0 };
      return none;
    },
    /* Whoever invited us into this room, for finding its host from outside. */
    invitedTo(place) { const host = fresh(place)?.host; return host && eligible(host) ? host : null; },
    /* THE OWNER SAYS THE LEASE IS OVER. Only its owner may say so, and only
     * about the generation we hold -- a late message about an older incarnation
     * must not discard a lease that has since been retaken. */
    leaseGone(host, place, gen) {
      const matches = (g) => !gen || !g || g === gen;
      let forgot = false;
      const asked = invites.get(place);
      if (asked && asked.host === host && matches(asked.gen)) { invites.delete(place); forgot = true; }
      /* A SECRET lease is reported with no note, only its visibility: that is
       * a lease too, and has to be forgotten too. */
      if (list && list.place === place && list.host === host && (list.note || list.vis) && matches(list.gen)) {
        list = { ...list, note: null, vis: null, gen: 0 }; forgot = true;
      }
      for (const [ship, r] of reports) {
        if (r.place === place && r.host === host && (r.note || r.vis) && matches(r.gen)) {
          reports.set(ship, { ...r, note: null, vis: null, gen: 0 }); forgot = true;
        }
      }
      if (forgot) { trace('room-list', { place, host, reason: 'lease-gone' }); notify('lease'); }
      return forgot;
    },
    noteOf(place, host) { return this.leaseOf(place, host).note; },
    /* THE DOOR ANSWERED: the lease owner's agent told us which note this room
     * is. Held like an invite -- it is one -- and filled into the list we
     * follow if that list came without it, as a secret room's does now that
     * lists travel the relay. */
    leaseInfo(host, place, note, vis, gen = 0) {
      if (!isRoom(place) || !eligible(host) || !isNote(note)) return false;
      invites.set(place, { host, note, vis: isVis(vis) ? vis : null, gen: Number.isSafeInteger(gen) ? gen : 0, at: now() });
      if (list && list.place === place && list.host === host && !list.note) list = { ...list, note, vis: isVis(vis) ? vis : list.vis };
      trace('room-list', { place, host, reason: 'lease-info' });
      notify('lease');
      return true;
    },
    /* Leases we can see reported -- a room is leased, and how open it is --
     * without knowing which note: a SECRET note's id stays off the relay, so
     * its members ask the owner for it. [{host, place, gen, vis}] */
    unknownLeases() {
      const out = new Map();
      const add = (host, place, vis, gen) => {
        if (!isRoom(place) || !eligible(host) || host === our || !vis) return;
        const asked = fresh(place);
        if (asked && asked.host === host && asked.note) return;
        out.set(`${host}/${place}`, { host, place, vis, gen: gen ?? 0 });
      };
      if (list && !list.note) add(list.host, list.place, list.vis, list.gen);
      for (const r of reports.values()) if (!r.note) add(r.host, r.place, r.vis, r.gen);
      return [...out.values()];
    },
    current: () => (list && eligible(list.host) ? { place: list.place, host: list.host, rev: list.rev, guests: guestsOf(list).sort(),
      note: list.note ?? null } : null),
    guests: () => (hosted ? hosted.guests.size : list?.guests.size ?? 0),
    stats: () => ({ hosting: hosted?.place ?? null, following: following ? `${following.place}/${following.host}` : null,
      guests: list?.guests.size ?? 0, reports: reports.size, viewers: viewers.size,
      introduced: introduced.size, visible: states.size, held: held.size }),
  };
}

import { WORLD_ID } from './world-config.js';

/* The shared note decides who may discover this world. Presence decides who is
 * actually here. Every packet goes directly between authenticated member ships;
 * nobody can introduce a third party or forward somebody else's position. */
export const MEMBER_LEASE_MS = 180000;
export const MEMBER_HEARTBEAT_MS = 30000;
export const MEMBER_BATCH_SIZE = 64;
/* RELAY FIRST. A member on our relay is not asked at all once we have their
 * snapshot: the relay's authenticated roster is the proof they are here, and
 * they send a new snapshot -- with a receipt -- whenever something in it
 * changes. A member NOT on it is only asked this often, over Ames, and only
 * to find out which relay they are on. */
export const OFF_RELAY_MS = 120000;
/* Somebody who left the relay while we were on it, and has not come back, has
 * left the world -- well before their presence lease would say so. */
export const RELAY_GONE_MS = 20000;
const RETRIES = [5000, 15000, 30000, 60000, 180000];
const RESTART_MS = 30000;
const ship = s => typeof s === 'string' && /^~[a-z-]{3,70}$/.test(s);
const id = s => typeof s === 'string' && s.length > 0 && s.length <= 100;
const num = n => Number.isSafeInteger(n) && n >= 0;
const bytes = new TextEncoder();

function validSnapshot(h) {
  if (!h || typeof h !== 'object' || !h.spot || h.spot.place !== 0 ||
      !num(h.spot.x) || !num(h.spot.y) || h.spot.x > 1024 || h.spot.y > 736 ||
      !['up', 'down', 'left', 'right'].includes(h.spot.dir) ||
      ![undefined, 'main', 'vatican'].includes(h.spot.scene) || !num(h.rev) ||
      (h.host !== null && !ship(h.host)) ||
      (h.stamp !== undefined && (!Number.isFinite(h.stamp) || h.stamp < 0)) ||
      /* Asleep since (their clock); absent when awake. */
      (h.idle !== undefined && (!Number.isFinite(h.idle) || h.idle < 0)) ||
      /* Microphone off in a call; absent when on. */
      (h.micOff !== undefined && typeof h.micOff !== 'boolean') ||
      /* Weapon put away; absent when out, or when there is none. */
      (h.sheathed !== undefined && typeof h.sheathed !== 'boolean') ||
      /* What they are doing on their stage ("playing Doomur"); absent in the world. */
      (h.activity !== undefined && (typeof h.activity !== 'string' || h.activity.length > 64))) return false;
  // Chat follows the sender's settled room, not a second guess from their
  // rounded position at a wall/doorway. Older clients omit this field.
  if (h.chatPlace !== undefined && (!num(h.chatPlace) ||
      (h.spot.scene === 'vatican' ? h.chatPlace !== 900 : h.chatPlace > 15))) return false;
  if (h.huddle != null) {
    const q = h.huddle;
    if (!ship(q.host) || !Number.isSafeInteger(q.place) || q.place < 1000 || q.place > 900999 ||
        !Number.isSafeInteger(q.epoch) || q.epoch <= 0 || !num(q.rev) || !id(q.session) ||
        q.session.length > 80 || !Array.isArray(q.members) || q.members.length < 2 ||
        q.members.length > 32 || !q.members.every(ship) || !q.members.includes(q.host) ||
        new Set(q.members).size !== q.members.length) return false;
  }
  return true;
}

export function createMemberPresence({our, session, members, blocked = () => false,
  snapshot, send, changed, trace = () => {}, now = Date.now, worldKey = WORLD_ID,
  /* A reply to one of our queries arrived from this ship: it hears us. */
  answered = () => {},
  /* Is this ship on our relay right now? */
  onRelay = () => false,
  /* Who Noltbook says is in Glurff now, as a Set, or null if it cannot say.
   * Discovery over Ames only asks these: asking every member meant queueing
   * messages to ships that were not even running. */
  likelyLive = () => null,
  /* This session's generation, issued by our agent (see `live` in
   * sur/glurff.hoon). 0 until it arrives. */
  sessionGen = () => 0}) {
  const started = now();
  let active = false, generation = 0, sequence = 0, restarted = -Infinity;
  let allowed = new Set();
  const rows = new Map(), routes = new Map(), latest = new Map();
  const contacts = new Map(), queued = new Set();
  const eligible = who => who !== our && allowed.has(who) && !blocked(who);
  const cadence = who => onRelay(who) ? (rows.has(who) ? Infinity : MEMBER_HEARTBEAT_MS) : OFF_RELAY_MS;
  /* Worth asking at all: on our relay, already known, or -- off it -- somebody
   * Noltbook says is here (or anyone, when it cannot say). */
  const interesting = who => {
    if (onRelay(who) || rows.has(who) || routes.has(who)) return true;
    const likely = likelyLive();
    return !likely || likely.has(who);
  };
  const relayGone = new Map();          //  who -> ms they left our relay
  const live = row => now() - row.at < MEMBER_LEASE_MS;
  const list = () => new Map([...rows].filter(([who, row]) => eligible(who) && live(row)));
  const notify = () => changed(list());
  const envelope = kind => {
    const sgen = sessionGen();
    return {kind, world: worldKey, origin: our, session, started,
      generation, sequence: ++sequence, ...(Number.isSafeInteger(sgen) && sgen > 0 ? {sgen} : {})};
  };
  function emit(to, packet, revoke = false) {
    if (to === our || (!revoke && !eligible(to))) return;
    try {
      if (bytes.encode(JSON.stringify(packet)).length > 8192) {
        trace('presence-rejected', {who: our, reason: 'snapshot-too-large'}); return;
      }
      Promise.resolve(send(to, packet)).catch(() => {});
    } catch {}
  }
  function contact(who) {
    if (!contacts.has(who)) contacts.set(who, {tries: 0, next: now(), requests: new Map()});
    return contacts.get(who);
  }
  function query(who) {
    const c = contact(who), p = envelope('query');
    c.requests.set(p.sequence, {at: now(), generation});
    while (c.requests.size > 8) c.requests.delete(c.requests.keys().next().value);
    c.next = now() + (rows.has(who) || routes.has(who) ? cadence(who) : RETRIES[Math.min(c.tries++, RETRIES.length - 1)]);
    emit(who, p);
  }
  function drain() {
    let sent = 0;
    for (const who of queued) {
      queued.delete(who);
      if (!eligible(who) || !interesting(who)) continue;
      query(who);
      if (++sent >= MEMBER_BATCH_SIZE) break;
    }
    if (sent) trace('presence-discover', {generation, count: sent});
  }
  function reply(who, route, here = snapshot()) {
    emit(who, {...envelope('state'), viewer: route.session, request: route.sequence, here});
  }
  function depart(who, revoke = false) {
    const r = routes.get(who);
    // A null snapshot also cancels the transport's queued snapshot for this
    // viewer, so a goodbye does not leave a stale position waiting to be sent.
    emit(who, r ? {...envelope('state'), viewer: r.session, request: r.sequence, here: null} : envelope('cancel'), revoke);
  }
  /* A sender's clock only orders that sender's browser sessions. Sequences are
   * retained after departure/expiry, so delayed snapshots cannot revive ghosts.
   *
   * TWO DEVICES ARE TWO CLOCKS. Ordering sessions by `started` meant a second
   * device whose clock ran behind the first was refused for as long as the
   * first session was remembered -- which is after it left, too. Where both
   * sessions carry the generation their AGENT issued, that decides instead:
   * one clock per ship. `started` remains the fallback for older clients. */
  const sgenOf = p => Number.isSafeInteger(p?.sgen) && p.sgen > 0 ? p.sgen : 0;
  function acceptVersion(who, p) {
    const old = latest.get(who);
    const same = old && p.session === old.session && p.generation === old.generation;
    const departure = p.kind === 'cancel' || p.kind === 'cut' || (p.kind === 'state' && p.here === null);
    const ordered = old && p.session !== old.session && sgenOf(p) && sgenOf(old) && sgenOf(p) !== sgenOf(old);
    if (ordered && sgenOf(p) < sgenOf(old)) return false;
    if (old && !ordered) {
      if (p.started < old.started ||
          (p.started === old.started && p.session !== old.session && p.session < old.session)) return false;
      if (p.session === old.session) {
        if (p.started !== old.started || p.generation < old.generation ||
            (!same && p.sequence <= old.sequence)) return false;
        if (same && (p.sequence <= old.departure ||
            (departure && p.sequence <= old.sequence) ||
            (!departure && p.sequence <= (p.kind === 'query' ? old.querySequence : old.stateSequence)))) return false;
      }
    }
    // Snapshots are coalesced separately from queries by the transport. A newer
    // snapshot arriving first must not discard the still-needed viewer query.
    latest.set(who, {session: p.session, started: p.started, generation: p.generation,
      sgen: Math.max(sgenOf(p), same || p.session === old?.session ? sgenOf(old) : 0),
      sequence: same ? Math.max(old.sequence, p.sequence) : p.sequence,
      querySequence: p.kind === 'query' ? p.sequence : same ? old.querySequence : 0,
      stateSequence: p.kind === 'state' ? p.sequence : same ? old.stateSequence : 0,
      departure: departure ? p.sequence : same ? old.departure : 0, at: now()});
    return true;
  }
  function remove(who, reason) {
    const lost = rows.delete(who);
    routes.delete(who);
    queued.delete(who);
    /* No longer on the relay: back to asking now and then. */
    const c = contacts.get(who);
    if (c && !Number.isFinite(c.next)) c.next = now() + OFF_RELAY_MS;
    if (lost) trace('presence-left', {who, reason});
    return lost;
  }
  function update(drainQueries = true) {
    if (!active) return;
    const next = new Set([...members()].filter(who => ship(who) && who !== our && !blocked(who)));
    let removed = false, additions = 0;
    for (const who of allowed) if (!next.has(who)) {
      /* Revocation contains no position and must also reach a newly blocked
       * viewer, so their existing copy disappears immediately. */
      if (rows.has(who) || routes.has(who)) depart(who, true);
      removed = remove(who, 'membership-or-block') || removed;
      contacts.delete(who);
    }
    for (const who of next) if (!allowed.has(who)) {contact(who); queued.add(who); additions++;}
    allowed = next;
    if (removed) notify();
    if (additions || removed) trace('presence-members-changed', {count: next.size, added: additions});
    if (drainQueries) drain();
  }
  function receive(from, p) {
    if (!active || !ship(from) || !eligible(from) || !p || p.world !== worldKey || p.origin !== from ||
        !id(p.session) || !num(p.started) || !num(p.generation) || p.generation < 1 ||
        !num(p.sequence) || p.sequence < 1 || !['query', 'state', 'cut', 'cancel'].includes(p.kind) ||
        (p.sgen !== undefined && !(Number.isSafeInteger(p.sgen) && p.sgen >= 0))) return;
    try {if (bytes.encode(JSON.stringify(p)).length > 8192) return;} catch {return;}
    if (p.kind === 'state') {
      if (p.viewer !== session || !num(p.request)) return;
      if (p.here !== null) {
        const request = contacts.get(from)?.requests.get(p.request);
        if (!request || request.generation !== generation || now() - request.at >= MEMBER_LEASE_MS || !validSnapshot(p.here)) return;
      }
    }
    const previous = latest.get(from);
    if (!acceptVersion(from, p)) return;
    if (p.kind === 'state' && p.viewer === session) { try { answered(from); } catch {} }
    if (p.kind === 'query') {
      const r = {...p, at: now()};
      routes.set(from, r);
      reply(from, r);
      /* First contact or a reload must discover both directions immediately.
       * A reciprocal query is only sent once per new remote session/generation,
       * so two arriving browsers cannot bounce discoveries forever. */
      if (!previous || previous.session !== p.session || previous.generation !== p.generation || !rows.has(from)) {
        const c = contact(from);
        if (!previous || previous.session !== p.session || previous.generation !== p.generation || now() >= c.next) {
          queued.delete(from); query(from);
        }
      }
      return;
    }
    if (p.kind === 'cancel' || p.kind === 'cut' || p.here === null) {
      const lost = remove(from, 'departure');
      if (lost) notify();
      return;
    }
    const old = rows.get(from);
    const h = p.here;
    rows.set(from, {...h, who: from, session: p.session, started: p.started, sgen: sgenOf(p),
      generation: p.generation, sequence: p.sequence, path: [our, from], at: now()});
    const c = contact(from);
    c.tries = 0; c.next = now() + cadence(from);
    relayGone.delete(from);
    if (!old) trace('presence-first', {who: from, generation});
    else trace('presence-received', {who: from, gap: now() - old.at, generation});
    notify();
  }
  function tick() {
    if (!active) return;
    update(false);
    let expired = false;
    /* On the relay's roster is present: no heartbeat needed to stay listed. */
    for (const [who, row] of rows) if (onRelay(who)) row.at = now();
    for (const [who, r] of routes) if (onRelay(who)) r.at = now();
    for (const [who, row] of rows) if (!live(row)) {
      trace('presence-expired', {who, gap: now() - row.at});
      rows.delete(who); expired = true;
    }
    for (const [who, at] of relayGone) {
      if (onRelay(who)) { relayGone.delete(who); continue; }
      if (now() - at < RELAY_GONE_MS) continue;
      relayGone.delete(who);
      if (remove(who, 'left-relay')) expired = true;
    }
    for (const [who, r] of routes) if (!live(r)) routes.delete(who);
    for (const [who, c] of contacts) {
      for (const [key, q] of c.requests) if (now() - q.at >= MEMBER_LEASE_MS) c.requests.delete(key);
      if (now() >= c.next) queued.add(who);
    }
    // Former-member tombstones are bounded in time; their query challenges were
    // removed immediately, so they cannot reuse an old reply after rejoining.
    for (const [who, p] of latest) if (!allowed.has(who) && now() - p.at >= MEMBER_LEASE_MS * 2) latest.delete(who);
    if (expired) notify();
    drain();
  }
  function viewers() {
    return new Set([...routes].filter(([who, r]) => eligible(who) && live(r)).map(([who]) => who));
  }
  function publishTo(ships) {
    if (!active) return;
    const here = snapshot();
    for (const who of ships) {
      const r = routes.get(who);
      if (r && eligible(who) && live(r)) reply(who, r, here);
    }
  }
  function start(force = false) {
    if (active && !force && now() - restarted < RESTART_MS) return;
    const first = !active;
    active = true; generation++; restarted = now();
    for (const c of contacts.values()) c.requests.clear();
    if (first) {
      allowed.clear(); update();
      if (!allowed.size) trace('presence-discover', {generation, count: 0});
    }
    else {
      update(false);
      for (const who of allowed) queued.add(who);
      drain();
    }
  }
  function stop() {
    if (!active) return;
    for (const who of new Set([...rows.keys(), ...routes.keys()])) depart(who);
    active = false;
    rows.clear(); routes.clear(); contacts.clear(); queued.clear(); allowed.clear(); notify();
  }
  /* The relay's roster changed while we were on it. Somebody new is asked at
   * once, over the relay; somebody who left is given RELAY_GONE_MS to return. */
  function relayRoster(ships, left = []) {
    if (!active) return;
    for (const who of left) if (rows.has(who)) relayGone.set(who, now());
    let asked = false;
    for (const who of ships) {
      relayGone.delete(who);
      if (!eligible(who) || rows.has(who)) continue;
      const c = contact(who);
      if (now() >= c.next || c.tries === 0) { queued.add(who); asked = true; }
    }
    if (asked) drain();
  }
  /* LIVE SNAPSHOTS GO ONLY OVER THE RELAY. A viewer who asked over Ames is
   * still finding the relay: they have our answer, and ask again on their own
   * cadence. Pushing every change to them over Ames was the slow backup. */
  const publishLive = (ships) => publishTo([...ships].filter(who => onRelay(who)));
  return {start, update, tick, stop, receive, publish: () => publishLive(viewers()),
    /* EXCEPT a change of movement session. Somebody off our relay is exactly
     * who needs to hear which relay we are on now; without it two people who
     * opened Glurff together sat on separate relays until the next
     * OFF_RELAY_MS query. Once per change, never as a heartbeat. */
    publishAll: () => publishTo(viewers()),
    publishTo: publishLive, viewers, peers: list, relayRoster};
}

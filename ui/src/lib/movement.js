/* Movement: which session to be on, how to get into it, and what goes over
 * Urbit when the relay cannot carry it.
 *
 * Three layers, kept apart on purpose:
 *
 *   PRESENCE (Urbit, slow)  who exists, who may see whom, avatar version, room
 *                           host, and each participant's movement-session claim.
 *                           Authorisation lives here and only here.
 *   SESSION  (this module)  converges on one movement session and decides when
 *                           the service behind it is really gone.
 *   RELAY    (realtime)     positions, straight from this browser, addressed
 *                           only to the viewers presence authorises.
 *
 * WHAT GOES OVER URBIT NOW. Discovery, the ten-second presence beat, state
 * changes, and a FALLBACK: a viewer who is not on the relay yet gets our
 * position over presence at most once every FALLBACK_MS. When every viewer is
 * on the relay, moving sends nothing through Eyre or Ames at all.
 *
 * THE WORLD ROOM. Given `world` -- the world's host ship -- everybody's first
 * session is that ship's world room, which its AGENT opens and keeps; nobody's
 * browser opens, reopens or releases it. See movement-session for when we fall
 * back to sessions of our own and how we return.
 *
 * ADMISSION AND LIFETIME. The host claims the room's place on its own ship and
 * opens the room once. Everyone else -- and the host itself, afterwards -- gets
 * a token by knocking the host's SHIP, whose agent admits them and extends the
 * lease with no browser involved. So the host can close Glurff and the room
 * keeps serving; when the last participant stops knocking, the lease lapses.
 *
 * Nothing here holds a credential longer than the relay needs it, and nothing
 * here stores a position.
 */
import { createMovementSession, isMovementPlace } from './movement-session.js';
import { createMovementRelay, LIVE, REFUSED, FAILED, EXPIRED } from './movement-relay.js';

export const TICK_MS = 1000;
export const FALLBACK_MS = 2000;
/* Fifteen minutes, renewed by the people still using the room. Long enough that
 * a busy or briefly unreachable host SHIP does not end a session everyone is
 * still connected to; short enough that an abandoned room is gone soon after
 * the last participant stops renewing. Mirrored in sur/glurff.hoon. */
export const MOVEMENT_TTL = 900;
/* Calls may start without the relay after this long, rather than wait forever. */
export const CALL_GRACE_MS = 20000;
/* A peer not on the relay is trusted from the slow path after this long. */
export const PEER_GRACE_MS = 15000;
const BACKOFF = [4000, 8000, 16000, 30000];
const RENEW_MARGIN_MS = 30000;
const MAX_RENEW_MS = 120000;
/* An admission request that has had no answer for this long is not going to get one. */
const ADMIT_DEADLINE_MS = 30000;
/* ACCESS BEFORE BREAK: how long to wait for a candidate host's grant, and how
 * to back off after one that never comes. Capped, so a ship on the wrong side
 * of an Ames partition asks now and then rather than constantly -- and never
 * gives up its working relay while it waits. */
export const CANDIDATE_TIMEOUT_MS = 20000;
export const CANDIDATE_BACKOFF_MS = 15000;
export const CANDIDATE_BACKOFF_MAX_MS = 5 * 60 * 1000;
/* CONNECTED BEFORE BREAK: a grant proves the candidate's ship answers, not
 * that its relay room will have us. The candidate's relay gets this long to
 * go live beside the working one before the switch is abandoned. */
export const PROBE_TIMEOUT_MS = 15000;

export function createMovement({
  our,
  agent,                                     //  {claim, release, open, knock} -> promises
  presence,                                  //  {viewers(): Set, publishTo(Set)}
  visible = () => false,                     //  may WE draw this ship
  apply = () => {},                          //  (ship, spot, meta) for a visible ship
  now = Date.now,
  every = (fn, ms) => setInterval(fn, ms),
  stopEvery = (id) => clearInterval(id),
  later = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  fresh = () => Date.now() % 1000000000,
  socket,
  trace = () => {},
  expected = () => [],                       //  who the app says is in here with us
  makeSession = createMovementSession,
  makeRelay = createMovementRelay,
  random = Math.random,
  /* Our session's agent-issued generation, carried on every relay packet so
   * the people drawing us can tell our sessions apart without our clock. */
  generation = () => 0,
  /* A control message from a ship on the relay: see CONTROL_KIND in
   * lib/movement-relay. Either relay's -- the working one or a probe -- since
   * the sender is authenticated by the relay either way. */
  onControl = () => {},
  /* Who is on the working relay changed while it was live: (ships, left). */
  onRelayRoster = () => {},
  /* The world's host ship: its world room is where everybody goes first. */
  world = null,
} = {}) {
  let current = null;
  let claimed = false;                       //  we created this session's room
  let request = null;                        //  {place, tries, timer, opened, reopened}
  let renewTimer = null;
  let pump = null;
  let started = false;
  let last = null;                           //  our newest position, tiles
  let lastAt = null;
  let dirty = false;
  let lastFallback = -Infinity;
  let heardShips = new Set();
  const lastMv = new Map();                   //  ship -> {mv, at}: their latest session claim
  let roster = new Set();
  let inFlight = null;                       //  local poke ACK, independent of session lifetime
  let newestGrant = null;
  /* A better session we have heard about but not yet proven we can reach:
   * {host, term, place, key, tries, timer, state, grant, probe}. `probe` is
   * a second relay, joining the candidate's room beside the working one. */
  let pending = null;
  /* Backoff REMEMBERED per candidate, across withdrawals. A report goes stale
   * after LIVE_WINDOW_MS and the candidate is withdrawn; the next report
   * proposes it again. Without this memory each re-proposal started counting
   * from zero, so an unreachable host was asked every half minute forever
   * instead of backing off. key -> {tries, until}. */
  const tried = new Map();
  let startedAt = null;
  /* When the relay was last seen to stop being live, and whether it ever was:
   * readiness is judged from how long positions have been off the relay. */
  let everLive = false, downSince = null;
  const firstSeen = new Map();                //  ship -> local ms first visible
  /* Receipt time and the sender's last motion flag are separate from presence.
   * A stationary peer is allowed to be quiet forever; a peer whose last packet
   * still says "moving" is not. Treating both as merely "on the relay" let a
   * thirty-second-old moving position split an otherwise healthy huddle. */
  const peerMotion = new Map();                //  ship -> {at,moving}
  const counts = { fallback: 0, applied: 0, ignored: 0, grants: 0, stale: 0, knocks: 0, opens: 0 };

  const quietly = (p) => { try { Promise.resolve(p).catch(() => {}); } catch {} };

  /* Only somebody we have not heard from AT ALL is worth waiting for. Once
   * presence has their answer we know whether they are on a session, and two
   * ships that both just opened Glurff must not each wait for the other. */
  const unheard = () => {
    try { return expected().filter((s) => !heardShips.has(s)); } catch { return []; }
  };
  const session = makeSession({ our, now, trace, expected: unheard, onChange: changed,
    onCandidate: candidate, world });
  /* The world room is its host AGENT's: never opened, reopened or released
   * from a browser -- opening it again would throw out everybody inside. */
  const home = session.world?.() ?? null;
  const isWorld = (s) => !!home && !!s && s.host === home.host && s.place === home.place;
  /* Two relays can exist at once, briefly: the working one and a probe of
   * the candidate's room. Whichever is `relay` is the working one; the other's
   * status goes to probeStatus, and its roster is not ours until adopted. */
  const spawnRelay = () => { const r = makeRelay({
    our, now, later, cancel, every, stopEvery,
    ...(socket ? { socket } : {}),
    diagnostic: trace,
    onStatus: (state, reason) => { if (r === relay) relayStatus(state, reason); else probeStatus(r, state, reason); },
    onPosition: (ship, spot, meta) => {
      /* The relay is transport, never permission. */
      if (!visible(ship)) { counts.ignored++; return false; }
      /* Motion is recorded only for a packet that was ACCEPTED as newer. A late
       * packet from an old browser used to set "moving" here even though the
       * avatar had already rejected it -- and a peer that looks moving but
       * never arrives reads as stalled, which splits huddles. An `apply` that
       * says nothing is taken as acceptance, for older callers. */
      if (apply(ship, spot, meta) === false) { counts.stale++; return true; }
      counts.applied++;
      peerMotion.set(ship, { at: now(), moving: meta?.moving === true });
      return true;
    },
    onRoster: (ships) => { if (r === relay) rosterFrom(ships); },
    /* Not filtered by `visible`: presence itself rides this channel, and is
     * how somebody BECOMES visible. The receiver checks membership. */
    onControl: (who, body) => onControl(who, body),
  }); return r; };
  /* Someone entitled to see us just arrived on the relay: give them our
   * position now rather than whenever we next move. */
  function rosterFrom(ships) {
    const viewers = presence.viewers();
    const gained = [...ships].some((s) => !roster.has(s) && viewers.has(s));
    const left = [...roster].filter((s) => !ships.has(s));
    roster = new Set(ships);
    /* Only while live: our own relay dropping is not everybody leaving. */
    if (relay.live()) { try { onRelayRoster(new Set(ships), left); } catch {} }
    if (gained && last) { relay.route(viewers); relay.send(last); }
  }
  let relay = spawnRelay();

  /* ------------------------------------------------ access before break */

  const say = (p, reason, extra = {}) => trace('movement-candidate', {
    host: p?.host ?? '', generation: p?.term ?? 0, place: p?.place ?? 0,
    tries: p?.tries ?? 0, reason, ...extra });

  /* The session proposes a better session, or withdraws one. */
  function candidate(c) {
    if (!c) { dropPending('withdrawn'); return; }
    const k = `${c.host}/${c.term}`;
    if (pending && pending.key === k) return;          //  same candidate: no churn
    dropPending('superseded');
    const t = now();
    for (const [key, v] of tried) if (t - v.until > CANDIDATE_BACKOFF_MAX_MS * 2) tried.delete(key);
    const prior = tried.get(k);
    pending = { host: c.host, term: c.term, place: c.place, key: k,
                tries: prior?.tries ?? 0, timer: null, state: 'idle', grant: null };
    if (!started) return;
    /* Still inside the backoff from last time: wait it out, don't ask again. */
    if (prior && prior.until > t) {
      const p = pending;
      p.state = 'backoff';
      p.timer = later(() => askCandidate(p), prior.until - t);
      return;
    }
    askCandidate(pending);
  }

  const backoff = (tries) => Math.round(Math.min(CANDIDATE_BACKOFF_MAX_MS,
    CANDIDATE_BACKOFF_MS * 2 ** Math.max(0, tries - 1)) * (0.8 + 0.4 * random()));

  /* Knock on the candidate's host. Never `open`: it is not our room, and its
   * host's BROWSER need not be anywhere -- a grant from its ship is the proof. */
  function askCandidate(p) {
    if (pending !== p || !started) return;
    cancel(p.timer);
    p.tries++;
    p.state = 'requesting';
    counts.knocks++;
    say(p, 'requested');
    /* Charged NOW, not only on timeout. A request withdrawn before its answer
     * was due is neither a success nor a recorded failure, and would otherwise
     * be asked again the moment the candidate was next reported. */
    tried.set(p.key, { tries: p.tries, until: now() + CANDIDATE_TIMEOUT_MS + backoff(p.tries) });
    quietly(agent.knock(p.host, p.place));
    p.timer = later(() => candidateFailed(p, 'timeout'), CANDIDATE_TIMEOUT_MS);
  }

  /* No grant, a refusal, or a relay room that would not have us. The relay we
   * have stays exactly as it is -- it was never let go. */
  function candidateFailed(p, reason) {
    if (pending !== p) return;
    cancel(p.timer);
    if (p.probe) {
      const probe = p.probe; p.probe = null; p.grant = null;
      probe.close('rollback');
      say(p, 'rolled-back', { detail: reason });
    }
    p.state = 'backoff';
    const wait = backoff(p.tries);
    tried.set(p.key, { tries: p.tries, until: now() + wait });
    say(p, reason, { wait });
    trace('movement-candidate', { host: current?.host ?? '', generation: current?.term ?? 0,
      place: current?.place ?? 0, tries: p.tries, reason: 'retained' });
    p.timer = later(() => askCandidate(p), wait);
    /* The world host would not have us: set it aside for a while, so the
     * sessions of our own can settle among themselves meanwhile. */
    if (isWorld(p)) session.unreachable?.({ host: p.host, term: p.term });
  }

  function dropPending(reason) {
    if (!pending) return;
    cancel(pending.timer);
    if (pending.probe) { const probe = pending.probe; pending.probe = null; probe.close(reason || 'dropped'); }
    if (reason) say(pending, reason);
    pending = null;
  }

  /* The candidate's relay room, joining beside the working one. */
  function probeStatus(r, state, reason) {
    const p = pending;
    if (!p || p.probe !== r) return;
    if (state === LIVE) {
      cancel(p.timer); p.timer = null;
      say(p, 'probe-live');
      if (!session.commit({ host: p.host, term: p.term })) dropPending('refused');
      return;
    }
    if (state === FAILED || state === EXPIRED || state === REFUSED)
      candidateFailed(p, `probe-${state}${reason ? ':' + reason : ''}`);
  }

  function changed(next, why) {
    const prev = current;
    /* A committed handoff arrives already holding the grant that proved the
     * host reachable, and -- normally -- a relay already live in its room.
     * Use them, rather than knocking and dialling again for the same thing. */
    const matches = why === 'handoff' && next && pending?.grant &&
      pending.place === next.place && pending.host === next.host;
    const handoff = matches ? pending.grant : null;
    const probe = matches && pending.probe?.live() ? pending.probe : null;
    if (probe) pending.probe = null;          //  adopted, not dropped
    dropPending(handoff ? null : 'moved');
    clearRequest();
    cancel(renewTimer); renewTimer = null;
    /* Swap BEFORE closing, so the old relay's goodbye reaches nobody who
     * would read it as our relay going down. */
    const old = relay;
    if (probe) relay = probe;
    old.close(why);
    /* Stop admitting people to a session we have left. Only on an actual move:
     * closing the tab never reaches here, so a host's room outlives its tab. */
    if (prev && prev.host === our && !isWorld(prev) && prev.place !== next?.place) quietly(agent.release(prev.place));
    current = next;
    newestGrant = null;
    claimed = !!next && next.host === our && (why === 'claimed' || why === 'failover');
    if (!next) return;
    if (handoff) {
      newestGrant = { gen: handoff.gen, expires: handoff.expires };
      if (probe) {
        session.relay('live');
        rosterFrom(relay.ships?.() ?? new Set());
        relay.route(presence.viewers());
        if (last) relay.send(last, true);
      } else relay.connect(handoff);
      scheduleRenew(handoff);
      trace('movement-candidate', { host: next.host, generation: next.term, place: next.place,
        reason: 'connected' });
      return;
    }
    // Opening atomically claims the movement place in our agent. A separate
    // claim poke could arrive after a remote knock on a busy Eyre channel.
    if (started) requestAccess();
  }

  function clearRequest() {
    if (request) cancel(request.timer);
    request = null;
  }

  /* Get a token for the current session. A session we just created is opened
   * exactly once -- re-opening a room that exists would invalidate everyone's
   * tokens. Every other request is a knock on the host's ship. */
  function requestAccess(renew = false) {
    if (!current || !started) return;
    /* One outstanding request at a time, so a slow ship is never buried in
     * repeats -- but not forever. Waiting on a reply that was lost left the relay
     * down with nothing retrying. */
    if (inFlight && now() - inFlight.at < ADMIT_DEADLINE_MS) return;
    if (inFlight) { trace('movement-access', { reason: 'unanswered', host: current.host, generation: current.place }); inFlight = null; }
    // The relay reconnects with its cached token. Do not mint more tokens while
    // an ordinary WebSocket handshake or retry is in progress.
    if (!renew && ['opening', 'retrying'].includes(relay.state()) && relay.expires() > now() + 5000) return;
    if (!request || request.place !== current.place) {
      clearRequest();
      request = { place: current.place, tries: 0, timer: null, opened: false, reopened: false };
    }
    const r = request;
    cancel(r.timer);
    r.tries++;
    let send;
    if (claimed && !r.opened) {
      r.opened = true;
      counts.opens++;
      send = () => agent.open(current.place, fresh(), MOVEMENT_TTL);
    } else {
      counts.knocks++;
      send = () => agent.knock(current.host, current.place);
    }
    const flight = { at: now() };
    inFlight = flight;
    try {
      const p = send();
      if (p?.then) Promise.resolve(p).then(() => {
        if (inFlight === flight) inFlight = null;
      }, () => {
        if (inFlight === flight) inFlight = null;
      });
      else inFlight = null;
    } catch { inFlight = null; }
    r.timer = later(() => {
      r.timer = null;
      if (request === r && (renew || !relay.live())) requestAccess(renew);
    }, BACKOFF[Math.min(r.tries - 1, BACKOFF.length - 1)]);
  }

  function relayStatus(state, reason) {
    if (state === LIVE) { everLive = true; downSince = null; }
    else if (downSince === null) downSince = now();
    session.relay(state === LIVE ? 'live' : state);
    if (state === LIVE) {
      if (request) { cancel(request.timer); request.timer = null; request.tries = 0; }
      relay.route(presence.viewers());
      if (last) relay.send(last);
      return;
    }
    /* These need a new token, not a reconnect. */
    if (state === FAILED || state === EXPIRED || state === REFUSED) {
      trace('movement-access', { reason: `${state}:${reason}`, host: current?.host ?? '', generation: current ? current.place : 0 });
      if (!request || request.timer === null) requestAccess();
    }
  }

  function scheduleRenew(g) {
    cancel(renewTimer);
    const t = now();
    let due = Math.min(
      Number.isFinite(g.renewAfter) ? g.renewAfter - t : Infinity,
      Number.isFinite(g.expires) ? g.expires - t - RENEW_MARGIN_MS : Infinity,
      MAX_RENEW_MS);
    if (!Number.isFinite(due)) due = MAX_RENEW_MS;
    renewTimer = later(() => {
      renewTimer = null;
      if (!current || current.place !== g.place) return;
      /* Renewal is a knock: the host's ship issues a fresh token and extends
       * the lease. Same path whether or not the host is still here. */
      requestAccess(true);
      renewTimer = later(() => { renewTimer = null; if (current?.place === g.place) scheduleRenew(g); }, 30000);
    }, Math.max(5000, due));
  }

  /* A /call-access result. Returns true if it belonged to movement, so the call
   * controller never sees it. */
  function result(name, p) {
    const [rawPlace, who, , host] = String(p?.context ?? '').split('/');
    const place = Number(String(rawPlace).replace(/\./g, ''));
    if (!isMovementPlace(place)) return false;
    /* An answer about the candidate. Checked first: it is, by definition, not
     * the session we are on. Exact host and place -- and so term -- or it is a
     * late answer about a candidate we have already given up on. */
    if (started && pending && who === our && place === pending.place && host === pending.host) {
      if (name === 'call-failed') { candidateFailed(pending, `failed:${String(p?.err ?? 'unknown')}`); return true; }
      if (name !== 'call-granted' || p.participant !== our) return true;
      if (!Number.isFinite(p.expires) || p.expires <= now() + 5000) { counts.stale++; return true; }
      counts.grants++;
      pending.grant = { sfu: p.sfu, group: p.group, token: p.token, expires: p.expires,
                        renewAfter: p.renewAfter, place, gen: p.gen ?? 0 };
      say(pending, 'granted');
      tried.delete(pending.key);
      /* Not yet: the switch happens when the candidate's relay room is LIVE,
       * with the working relay still up beside it. */
      if (!pending.probe) {
        const p = pending;
        cancel(p.timer);
        p.state = 'probing';
        p.probe = spawnRelay();
        p.timer = later(() => candidateFailed(p, 'probe-timeout'), PROBE_TIMEOUT_MS);
        if (p.probe.connect(p.grant) === false) candidateFailed(p, 'probe-grant');
      }
      return true;
    }
    if (!started || !current || place !== current.place || who !== our || host !== current.host) { counts.stale++; return true; }
    if (name === 'call-failed') { failed(String(p?.err ?? 'unknown')); return true; }
    if (name !== 'call-granted' || p.participant !== our) return true;
    if (!Number.isFinite(p.expires) || p.expires <= now() + 5000 ||
        (newestGrant && ((p.gen ?? 0) < newestGrant.gen || p.expires < newestGrant.expires))) { counts.stale++; return true; }
    newestGrant = { gen: p.gen ?? 0, expires: p.expires };
    counts.grants++;
    const grant = { sfu: p.sfu, group: p.group, token: p.token, expires: p.expires,
                    renewAfter: p.renewAfter, place };
    if (!(relay.group() === grant.group && relay.refresh(grant))) relay.connect(grant);
    // Receiving a token is not a successful join. Keep the retry backoff until
    // LIVE, otherwise a permission refusal can request fresh tokens in a loop.
    if (relay.live() && request) { cancel(request.timer); request.timer = null; request.tries = 0; }
    scheduleRenew(grant);
    return true;
  }

  function failed(err) {
    trace('movement-access', { reason: err, host: current.host, generation: current.place });
    // A delayed admission error does not invalidate a working connection.
    if (relay.live()) return;
    session.relay('failed');
    /* Our own room has gone -- lease lapsed while we were away. It is ours to
     * recreate, once, and nobody holds a live token for it. */
    if (current.host === our && !isWorld(current) &&
        ['room-unavailable', 'room-ended', 'expired', 'no-such-room', 'lease-expired'].includes(err) &&
        request && !request.reopened) {
      request.reopened = true;
      request.opened = false;
      claimed = true;
    }
    /* Anything else: the backoff retries, and persistent failure becomes
     * failover evidence in the session. */
  }

  /* The slow path, only for viewers the relay is not reaching. */
  /* NO AMES BACKUP. Positions go over the relay or not at all: a second,
   * slower copy over Ames is what let two paths disagree about where somebody
   * was. A viewer the relay is not reaching sees us where we last were, the
   * relay's own repair resends our newest position, and a stall is written
   * down -- nothing is sent over Urbit. */
  function fallback() {
    if (!last) return;
    dirty = false;
    if (!relay.live()) return;
    const stalled = [...presence.viewers()].filter((s) => relay.has(s) && !(relay.delivering?.(s) ?? true));
    const t = now();
    if (!stalled.length || t - lastFallback < FALLBACK_MS) return;
    lastFallback = t;
    trace('movement-delivery-stalled', { count: stalled.length, reason: 'position-unacknowledged' });
  }

  function tick() {
    if (!started) return;
    /* Being in our relay room right now proves being live on our session.
     * Presence used to repeat everyone's claim every few seconds; it now sends
     * only changes, so the relay is what keeps a connected peer counted. */
    if (current && relay.live()) for (const ship of relay.ships?.() ?? []) {
      const h = lastMv.get(ship);
      if (!h?.mv || h.mv.host !== current.host || h.mv.term !== current.term) continue;
      session.hear(ship, { ...h.mv, live: true, age: (h.mv.age ?? 0) + (now() - h.at) }, now());
    }
    session.tick();
    relay.route(presence.viewers());
    fallback(false);
    if (current && !relay.live() && (!request || request.timer === null)) {
      requestAccess();
    }
  }

  function trusted() {
    if (!started) return false;
    if (relay.live() || session.role() === 'degraded') return true;
    /* Never live yet: the startup grace. Live before: long enough off the
     * relay that every peer is on the slow path (see confidence). */
    const since = everLive ? downSince : startedAt;
    if (since === null) return false;
    return now() - since >= (everLive ? PEER_GRACE_MS : CALL_GRACE_MS);
  }

  function confidence(ship) {
    if (relay.live() && relay.has(ship)) {
      const motion = peerMotion.get(ship);
      if (!motion) return 'delayed';
      if (!motion.moving) return 'live-stationary';
      return now() - motion.at <= 3000 ? 'live-moving' : 'stalled';
    }
    /* Not on our relay: whatever we last heard is old, and with no slow path
     * nothing newer is coming until they are. */
    return 'absent';
  }

  return {
    start() {
      if (started) return;
      started = true;
      startedAt = now();
      session.start?.();
      pump = every(tick, TICK_MS);
      if (current) requestAccess();
    },
    /* Closing the tab. Deliberately does NOT release the room: the host's ship
     * keeps admitting the people still in it. */
    stop(reason = 'stopped') {
      started = false;
      dropPending('exit');
      stopEvery(pump); pump = null;
      clearRequest();
      cancel(renewTimer); renewTimer = null;
      relay.close(reason);
    },
    restored() { if (started && current && !relay.live()) requestAccess(); },
    /* Our own position. Velocity rides with it so the people drawing us can
     * keep us walking through a late message instead of freezing us, and a
     * start, a stop or a turn is sent at once rather than on the next tick. */
    moved(p, force = false, urgent = false) {
      const previous = last, at = now();
      const seconds = lastAt === null ? 0 : (at - lastAt) / 1000;
      const scene = p.scene === 'vatican' ? 'vatican' : 'main';
      const sameScene = previous?.scene === scene;
      const moving = p.moving ?? (!!previous && sameScene && (previous.x !== p.x || previous.y !== p.y));
      const speed = (from, to) => (previous && sameScene && moving && seconds > 0 && seconds < 1 ? (to - from) / seconds : 0);
      last = { x: p.x, y: p.y, dir: p.dir, scene, host: p.host ?? null, moving,
               vx: speed(previous?.x, p.x), vy: speed(previous?.y, p.y), gen: generation() };
      lastAt = at;
      dirty = true;
      const changed = !previous || previous.dir !== last.dir || previous.moving !== last.moving || previous.scene !== last.scene;
      relay.send(last, urgent || changed || force);
      fallback(force);
    },
    /* Presence's member list: each visible peer's movement claim, with the
     * time presence actually received it. */
    presence(peers) {
      const seen = new Set();
      for (const [ship, m] of peers) {
        seen.add(ship);
        if (!firstSeen.has(ship)) firstSeen.set(ship, now());
        session.hear(ship, m?.mv ?? null, m?.at);
        if (m?.mv) lastMv.set(ship, { mv: m.mv, at: m.at ?? now() }); else lastMv.delete(ship);
      }
      for (const ship of heardShips) if (!seen.has(ship)) { session.forget(ship); firstSeen.delete(ship); lastMv.delete(ship); }
      for (const ship of peerMotion.keys()) if (!seen.has(ship)) peerMotion.delete(ship);
      heardShips = seen;
    },
    /* THREE DECISIONS, NOT ONE. This used to be a single answer, latched true
     * forever the first time the relay went live -- so after a later relay
     * outage a new huddle could be formed, or a room's host changed, from
     * positions that had stopped arriving.
     *
     *   keep    an existing call survives any relay trouble. Always true:
     *           nothing here ever hangs one up.
     *   start   positions are good enough to START a call or form a huddle:
     *           the relay is carrying them, the session has fallen back to
     *           the slow path, or positions have been off the relay long
     *           enough that the slow path has taken over.
     *   roster  good enough to CHANGE who is in a call or who hosts it: as
     *           start, and not while we are switching movement sessions --
     *           positions are about to move from one relay to another. */
    readiness() {
      const start = trusted();
      return { keep: true, start, roster: start && !pending?.probe };
    },
    ready: () => trusted(),
    rosterReady: () => trusted() && !pending?.probe,
    /* Whether our picture of this ship's position is current. */
    confidence,
    reliable(ship) {
      return ['live-stationary','live-moving'].includes(confidence(ship));
    },
    result,
    /* The live channel: is this ship reachable over the relay right now, and
     * send them one control message if so. */
    onRelay: (ship) => relay.live() && relay.has(ship),
    control: (ship, body) => relay.control?.(ship, body) ?? false,
    relayLive: () => relay.live(),
    announce: () => session.announce(),
    current: () => session.current(),
    stats: () => ({
      session: session.stats(),
      relay: relay.stats(),
      ...counts,
      request: request ? { tries: request.tries } : null,
      candidate: pending ? { host: pending.host, term: pending.term, tries: pending.tries,
                             state: pending.state, probe: pending.probe?.state?.() ?? null } : null,
      pending: !!inFlight,
      grantExpires: relay.expires(),
      authorizedViewers:[...presence.viewers()],
      ready: trusted(),
      readiness: { start: trusted(), roster: trusted() && !pending?.probe, everLive,
                   downFor: downSince === null ? 0 : now() - downSince },
      confidence:Object.fromEntries([...heardShips].sort().map((ship)=>[ship,confidence(ship)])),
    }),
  };
}

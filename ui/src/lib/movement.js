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
  let startedAt = null;
  let readyLatched = false;
  const firstSeen = new Map();                //  ship -> local ms first visible
  const counts = { fallback: 0, applied: 0, ignored: 0, grants: 0, stale: 0, knocks: 0, opens: 0 };

  const quietly = (p) => { try { Promise.resolve(p).catch(() => {}); } catch {} };

  /* Only somebody we have not heard from AT ALL is worth waiting for. Once
   * presence has their answer we know whether they are on a session, and two
   * ships that both just opened Glurff must not each wait for the other. */
  const unheard = () => {
    try { return expected().filter((s) => !heardShips.has(s)); } catch { return []; }
  };
  const session = makeSession({ our, now, trace, expected: unheard, onChange: changed });
  const relay = makeRelay({
    our, now, later, cancel, every, stopEvery,
    ...(socket ? { socket } : {}),
    diagnostic: trace,
    onStatus: relayStatus,
    onPosition: (ship, spot, meta) => {
      /* The relay is transport, never permission. */
      if (!visible(ship)) { counts.ignored++; return false; }
      counts.applied++;
      apply(ship, spot, meta);
      return true;
    },
    onRoster: (ships) => {
      /* Someone entitled to see us just arrived on the relay: give them our
       * position now rather than whenever we next move. */
      const viewers = presence.viewers();
      const gained = [...ships].some((s) => !roster.has(s) && viewers.has(s));
      roster = new Set(ships);
      if (gained && last) { relay.route(viewers); relay.send(last); }
    },
  });

  function changed(next, why) {
    const prev = current;
    clearRequest();
    cancel(renewTimer); renewTimer = null;
    relay.close(why);
    /* Stop admitting people to a session we have left. Only on an actual move:
     * closing the tab never reaches here, so a host's room outlives its tab. */
    if (prev && prev.host === our && prev.place !== next?.place) quietly(agent.release(prev.place));
    current = next;
    newestGrant = null;
    claimed = !!next && next.host === our && (why === 'claimed' || why === 'failover');
    if (!next) return;
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
    if (current.host === our && ['room-unavailable', 'room-ended', 'expired', 'no-such-room', 'lease-expired'].includes(err) &&
        request && !request.reopened) {
      request.reopened = true;
      request.opened = false;
      claimed = true;
    }
    /* Anything else: the backoff retries, and persistent failure becomes
     * failover evidence in the session. */
  }

  /* The slow path, only for viewers the relay is not reaching. */
  function fallback(force) {
    if (!last) return;
    const viewers = presence.viewers();
    const targets = relay.live() ? new Set([...viewers].filter((s) => !(relay.delivering?.(s) ?? relay.has(s)))) : viewers;
    if (!targets.size) { dirty = false; return; }
    const t = now();
    // A stopped avatar may still have an unacknowledged final position.
    const stalled=relay.live() && [...targets].some(s=>relay.has(s));
    if (!force && ((!dirty && !stalled) || t - lastFallback < FALLBACK_MS)) return;
    dirty = false;
    lastFallback = t;
    counts.fallback++;
    if(stalled)trace('movement-delivery-stalled',{count:targets.size,reason:'position-unacknowledged'});
    presence.publishTo(targets);
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
               vx: speed(previous?.x, p.x), vy: speed(previous?.y, p.y) };
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
      heardShips = seen;
    },
    /* Positions are good enough to START calls on: the relay is carrying them,
     * movement has settled for the slow path, or we have waited long enough
     * that holding calls back would be worse than trying. Latched, because this
     * gates starting calls and a later relay hiccup must never hang one up. */
    ready() {
      if (readyLatched) return true;
      if (relay.live() || session.role() === 'degraded' ||
          (startedAt !== null && now() - startedAt >= CALL_GRACE_MS)) readyLatched = true;
      return readyLatched;
    },
    /* Whether our picture of this ship's position is current. */
    reliable(ship) {
      if (relay.live() && relay.has(ship)) return true;
      if (session.role() === 'degraded') return true;
      const first = firstSeen.get(ship);
      return first !== undefined && now() - first >= PEER_GRACE_MS;
    },
    result,
    announce: () => session.announce(),
    current: () => session.current(),
    stats: () => ({
      session: session.stats(),
      relay: relay.stats(),
      ...counts,
      request: request ? { tries: request.tries } : null,
      pending: !!inFlight,
      grantExpires: relay.expires(),
      authorizedViewers:[...presence.viewers()],
      ready: readyLatched,
    }),
  };
}

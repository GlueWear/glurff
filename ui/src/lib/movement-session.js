/* Which movement session the world uses, and when to give up on it.
 *
 * A session is {host, term}. Its Galene room is the place MOVEMENT_BASE + term
 * on the host ship's own configured call broker -- so "A's server" means the
 * service A's broker selects, never a named ship or provider, and never A's
 * ship relaying packets.
 *
 * THE HOST'S BROWSER IS NOT THE SESSION. Once a session exists, every
 * participant announces the session it is actually connected to, at the
 * presence layer's low frequency. When the host closes Glurff, the people still
 * connected keep announcing it, newcomers keep joining it, and the host's ship
 * -- which is still running -- keeps admitting them and extending the lease.
 * Nobody moves servers because a tab closed.
 *
 * WHAT ENDS A SESSION is evidence that the service itself is gone: our own
 * connection has failed for FAILOVER_MS *and* no visible participant has
 * reported being connected to it within LIVE_WINDOW_MS. A single participant
 * whose network is bad sees others still live and keeps retrying; only when
 * nobody can reach the service does anyone move, and then only a bounded number
 * of times before settling for the slow fallback.
 *
 * CLOCKS ARE NOT TRUSTED. Terms are integers. "Who started first" is never
 * decided from wall clocks. Sessions are ordered by
 *
 *   term  >  how long participants have been on it  >  is anyone connected  >  host @p
 *
 * The second key is an elapsed duration each participant measures itself since
 * adopting the session, bucketed coarsely -- no synchronised clock is needed,
 * the buckets are wide enough that delivery delay cannot reorder them, and a
 * reconnect does not reset it. It is what stops a later arrival displacing a
 * healthy session.
 *
 * ANOTHER SESSION ONLY COUNTS ONCE SOMEBODY IS CONNECTED TO IT. A claim that has
 * not gone live cannot pull anyone. Without that, a ship whose own service is
 * down but whose @p sorts first would win every failover tie and drag everyone
 * onto a dead server until the failover limit ran out.
 *
 * NOT A LOCK. Participants that cannot see each other will run separate
 * sessions, as rooms already do. When they come into view, the ordering above
 * converges them.
 *
 * THE WORLD HOST FIRST (2026-09-29). A glurff names its host ship, and that
 * ship's agent keeps ONE relay room for everybody -- the WORLD session, at
 * WORLD_TERM -- opened by the first ask, with no browser of the host's
 * involved. Given `world`, everybody goes straight to it: no settle window,
 * no claim, nothing to race. Everything above is now the FALLBACK, for when
 * the host cannot be reached: a world session not live within WORLD_WAIT_MS
 * (and nobody else live on it) is set aside for WORLD_RETRY_MS, doubling to
 * WORLD_RETRY_MAX_MS, and sessions of our own are found or started as before.
 * Once the wait is over the world is proposed again -- access before break,
 * so a working fallback is kept until the host has let us in -- and everybody
 * returns to it. It outranks every other session, and its term is the top
 * one, so clients from before it existed rank it first as well.
 */

/* Clear of rooms (1-7) and proximity huddles (1000-900999). Mirrored in
 * sur/glurff.hoon as movement-base; the two MUST agree. */
export const MOVEMENT_BASE = 950000;
export const MAX_TERM = 49999;
/* The world host's room. Mirrored as world-term in sur/glurff.hoon; the two
 * MUST agree. Sessions of our own stay below it. */
export const WORLD_TERM = MAX_TERM;
/* How long the world session gets to go live before we fall back, and how long
 * it is then set aside before being tried again. */
export const WORLD_WAIT_MS = 30000;
export const WORLD_RETRY_MS = 60000;
export const WORLD_RETRY_MAX_MS = 5 * 60 * 1000;
/* A session we are switching to stays a candidate this much longer than a
 * plain report would, so a slow switch is not withdrawn half way: reports from
 * people off our relay arrive minutes apart now, not seconds. */
export const HOLD_MS = 40000;

/* Listen this long before claiming on a cold start. Long enough for a
 * discovery round to come back over a slow Urbit path; a claim that loses
 * a late race still converges, at the cost of one reconnect. */
export const SETTLE_MS = 8000;

/* If the app says somebody else is in Glurff, their session is worth waiting
 * for a little longer than the plain settle window: claiming one of our own
 * beside theirs costs everybody a reconnect. Bounded, because a listed person
 * whose ship never answers must not hold the world up. */
export const CLAIM_WAIT_MS = 15000;

/* An announcement older than this says nothing about now. Presence beats every
 * ten seconds, so this spans several missed beats. */
export const LIVE_WINDOW_MS = 40000;

/* Our own connection must have been failing this long, with nobody else live,
 * before we abandon the session. */
export const FAILOVER_MS = 45000;

/* Bounded failover: at most this many new sessions of our own per window. A
 * broken service shared by every host would otherwise churn forever. */
export const MAX_FAILOVERS = 3;
export const FAILOVER_WINDOW_MS = 10 * 60 * 1000;

/* Live-duration buckets. Coarse on purpose; see the header. */
export const TIER_MS = 30000;
export const MAX_TIER = 3;
/* How long a relay counts as healthy after it last was. A websocket reconnect
 * passes through non-live states for a moment; without this, that moment was
 * enough to drop access-before-break and jump straight to an unreachable host. */
export const RELAY_GRACE_MS = 15000;

export const SEEKING = 'seeking';
export const HOST = 'host';
export const GUEST = 'guest';
export const DEGRADED = 'degraded';

const isShip = (s) => typeof s === 'string' && /^~[a-z-]{3,70}$/.test(s);

export const placeOf = (term) => MOVEMENT_BASE + term;
export const termOf = (place) =>
  Number.isSafeInteger(place) && place > MOVEMENT_BASE && place <= MOVEMENT_BASE + MAX_TERM
    ? place - MOVEMENT_BASE : null;
export const isMovementPlace = (place) => termOf(place) !== null;

const tier = (age) => Math.min(MAX_TIER, Math.floor(Math.max(0, age || 0) / TIER_MS));

/* A total order, so every participant sorting the same candidates reaches the
 * same answer. Negative means `a` is the better session. */
export function compare(a, b) {
  if (!!a.world !== !!b.world) return a.world ? -1 : 1;
  if (a.term !== b.term) return b.term - a.term;
  const ta = tier(a.age), tb = tier(b.age);
  if (ta !== tb) return tb - ta;
  if (!!a.live !== !!b.live) return a.live ? -1 : 1;
  return a.host < b.host ? -1 : a.host > b.host ? 1 : 0;
}

export function createMovementSession({ our, now = Date.now, onChange = () => {}, trace = () => {},
  /* Who the app believes is in here with us, whether or not they have answered
   * yet. Empty by default, which is the old behaviour exactly. */
  expected = () => [],
  /* ACCESS BEFORE BREAK. When given, a better session heard about while our own
   * relay is healthy is only PROPOSED: the caller asks the candidate's host for
   * access and calls commit() once a grant for exactly that session arrives.
   *
   * Hearing about a session proves only that the ship that TOLD us can reach
   * it. ~natlut-minryx, able to talk to ~disden but not to ~dolten, heard from
   * ~disden that ~dolten's term 24 was live, abandoned its own working term 23
   * on the spot, and then could never get a token for 24. A grant is the one
   * thing that proves WE can reach the host.
   *
   * Without it -- the old callers, and the tests written for them -- a better
   * session is adopted at once, exactly as before. */
  onCandidate = null,
  /* The world's host ship, or null for no world session (the old behaviour
   * exactly). See THE WORLD HOST FIRST above. */
  world = null } = {}) {
  let role = SEEKING;
  let current = null;              //  {host, term, place}
  let started = now();             //  local ms, start of the settle window
  let liveSince = null;            //  local ms our relay became live on `current`
  let trying = null;               //  local ms we began failing on `current`
  let adoptedAt = null;            //  local ms we adopted `current`
  let degradedUntil = 0;
  let maxTerm = 0;
  const heard = new Map();         //  ship -> {host, term, live, age, at}
  const failovers = [];            //  local ms of our own recent failover claims
  let proposed = null;             //  {host, term, place} awaiting its host's grant
  let lastLiveAt = null;           //  local ms our relay was last live
  const home = isShip(world) ? { host: world, term: WORLD_TERM } : null;
  let worldFails = 0, worldDownUntil = 0;
  /* Sessions of our own stay below the world's term. */
  const top = home ? WORLD_TERM - 1 : MAX_TERM;

  const key = (s) => (s ? `${s.host}/${s.term}` : '');
  const isWorld = (s) => !!home && !!s && s.host === home.host && s.term === WORLD_TERM;
  const worldUp = () => !!home && now() >= worldDownUntil;
  function worldFailed(why) {
    if (!home) return;
    worldFails++;
    const wait = Math.min(WORLD_RETRY_MAX_MS, WORLD_RETRY_MS * 2 ** (worldFails - 1));
    worldDownUntil = now() + wait;
    trace('movement-session', { host: home.host, generation: WORLD_TERM, reason: `world-${why}`, wait });
  }

  function valid(mv) {
    return !!mv && isShip(mv.host) && Number.isSafeInteger(mv.term) && mv.term >= 1 &&
      mv.term <= MAX_TERM && typeof mv.live === 'boolean' &&
      Number.isFinite(mv.age ?? 0) && (mv.age ?? 0) >= 0;
  }

  /* A visible peer's announcement, delivered by presence. `from` is the
   * authenticated sender; `mv` is only their claim about which session they
   * are on. */
  function hear(from, mv, at) {
    if (!isShip(from) || from === our) return;
    if (mv == null) { heard.delete(from); return; }
    if (!valid(mv)) return;
    /* `at` is when presence actually RECEIVED the snapshot. Presence re-notifies
     * its whole member list every second, so stamping with now() would make a
     * thirty-second-old announcement look current and hide a dead session. */
    const received = Number.isFinite(at) ? Math.min(at, now()) : now();
    heard.set(from, { host: mv.host, term: mv.term, live: mv.live,
                      age: Math.min(mv.age ?? 0, 86400000), at: received });
    if (!isWorld(mv)) maxTerm = Math.max(maxTerm, Math.min(mv.term, top));
  }

  function candidates() {
    const t = now();
    const found = new Map();
    const add = (host, term, live, age, eligible) => {
      const k = `${host}/${term}`;
      const c = found.get(k) ?? { host, term, live: false, age: 0, eligible: false,
                                  world: isWorld({ host, term }) };
      c.live = c.live || live;
      c.age = Math.max(c.age, age);
      c.eligible = c.eligible || eligible;
      found.set(k, c);
    };
    /* The world is always worth going to, unless we have just failed to. */
    if (worldUp()) add(home.host, home.term, false, 0, true);
    for (const h of heard.values()) {
      if (isWorld(h) && !worldUp() && !isWorld(current)) continue;
      /* The session we are switching to is held a while longer. */
      const held = proposed && h.host === proposed.host && h.term === proposed.term;
      if (t - h.at >= LIVE_WINDOW_MS + (held ? HOLD_MS : 0)) continue;
      /* Only a session somebody is connected to can pull us. That covers a
       * pal announcing a session that does not exist, and a failover claim
       * whose own service is down. Simultaneous claims still resolve: each goes
       * live on its own room, and then they compare. */
      add(h.host, h.term, h.live, h.age + (t - h.at), h.live);
    }
    if (current) {
      add(current.host, current.term, liveSince !== null,
          adoptedAt !== null ? t - adoptedAt : 0, true);
    }
    return [...found.values()].filter((c) => c.eligible).sort(compare);
  }

  function othersLive(s) {
    const t = now();
    for (const h of heard.values()) {
      if (h.live && h.host === s.host && h.term === s.term && t - h.at < LIVE_WINDOW_MS) return true;
    }
    return false;
  }

  function adopt(next, why) {
    if (key(next) === key(current)) return;
    proposed = null;
    lastLiveAt = null;       //  health belongs to a relay, and this is a new one
    current = next ? { host: next.host, term: next.term, place: placeOf(next.term) } : null;
    role = current ? (current.host === our ? HOST : GUEST) : SEEKING;
    liveSince = null;
    trying = current ? now() : null;
    adoptedAt = current ? now() : null;
    if (current && !isWorld(current)) maxTerm = Math.max(maxTerm, current.term);
    trace('movement-session', { host: current?.host ?? '', generation: current?.term ?? 0, reason: why });
    onChange(current ? { ...current } : null, why);
  }

  /* Offer a candidate, once. The same session reported again and again by
   * whoever heard about it is one proposal, not a stream of them. */
  function propose(next) {
    if (key(next) === key(proposed)) return;
    proposed = next ? { host: next.host, term: next.term, place: placeOf(next.term) } : null;
    if (proposed) trace('movement-candidate', { host: proposed.host, generation: proposed.term,
      place: proposed.place, reason: 'proposed' });
    try { onCandidate(proposed ? { ...proposed } : null); } catch {}
  }
  const healthy = () => liveSince !== null ||
    (lastLiveAt !== null && now() - lastLiveAt < RELAY_GRACE_MS);

  function tick() {
    const t = now();
    for (const [from, h] of heard) if (t - h.at >= LIVE_WINDOW_MS * 2 + HOLD_MS) heard.delete(from);
    while (failovers.length && t - failovers[0] >= FAILOVER_WINDOW_MS) failovers.shift();

    if (role === DEGRADED) {
      if (t < degradedUntil) return;
      role = SEEKING;
      started = t;
    }

    if (role === SEEKING) {
      /* Hearing an existing session IS the signal; there is nothing to wait
       * for. The settle window only delays inventing a new one. */
      const best = candidates()[0];
      if (best) { adopt(best, 'adopted'); return; }
      if (t - started < SETTLE_MS) return;
      /* Somebody the app says is in here has not told us their session yet.
       * Give them a moment before starting a second one beside it. */
      if (t - started < CLAIM_WAIT_MS) {
        let waiting = false;
        try { waiting = expected().some((s) => isShip(s) && s !== our && !heard.has(s)); } catch {}
        if (waiting) return;
      }
      adopt({ host: our, term: Math.min(top, maxTerm + 1) }, 'claimed');
      return;
    }

    /* Converge on the best session anyone visible can vouch for -- but a relay
     * that WORKS is not abandoned for one we have only heard about. It is
     * proposed, and we move when its host grants us access; see onCandidate. A
     * session of our own needs no such proof, and neither does leaving a relay
     * that is already down: that is ordinary failover, unchanged. */
    const best = candidates()[0];
    if (best && key(best) !== key(current)) {
      if (onCandidate && best.host !== our && healthy()) { propose(best); return; }
      adopt(best, 'converged'); return;
    }
    /* Nothing better any more: stop asking. */
    if (proposed) propose(null);

    /* The world host cannot be reached, and nobody else is getting through
     * either: set it aside, and find or start a session of our own. */
    if (isWorld(current) && liveSince === null && trying !== null &&
        t - trying >= WORLD_WAIT_MS && !othersLive(current)) {
      worldFailed('unreachable');
      started = t;
      adopt(null, 'world-unreachable');
      return;
    }

    /* Failover, only on evidence the service is gone for everyone. */
    if (liveSince === null && trying !== null && t - trying >= FAILOVER_MS && !othersLive(current)) {
      if (failovers.length >= MAX_FAILOVERS || current.term >= top) {
        const was = current;
        current = null;
        liveSince = null;
        trying = null;
        adoptedAt = null;
        role = DEGRADED;
        degradedUntil = t + FAILOVER_WINDOW_MS;
        trace('movement-session', { host: was.host, generation: was.term, reason: 'degraded' });
        onChange(null, 'degraded');
        return;
      }
      failovers.push(t);
      adopt({ host: our, term: current.term + 1 }, 'failover');
    }
  }

  /* Our own relay's state for the current session. */
  function relay(state) {
    if (!current) return;
    if (state === 'live') {
      lastLiveAt = now();
      if (liveSince === null) liveSince = now();
      trying = null;
      if (isWorld(current)) { worldFails = 0; worldDownUntil = 0; }
    } else {
      liveSince = null;
      if (trying === null) trying = now();
    }
  }

  return {
    hear,
    forget: (from) => { heard.delete(from); },
    tick,
    relay,
    /* Presence has started: begin listening for sessions that already exist.
     * The window used to start when this was created, at page load, so a slow
     * start had spent it already and claimed a competing session at once. */
    start: () => { started = now(); },
    current: () => (current ? { ...current } : null),
    /* The candidate's host granted us access to exactly this session: we can
     * reach it, so move. Anything else is a late answer to a question we have
     * stopped asking, and changes nothing. */
    commit(c) {
      if (!proposed || !c || key(c) !== key(proposed)) return false;
      const next = proposed;
      trace('movement-candidate', { host: next.host, generation: next.term, place: next.place,
        reason: 'committed' });
      adopt(next, 'handoff');
      return true;
    },
    proposed: () => (proposed ? { ...proposed } : null),
    /* The movement layer could not get into this session. For the world, that
     * sets it aside like an unreachable host; anything else backs off there. */
    unreachable(s) { if (isWorld(s)) worldFailed('refused'); },
    /* The world session, if this world has a host. */
    world: () => (home ? { ...home, place: placeOf(home.term) } : null),
    role: () => role,
    ready: () => role === HOST || role === GUEST,
    /* What we tell visible peers, riding the presence snapshot. */
    announce: () => (current
      ? { host: current.host, term: current.term, live: liveSince !== null,
          age: adoptedAt !== null ? now() - adoptedAt : 0 }
      : null),
    stats: () => ({ role, host: current?.host ?? null, term: current?.term ?? 0,
                    live: liveSince !== null, heard: heard.size, failovers: failovers.length,
                    proposed: proposed ? `${proposed.host}/${proposed.term}` : null,
                    world: home ? { host: home.host, onIt: isWorld(current),
                                    downFor: Math.max(0, worldDownUntil - now()) } : null }),
  };
}

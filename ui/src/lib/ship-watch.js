/* NO SHIP, NO WORLD (2026-11-14).
 *
 * A page keeps running after its ship stops or its login is revoked, and its
 * relay connection does not go through the ship -- so nothing ended it. A
 * ship lent to one visitor and then the next (Manor) could still have the
 * first visitor's tab in the world as that ship: drawn there, and sent what
 * the people there send to that ship. Two moons stopped with |exit stayed in
 * the world for as long as their tabs stayed open.
 *
 * So the page asks its own ship, every PROBE_MS, one cheap question that needs
 * the login: a read of our agent's lease -- a scry, so nothing is written on
 * the ship. Eyre answers 200 while we are signed in, 401 once our session is
 * revoked and 403 with no session at all (measured on ~dolten-dilpun).
 *
 *   - Refused twice running (RECHECK_MS apart): the login is gone. We leave
 *     the world at once and stop asking; signing in again reloads the page.
 *   - No answer for SHIP_GONE_MS, over at least GONE_TRIES asks: the ship is
 *     gone. We leave the world but keep asking, and come back when it answers.
 *     Far longer than any stall seen on a slow ship (36 s, 2026-11-14), and
 *     counted from the FIRST failure, never from the last answer -- so a
 *     laptop waking from sleep is not mistaken for a ship that went away.
 *
 * A stopped ship behind Manor's proxy answers 502: unreachable, as it should
 * be. Only the page leaves; nothing is asked of Manor, the ship or the host.
 */
export const PROBE_MS = 15000;
export const PROBE_TIMEOUT_MS = 10000;
export const RECHECK_MS = 2000;
export const SHIP_GONE_MS = 120000;
export const GONE_TRIES = 3;
export const PROBE_PATH = '/~/scry/glurff/lease.json';

/* One ask of our own ship: 'ok', 'refused' (signed out) or 'unreachable'. A
 * redirect is a login wall, so it counts as refused. A browser without
 * AbortSignal.timeout (Safari before 16) asks without one: a hung ask then
 * holds the next ones back, which can never make us leave -- where failing
 * every ask at once would have, two minutes in. */
export async function probeShip({ fetch: get = globalThis.fetch, path = PROBE_PATH, ms = PROBE_TIMEOUT_MS } = {}) {
  try {
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
    const r = await get(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal });
    if (r.status === 401 || r.status === 403 || r.type === 'opaqueredirect') return 'refused';
    return r.ok ? 'ok' : 'unreachable';
  } catch { return 'unreachable'; }
}

export function createShipWatch({ probe = probeShip, onSignedOut = () => {}, onGone = () => {}, onBack = () => {},
  now = Date.now, later = (fn, ms) => setTimeout(fn, ms), cancel = (t) => clearTimeout(t), trace = () => {} } = {}) {
  let timer = null, running = false, busy = false;
  let refusals = 0, failures = 0, failingSince = null;
  /* null while we are in the world; 'ship-gone' or 'signed-out' once we left. */
  let left = null;
  const schedule = (ms) => {
    if (timer !== null) cancel(timer);
    timer = running ? later(tick, ms) : null;
  };
  async function tick() {
    timer = null;
    if (!running || busy) return;
    busy = true;
    let answer;
    try { answer = await probe(); } catch { answer = 'unreachable'; }
    busy = false;
    if (!running) return;
    if (answer === 'ok') {
      refusals = 0; failures = 0; failingSince = null;
      if (left === 'ship-gone') {
        left = null; running = false;
        trace('ship-watch', { reason: 'back' });
        onBack();
        return;
      }
      schedule(PROBE_MS);
      return;
    }
    if (answer === 'refused') {
      /* A refusal is an answer: the ship is there, our login is not. */
      failures = 0; failingSince = null;
      if (++refusals < 2) { schedule(RECHECK_MS); return; }
      left = 'signed-out'; running = false;
      trace('ship-watch', { reason: 'signed-out' });
      onSignedOut();
      return;
    }
    refusals = 0;
    failures++;
    if (failingSince === null) failingSince = now();
    if (left === null && failures >= GONE_TRIES && now() - failingSince >= SHIP_GONE_MS) {
      left = 'ship-gone';
      trace('ship-watch', { reason: 'ship-gone', count: failures });
      onGone();
    }
    schedule(PROBE_MS);
  }
  return {
    start() {
      if (running || left === 'signed-out') return;
      running = true;
      schedule(PROBE_MS);
    },
    stop() {
      running = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
    /* The channel to our ship just failed: ask now, not at the next tick, so a
     * revoked login is noticed in seconds. */
    nudge() { if (running && !busy) schedule(0); },
    state: () => ({ running, left, refusals, failures, failingSince }),
  };
}

/* ONE LIVE GLURFF PER SHIP -- the browser's half.
 *
 * lib/tab.js keeps one live tab per BROWSER. It cannot see an incognito
 * window, another browser or another device, and those used to run side by
 * side: two relays, two publishers, two contradictory positions for one
 * person. The agent is the one place every session of a ship shares, so it
 * holds the lease (see `live` in sur/glurff.hoon).
 *
 * Opening Glurff TAKES the lease -- newest wins, as with tabs, because that is
 * the one somebody is looking at. Renewing only KEEPS it, so a session that
 * lost cannot quietly take it back; it is told who holds it and stands down.
 *
 * The agent also issues this session a GENERATION. It rides our presence and
 * relay packets, and is what the people drawing us order our sessions by:
 * one clock per ship, instead of whichever device's clock is furthest ahead.
 */
export const SESSION_RENEW_MS = 15000;

/* Is a position stamped (gen, t) newer than what this peer last moved with
 * ({motionG, motionT})? Sessions are ordered by the generation their agent
 * issued; only within one session does the sender's own clock decide. A
 * generation of 0 is a sender without one (yet): it never outranks one that
 * has one, and between two of them the clock decides, as it always did. */
export function newerMotion(gen, t, prev) {
  const g = Number.isSafeInteger(gen) && gen > 0 ? gen : 0;
  const had = Number.isSafeInteger(prev?.motionG) ? prev.motionG : 0;
  if (g && had && g !== had) return g > had;
  if (!g && had) return false;
  if (g && !had) return true;
  return t > (prev?.motionT ?? -Infinity);
}

export function createSessionLease({ tab, send, onLost = () => {}, onGen = () => {},
  trace = () => {}, every = (fn, ms) => setInterval(fn, ms), stopEvery = (id) => clearInterval(id) } = {}) {
  let gen = 0, timer = null, lost = false, started = false;
  const ask = (take) => { try { Promise.resolve(send(tab, take)).catch(() => {}); } catch {} };
  return {
    /* Opening: take the lease, then keep it. */
    start() {
      if (started || lost) return;
      started = true;
      ask(true);
      timer = every(() => { if (!lost) ask(false); }, SESSION_RENEW_MS);
    },
    /* The agent says which session is live. */
    heard(f) {
      if (!f || typeof f.tab !== 'string' || !Number.isSafeInteger(f.gen) || f.gen <= 0) return false;
      if (f.tab === tab) {
        if (f.gen !== gen) { gen = f.gen; trace('session-lease', { reason: 'granted', count: gen }); onGen(gen); }
        return true;
      }
      /* Somebody else's. Before our own grant it is the session we are about
       * to replace -- the agent tells a new subscriber who is live -- and a
       * fact about a session OLDER than ours is late news about it. Anything
       * else means we are not live. */
      if (lost || !gen || f.gen < gen) return false;
      lost = true;
      stopEvery(timer); timer = null;
      trace('session-lease', { reason: 'lost', count: f.gen });
      onLost('another-session');
      return true;
    },
    stop() { stopEvery(timer); timer = null; },
    gen: () => gen,
    lost: () => lost,
  };
}

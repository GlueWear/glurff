/* WHO CAN WE ACTUALLY REACH?
 *
 * A presence send that never arrives and a request nobody answers used to be
 * silent. Over a partial Ames partition -- we can hear somebody, they cannot
 * hear us -- that read as a call "transitioning" for ever. This keeps, per
 * ship, the three things that tell the cases apart:
 *
 *   heard     when anything last arrived from them (their path to us)
 *   asked     the oldest request of ours they have not answered yet
 *   answered  when they last answered one (our path to them)
 *
 * and says one of:
 *
 *   reachable    they answer us, or we hear them and owe them nothing
 *   waiting      we asked, and it is too soon to worry
 *   one-way      we hear them, but they have not answered what we asked
 *   unreachable  we asked, they have not answered, and we hear nothing
 *   unknown      nothing either way yet
 *
 * It decides nothing. Callers use it to SAY what is wrong -- "the host can't
 * hear your ship" -- instead of an endless spinner.
 */
export const WAIT_MS = 15000;
export const HEARD_MS = 45000;
export const ANSWER_MS = 120000;
export const REACHABLE = 'reachable', WAITING = 'waiting', ONE_WAY = 'one-way',
  UNREACHABLE = 'unreachable', UNKNOWN = 'unknown';

export function createReachability({ now = Date.now, trace = () => {}, changed = () => {}, max = 256 } = {}) {
  const ships = new Map();   //  ship -> {heardAt, askedAt, answeredAt, said}
  const rec = (s) => {
    let r = ships.get(s);
    if (!r) {
      r = { heardAt: 0, askedAt: 0, answeredAt: 0, said: UNKNOWN };
      ships.set(s, r);
      if (ships.size > max) ships.delete(ships.keys().next().value);
    }
    return r;
  };
  function status(s, t = now()) {
    const r = ships.get(s);
    if (!r) return UNKNOWN;
    const hearing = r.heardAt > 0 && t - r.heardAt < HEARD_MS;
    if (r.askedAt > r.answeredAt) {
      if (t - r.askedAt < WAIT_MS) return WAITING;
      return hearing ? ONE_WAY : UNREACHABLE;
    }
    if (r.answeredAt > 0 && t - r.answeredAt < ANSWER_MS) return REACHABLE;
    return hearing ? REACHABLE : UNKNOWN;
  }
  function settle(s) {
    const r = ships.get(s);
    if (!r) return;
    const now_ = status(s);
    if (now_ === r.said) return;
    const was = r.said;
    r.said = now_;
    trace('reach', { who: s, reason: now_, detail: was });
    try { changed(s, now_, was); } catch {}
  }
  return {
    /* We sent them something that expects an answer. Only the OLDEST
     * unanswered request counts: asking again does not reset the clock. */
    asked(s) { const r = rec(s); if (r.askedAt <= r.answeredAt) r.askedAt = now(); settle(s); },
    /* Anything at all arrived from them. */
    heard(s) { rec(s).heardAt = now(); settle(s); },
    /* They answered something we asked: our messages reach them. */
    answered(s) { const r = rec(s), t = now(); r.heardAt = t; r.answeredAt = t; settle(s); },
    /* Time passing changes the answer; call this on a tick. */
    check() { for (const s of ships.keys()) settle(s); },
    forget(s) { ships.delete(s); },
    status,
    stats: () => Object.fromEntries([...ships.keys()].sort().map((s) => [s, status(s)])),
  };
}

/* Proximity voice in the commons.
 *
 * People standing near each other form a huddle, and one of them hosts it. Ten
 * conversations are ten small rooms on ten different brokers, so nobody carries
 * the whole world -- which is the reason the commons is not simply one big
 * call.
 *
 * Every decision here is a pure function of the membership set, because each
 * ship has to reach the same answer with no negotiation. Positions come from
 * presence; this module keeps no contact list of its own.
 */

/* Tiles. Two to join -- standing next to someone, not across the square. JOIN
 * is smaller than LEAVE on purpose: without the gap, someone walking along the
 * edge of a group flips in and out and tears the room down repeatedly. Audio
 * falls silent at the leave radius too; see AUDIBLE_* in lib/sfu. */
export const JOIN_RADIUS = 2;
export const LEAVE_RADIUS = 3;

/* Timing belongs to proximity policy, alongside its radii. Formation filters
 * passers-by; established calls get a longer departure grace because distance
 * already mutes audio immediately. */
export const HUDDLE_FORM_MS = 3000;
export const HUDDLE_JOIN_MS = 2000;
export const HUDDLE_LEAVE_MS = 5000;

/* How long a non-authority waits for its credential before concluding the
 * elected host is not going to produce one. */
export const GRANT_TIMEOUT_MS = 25000;

/* Huddle place ids live above every authored room, so a huddle's Galene room
 * can never collide with a room's. */
export const HUDDLE_BASE = 1000;

const distance = (a, b) =>
  !a || !b ? Infinity : Math.hypot(a.x - b.x, a.y - b.y);

/* Single-link clustering at the join radius, widened to the leave radius for
 * pairs already together. Deterministic given the same positions, which is what
 * lets two ships agree on membership without talking about it. */
export function clusterPeers(peers, previousMembers = new Set()) {
  const ids = Object.keys(peers).sort();
  const seen = new Set();
  const clusters = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const stack = [id];
    const members = [];
    seen.add(id);
    while (stack.length) {
      const cur = stack.pop();
      members.push(cur);
      for (const other of ids) {
        if (seen.has(other)) continue;
        const r = previousMembers.has(cur) && previousMembers.has(other)
          ? LEAVE_RADIUS : JOIN_RADIUS;
        if (distance(peers[cur], peers[other]) <= r) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    if (members.length > 1) clusters.push(members.sort());
  }
  return clusters;
}

/* Agreement between browsers. Each works out its huddle on its own, so at the
 * edge two can disagree and stay that way: the one already in a huddle keeps you
 * to LEAVE_RADIUS, the one that never saw you inside JOIN_RADIUS never lets you
 * in -- one side "connected" to an empty call, the other showing no call.
 *
 * Everyone announces the host of the huddle they are in. A peer within
 * LEAVE_RADIUS of us who announces a huddle hosted by us, or by someone near us,
 * is treated as already together with us -- when we are in no huddle, or in the
 * one with that same host -- so we keep the distance they keep. Once we join we
 * announce the same host, and they take us in the same way. */
export function agreedMembers(our, near, hosts, previous = [], ourHost = null) {
  const together = new Set(previous);
  const inHuddle = together.size > 0;
  for (const [who, spot] of Object.entries(near)) {
    const host = hosts[who];
    if (who === our || !host || !(host === our || host in near)) continue;
    if (inHuddle && host !== ourHost) continue;
    if (distance(near[our], spot) > LEAVE_RADIUS) continue;
    together.add(our); together.add(who); together.add(host);
  }
  return together;
}

/* Lowest @p in the agreed membership, with hysteresis: the sitting host keeps
 * the job while it is still in the huddle. Re-electing every time a lower @p
 * walks up would tear down a live call mid-sentence, which is worse than an
 * arbitrary-but-stable choice. */
/* WHO HOSTS A HUDDLE.
 *
 * A sitting host is kept so that somebody joining or leaving does not move the
 * call and make everybody reconnect. But `sitting` is PURELY LOCAL -- it is
 * whatever this browser last decided -- and that is how two clients froze
 * apart: a presence gap let them re-form the huddle a moment apart with
 * different member sets, so they elected different hosts; once the sets
 * converged both hosts were members, so each browser's own host stayed
 * "valid" forever. The places are derived from the host, so they diverged too
 * (107874 against 242389) and everyone sat alone in a call of one.
 *
 * `claims` is what each member says their host is, which both browsers can
 * see. While everybody agrees, the sitting host stands and nobody reconnects.
 * The moment anybody disagrees, every browser falls back to the same
 * deterministic answer -- the lowest @p of the shared member set -- and they
 * converge on the next beat.
 *
 * `trusted` is a deliberate handoff in progress: the new host is authoritative
 * and the disagreement below is expected, because the others have not been
 * told yet. */
export function electHost(members, sitting = null, claims = {}, trusted = false) {
  if (!members.length) return null;
  const lowest = [...members].sort()[0];
  if (!sitting || !members.includes(sitting)) return lowest;
  if (trusted) return sitting;
  for (const who of members) {
    const said = claims?.[who];
    if (said && said !== sitting && members.includes(said)) return lowest;
  }
  return sitting;
}

export const huddleKey = (members) => [...members].sort().join(',');

/* A huddle's call is its HOST's: a stable place id for the host, not for the
 * membership. Everyone who follows the same host joins the same call however
 * much of the huddle each of them can see -- a membership-derived id gave two
 * browsers that saw different people two different calls -- and somebody
 * joining or leaving no longer moves everybody to a new call. Deliberately NOT
 * a function of a generation: generations are counted per client. */
export function huddlePlace(host) {
  const key = String(host);
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
  }
  /* Force unsigned before the modulus. A signed result gives a NEGATIVE place
   * id, the agent's @ud cast rejects the poke, and the huddle silently never
   * connects -- which looks exactly like the broker refusing. */
  return HUDDLE_BASE + ((h >>> 0) % 900000);
}

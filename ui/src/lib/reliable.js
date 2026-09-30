/* RECEIPTS FOR WHAT MATTERS on the live channel.
 *
 * A message handed to the relay socket was counted as delivered the moment it
 * was queued locally -- so a call request, a roster, or a goodbye could simply
 * vanish in a relay hiccup, and the call sat "transitioning" until something
 * else happened to retry it. Now the messages calls and presence depend on
 * carry an id; the receiver answers with a receipt and ignores repeats; the
 * sender tries again every RETRY_MS until DEADLINE_MS. For each recipient,
 * kind and place only the NEWEST message is kept: a newer call request
 * replaces an older one still waiting, rather than queueing behind it.
 *
 * Only these kinds. Positions have their own acknowledgements (see
 * movement-relay), and everything else is either repeated anyway or does not
 * matter if lost. */
export const RETRY_MS = 1500;
export const DEADLINE_MS = 6000;
export const RECEIPT = 'ctl-ack';
const SEEN_MS = 60000, MAX_SEEN = 2048;

export const critical = (kind) => typeof kind === 'string' &&
  (kind.startsWith('call-') || kind === 'room-hello' || kind === 'room-drop' ||
   kind === 'query' || kind === 'state' || kind === 'cut' || kind === 'cancel' ||
   /* A wave is sent once, by hand: it has to arrive, and arrive once. */
   kind === 'wave');

export function createReliable({ send, now = Date.now, later = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id), trace = () => {}, session = Math.random().toString(36).slice(2, 10) } = {}) {
  let seq = 0;
  const pending = new Map();       //  `${to}/${kind}/${place}` -> {key, cid, to, body, first, tries, timer}
  const seen = new Map();          //  `${from}/${cid}` -> ms
  const counts = { sent: 0, retried: 0, acked: 0, expired: 0, duplicates: 0, replaced: 0 };

  function attempt(p) {
    if (pending.get(p.key) !== p) return;
    if (now() - p.first >= DEADLINE_MS) {
      pending.delete(p.key); counts.expired++;
      trace('live-unacked', { who: p.to, kind: String(p.body.kind), count: p.tries });
      return;
    }
    p.tries++; counts.retried++;
    send(p.to, p.body);
    p.timer = later(() => attempt(p), RETRY_MS);
  }

  return {
    /* Send a body to a ship on the relay. Critical kinds are tracked until a
     * receipt comes back; false if it could not even be handed to the relay. */
    send(to, body) {
      if (!critical(body?.kind)) return send(to, body);
      const key = `${to}/${body.kind}/${body.place ?? ''}/${body.viewer ?? ''}`;
      const old = pending.get(key);
      if (old) { cancel(old.timer); counts.replaced++; }
      const p = { key, cid: `${session}.${++seq}`, to, first: now(), tries: 1, timer: null };
      p.body = { ...body, cid: p.cid };
      if (!send(to, p.body)) { pending.delete(key); return false; }
      pending.set(key, p); counts.sent++;
      p.timer = later(() => attempt(p), RETRY_MS);
      return true;
    },
    /* A body that arrived from `from`. True if it was a receipt or a repeat --
     * handled here, and not to be acted on again. */
    receive(from, body) {
      if (body?.kind === RECEIPT) {
        for (const p of pending.values()) if (p.cid === body.cid && p.to === from) {
          cancel(p.timer); pending.delete(p.key); counts.acked++;
        }
        return true;
      }
      if (typeof body?.cid !== 'string' || body.cid.length > 40) return false;
      send(from, { kind: RECEIPT, cid: body.cid, world: body.world });
      const key = `${from}/${body.cid}`, t = now();
      if (seen.has(key)) { counts.duplicates++; return true; }
      seen.set(key, t);
      if (seen.size > MAX_SEEN) for (const [k, at] of seen) { if (t - at < SEEN_MS && seen.size <= MAX_SEEN) break; seen.delete(k); }
      return false;
    },
    /* Drop anything waiting for ships that have left. */
    forget(ship) { for (const p of [...pending.values()]) if (p.to === ship) { cancel(p.timer); pending.delete(p.key); } },
    stats: () => ({ ...counts, pending: pending.size }),
  };
}

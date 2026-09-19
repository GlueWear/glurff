/* Moderation on the wire.
 *
 * The rules live in lib/moderation; this is what carries them between ships.
 * One shape of conversation, and no other:
 *
 *   guest -> host   call-mod-ask   {place, gen, target, op}
 *   guest -> host   call-mod-sync  {place, gen}          "tell me the record"
 *   host  -> all    call-mod-snap  {place, host, gen, rev, ...}
 *
 * The host is the only writer. It applies a request to its own record and
 * publishes the result; nobody else ever changes a record except by taking a
 * newer snapshot from the host. A request that the rules refuse changes
 * nothing and is answered with nothing, because a refusal and a no-op look the
 * same from outside -- and answering every refusal is a way to be made to send
 * messages by anyone who can reach you.
 *
 * WHAT IS BOUNDED. Sync requests retry a handful of times and then stop; the
 * host de-duplicates the requests it answers within a beat; the record itself
 * is four lists of ships in one call. There is no timer that reschedules
 * itself forever and no queue that grows with traffic.
 */
import { applyOp, acceptSnapshot, emptyRecord, recordMatches, recordingOf,
         recorderGone, snapshotOf, MOD_OPS } from './moderation.js';

export const SYNC_TRIES = 4;
export const SYNC_MS = 2500;
/* The host answers at most one sync per ship per this, so a peer that asks in a
 * loop costs one message a beat rather than one each. */
const ANSWER_EVERY_MS = 1500;

export function createModeration({ our, send, members = () => [], enforce = () => {},
  changed = () => {}, trace = () => {}, now = Date.now,
  later = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) }) {
  let call = null;          //  {place, host, gen} -- the call this is about
  let record = null;
  let syncTimer = null, syncTries = 0;
  const answered = new Map();   //  ship -> when we last sent them a snapshot

  const hosting = () => !!call && call.host === our;
  const tell = (who, event) => { try { Promise.resolve(send(who, event)).catch(() => {}); } catch {} };

  function publish(only = null) {
    if (!hosting() || !record) return;
    const snap = snapshotOf(record);
    const to = only ? [only] : members().filter((s) => s !== our);
    for (const who of to) tell(who, snap);
    /* Only an ANSWER is rate-limited, and only against the asker. A broadcast
     * is fire-and-forget: counting it would make the host refuse the very
     * first question from somebody who joined a moment after it went out. */
    if (only) {
      answered.set(only, now());
      if (answered.size > 256) answered.delete(answered.keys().next().value);
    }
  }

  function setRecord(next, why) {
    record = next;
    trace('call-mod', { place: call?.place ?? 0, host: call?.host ?? '', rev: next?.rev ?? 0, reason: why });
    enforce(next, call);
    changed();
  }

  function stopSync() { cancel(syncTimer); syncTimer = null; syncTries = 0; }

  /* Ask the host for the record. Late joiners, reconnecting clients and
   * restored tabs all arrive here: whatever happened while we were away, the
   * host's copy is the truth and we take it whole. */
  function sync() {
    if (!call || hosting()) return stopSync();
    if (syncTries >= SYNC_TRIES) return stopSync();
    syncTries++;
    tell(call.host, { kind: 'call-mod-sync', place: call.place, gen: call.gen ?? 0 });
    cancel(syncTimer);
    syncTimer = later(() => { syncTimer = null; sync(); }, SYNC_MS);
  }

  return {
    /* The call changed -- a different room, a different host, or the same room
     * re-opened with a new generation. Everything about the old one goes. */
    enter(next) {
      /* The same call, whatever the lease has done since: a renewal or a
       * reconnect must not wipe a record, and the generation is not part of
       * what identifies the call (see recordMatches). */
      if (next && call && next.place === call.place && next.host === call.host) {
        call.gen = Math.max(call.gen ?? 0, next.gen ?? 0);
        return;
      }
      stopSync();
      answered.clear();
      call = next ? { place: next.place, host: next.host, gen: next.gen ?? 0 } : null;
      record = call && call.host === our ? emptyRecord(call) : null;
      enforce(record, call);
      changed();
      if (call && !hosting()) sync();
      else if (call) publish();
    },
    /* The generation moved under us: the call server re-made the room, so this
     * is a new incarnation and the old record does not apply to it. */
    generation(gen) {
      if (!call || (call.gen ?? 0) === gen) return;
      this.enter({ place: call.place, host: call.host, gen });
    },
    call: () => call,
    record: () => (recordMatches(record, call) ? record : null),

    /* Ask for something. The host does it directly; everyone else asks. */
    request(target, op) {
      if (!call || !MOD_OPS.includes(op)) return false;
      if (hosting()) return this.receive(our, { kind: 'call-mod-ask', place: call.place, gen: call.gen ?? 0, target, op });
      tell(call.host, { kind: 'call-mod-ask', place: call.place, gen: call.gen ?? 0, target, op });
      return true;
    },

    /* Everything that arrives. `who` is the ship the agent says sent it: the
     * actor is never read out of the payload. */
    receive(who, event) {
      if (!call || !event || typeof event.kind !== 'string') return false;
      /* The PLACE, not the generation: everybody in one call holds a different
       * lease generation, so demanding they match threw away every message
       * between a host and anyone who joined after a renewal. Ordering by
       * generation happens inside acceptSnapshot, where it belongs. */
      if (event.place !== call.place) return false;

      if (event.kind === 'call-mod-snap') {
        const next = acceptSnapshot(record, call, who, event);
        if (!next) return false;
        setRecord(next, 'snapshot');
        stopSync();
        return true;
      }
      if (!hosting()) return false;

      if (event.kind === 'call-mod-sync') {
        const last = answered.get(who) ?? -Infinity;
        if (now() - last < ANSWER_EVERY_MS) return false;
        publish(who);
        return true;
      }
      if (event.kind === 'call-mod-ask') {
        const target = typeof event.target === 'string' ? event.target : null;
        const next = applyOp(record, call, { actor: who, target, op: event.op, members: members(), now: now() });
        if (!next) { trace('call-mod-refused', { who, op: String(event.op), place: call.place }); return false; }
        setRecord(next, String(event.op));
        publish();
        return true;
      }
      return false;
    },

    /* Membership moved. The host stops a recording whose recorder has left --
     * nobody else can, and a record naming an absent recorder would leave
     * everyone showing a REC notice for a recording that is not happening. */
    membersChanged() {
      if (!hosting() || !record) return;
      const next = recorderGone(record, call, members());
      if (!next) return;
      setRecord(next, 'recorder-left');
      publish();
    },

    /* Hosting moved to us mid-call: we become the authority, carrying the
     * record we last saw so promotions, mutes and boots survive the transfer.
     * A record we never received starts empty rather than blank-slating
     * somebody's mute, which is why the handoff sends one first. */
    assume(next, carried = null) {
      stopSync();
      answered.clear();
      call = { place: next.place, host: our, gen: next.gen ?? 0 };
      const from = carried ?? record;
      record = from
        ? { ...from, place: call.place, host: our, gen: call.gen, rev: (from.rev ?? 0) + 1 }
        : emptyRecord(call);
      enforce(record, call);
      changed();
      publish();
    },

    /* What the new host should carry, for the handoff to hand over. */
    carry: () => (recordMatches(record, call) ? { ...record } : null),
    recording: () => recordingOf(record, call),
    resync() { if (call && !hosting()) { syncTries = 0; sync(); } },
    close() { stopSync(); answered.clear(); call = null; record = null; },
  };
}

/* Moderation on the wire.
 *
 * The rules live with the Glurff's host's agent (+call-mod in app/glurff);
 * lib/moderation is the browser's copy for showing them. This is what carries
 * them, through our own ship to the host's:
 *
 *   us   -> host   call-mod {place, inc, target, mod}   "do this"
 *   us   -> host   call-mod {place, mod: 'sync'}         "tell me the record"
 *   host -> all    call-mod-snap {host, place, inc, rev, ...}
 *
 * The host is the only writer. It applies a request, makes it true on the call
 * server, and sends the result to everybody in the call; nobody changes a
 * record except by taking a newer snapshot from it. A request the rules refuse
 * changes nothing and is answered with nothing.
 *
 * The host sends the record to everybody in a call when it starts and to each
 * newcomer, so a sync is only for one that went astray: asked a handful of
 * times on entering a call, and then not again.
 */
import { acceptSnapshot, recordMatches, recordingOf, MOD_OPS } from './moderation.js';

export const SYNC_TRIES = 4;
export const SYNC_MS = 2500;

export function createModeration({ our, send, enforce = () => {}, changed = () => {},
  trace = () => {}, later = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) }) {
  let call = null;          //  {place, host} -- the call this is about
  let record = null;
  let syncTimer = null, syncTries = 0;

  const ask = (target, op) => {
    try { Promise.resolve(send(call.host, call.place, record?.inc ?? 0, target, op)).catch(() => {}); } catch {}
  };
  function stopSync() { cancel(syncTimer); syncTimer = null; syncTries = 0; }
  function sync() {
    if (!call || record || syncTries >= SYNC_TRIES) return stopSync();
    syncTries++;
    ask(our, 'sync');
    cancel(syncTimer);
    syncTimer = later(() => { syncTimer = null; sync(); }, SYNC_MS);
  }

  return {
    /* The call changed -- a different room or huddle. Everything about the old
     * one goes; the same call again keeps what we hold. */
    enter(next) {
      if (next && call && next.place === call.place && next.host === call.host) return;
      stopSync();
      call = next ? { place: next.place, host: next.host } : null;
      record = null;
      enforce(record, call);
      changed();
      if (call) sync();
    },
    call: () => call,
    record: () => (recordMatches(record, call) ? record : null),

    /* Ask the host for something. Whether it happens is the host's to say. */
    request(target, op) {
      if (!call || !MOD_OPS.includes(op) || typeof target !== 'string') return false;
      ask(target, op);
      return true;
    },

    /* A snapshot. `who` is the ship the agent says sent it. */
    receive(who, snap) {
      if (!call || !snap) return false;
      const next = acceptSnapshot(record, call, who, snap);
      if (!next) return false;
      record = next;
      stopSync();
      trace('call-mod', { place: call.place, host: call.host, rev: next.rev, reason: `snapshot/${next.inc}` });
      enforce(record, call);
      changed();
      return true;
    },

    recording: () => recordingOf(record, call),
    /* Ask once more, keeping what we hold: a newer record replaces it. */
    resync() { if (call) ask(our, 'sync'); },
    close() { stopSync(); call = null; record = null; },
  };
}

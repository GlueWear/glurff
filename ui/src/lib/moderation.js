/* Who may do what inside a Glurff call.
 *
 * Glurff calls are NOT Noltbook note calls: a room or a huddle is a
 * %noltbook-calls room on the GLURFF'S HOST, and Noltbook's note-scoped
 * `call-mod` action has nothing to say about it. So the behaviour is
 * Noltbook's -- promote, demote, mute, boot, record -- and the record is
 * Glurff's own, kept by the Glurff's host's AGENT (+call-mod in app/glurff).
 * Nothing here decides anything: this is the browser's copy of the rules, so
 * it offers only the buttons the host will honour, and its reading of the
 * record the host sends.
 *
 * THE RECORD IS ONE CALL'S. It names the call it belongs to:
 *
 *     {place, host, inc, rev, admins, mods, muted, gmuted, booted, recording}
 *
 * `muted` is who this call's admins muted; `gmuted`, who in the call is muted
 * across the WHOLE Glurff by its note (2026-10-31). Either keeps somebody
 * quiet; only the first is this call's to lift.
 *
 * A record is identified by its PLACE and HOST. `inc` is which run of the call
 * it is: a call that empties and fills again is a new run, and its admins,
 * mutes and removals start over. `rev` orders snapshots within a run, so a
 * replayed or reordered snapshot cannot roll moderation backwards.
 *
 * RANKS. The Glurff's host, then its moderators (`mods`, the admins of the
 * Glurff's note), then the call's own admins (whoever started it, anybody
 * promoted, and whoever it passed to when they had all gone), then everybody
 * else. An admin of any rank may act only on somebody of a lower one, and
 * never on themselves. Everybody sees all three kinds of admin as "admin".
 *
 * Nothing here touches the network, the DOM or the SFU.
 */

/* Everything an admin can ask for. Noltbook's vocabulary, deliberately. */
export const MOD_OPS = ['promote', 'demote', 'mute', 'unmute', 'boot', 'unboot',
                        'record-start', 'record-stop'];

const list = (v) => Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
const uniq = (v) => [...new Set(list(v))].sort();

/* Is this record about this call? The place and the host. */
export const recordMatches = (record, call) =>
  !!record && !!call && record.place === call.place && record.host === call.host;

/* 3 the Glurff's host, 2 a moderator, 1 an admin of this call, 0 anybody else.
 * The host outranks everybody whether or not any record has arrived yet. */
export function rankOf(record, call, ship) {
  if (!call || !ship) return 0;
  if (ship === call.host) return 3;
  if (!recordMatches(record, call)) return 0;
  if (list(record.mods).includes(ship)) return 2;
  if (list(record.admins).includes(ship)) return 1;
  return 0;
}
/* 'host', 'mod', 'admin' or null. Shown to everybody as "admin" or nothing. */
export function roleOf(record, call, ship) {
  return [null, 'admin', 'mod', 'host'][rankOf(record, call, ship)];
}
export const isAdmin = (record, call, ship) => rankOf(record, call, ship) > 0;
/* May `actor` act on `target` at all? Above them, and not themselves. */
export const mayModerate = (record, call, actor, target) =>
  !!actor && !!target && actor !== target &&
  rankOf(record, call, actor) > 0 && rankOf(record, call, actor) > rankOf(record, call, target);
export const isCallMuted = (record, call, ship) =>
  recordMatches(record, call) && list(record.muted).includes(ship);
export const isGlurffMuted = (record, call, ship) =>
  recordMatches(record, call) && list(record.gmuted).includes(ship);
export const isMuted = (record, call, ship) =>
  isCallMuted(record, call, ship) || isGlurffMuted(record, call, ship);
export const isBooted = (record, call, ship) =>
  recordMatches(record, call) && list(record.booted).includes(ship);
export const recordingOf = (record, call) =>
  recordMatches(record, call) && record.recording ? record.recording : null;

/* Read a snapshot the Glurff's host sent us.
 *
 * `from` is the ship the AGENT says sent it, never anything in the payload.
 * Taken only from the host of the call we are in, about that call, and only
 * if it is newer: a later run replaces what we hold, the same run only moves
 * forwards, and an earlier one is a replay and is dropped. */
export function acceptSnapshot(record, call, from, snap) {
  if (!call || !snap || from !== call.host || snap.place !== call.place) return null;
  if (!Number.isSafeInteger(snap.inc) || snap.inc < 0 ||
      !Number.isSafeInteger(snap.rev) || snap.rev < 0) return null;
  if (recordMatches(record, call)) {
    if (snap.inc < record.inc) return null;
    if (snap.inc === record.inc && snap.rev <= record.rev) return null;
  }
  const rec = snap.recording;
  return {
    place: call.place, host: call.host, inc: snap.inc, rev: snap.rev,
    admins: uniq(snap.admins), mods: uniq(snap.mods),
    muted: uniq(snap.muted), gmuted: uniq(snap.gmuted), booted: uniq(snap.booted),
    recording: rec && typeof rec.by === 'string'
      ? { by: rec.by, since: Number.isFinite(rec.since) ? rec.since : 0 } : null,
  };
}

/* What our own controls are allowed to do. A forced mute turns mic, camera and
 * screen off and LOCKS them; a boot means we should not be here at all. */
export const restrictions = (record, call, our) => ({
  muted: isMuted(record, call, our),
  booted: isBooted(record, call, our),
});

/* Whose media we may play. A muted participant is not played or shown by
 * anybody, which is what makes a mute a mute rather than a request. */
export const mayPlay = (record, call, ship) =>
  !isMuted(record, call, ship) && !isBooted(record, call, ship);

/* Who may do what inside a Glurff call.
 *
 * Glurff calls are NOT Noltbook note calls: a room or a huddle is a
 * %noltbook-calls room that Glurff opens on the host's own broker, and
 * Noltbook's note-scoped `call-mod` action has nothing to say about it. So the
 * behaviour is Noltbook's -- promote, demote, mute, boot, record -- and the
 * record is Glurff's own, kept by the host of the call it belongs to.
 *
 * THE RECORD IS ONE CALL'S. It names the call it belongs to:
 *
 *     {place, host, gen, rev, admins, muted, booted, recording}
 *
 * A record is identified by its PLACE and HOST. `gen` is the %noltbook-calls
 * room generation, which is a lease counter rather than a call identity: it
 * moves every time the host renews the room, so the people in one call hold
 * different values for it. It orders incarnations instead -- a snapshot
 * carrying a newer generation replaces what you hold wholesale -- so state
 * from an earlier call still cannot apply to a later one.
 *
 * THE HOST IS THE AUTHORITY. Everyone else asks, and the host publishes the
 * result. A snapshot is accepted only from the host of the call you are in,
 * only for that call's incarnation, and only at a newer revision -- so a
 * replayed or reordered snapshot cannot roll moderation backwards.
 *
 * THE ACTOR IS THE SENDING SHIP. Every request is judged against the ship the
 * agent says sent it, never against a field in the payload. A payload cannot
 * name its own author.
 *
 * Nothing here touches the network, the DOM or the SFU: it is the rules and the
 * record, so both sides can be tested without a browser.
 */

/* Everything an admin can ask for. Noltbook's vocabulary, deliberately. */
export const MOD_OPS = ['promote', 'demote', 'mute', 'unmute', 'boot', 'unboot',
                        'record-start', 'record-stop'];

const list = (v) => Array.isArray(v) ? v.filter((s) => typeof s === 'string') : [];
const uniq = (v) => [...new Set(list(v))].sort();

/* An empty record for a call, so "no moderation yet" and "moderation that
 * happens to be empty" are the same shape. The host is always an admin, and is
 * never in the list: the list is who was PROMOTED. */
export const emptyRecord = (call) => ({
  place: call.place, host: call.host, gen: call.gen ?? 0, rev: 0,
  admins: [], muted: [], booted: [], recording: null,
});

/* Is this record about this call?
 *
 * THE PLACE AND THE HOST, not the generation. `gen` is a LEASE counter: it
 * moves whenever the host renews the room, so two people in the same call hold
 * different values for it -- somebody who joined after a renewal has a higher
 * one than the host that opened the room. Demanding equality meant every
 * snapshot was dropped once a call had been open long enough to renew, which
 * is why muting and removing someone worked in a huddle that had just formed
 * and silently did nothing in a room that had been sitting there.
 *
 * `gen` still does its job, one step further in: a snapshot carrying a NEWER
 * generation supersedes the record wholesale, so state from an earlier
 * incarnation can never apply to a later one. See acceptSnapshot. */
export const recordMatches = (record, call) =>
  !!record && !!call && record.place === call.place && record.host === call.host;

/* HOST or ADMIN, or null. The host is always an admin and can never be
 * demoted out of it. */
export function roleOf(record, call, ship) {
  if (!call || !ship) return null;
  if (ship === call.host) return 'host';
  if (recordMatches(record, call) && list(record.admins).includes(ship)) return 'admin';
  return null;
}
export const isAdmin = (record, call, ship) => roleOf(record, call, ship) !== null;
export const isMuted = (record, call, ship) =>
  recordMatches(record, call) && list(record.muted).includes(ship);
export const isBooted = (record, call, ship) =>
  recordMatches(record, call) && list(record.booted).includes(ship);
export const recordingOf = (record, call) =>
  recordMatches(record, call) && record.recording ? record.recording : null;

/* Apply one request to the record, as the HOST.
 *
 * Returns the next record, or null when the request changes nothing -- which
 * covers every refusal, because a refusal and a no-op are the same thing to
 * everyone else: the record simply does not move.
 *
 * The rules are Noltbook's:
 *   - nobody may act on the host, or on themselves;
 *   - only the host may act on another admin;
 *   - promote only somebody in the call, demote only somebody promoted;
 *   - one recording at a time, started only by an admin who is in the call,
 *     stopped by that recorder or by the host.
 */
export function applyOp(record, call, { actor, target, op, members = [], now = Date.now() }) {
  if (!call || !MOD_OPS.includes(op)) return null;
  const base = recordMatches(record, call) ? record : emptyRecord(call);
  const inCall = (ship) => members.includes(ship);
  const next = (patch) => ({ ...base, ...patch, rev: base.rev + 1 });

  if (op === 'record-start') {
    if (!isAdmin(base, call, actor) || !inCall(actor) || base.recording) return null;
    return next({ recording: { by: actor, since: now } });
  }
  if (op === 'record-stop') {
    if (!base.recording) return null;
    if (actor !== base.recording.by && actor !== call.host) return null;
    return next({ recording: null });
  }

  if (!isAdmin(base, call, actor)) return null;
  if (!target || target === call.host || target === actor) return null;
  /* An ordinary admin cannot touch another admin; the host can. */
  if (isAdmin(base, call, target) && actor !== call.host) return null;

  const admins = uniq(base.admins), muted = uniq(base.muted), booted = uniq(base.booted);
  switch (op) {
    case 'promote':
      if (!inCall(target) || admins.includes(target)) return null;
      return next({ admins: uniq([...admins, target]) });
    case 'demote':
      if (!admins.includes(target)) return null;
      return next({ admins: admins.filter((s) => s !== target) });
    case 'mute':
      if (muted.includes(target)) return null;
      return next({ muted: uniq([...muted, target]) });
    case 'unmute':
      if (!muted.includes(target)) return null;
      return next({ muted: muted.filter((s) => s !== target) });
    case 'boot':
      if (booted.includes(target)) return null;
      /* Booting the recorder ends the recording with them. */
      return next({ booted: uniq([...booted, target]),
                    recording: base.recording?.by === target ? null : base.recording });
    case 'unboot':
      if (!booted.includes(target)) return null;
      return next({ booted: booted.filter((s) => s !== target) });
    default:
      return null;
  }
}

/* The recorder left the call, or the call moved: the recording stops with it.
 * Returns the next record or null when nothing changes. */
export function recorderGone(record, call, members) {
  const rec = recordingOf(record, call);
  if (!rec || members.includes(rec.by)) return null;
  return { ...record, recording: null, rev: record.rev + 1 };
}

/* A snapshot, as it travels. Nothing secret and nothing large: four short
 * lists and a revision. */
export const snapshotOf = (record) => ({
  kind: 'call-mod-snap',
  place: record.place, host: record.host, gen: record.gen ?? 0, rev: record.rev,
  admins: uniq(record.admins), muted: uniq(record.muted), booted: uniq(record.booted),
  recording: record.recording ? { by: record.recording.by, since: record.recording.since } : null,
});

/* Read a snapshot somebody sent us.
 *
 * `from` is the ship the AGENT says sent it, not anything in the payload. A
 * snapshot is taken only from the host of the call we are in, about that call,
 * and only if it is newer than what we hold. Everything else is dropped --
 * including a snapshot for a call we have since left. */
export function acceptSnapshot(record, call, from, snap) {
  if (!call || !snap || from !== call.host) return null;
  if (snap.place !== call.place || snap.host !== call.host) return null;
  if (!Number.isSafeInteger(snap.rev) || snap.rev < 0) return null;
  const gen = Number.isSafeInteger(snap.gen) ? snap.gen : 0;
  if (recordMatches(record, call)) {
    /* A newer incarnation replaces what we hold; the same one only moves
     * forwards; an older one is a replay and is dropped. */
    const held = record.gen ?? 0;
    if (gen < held) return null;
    if (gen === held && snap.rev <= record.rev) return null;
  }
  const rec = snap.recording;
  return {
    place: call.place, host: call.host, gen, rev: snap.rev,
    admins: uniq(snap.admins), muted: uniq(snap.muted), booted: uniq(snap.booted),
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

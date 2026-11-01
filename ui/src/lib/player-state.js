/* Ephemeral media shared over Glurff presence.
 *
 * Calls and room leases have a host. These players have no host: every browser
 * keeps the newest record it has seen. Equal revisions choose the lower @p,
 * matching huddle election. Nothing here is persisted on either Glurff or
 * Noltbook.
 *
 * THE SCREENS HAVE A CONTROLLER (2026-10-31). On the Movie Theater's and the
 * Amphitheatre's screens a SCREENING is one deliberate "Play for room": it has
 * its own id, and whoever started it is its controller. Only the controller's
 * play, pause, seek and playlist moves are shared; anybody else's stay in their
 * own player (ui/media-surfaces). Anybody may deliberately replace the
 * screening, and so becomes the new one's controller -- a replacement names
 * the screening it replaces and beats it whatever their revisions, and once
 * replaced a screening is retired, so its old controller's late updates are
 * dropped. Two replacements at once settle as any two records do.
 *
 * Every record is checked against who sent it: a direct action belongs to its
 * authenticated sender whatever its JSON says, and `allowed` turns away
 * anybody blocked or muted in the Glurff -- a muted controller included. A
 * presence snapshot relayed by somebody else cannot prove who wrote it, so it
 * is taken only as a record its own controller wrote, from somebody allowed.
 *
 * The jukebox stays ownerless: anybody allowed may operate it. */

export const PLAYER_SURFACES = ['jukebox', 'amphitheatre', 'movie'];
export const CONTROLLED_SURFACES = ['amphitheatre', 'movie'];
export const PLAYER_PROVIDERS = ['none', 'youtube', 'vimeo', 'direct', 'radio', 'soundcloud', 'screen'];
const surfaceSet = new Set(PLAYER_SURFACES), providerSet = new Set(PLAYER_PROVIDERS);

const finite = n => Number.isFinite(n);
const ship = s => typeof s === 'string' && /^~[a-z-]{3,56}$/.test(s);
const screeningId = s => typeof s === 'string' && s.length > 0 && s.length <= 64;

export function validPlayerState(value) {
  return !!value && value.kind === 'player-state' && surfaceSet.has(value.surface) &&
    Number.isSafeInteger(value.rev) && value.rev >= 0 && ship(value.by) &&
    providerSet.has(value.provider) && typeof value.ref === 'string' && value.ref.length <= 2048 &&
    finite(value.positionMs) && value.positionMs >= 0 && value.positionMs <= 31_536_000_000 &&
    finite(value.at) && typeof value.paused === 'boolean' && ship(value.startedBy) &&
    (value.playlistIndex === undefined ||
      (Number.isSafeInteger(value.playlistIndex) && value.playlistIndex >= 0 && value.playlistIndex <= 100_000)) &&
    (value.screening === undefined || screeningId(value.screening)) &&
    (value.replaces === undefined || value.replaces === null || screeningId(value.replaces));
}

/* Positive means a wins. Lower @p wins a same-revision race. */
export function comparePlayerState(a, b) {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  if (a.rev !== b.rev) return a.rev > b.rev ? 1 : -1;
  if (a.by === b.by) return 0;
  return a.by < b.by ? 1 : -1;
}

export function playbackPosition(state, now = Date.now()) {
  if (!validPlayerState(state) || state.paused || state.provider === 'radio' || state.provider === 'screen' || state.provider === 'none')
    return validPlayerState(state) ? state.positionMs : 0;
  return Math.max(0, state.positionMs + Math.max(0, now - state.at));
}

const RETIRED_KEPT = 32;
const freshId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function createPlayerState({ our, now = () => Date.now(), send = () => {}, changed = () => {},
  allowed = () => true, id = freshId } = {}) {
  const states = new Map(), revisions = new Map(), retired = new Map();
  const controlled = new Set(CONTROLLED_SURFACES);
  const notify = (surface, state, local) => changed(surface, state, local);
  const gone = (surface) => { let set = retired.get(surface); if (!set) retired.set(surface, set = new Set()); return set; };
  const retire = (surface, screening) => {
    if (!screening) return;
    const set = gone(surface); set.delete(screening); set.add(screening);
    while (set.size > RETIRED_KEPT) set.delete(set.values().next().value);
  };
  const seen = (state) => revisions.set(state.surface, Math.max(revisions.get(state.surface) ?? 0, state.rev));

  /* `writer` is who wrote it: the authenticated sender of a direct action, or
   * what a relayed snapshot says. */
  function take(from, raw, writer) {
    const surface = raw.surface;
    if (!surfaceSet.has(surface) || !allowed(from) || !allowed(writer)) return false;
    const known = states.get(surface) ?? null;
    if (!controlled.has(surface)) {
      const candidate = { ...raw, by: writer };
      if (!validPlayerState(candidate)) return false;
      seen(candidate);
      if (comparePlayerState(candidate, known) <= 0) return false;
      states.set(surface, candidate); notify(surface, candidate, false);
      return true;
    }
    if (!screeningId(raw.screening) || gone(surface).has(raw.screening)) return false;
    const same = !!known && known.screening === raw.screening;
    /* Only a screening's controller writes it. Its controller is whoever
     * started it -- for a direct action that is the sender, never a name in
     * the payload. */
    const startedBy = same ? known.startedBy : from === writer ? writer : raw.startedBy;
    const candidate = { ...raw, by: writer, startedBy, replaces: same ? known.replaces ?? null : raw.replaces ?? null };
    if (candidate.by !== candidate.startedBy || !validPlayerState(candidate)) return false;
    seen(candidate);
    /* What we wrote we know, unless we have just loaded and know nothing: a
     * relay naming us otherwise is somebody else's word for it. */
    if (writer === our && from !== our && known) return false;
    const replacing = !same && !!known && candidate.replaces === known.screening;
    if (!replacing && comparePlayerState(candidate, known) <= 0) {
      if (!same) retire(surface, candidate.screening);
      return false;
    }
    if (known && !same) retire(surface, known.screening);
    if (candidate.replaces) retire(surface, candidate.replaces);
    states.set(surface, candidate); notify(surface, candidate, false);
    return true;
  }

  function adopt(from, incoming) {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    let accepted = false;
    for (const raw of list) {
      if (!raw || raw.kind !== 'player-state') continue;
      /* The envelope is authenticated by %glurff. Never trust a body claiming
       * that another ship won a last-writer tie. Snapshot records are the one
       * exception: their `by` is the original writer, while `from` merely
       * carries the latest record onward. */
      if (take(from, raw, ship(raw.by) ? raw.by : from)) accepted = true;
    }
    return accepted;
  }

  function receive(from, raw) {
    if (!raw || raw.kind !== 'player-state') return false;
    /* A direct action belongs to the authenticated sender, even if its JSON
     * says otherwise. Relayed snapshots use adopt(), preserving the writer. */
    return take(from, raw, from);
  }

  /* Ours to share? The jukebox is anybody's; a screen, its controller's. */
  const mayControl = (surface) => allowed(our) &&
    (!controlled.has(surface) || states.get(surface)?.startedBy === our);

  /* A new item (`newItem`) is a new screening, which anybody allowed may
   * start; anything else moves the current one, which on a screen only its
   * controller may. Refused, nothing is written or sent: null. */
  function write(surface, patch, { newItem = false } = {}) {
    if (!surfaceSet.has(surface)) throw new Error('unknown player surface');
    const previous = states.get(surface);
    if (!allowed(our)) return null;
    if (!newItem && controlled.has(surface) && previous && previous.startedBy !== our) return null;
    const provider = patch.provider ?? previous?.provider ?? 'none';
    const ref = patch.ref ?? previous?.ref ?? '';
    const fresh = newItem || !previous?.screening;
    const state = {
      kind: 'player-state', surface,
      rev: Math.max(revisions.get(surface) ?? 0, previous?.rev ?? 0) + 1,
      by: our, provider, ref,
      positionMs: Math.max(0, Number(patch.positionMs ?? playbackPosition(previous, now())) || 0),
      at: now(), paused: patch.paused ?? previous?.paused ?? false,
      startedBy: newItem ? our : (previous?.startedBy ?? our),
      playlistIndex: Math.max(0, Number(patch.playlistIndex ?? (newItem ? 0 : previous?.playlistIndex) ?? 0) || 0),
      screening: fresh ? String(id()).slice(0, 64) : previous.screening,
      replaces: fresh ? previous?.screening ?? null : previous.replaces ?? null,
    };
    if (!validPlayerState(state)) throw new Error('invalid player state');
    if (fresh && previous?.screening) retire(surface, previous.screening);
    states.set(surface, state);
    revisions.set(surface, state.rev);
    notify(surface, state, true);
    void Promise.resolve(send(state)).catch(() => {});
    return state;
  }

  /* Over, for everybody: the jukebox by anybody, a screen by its controller
   * (its own screen share ending). There is no button for it on a screen. */
  const clear = surface => write(surface, {
    provider: 'none', ref: '', positionMs: 0, paused: true, playlistIndex: 0,
  }, { newItem: !controlled.has(surface) });

  return {
    adopt, receive, write, clear, mayControl,
    get: surface => states.get(surface) ?? null,
    snapshot: () => PLAYER_SURFACES.map(s => states.get(s)).filter(Boolean).map(s => ({ ...s })),
  };
}

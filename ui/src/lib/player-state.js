/* Ephemeral, ownerless media shared over Glurff presence.
 *
 * Calls and room leases have a host. These players deliberately do not: any
 * visible person may operate one, so every browser keeps the newest record it
 * has seen. Equal revisions choose the lower @p, matching huddle election.
 * Nothing here is persisted on either Glurff or Noltbook. */

export const PLAYER_SURFACES = ['jukebox', 'amphitheatre', 'movie'];
export const PLAYER_PROVIDERS = ['none', 'youtube', 'vimeo', 'direct', 'radio', 'soundcloud'];
const surfaceSet = new Set(PLAYER_SURFACES), providerSet = new Set(PLAYER_PROVIDERS);

const finite = n => Number.isFinite(n);
const ship = s => typeof s === 'string' && /^~[a-z-]{3,56}$/.test(s);

export function validPlayerState(value) {
  return !!value && value.kind === 'player-state' && surfaceSet.has(value.surface) &&
    Number.isSafeInteger(value.rev) && value.rev >= 0 && ship(value.by) &&
    providerSet.has(value.provider) && typeof value.ref === 'string' && value.ref.length <= 2048 &&
    finite(value.positionMs) && value.positionMs >= 0 && value.positionMs <= 31_536_000_000 &&
    finite(value.at) && typeof value.paused === 'boolean' && ship(value.startedBy) &&
    (value.playlistIndex === undefined ||
      (Number.isSafeInteger(value.playlistIndex) && value.playlistIndex >= 0 && value.playlistIndex <= 100_000));
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
  if (!validPlayerState(state) || state.paused || state.provider === 'radio' || state.provider === 'none')
    return validPlayerState(state) ? state.positionMs : 0;
  return Math.max(0, state.positionMs + Math.max(0, now - state.at));
}

export function createPlayerState({ our, now = () => Date.now(), send = () => {}, changed = () => {} }) {
  const states = new Map(), revisions = new Map();
  const notify = (surface, state, local) => changed(surface, state, local);

  function adopt(from, incoming) {
    const list = Array.isArray(incoming) ? incoming : [incoming];
    let accepted = false;
    for (const raw of list) {
      if (!raw || raw.kind !== 'player-state') continue;
      /* The envelope is authenticated by %glurff. Never trust a body claiming
       * that another ship won a last-writer tie. Snapshot records are the one
       * exception: their `by` is the original writer, while `from` merely
       * carries the latest record onward. */
      const candidate = raw.by ? { ...raw } : { ...raw, by: from };
      if (!validPlayerState(candidate)) continue;
      revisions.set(candidate.surface, Math.max(revisions.get(candidate.surface) ?? 0, candidate.rev));
      if (comparePlayerState(candidate, states.get(candidate.surface)) <= 0) continue;
      states.set(candidate.surface, candidate);
      notify(candidate.surface, candidate, false);
      accepted = true;
    }
    return accepted;
  }

  function receive(from, raw) {
    if (!raw || raw.kind !== 'player-state') return false;
    /* A direct action belongs to the authenticated sender, even if its JSON
     * says otherwise. Relayed snapshots use adopt(), preserving the writer. */
    return adopt(from, { ...raw, by: from });
  }

  function write(surface, patch, { newItem = false } = {}) {
    if (!surfaceSet.has(surface)) throw new Error('unknown player surface');
    const previous = states.get(surface);
    const provider = patch.provider ?? previous?.provider ?? 'none';
    const ref = patch.ref ?? previous?.ref ?? '';
    const state = {
      kind: 'player-state', surface,
      rev: Math.max(revisions.get(surface) ?? 0, previous?.rev ?? 0) + 1,
      by: our, provider, ref,
      positionMs: Math.max(0, Number(patch.positionMs ?? playbackPosition(previous, now())) || 0),
      at: now(), paused: patch.paused ?? previous?.paused ?? false,
      startedBy: newItem ? our : (previous?.startedBy ?? our),
      playlistIndex: Math.max(0, Number(patch.playlistIndex ?? (newItem ? 0 : previous?.playlistIndex) ?? 0) || 0),
    };
    if (!validPlayerState(state)) throw new Error('invalid player state');
    states.set(surface, state);
    revisions.set(surface, state.rev);
    notify(surface, state, true);
    void Promise.resolve(send(state)).catch(() => {});
    return state;
  }

  const clear = surface => write(surface, {
    provider: 'none', ref: '', positionMs: 0, paused: true, playlistIndex: 0,
  }, { newItem: true });

  return {
    adopt, receive, write, clear,
    get: surface => states.get(surface) ?? null,
    snapshot: () => PLAYER_SURFACES.map(s => states.get(s)).filter(Boolean).map(s => ({ ...s })),
  };
}

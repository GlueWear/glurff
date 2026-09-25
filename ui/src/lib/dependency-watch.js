import { NOLTBOOK_DESK, NOLTBOOK_PUBLISHER, reduceDependency } from './dependency-state.js';

export function createDependencyWatch({ client, send }) {
  let state = { status: 'checking' }, handle = null, closed = false, initialLoaded = false;
  let queued = [];
  const listeners = new Set();
  const set = (next) => {
    if (closed || (next.status === state.status && next.error === state.error)) return;
    state = next;
    for (const listener of listeners) listener(state);
  };
  const receive = (fact) => {
    if (!initialLoaded) { queued.push(fact); return; }
    set(reduceDependency(state, fact));
  };
  /* Docket's watch emits only future add/delete changes. Its current charge
   * map comes from a scry, so subscribe first, fetch the snapshot, then replay
   * any changes that raced with that fetch. */
  const subscription = client.subscribe({
    app: 'docket',
    path: '/charges',
    event: receive,
    err: () => set({ status: 'unavailable' }),
    quit: () => set({ status: 'unavailable' }),
  }).then((id) => {
    handle = id;
    if (closed) client.unsubscribe(id).catch(() => {});
  }).catch(() => { if (!initialLoaded) set({ status: 'unavailable' }); });

  const snapshot = client.scry({ app: 'docket', path: '/charges' }).then((fact) => {
    if (closed) return;
    let next = reduceDependency(state, fact);
    for (const delta of queued) next = reduceDependency(next, delta);
    queued = [];
    initialLoaded = true;
    if (next.status === 'checking') set({ status: 'unavailable' });
    else set(next);
  }).catch(() => {
    queued = [];
    initialLoaded = true;
    set({ status: 'unavailable' });
  });

  return {
    get state() { return state; },
    on(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async install() {
      if (state.status === 'ready') return;
      set({ status: 'installing' });
      try {
        await send('docket', 'docket-install', `${NOLTBOOK_PUBLISHER}/${NOLTBOOK_DESK}`);
      } catch (error) {
        set({ status: 'failed', error: error?.message || 'Docket refused the installation' });
        throw error;
      }
    },
    close() {
      closed = true;
      listeners.clear();
      if (handle != null) client.unsubscribe(handle).catch(() => {});
      else subscription.catch(() => {});
      snapshot.catch(() => {});
    },
  };
}

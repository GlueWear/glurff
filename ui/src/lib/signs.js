/* SIGNS (2026-11-07): an item that shows text is a sign, and its host may
 * let anybody in the Glurff write on it (`do.editable` in the document).
 * What one says then is kept by the world's host (app/glurff.hoon,
 * `sign-put`), which takes a change only from somebody in the world, on a
 * sign the live release lets people change; the release's text is only where
 * it starts. We hear every change from the host while we are here, through
 * our own agent.
 *
 * A playtest writes nothing: nobody is there to read it.
 */
import { watchSigns, setSign, resetSign } from 'lib/glurff';

export const SIGN_MAX = 4000;
export const editableSign = (item) => item?.do?.kind === 'text' && item.do.editable === true;

export function createSigns({ host, our, preview = false }) {
  const changed = new Map();          //  item id -> {text, by, at}
  /* idle, then watching once asked; shut if the host keeps none for us (we
   * are not in it, or it is from before signs); preview in a playtest. */
  let state = preview ? 'preview' : 'idle';
  const listeners = new Set(), waits = new Set();

  function watch() {
    if (state !== 'idle') return;
    state = 'watching';
    void Promise.resolve(watchSigns(host, (name, p) => {
      if (p?.host !== host) return;
      if (name === 'signs') { changed.clear(); for (const [id, s] of Object.entries(p.signs ?? {})) changed.set(id, s); }
      if (name === 'signs-shut') state = 'shut';
      for (const w of [...waits]) w(name, p);
      for (const fn of listeners) { try { fn(); } catch {} }
    })).catch(() => { state = 'shut'; });
  }

  return {
    watch,
    state: () => state,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /* What a sign says now, and who last changed it, if anybody did. */
    of(item) {
      const c = editableSign(item) ? changed.get(item.id) : null;
      return { text: c?.text ?? item.do?.text ?? '', by: c?.by ?? null, at: c?.at ?? null };
    },
    canWrite: (item) => editableSign(item) && state === 'watching',
    /* Write on it. Done once the host has it; refused if it would not take
     * it, or did not answer. */
    write(item, text) {
      return new Promise((resolve, reject) => {
        const finish = () => { clearTimeout(timer); waits.delete(heard); };
        const heard = (name, p) => {
          if (name === 'sign-refused' && p.item === item.id) { finish(); reject(new Error(`${host} did not take it`)); }
          const s = name === 'signs' && p.signs?.[item.id];
          if (s && s.text === text && s.by === our) { finish(); resolve(); }
        };
        const timer = setTimeout(() => { finish(); reject(new Error(`${host} did not answer`)); }, 20000);
        waits.add(heard);
        Promise.resolve(setSign(host, item.id, text)).catch((e) => { finish(); reject(e instanceof Error ? e : new Error('it was refused')); });
      });
    },
    /* As the host: back to what the world was published with. */
    putBack: (item) => resetSign(item.id),
  };
}

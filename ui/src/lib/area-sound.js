/* THE SOUND OF A PLACE (2026-11-08): an area's loop (`sound` in the world's
 * document) plays while we are in it, fading into the next one's as we walk;
 * anywhere without one is quiet.
 *
 * Sounds come from the host once the map is showing -- the one we are in
 * first, then the rest, one at a time -- never before, so a sound never holds
 * the world up. Each is kept whole as a blob: it plays in any browser, and
 * the host's ship is never asked for it in pieces.
 *
 * Quieter during a call or while something plays for the room (`ducked`),
 * and off altogether from the settings (`enabled`). A browser plays nothing
 * before the page has been clicked or typed in; the first click or key
 * starts it. */
export const FADE_MS = 1200, DUCK = 0.3;
const STEP_MS = 100;

/* want(): the sound for where we are now, {src, volume} or null.
 * url(src): where it is fetched from. */
export function createAreaSound({ want, url, enabled = () => true, ducked = () => false,
  fetchBlob = (u) => fetch(u, { credentials: 'include' }).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.blob(); }) } = {}) {
  const blobs = new Map();        //  src -> Promise of an object URL
  const playing = new Map();      //  src -> {audio, target}
  let wanted = null, started = false, timer = null;

  const load = (src) => {
    if (!blobs.has(src)) blobs.set(src, fetchBlob(url(src)).then((b) => URL.createObjectURL(b)).catch((e) => { blobs.delete(src); throw e; }));
    return blobs.get(src);
  };
  const level = (s) => (enabled() ? Math.max(0, Math.min(1, s.volume ?? 0.6)) * (ducked() ? DUCK : 1) : 0);

  async function begin(s) {
    let u;
    try { u = await load(s.src); } catch { return; }
    if (wanted?.src !== s.src || playing.has(s.src)) return;
    const audio = new Audio(u);
    audio.loop = true; audio.volume = 0;
    playing.set(s.src, { audio, target: level(s) });
    if (started) audio.play().catch(() => {});
  }

  /* Each step: what should play, and every sound a step nearer its volume --
   * the one wanted up to its level, the others down to nothing, and gone. */
  function step() {
    const s = want();
    if (s?.src !== wanted?.src) { wanted = s; if (s && !playing.has(s.src)) void begin(s); }
    else wanted = s;
    for (const [src, p] of playing) {
      p.target = wanted?.src === src ? level(wanted) : 0;
      const by = STEP_MS / FADE_MS, v = p.audio.volume;
      const next = v < p.target ? Math.min(p.target, v + by) : Math.max(p.target, v - by);
      p.audio.volume = next;
      /* Silent is paused -- and, if it is not the one wanted, gone. */
      if (next === 0 && p.target === 0) { if (!p.audio.paused) p.audio.pause(); if (wanted?.src !== src) playing.delete(src); }
      else if (started && p.audio.paused && next > 0) p.audio.play().catch(() => {});
    }
  }

  return {
    /* Listening for where we are, and for the first click or key. */
    start() {
      if (timer) return;
      timer = setInterval(step, STEP_MS);
      const go = () => { started = true; for (const p of playing.values()) if (p.target > 0) p.audio.play().catch(() => {}); };
      for (const e of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(e, go, { once: true, capture: true });
    },
    /* Every sound of the world, fetched one after another while nothing else
     * is: the place we are in comes first by itself. */
    async prefetch(srcs) {
      for (const src of srcs) { try { await load(src); } catch {} }
    },
    stop() { clearInterval(timer); timer = null; for (const p of playing.values()) p.audio.pause(); playing.clear(); },
    playing: () => [...playing].map(([src, p]) => ({ src, volume: p.audio.volume, paused: p.audio.paused })),
  };
}

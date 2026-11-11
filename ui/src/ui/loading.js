/* THE WAY IN (2026-11-04): what the loading screen says, and when we land.
 *
 * public/loading.js draws it -- space, from the first paint -- and this says
 * what is happening on it. It stays until everything is in: the artwork made
 * into a world, the world's host answering, our membership of it, and the
 * people in it, where they stand -- so that we arrive in a world that is
 * already there rather than watch it fill in. Each is a step of the way, said
 * on the screen as it goes.
 *
 * Membership trouble is said there too, where a card over the world used to
 * say it: the host not answering yet (and Retry), access removed, a request
 * turned down. Losing access after arriving takes us back out into space with
 * the reason, and having it again lands us again. A blip after arriving -- a
 * rejoin under way -- does not: main.js says that in its connection pill.
 *
 * The people are the one thing not waited for for ever: once everything else
 * is in, PEOPLE_WAIT_MS at most, so a host whose relay is slow keeps nobody
 * out of a world they could walk into.
 *
 * ANOTHER MAP (2026-11-10): going through a door to a map of the world whose
 * pictures are not in yet takes us out into space too -- "Traveling to" it --
 * until they are, rather than onto a world with no map under it; and a wait
 * for the map says how long it has been, as its host may be busy.
 */
import { nb, worldStatus, worldJoined, retryWorld, onChange } from 'lib/noltbook';

export const PEOPLE_WAIT_MS = 6000;
const TICK_MS = 250;
/* After this long, a wait for the map says how long it has been. */
export const SLOW_MS = 5000;
/* Another map's pictures in within this are gone to with no journey. */
export const QUICK_MS = 150;
const waited = (words, ms) => (ms >= SLOW_MS ? `${words} ${Math.floor(ms / 1000)} s` : words);
/* What membership trouble says, and whether it ends the way in (`stop`) or we
 * travel on while it is tried again. */
export const NOTICES = {
  retrying: { title: 'Waiting for Glurff', detail: 'The world host has not answered yet. We’ll keep trying.', retry: true },
  banned: { title: 'Access to Glurff was removed', detail: 'A host or administrator must restore your membership.', stop: true },
  denied: { title: 'Unable to join Glurff', detail: 'The world host did not approve your request.', retry: true, stop: true },
  left: { title: 'You left Glurff', detail: 'Open Glurff again to rejoin.', stop: true },
  'config-error': { title: 'Glurff is unavailable', detail: 'The official shared note could not be verified.', stop: true },
};
/* The steps, what share of the way each is, and what is said while it is the
 * one under way. */
const STEPS = [
  ['art', 0.5, 'Loading the map…'],
  ['world', 0.15, 'Reaching the host…'],
  ['joined', 0.15, 'Joining Glurff…'],
  ['built', 0.05, 'Building the world…'],
  ['people', 0.15, 'Finding everyone…'],
];

export function createLoading({
  screen = globalThis.glurffLoading ?? null, name = 'Glurff', host = '',
  people = () => true, where = () => null,
  status = worldStatus, joined = worldJoined, ready = () => nb.ready, retry = retryWorld,
  watch = (fn) => onChange(fn, (c) => ['world', 'notes', 'pals'].includes(c.field)),
  now = Date.now, every = setInterval, cancel = clearInterval,
} = {}) {
  let art = 0, world = false, built = false, landed = false, landing = false, halted = false;
  let settledAt = null, said = undefined, off = null, mapWait = null, travelling = false;
  const began = now();
  screen?.to?.(name, host);

  function notice(n) {
    const key = n ? n.title : null;
    if (key === said) return;
    said = key;
    screen?.notice?.(n && { title: n.title, detail: n.detail, stop: !!n.stop,
      action: n.retry ? { label: 'Retry', run: () => retry() } : null });
  }
  const done = { art: () => art >= 1, world: () => world, joined: () => joined(), built: () => built,
    people: () => people() || (settledAt !== null && now() - settledAt >= PEOPLE_WAIT_MS) };

  function paint() {
    if (!screen || halted || travelling) return;
    /* Changes are listened for from the first look, not from creation: what
     * `people` and `where` read is made after this is. */
    off ??= watch(paint) ?? (() => {});
    const phase = ready() ? status()?.phase : null;
    const trouble = phase && !joined() ? NOTICES[phase] ?? null : null;
    if (landed) {
      /* Arrived: only an end to our membership takes us back out. */
      if (!trouble?.stop) return;
      landed = false; screen.show?.();
    }
    if (landing) return;
    notice(trouble);
    const rest = art >= 1 && world && built && joined() && !mapWait;
    if (!rest) settledAt = null; else settledAt ??= now();
    let f = 0, words = null;
    for (const [step, share, says] of STEPS) {
      const ok = done[step]();
      f += share * (step === 'art' ? Math.min(1, art) : ok ? 1 : 0);
      if (!ok && !words) words = step === 'art' ? waited(says, now() - began) : says;
    }
    screen.progress?.(f, words ?? 'Landing…');
    if (rest && done.people()) void land();
  }
  async function land() {
    landing = true;
    notice(null);
    screen.progress?.(1, 'Landing…');
    try { await screen.land?.(where); } finally { landing = false; landed = true; }
    paint();
  }

  const timer = every(paint, TICK_MS);
  return {
    /* The artwork, 0..1 of it. */
    art(f) { art = Math.max(art, Math.min(1, Number(f) || 0)); paint(); },
    /* The world's host is watched. */
    world() { world = true; paint(); },
    /* The world is drawn, everyone found so far in it. */
    built() { built = true; paint(); },
    /* Going to another map of the world: `ready`, a promise of its pictures.
     * Before we have landed, landing waits for them too. */
    async map(title, ready) {
      if (!screen || halted) return;
      if (!landed || landing || travelling) {
        const w = mapWait = Promise.resolve(ready).finally(() => { if (mapWait === w) mapWait = null; paint(); });
        return;
      }
      /* In at once (the browser had them): no journey. */
      if (await Promise.race([Promise.resolve(ready).then(() => true), new Promise((ok) => setTimeout(() => ok(false), QUICK_MS))])) return;
      if (!landed || landing || travelling || halted) return;
      landed = false; travelling = true;
      const t0 = now();
      screen.to?.(title, '');
      screen.show?.();
      /* Travelling, not held: nothing is in the way, only the distance. */
      screen.notice?.(null);
      const say = () => screen.progress?.(0.5, waited('Fetching its map…', now() - t0));
      say();
      const tick = every(say, 1000);
      try { await ready; } finally { cancel(tick); }
      if (halted) return;
      screen.progress?.(1, 'Landing…');
      landing = true;
      try { await screen.land?.(where); } finally { landing = false; landed = true; travelling = false; }
      screen.to?.(name, host);
      paint();
    },
    landed: () => landed,
    /* This tab has stood down: the screen stops where it is. */
    halt() { halted = true; cancel(timer); off?.(); screen?.notice?.({ stop: true }); },
    state: () => ({ art, world, built, joined: joined(), people: people(), landing, landed }),
  };
}

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
 */
import { nb, worldStatus, worldJoined, retryWorld, onChange } from 'lib/noltbook';

export const PEOPLE_WAIT_MS = 6000;
const TICK_MS = 250;
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
  let settledAt = null, said = undefined, off = null;
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
    if (!screen || halted) return;
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
    const rest = art >= 1 && world && built && joined();
    if (!rest) settledAt = null; else settledAt ??= now();
    let f = 0, words = null;
    for (const [step, share, says] of STEPS) {
      const ok = done[step]();
      f += share * (step === 'art' ? Math.min(1, art) : ok ? 1 : 0);
      if (!ok && !words) words = says;
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
    landed: () => landed,
    /* This tab has stood down: the screen stops where it is. */
    halt() { halted = true; cancel(timer); off?.(); screen?.notice?.({ stop: true }); },
    state: () => ({ art, world, built, joined: joined(), people: people(), landing, landed }),
  };
}

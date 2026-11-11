/* THE MAP PICTURES' QUEUE (2026-11-10, given way 2026-11-11).
 *
 * Every picture is asked for once, whoever asks: a second ask joins the
 * first. Two at a time -- the host's ship sends them one after another
 * anyway, and a browser has only six connections to our ship for everything
 * else -- the ones needed NOW first: the map we are on, or walking into.
 *
 * GIVING WAY. Pictures for later -- the maps ahead (world/ahead) -- go one
 * at a time, only when nothing is needed now, and not while the page holds
 * them: until our movement pass is live, and while we join a call (main.js).
 * Both ride the same two ships as the pictures; neither waits behind them,
 * but on a slow ship or a crowded host they are slowed by them.
 *
 * `fetch(url)` fetches one picture, however long it takes, and resolves
 * with what to draw.
 */
export function createPictureQueue({ fetch, atOnce = 2, aheadAtOnce = 1 }) {
  const pictures = new Map();
  const urgent = [], later = [];
  let fetching = 0, fetchingAhead = 0, held = true, told = false;

  function entry(url) {
    const p = { url, done: null, go: null };
    p.done = new Promise((resolve) => { p.go = resolve; });
    pictures.set(url, p);
    return p;
  }
  function next() {
    while (fetching < atOnce && urgent.length) start(urgent.shift(), false);
    /* For later: only with nothing needed now waiting or on its way. */
    while (!held && !urgent.length && fetching === fetchingAhead && fetchingAhead < aheadAtOnce && later.length) start(later.shift(), true);
  }
  function start(p, ahead) {
    fetching++;
    if (ahead) fetchingAhead++;
    Promise.resolve().then(() => fetch(p.url)).then(p.go, () => p.go(null))
      .finally(() => { fetching--; if (ahead) fetchingAhead--; next(); });
  }
  /* Needed now after all: the map we are walking into. */
  function hurry(p) {
    const i = later.indexOf(p);
    if (i >= 0) { later.splice(i, 1); urgent.unshift(p); next(); }
  }

  return {
    /* A picture, needed now (`first`) or for later. */
    picture(url, first = false) {
      let p = pictures.get(url);
      if (p) { if (first) hurry(p); return p.done; }
      p = entry(url);
      if (first) urgent.unshift(p); else later.push(p);
      next();
      return p.done;
    },
    /* The pictures now ahead, nearest first. Anything waiting that is no
     * longer among them is dropped -- asked for again if it is ever needed --
     * and the rest wait in this order; one on its way, or in, is left be.
     * `got(url, done)` hears of each newly asked for. */
    ahead(urls, got = () => {}) {
      const waiting = new Map(later.splice(0).map((p) => [p.url, p]));
      const want = new Set(urls);
      for (const url of waiting.keys()) if (!want.has(url)) pictures.delete(url);
      for (const url of want) {
        const p = waiting.get(url);
        if (p) { later.push(p); continue; }
        if (pictures.has(url)) continue;
        const fresh = entry(url);
        later.push(fresh);
        got(url, fresh.done);
      }
      next();
    },
    /* The page's say over pictures for later: held (true) or let go. */
    hold(on) {
      told = true;
      if (held === !!on) return;
      held = !!on;
      next();
    },
    /* Let go, if the page has never said (it has nothing to hold them for). */
    unheld() { if (!told) { held = false; next(); } },
    stats: () => ({ fetching, fetchingAhead, urgent: urgent.length, later: later.length, held }),
  };
}

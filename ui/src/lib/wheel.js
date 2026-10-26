/* THE WHEEL AND THE TRACKPAD (2026-10-26).
 *
 * Every scroll event used to be one whole zoom step. A mouse wheel sends one
 * event per notch, so that was right for it; a trackpad sends a stream of tiny
 * ones -- sixty a second, and more as momentum after the fingers lift -- so the
 * smallest gesture flew through every level. Now:
 *
 *   a pinch        (the browser reports it as a wheel with Ctrl held) zooms by
 *                  how far the fingers move, as a pinch on a phone does: the
 *                  wanted scale is followed and the nearest level shown.
 *   two fingers    moving on a trackpad move the map, momentum and all.
 *   a mouse wheel  zooms one level per notch, no faster than WHEEL_STEP_GAP_MS.
 *
 * Fingers and a wheel are told apart the way Mapbox does it: a sideways
 * movement is fingers; a line or page delta, or Chrome-on-macOS's tell-tale
 * 4.000244140625, is a wheel; a delta under 4 pixels is fingers; and anything
 * else waits DECIDE_MS -- a stream of more is fingers, a lone event a notch. The
 * answer holds until a pause (NEW_SERIES_MS) ends the series.
 */
export const PINCH_SCALE = 100;          //  Ctrl+wheel delta per factor of e
export const WHEEL_STEP_GAP_MS = 90;     //  between two notches' steps
export const PINCH_IDLE_MS = 250;        //  a pause that ends a pinch
export const NEW_SERIES_MS = 400;        //  a pause that ends a series
export const DECIDE_MS = 40;             //  how long an ambiguous first event waits
const CHROME_MAC_NOTCH = 4.000244140625;
const LINE_PX = 16;

/* The nearest level, measured as a scale: halfway from 1 to 2 is 1.41, not 1.5. */
export function nearestZoom(want, zooms) {
  if (!(want > 0)) return zooms[0];
  const w = Math.log(want);
  return zooms.reduce((best, z) => (Math.abs(Math.log(z) - w) < Math.abs(Math.log(best) - w) ? z : best), zooms[0]);
}

/* Pixels, whatever unit the browser reported in. */
export function wheelPixels(e, page = 800) {
  const k = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? page : 1;
  return { x: (e.deltaX || 0) * k, y: (e.deltaY || 0) * k };
}

/* What a lone event says for certain, or null. */
export function wheelKind(e) {
  if (e.deltaX) return 'pan';
  if (e.deltaMode !== 0) return 'wheel';
  const v = e.deltaY;
  if (v && v % CHROME_MAC_NOTCH === 0) return 'wheel';
  if (v && Math.abs(v) < 4) return 'pan';
  return null;
}

/* zooms: the levels; zoom(): the current one; setZoom(level); pan(dx, dy) in
 * screen pixels; startPan(): a new run of panning begins. */
export function createWheel({ zooms, zoom, setZoom, pan, startPan = () => {}, now = () => performance.now(),
  later = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) }) {
  let kind = null, last = -Infinity, pending = null, timer = null, stepAt = -Infinity, pinch = null;
  function step(dir) {
    const t = now();
    if (t - stepAt < WHEEL_STEP_GAP_MS) return;
    stepAt = t;
    const i = zooms.indexOf(zoom());
    const next = zooms[Math.max(0, Math.min(zooms.length - 1, (i < 0 ? zooms.indexOf(nearestZoom(zoom(), zooms)) : i) + dir))];
    if (next !== zoom()) setZoom(next);
  }
  function apply(k, d) {
    if (k === 'pan') { if (d.x || d.y) pan(d.x, d.y); return; }
    if (d.y) step(d.y < 0 ? 1 : -1);
  }
  function settle(k) {
    kind = k;
    if (k === 'pan') startPan();
  }
  return {
    handle(e) {
      const t = now(), d = wheelPixels(e), gap = t - last;
      last = t;
      /* A PINCH: follow the scale the fingers ask for. */
      if (e.ctrlKey) {
        if (!pinch || t - pinch.at > PINCH_IDLE_MS) pinch = { start: zoom(), acc: 0, at: t };
        pinch.at = t; pinch.acc += d.y;
        const z = nearestZoom(pinch.start * Math.exp(-pinch.acc / PINCH_SCALE), zooms);
        if (z !== zoom()) setZoom(z);
        return;
      }
      pinch = null;
      if (gap > NEW_SERIES_MS) { kind = null; if (timer != null) { cancel(timer); timer = null; } pending = null; }
      if (kind) {
        /* A sideways move inside what looked like a wheel is fingers after all. */
        if (kind === 'wheel' && d.x) settle('pan');
        apply(kind, d);
        return;
      }
      const sure = wheelKind(e);
      if (sure) {
        settle(sure);
        if (pending) { if (timer != null) { cancel(timer); timer = null; } apply(sure, pending); pending = null; }
        apply(sure, d);
        return;
      }
      if (!pending) {
        pending = d;
        timer = later(() => { timer = null; if (!pending) return; settle('wheel'); apply('wheel', pending); pending = null; }, DECIDE_MS);
        return;
      }
      /* A second event before the wait was out: a stream, or a fast notch. */
      if (timer != null) { cancel(timer); timer = null; }
      settle(Math.abs(gap * d.y) < 200 ? 'pan' : 'wheel');
      apply(kind, pending); pending = null;
      apply(kind, d);
    },
  };
}

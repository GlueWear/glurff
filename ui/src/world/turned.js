/* A TURNED BOX (2026-11-10): a picture placed on a map -- or a piece of
 * drawing being put down -- turned about its middle. `at` is [x, y, w, h],
 * its place as it would be straight; `turn` is degrees, clockwise as the
 * screen shows it (y grows downward), as a canvas and Pixi both turn.
 *
 * Its handles are worked in its own frame -- "local", from its middle, as if
 * straight -- so a turned box resizes the way a straight one does: a corner
 * keeps its shape, a side stretches, and the corner or side across stays put.
 */
export const TURN_SNAP = 15;       //  degrees, with Shift
export const TURN_SETTLE = 4;      //  degrees from straight that settle on it
const rad = (deg) => (deg * Math.PI) / 180;

export const centreOf = ([x, y, w, h]) => [x + w / 2, y + h / 2];
/* Somewhere in its own frame, on the map; and back. */
export function fromLocal(at, turn, lx, ly) {
  const [cx, cy] = centreOf(at), a = rad(turn || 0), c = Math.cos(a), s = Math.sin(a);
  return [cx + lx * c - ly * s, cy + lx * s + ly * c];
}
export function toLocal(at, turn, x, y) {
  const [cx, cy] = centreOf(at), a = rad(-(turn || 0)), c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
  return [dx * c - dy * s, dx * s + dy * c];
}
/* Its corners -- top left, top right, bottom right, bottom left -- and the
 * middles of its sides -- top, right, bottom, left -- on the map. */
export const turnedCorners = (at, turn) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => fromLocal(at, turn, (i * at[2]) / 2, (j * at[3]) / 2));
export const turnedSides = (at, turn) => [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([i, j]) => fromLocal(at, turn, (i * at[2]) / 2, (j * at[3]) / 2));
/* Where its turn handle is: out past its top right corner by `gap`. */
export const turnHandle = (at, turn, gap) => fromLocal(at, turn, at[2] / 2 + gap, -at[3] / 2 - gap);

/* As a shape (world/world-doc ops): its rectangle while straight, else the
 * polygon of its corners. */
export function turnedShape(at, turn) {
  if (!normalTurn(turn)) return { t: 'rect', x: at[0], y: at[1], w: at[2], h: at[3] };
  return { t: 'poly', p: turnedCorners(at, turn).flat() };
}
export const imageShape = (img) => turnedShape(img.at, img.turn);
/* The straight box round it. */
export function turnedBounds(at, turn) {
  const cs = turnedCorners(at, turn), xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
export function inside(at, turn, x, y, pad = 0) {
  const [lx, ly] = toLocal(at, turn, x, y);
  return Math.abs(lx) <= at[2] / 2 + pad && Math.abs(ly) <= at[3] / 2 + pad;
}

/* A turn as kept: more than -180 and at most 180, a tenth of a degree at
 * most, and 0 for straight. */
export function normalTurn(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return 0;
  let t = Math.round((((deg % 360) + 360) % 360) * 10) / 10;
  if (t > 180) t -= 360;
  return t === 0 || t === 360 ? 0 : t;
}
/* A turn as the pointer leaves it: in steps of TURN_SNAP with Shift, and
 * straight when within TURN_SETTLE of a quarter turn. */
export function snapTurn(deg, step = false) {
  if (step) return normalTurn(Math.round(deg / TURN_SNAP) * TURN_SNAP);
  const q = Math.round(deg / 90) * 90;
  return normalTurn(Math.abs(deg - q) <= TURN_SETTLE ? q : deg);
}
/* The turn a drag gives: as it was, plus how far round its middle the
 * pointer has gone since `from`. */
export function turnBy(at, turn, from, to, step = false) {
  const [cx, cy] = centreOf(at);
  const swept = Math.atan2(to.y - cy, to.x - cx) - Math.atan2(from.y - cy, from.x - cx);
  return snapTurn((turn || 0) + (swept * 180) / Math.PI, step);
}

/* Resized by corner `i` (top left, top right, bottom right, bottom left)
 * dragged to p, the corner across from it staying put: in proportion when
 * `keep`, and never smaller than `least` a side. */
export function resizeCorner(at, turn, i, p, keep = true, least = 4) {
  const [w, h] = [at[2], at[3]], sx = i === 1 || i === 2 ? 1 : -1, sy = i >= 2 ? 1 : -1;
  const ax = (-sx * w) / 2, ay = (-sy * h) / 2, [qx, qy] = toLocal(at, turn, p.x, p.y);
  let nw, nh;
  if (keep) {
    const k = Math.max(Math.abs(qx - ax) / w, Math.abs(qy - ay) / h, least / Math.min(w, h));
    nw = w * k; nh = h * k;
  } else { nw = Math.max(least, Math.abs(qx - ax)); nh = Math.max(least, Math.abs(qy - ay)); }
  const dx = qx === ax ? sx : Math.sign(qx - ax), dy = qy === ay ? sy : Math.sign(qy - ay);
  return placed(at, turn, ax + (dx * nw) / 2, ay + (dy * nh) / 2, nw, nh);
}
/* Resized by side `i` (top, right, bottom, left) dragged to p: that side
 * alone moves, the one across stays, and it is never thinner than `least`. */
export function resizeSide(at, turn, i, p, least = 4) {
  const [w, h] = [at[2], at[3]], [qx, qy] = toLocal(at, turn, p.x, p.y);
  if (i === 1 || i === 3) {
    const s = i === 1 ? 1 : -1, ax = (-s * w) / 2, nw = Math.max(least, s * (qx - ax));
    return placed(at, turn, ax + (s * nw) / 2, 0, nw, h);
  }
  const s = i === 2 ? 1 : -1, ay = (-s * h) / 2, nh = Math.max(least, s * (qy - ay));
  return placed(at, turn, 0, ay + (s * nh) / 2, w, nh);
}
/* A box of w x h whose middle is (lx, ly) in at's own frame, as a place. */
function placed(at, turn, lx, ly, w, h) {
  const [cx, cy] = fromLocal(at, turn, lx, ly);
  return [cx - w / 2, cy - h / 2, w, h];
}

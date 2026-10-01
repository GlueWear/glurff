/* PLAYING ON A PHONE: the arithmetic behind the touch controls.
 *
 *   the joystick   a thumb's offset from the stick's centre is a direction to
 *                  walk in. A little play in the middle does nothing, so a
 *                  resting thumb does not wander; pushed to the rim, we run --
 *                  the double-tap of the keyboard.
 *   two fingers    drag together to look around; pinch to zoom, in the same
 *                  whole steps the wheel uses, so pixels stay square.
 *   one finger     a tap -- a touch that neither moves nor lingers -- is what a
 *                  double-click is with a mouse: open somebody, open a spot,
 *                  read a clock; with a weapon out, attack there.
 *
 * Pure: the DOM and the game wire it up (ui/touch-controls, world/game).
 */

/* Of the stick's reach: inside this, nothing; past RUN_AT, running. */
export const STICK_DEAD = 0.2;
export const STICK_RUN_AT = 0.9;
/* A tap may wander this far, and last this long, and still be a tap. */
export const TAP_SLOP_PX = 12;
export const TAP_MS = 500;
/* Two fingers move the world this much faster than they move: a phone is
 * small, and crossing a room should not take a dozen swipes. */
export const TOUCH_PAN_SPEED = 1.5;

/* A thumb (dx, dy) from the centre of a stick that reaches `radius`: where the
 * knob is drawn (held inside the rim), and which way to walk -- a unit vector,
 * or null inside the dead zone. */
export function stickVector(dx, dy, radius) {
  const d = Math.hypot(dx, dy);
  if (!(radius > 0) || !Number.isFinite(d)) return { knob: { x: 0, y: 0 }, walk: null };
  const reach = Math.min(1, d / radius);
  const knob = d > radius ? { x: (dx / d) * radius, y: (dy / d) * radius } : { x: dx, y: dy };
  if (reach < STICK_DEAD) return { knob, walk: null };
  return { knob, walk: { x: dx / d, y: dy / d, run: reach >= STICK_RUN_AT } };
}

/* The zoom a pinch asks for: the zoom it started at, scaled by how far the
 * fingers have spread, snapped to the nearest step -- measured by ratio, so
 * the half step and the whole ones are as easy to reach as the rest. */
export function pinchZoom(startZoom, startSpread, spread, zooms) {
  if (!(startSpread > 0) || !(spread > 0)) return startZoom;
  const want = Math.log(startZoom * (spread / startSpread));
  return zooms.reduce((best, z) => (Math.abs(Math.log(z) - want) < Math.abs(Math.log(best) - want) ? z : best), zooms[0]);
}

/* Two or more fingers: where their middle is, and how far apart the first two are. */
export function spreadOf(points) {
  const list = [...points];
  if (!list.length) return { x: 0, y: 0, spread: 0 };
  const x = list.reduce((s, p) => s + p.x, 0) / list.length;
  const y = list.reduce((s, p) => s + p.y, 0) / list.length;
  const spread = list.length > 1 ? Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) : 0;
  return { x, y, spread };
}

/* Was this a tap: down and up at about the same place, quickly? */
export function isTap(down, up) {
  return !!down && !!up && Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP_PX && up.at - down.at <= TAP_MS;
}

/* How much of the layout the on-screen keyboard covers: the page's height less
 * the part of it still visible. iOS leaves the page its full height and only
 * shrinks what is seen, so anything pinned to the bottom must rise by this. */
export function keyboardCover(innerHeight, viewport) {
  if (!viewport) return 0;
  const cover = innerHeight - viewport.height - viewport.offsetTop;
  return cover > 40 ? Math.round(cover) : 0;
}

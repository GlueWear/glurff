/* WHERE A CHARACTER WANDERS (2026-11-08), worked out the same in every
 * browser from its id and the clock alone, so everybody sees it in the same
 * place with no ship saying where it is.
 *
 * A character that wanders has a few spots about its home -- anywhere in
 * the box its host drew for it (`box`, 2026-11-08), or else near home in the
 * area it stands in -- each one it can walk straight to from home. Time is cut into turns; every turn picks one of them from the
 * id and the turn's number, and the character strolls there from where the
 * last turn left it: straight, if nothing is in the way, or by way of home.
 * Then it stands until the next turn. */
export const TURN_MS = 9000;
const SPOTS = 6, REACH = 7, STEP = 0.25;

/* A small, good-enough mixing of a string and a number into 0..1. */
export function chance(text, n) {
  let h = 2166136261 ^ n;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* Whether somebody can walk straight from a to b: no wall along the way,
 * and never leaving the region (`inside`). */
export function clear(a, b, solid, inside = () => true) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / STEP));
  for (let i = 1; i <= n; i++) {
    const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
    if (solid(x, y) || !inside(x, y)) return false;
  }
  return true;
}

/* id: the character's; home {x, y} in units; solid(x, y); inside(x, y):
 * still where it may go; box: [x0, y0, x1, y1] in units, or null; speed:
 * units a second it strolls at. */
export function wanderRoute({ id, home, solid, inside = () => true, box = null, speed = 1.5 }) {
  const spots = [home];
  for (let tries = 0; tries < 80 && spots.length < SPOTS + 1; tries++) {
    const a = chance(id, 1000 + tries) * Math.PI * 2, r = 1 + chance(id, 2000 + tries) * (REACH - 1);
    const p = box ? { x: box[0] + chance(id, 1000 + tries) * (box[2] - box[0]), y: box[1] + chance(id, 2000 + tries) * (box[3] - box[1]) }
      : { x: home.x + Math.cos(a) * r, y: home.y + Math.sin(a) * r };
    if (!solid(p.x, p.y) && inside(p.x, p.y) && clear(home, p, solid, inside)) spots.push(p);
  }
  if (spots.length < 2) return null;
  const spotOf = (turn) => spots[Math.floor(chance(id, turn) * spots.length)];
  const pathOf = (from, to) => (clear(from, to, solid, inside) ? [from, to] : [from, home, to]);
  return {
    spots,
    /* Where it is at `ms` (the clock's milliseconds): {x, y, moving, dir}. */
    at(ms) {
      const turn = Math.floor(ms / TURN_MS), path = pathOf(spotOf(turn - 1), spotOf(turn));
      const legs = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, p.y - path[i].y));
      const length = legs.reduce((a, b) => a + b, 0);
      /* A long way is walked a little faster, so it is there before the next turn. */
      const pace = Math.max(speed, length / (0.8 * TURN_MS / 1000));
      let gone = ((ms - turn * TURN_MS) / 1000) * pace;
      if (gone >= length) { const end = path[path.length - 1]; return { x: end.x, y: end.y, moving: false, dir: null }; }
      for (let i = 0; i < legs.length; i++) {
        if (gone > legs[i]) { gone -= legs[i]; continue; }
        const a = path[i], b = path[i + 1], k = legs[i] ? gone / legs[i] : 1;
        const dx = b.x - a.x, dy = b.y - a.y;
        return { x: a.x + dx * k, y: a.y + dy * k, moving: true,
          dir: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down') };
      }
      const end = path[path.length - 1];
      return { x: end.x, y: end.y, moving: false, dir: null };
    },
  };
}

/* Which way to look at somebody from (x, y). */
export const faceTowards = (from, to) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
};

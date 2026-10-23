/* THE CALL COLUMN (2026-10-20). On a desktop, everybody in the call -- and a
 * jukebox or a screen popped out of the world -- stands in one column down
 * the left, top to bottom, scrolling when there are too many. A phone keeps
 * the strip across the top: a column would cover too much of a narrow screen.
 *
 * EACH ITS OWN SIZE (2026-10-22). One width for the whole column made every
 * tile grow at once; now a press and a drag sizes the one under the hand, and
 * a double-click on any corner square puts them all back (resetTileSizes).
 */
export const COLUMN_MIN = 120, COLUMN_MAX = 420, COLUMN_START = 180;
/* The same test the stylesheet uses for a phone (or a phone on its side). */
const PHONE = '(max-width: 700px), (max-height: 500px)';
export const columnMode = () => !(typeof matchMedia === 'function' && matchMedia(PHONE).matches);
export const clampColumn = (w) => Math.round(Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Number(w) || COLUMN_START)));
/* What a tile starts at, and goes back to: the column's width on a desktop,
 * small on a phone, where the world is small too. */
export const defaultTileWidth = () => columnMode() ? COLUMN_START : 96;
/* As wide as one may be dragged in the column: nearly the whole window
 * (2026-10-22; it used to stop at COLUMN_MAX). The column grows to the widest. */
export const maxColumnTile = () => Math.max(COLUMN_MIN, (globalThis.innerWidth ?? 1440) - 40);
/* A window dragged across the line, or a phone turned: the tiles were sized
 * for the other layout. */
export function onColumnMode(fn) {
  const mq = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;
  mq?.addEventListener?.('change', () => fn(columnMode()));
}

/* EVERY TILE BACK TO ITS NORMAL SIZE: the call's feeds (ui/rail) and the
 * popped-out players (ui/media-surfaces) each listen. */
const RESET = 'glurff-tile-sizes-reset';
export const resetTileSizes = () => window.dispatchEvent(new Event(RESET));
export const onTileReset = (fn) => window.addEventListener(RESET, fn);

/* DRAGGED TO SIZE. Sideways from where the press began; nothing happens until
 * it has moved DRAG_START_PX, so a press that stays put is still a click.
 *
 * The drag listens to the WINDOW. The strip repaints and reorders its tiles
 * several times a second in a call, and an element moved under the pointer
 * loses the pointer's capture -- the drag then never heard the button come up,
 * and the tile went on following the mouse with nothing pressed. It ends on a
 * release, a cancel (a finger that turns out to be scrolling), or a move with
 * no button down at all. */
const DRAG_START_PX = 4;
export function dragToSize(e, { width, set, min = 96, max = () => Infinity }) {
  const id = e.pointerId, x0 = e.clientX;
  let moving = false;
  const end = (ev) => {
    if (ev && ev.pointerId !== id) return;
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
  };
  const move = (ev) => {
    if (ev.pointerId !== id) return;
    if (ev.buttons === 0) { end(); return; }
    if (!moving && Math.abs(ev.clientX - x0) < DRAG_START_PX) return;
    moving = true;
    set(Math.round(Math.max(min, Math.min(max(), width + ev.clientX - x0))));
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
}

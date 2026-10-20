/* THE CALL COLUMN (2026-10-20). On a desktop, everybody in the call -- and a
 * jukebox or a screen popped out of the world -- stands in one column down
 * the left, top to bottom, scrolling when there are too many. One width for
 * all of it, dragged from any tile's corner and kept in this browser. A phone
 * keeps the strip across the top: a column would cover too much of a narrow
 * screen. */
export const COLUMN_MIN = 120, COLUMN_MAX = 420, COLUMN_START = 180;
const KEY = 'glurff-call-column';
/* The same test the stylesheet uses for a phone (or a phone on its side). */
const PHONE = '(max-width: 700px), (max-height: 500px)';
export const columnMode = () => !(typeof matchMedia === 'function' && matchMedia(PHONE).matches);
export const clampColumn = (w) => Math.round(Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, Number(w) || COLUMN_START)));
let width = (() => {
  try { const saved = Number(localStorage.getItem(KEY)); return saved ? clampColumn(saved) : COLUMN_START; } catch { return COLUMN_START; }
})();
export const columnWidth = () => width;
export function applyColumnWidth(strip = document.getElementById('strip')) {
  strip?.style.setProperty('--strip-w', `${width}px`);
}
export function setColumnWidth(w, strip = document.getElementById('strip')) {
  width = clampColumn(w);
  applyColumnWidth(strip);
  try { localStorage.setItem(KEY, String(width)); } catch {}
}
/* A window dragged across the line, or a phone turned: the tiles were sized
 * for the other layout. */
export function onColumnMode(fn) {
  const mq = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;
  mq?.addEventListener?.('change', () => fn(columnMode()));
}

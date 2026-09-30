/* THE ONE WAY TEXT GOES INTO HTML.
 *
 * Anything another ship can influence -- a display name, a note's name, an
 * error a host sent us, a room name from somebody's map -- is escaped before
 * it goes near innerHTML, or it can put script into everybody's page. Every
 * UI module uses this one helper rather than its own copy, so there is one
 * thing to get right. Quotes are escaped too, so it is safe inside attribute
 * values as well as text. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

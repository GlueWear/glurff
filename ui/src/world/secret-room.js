/* THE WAY INTO VATICAN CITY (2026-10-31).
 *
 * Said, not walked: "vatican city" in the Game Room's chat takes whoever says
 * it there. It replaces the old walk -- two circuits of the pool table, then
 * the plant -- which no longer opens anything. Like the Library's secret
 * (lib/unlock) the phrase is never sent as a message, and it moves only the
 * person who typed it, never anybody reading.
 *
 * The whole message, however it is cased, with spaces round it trimmed and
 * runs of them inside counted as one. A longer message that merely contains
 * the words is ordinary chat.
 */
export const VATICAN_ROOM = 'game';
export const VATICAN_PHRASE = 'vatican city';

export const isVaticanPhrase = (text) =>
  String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ') === VATICAN_PHRASE;

/* Said where it counts: `room` is the room's slug (world/places). */
export const opensVatican = (text, room) => room === VATICAN_ROOM && isVaticanPhrase(text);

/* Where you come back to from Vatican City: the Game Room, under the plant. */
export const MAIN_RETURN = { x: 44.6, y: 27.75, dir: 'left' };

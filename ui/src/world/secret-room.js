/* PHRASES THAT TAKE YOU SOMEWHERE (2026-10-31; any world's, 2026-11-05).
 *
 * Said, not walked: a portal whose trigger is a phrase takes whoever says it
 * in its area's chat to the portal's arrival. The official world's is "vatican
 * city", in the Game Room. It replaced the old walk -- two circuits of the
 * pool table, then the plant -- which no longer opens anything. Like the
 * Library's secret (lib/unlock) the phrase is never sent as a message, and it
 * moves only the person who typed it, never anybody reading.
 *
 * The whole message counts, however it is cased, with spaces round it trimmed
 * and runs of them inside counted as one. A longer message that merely
 * contains the words is ordinary chat. The portals themselves are the
 * world's document's (world/places).
 */
export { phrasePortal } from './places.js';

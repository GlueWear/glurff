/* ONLINE OR OFFLINE (2026-11-10): one rule for any Glurff we know of.
 *
 * Online is its host answering with it published. Offline is everything
 * else: its host saying it is taken down (or hosts none any more), or no
 * answer within CARD_WAIT_MS -- which is all a ship that is down can give,
 * since it can say nothing. Both are said the one way, "This Glurff is
 * offline", greyed where it is listed, with another try where it is visited.
 *
 * The wait is the one every question about a Glurff has: its card is one
 * small answer, which a ship that is up gives in about a second, and one that
 * is busy within a pause of its own (ships here have paused for 25 s).
 */
export const CARD_WAIT_MS = 20000;
export const OFFLINE = 'This Glurff is offline';

/* An answer as kept -- {card}, card undefined when none came in time -- or,
 * not asked yet this visit, what we knew last (`was`: true for offline). */
export function isOffline(answer, was = false) {
  if (!answer) return !!was;
  return !answer.card?.live;
}

/* Why, in a sentence, where there is room for one. */
export function whyOffline({ card, name, host, own = false }) {
  if (card === undefined) return `${host} did not answer. Its ship may be down.`;
  if (own) return 'It is not published. Publish it from the editor to open it.';
  return `${name || `${host}'s Glurff`} has been taken down by its host for now.`;
}

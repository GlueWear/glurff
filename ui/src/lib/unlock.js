/* THE LIBRARY'S SECRET (2026-10-12).
 *
 * Weapons, mounts, companions and the ready-made characters are seen by
 * everybody -- and anybody hit falls down -- but they are CHOSEN only by a
 * player who has unlocked them: by going into the Library and saying, in its
 * chat, "argumentum ad baculum", the appeal to the stick. The phrase is not
 * sent as a message. Our own agent remembers (its sprite-lab switch, which
 * Dojo can still turn off), so it follows us to any browser.
 */
export const UNLOCK_ROOM = 'library';
export const UNLOCK_PHRASE = 'argumentum ad baculum';

/* The phrase, however it is typed: any case, any spacing, any punctuation. */
export const isUnlockPhrase = (text) =>
  String(text ?? '').toLowerCase().replace(/[^a-z]+/g, ' ').trim() === UNLOCK_PHRASE;

/* Said where it counts: `room` is the room's slug (world/places). */
export const unlocks = (text, room) => room === UNLOCK_ROOM && isUnlockPhrase(text);

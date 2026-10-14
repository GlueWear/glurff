/* WHAT MAY BE DONE WITH A MESSAGE, apart from the page (ui/messages) so it
 * can be tested on its own (2026-10-13). */
import { parseReceipt, shipLike } from './nock-receipt.js';

/* WHAT MAY BE DONE WITH A LINE, decided as Noltbook decides it:
 *   reply    anything with an id to reply to
 *   edit     our own, unless imported or a payment message
 *   send     somebody else's, if they are a ship
 *   delete   our own; in a hosted group or notebook, the host may too
 * `note` is the Noltbook note (null for a room's session chat); nothing at
 * all for an anonymous chat, or a line not yet confirmed. */
export function messageActions(line, { our, note = null, anonymous = false }) {
  if (anonymous || !line || line.pending || !line.replyId) return [];
  const mine = line.author === our;
  const hosted = note && (note.type === 'group' || note.type === 'notebook');
  const out = ['reply'];
  if (mine && !line.imported && !parseReceipt(line.text)) out.push('edit');
  if (!mine && shipLike(line.author)) out.push('send');
  if (!line.imported && (mine || (hosted && note.creator === our))) out.push('delete');
  return out;
}

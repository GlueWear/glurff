/* PAYMENT MESSAGES, as Noltbook writes and reads them (2026-10-13).
 *
 * A send leaves a message behind -- in the chat it was sent from, or in a DM
 * with whoever was paid -- and that message is Noltbook's, word for word
 * (lib/noltbook/index.html, walletSend and renderMsgBody):
 *
 *   $$NOCK_SEND$$ sent 5.0000 $NOCK to ~sampel-palnet (tx:0123456789ab...)
 *
 * It is SHOWN as "sent 5.0000 $NOCK to Name", or "sent you 5.0000 $NOCK" to
 * the one paid, in green. Anything that merely starts with the marker but does
 * not fit this exact grammar is an ordinary message, shown as typed.
 */
export const NOCK_SEND_PREFIX = '$$NOCK_SEND$$';
const RECEIPT = /^sent (\d{1,15}\.\d{4}) \$NOCK to (~[a-z-]{3,60})(?: \(tx:([0-9a-zA-Z_-]{1,32})\.\.\.\))?$/;

/* A ship's name, by shape: a galaxy, a star, a planet, a moon, a comet. */
export const shipLike = (s) => typeof s === 'string' && /^~(?:[a-z]{3}|[a-z]{6}(?:-{1,2}[a-z]{6}){0,7})$/.test(s);

/* A transaction id we can keep: non-empty, short, nothing unprintable. */
export function usableTxId(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s.length > 128 || /[\u0000-\u001f\u007f]/.test(s)) return '';
  return s;
}

/* What a send says, given the amount as typed (a number) and who was paid. */
export const nockAmount = (n) => Number(n).toFixed(4);
export const receiptText = (amount4, ship, txHash = '') =>
  `${NOCK_SEND_PREFIX} sent ${amount4} $NOCK to ${ship}${txHash ? ` (tx:${String(txHash).slice(0, 12)}...)` : ''}`;

/* {amount, ship, tx} for a well-formed payment message, else null. */
export function parseReceipt(text) {
  if (typeof text !== 'string' || !text.startsWith(NOCK_SEND_PREFIX)) return null;
  const m = RECEIPT.exec(text.slice(NOCK_SEND_PREFIX.length).trim());
  if (!m || !shipLike(m[2])) return null;
  return { amount: m[1], ship: m[2], tx: m[3] ?? null };
}

/* How it reads, as words: null for anything that is not a payment message. */
export function receiptWords(text, our, name = (s) => s) {
  const r = parseReceipt(text);
  if (!r) return null;
  return r.ship === our ? `sent you ${r.amount} $NOCK` : `sent ${r.amount} $NOCK to ${name(r.ship)}`;
}

/* "5.0000" as a prize: "5"; "0.2500": "0.25". */
export const shortAmount = (a) => {
  const s = String(a);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
};
/* An amount as a world event carries it: four places, nothing else. */
export const validAmount = (a) => typeof a === 'string' && /^\d{1,15}\.\d{4}$/.test(a) && Number(a) > 0;

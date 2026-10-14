/* Sending $NOCK, straight to the Iris wallet.
 *
 * SEND used to open Noltbook in a second window and drive its wallet panel.
 * That is a whole other application on screen for one transaction. Iris is a
 * browser extension: it is in THIS page already, and it puts up its own
 * approval window, which is the only confirmation that should exist -- Glurff
 * never sees a key and never holds a balance.
 *
 * Nothing about Noltbook changes. What we read from it is what it already
 * publishes: the recipient's wallet address, a field of their Noltbook
 * profile, and whether YOUR wallet is connected there, which it keeps under
 * `noltbook_wallet` in this same origin's localStorage. What we tell it is
 * what its own page tells it after a send (2026-10-13; lib/noltbook/index.html
 * walletSend): the send, for its activity list and the one paid
 * ('nock-send-confirmed'), and a payment message (lib/nock-receipt) -- in a DM
 * with them, or in the chat the send was made from.
 *
 * The envelope is Noltbook's own, field for field (buildWalletSendEnvelope):
 * api 1.0.0, object params. Iris 1.3 and later work out the fee themselves
 * and show it for approval, so the fee is left out; an older Iris cannot, and
 * is given the fixed 5 NOCK Noltbook gives it.
 */
import { nb, displayName, nbAction, openDm, dmWith } from 'lib/noltbook';
import { nockAmount, receiptText, usableTxId } from 'lib/nock-receipt';

export const NICKS_PER_NOCK = 65536;         //  1 NOCK = 2^16 nicks
const API = '1.0.0';                         //  Iris RPC api version
export const FIXED_FEE_NICKS = 5 * NICKS_PER_NOCK;   //  for an Iris older than 1.3
const NOLTBOOK_WALLET_KEY = 'noltbook_wallet';

/* Is the extension in this browser at all? */
export const irisPresent = () =>
  !!(window.nockchain && typeof window.nockchain.request === 'function');

/* Does this Iris work out its own fee? 1.3.0 is the first that does, and the
 * first whose provider says which api it speaks. */
export function versionAtLeast(v, min) {
  const a = String(v || '').split('.').map((n) => parseInt(n, 10) || 0), b = min.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}
export function irisCalculatesFee() {
  const p = (typeof window !== 'undefined' && window.nockchain) || {};
  return typeof p.api === 'string' || versionAtLeast(p.version, '1.3.0');
}

/* Is a wallet connected in Noltbook -- same browser, same origin, the state
 * Noltbook itself saved. We only read it. */
export function noltbookWallet() {
  try {
    const raw = window.localStorage?.getItem(NOLTBOOK_WALLET_KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return saved?.pkh ? saved : null;
  } catch { return null; }
}

export const walletAddressOf = (ship) => nb.profiles[ship]?.walletAddress || null;

/* Why a send cannot be offered, in a sentence, or null if it can. */
export function sendBlocked(ship) {
  if (!irisPresent()) return 'The Iris wallet extension is not in this browser.';
  if (!noltbookWallet()) return 'Connect your Iris wallet in Noltbook first.';
  if (!walletAddressOf(ship))
    return `${displayName(ship)} has no wallet address in their Noltbook profile.`;
  return null;
}

/* The request Iris is handed: Noltbook's exactly. */
export function sendEnvelope(to, nicks) {
  return { method: 'nock_sendTransaction', api: API, timeout: 120000,
    params: irisCalculatesFee() ? { to, amount: nicks } : { to, amount: nicks, fee: FIXED_FEE_NICKS } };
}

const nicksOf = (amount) => {
  const nock = Number(amount);
  if (!Number.isFinite(nock) || nock <= 0) throw new Error('Enter an amount to send.');
  const nicks = Math.floor(nock * NICKS_PER_NOCK);
  if (nicks < 1) throw new Error('That is less than one nick.');
  return nicks;
};
const formatNock = (nicks) => (Number(nicks) / NICKS_PER_NOCK).toFixed(4);

/* WHAT THE NETWORK WILL CHARGE, before anything is sent: Iris builds the
 * transaction without sending it and says (nock_buildSimpleTransaction, read
 * only, no window). {text} to show; {locked} when Iris must be unlocked to
 * say; {busy} when it asks us to try again in a moment. */
export async function previewFee(ship, amount) {
  if (sendBlocked(ship)) return { text: '' };
  let nicks; try { nicks = nicksOf(amount); } catch { return { text: '' }; }
  if (!irisCalculatesFee())
    return { text: `Network fee: ${formatNock(FIXED_FEE_NICKS)} NOCK (fixed: update Iris to 1.3 for an exact fee)` };
  try {
    const b = await window.nockchain.request({ method: 'nock_buildSimpleTransaction', api: API,
      params: { to: walletAddressOf(ship), amount: nicks }, timeout: 30000 });
    const fee = b?.fee != null ? Number(b.fee) : NaN, min = b?.minimumFee != null ? Number(b.minimumFee) : NaN;
    if (!Number.isFinite(fee)) return { text: '' };
    return { text: `Network fee: ${formatNock(fee)} NOCK${Number.isFinite(min) && min !== fee ? ` (minimum ${formatNock(min)})` : ''}: Iris confirms the final amount` };
  } catch (e) {
    if (e?.code === -32005) return { busy: true, text: '' };
    const m = e?.message || e?.data?.message || '';
    /* Iris locks itself after a while, and this read-only check cannot ask
     * to be let in -- so offer to. */
    if (/locked/i.test(String(m)) || /locked/i.test(String(e?.code))) return { locked: true, text: 'Wallet locked: unlock it to see the fee.' };
    return { text: `Fee estimate unavailable${m && m !== '[object Object]' ? `: ${m}` : ''}`, error: true };
  }
}
/* Raise Iris's own unlock window. */
export const unlockIris = () => window.nockchain.request({ method: 'nock_connect', api: API, timeout: 120000 }).catch(() => {});

/* Hand the transaction to Iris. IT asks the person to approve it; this
 * resolves with {txHash, nicks, amount} -- the amount as the payment message
 * gives it, four places -- or throws (code 4001: they said no). */
export async function sendNock(ship, amount) {
  const blocked = sendBlocked(ship);
  if (blocked) throw new Error(blocked);
  const nicks = nicksOf(amount);
  /* Connecting is what raises the extension's window the first time; it is
   * cheap and idempotent afterwards. */
  await window.nockchain.request({ method: 'nock_connect', api: API, timeout: 30000 });
  const r = await window.nockchain.request(sendEnvelope(walletAddressOf(ship), nicks));
  return { txHash: txHash(r), nicks, amount: nockAmount(amount) };
}

/* Iris has returned several shapes for this; take whichever one it gives. */
function txHash(r) {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object')
    for (const k of ['txid', 'txId', 'txHash', 'id', 'hash']) if (r[k]) return r[k];
  return null;
}

/* A SENT payment, told to Noltbook as its own page tells it: for our activity
 * list, and so the one paid is told too. Without a usable id there is nothing
 * to record. True once handed over. */
export async function recordSend(ship, nicks, tx) {
  const id = usableTxId(tx);
  if (!id) return false;
  await nbAction('nock-send-confirmed', { to: ship, amount: nicks, txHash: id });
  return true;
}

/* THE PAYMENT MESSAGE. `at` is where:
 *   {dm: true}                 a DM with whoever was paid (the profile card)
 *   {noteId, replyToEid}       a saved chat, as a reply to the message paid for
 *   {room: (text) => Promise}  a room's session chat */
export async function postReceipt({ ship, amount, txHash: tx, at }) {
  const text = receiptText(amount, ship, usableTxId(tx));
  if (at?.room) return at.room(text);
  if (at?.noteId) return nbAction('send-message',
    { noteId: at.noteId, text, ...(at.replyToEid ? { replyToEid: at.replyToEid } : {}), directedKind: 'send' });
  /* The DM we have with them, as Noltbook finds it, or a new one. */
  const noteId = dmWith(ship)?.id ?? await openDm(ship);
  if (!noteId) throw new Error('No DM with them.');
  return nbAction('send-message', { noteId, text });
}

/* A SEND, start to finish: Iris, then Noltbook's record and the payment
 * message. The money has moved once Iris says so; what follows can fail
 * without undoing it, and says so instead. */
export async function pay({ ship, amount, at }) {
  const sent = await sendNock(ship, amount);
  let recorded = false, posted = false;
  try { recorded = await recordSend(ship, sent.nicks, sent.txHash); } catch {}
  try { await postReceipt({ ship, amount: sent.amount, txHash: sent.txHash, at }); posted = true; } catch {}
  return { ...sent, recorded, posted };
}

/* What a failed send says. */
export const sendError = (e) => (e?.code === 4001 ? 'Transaction cancelled.' : e?.data?.message || e?.message || 'Send failed.');

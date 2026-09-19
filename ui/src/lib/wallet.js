/* Sending $NOCK, straight to the Iris wallet.
 *
 * SEND used to open Noltbook in a second window and drive its wallet panel.
 * That is a whole other application on screen for one transaction. Iris is a
 * browser extension: it is in THIS page already, and it puts up its own
 * approval window, which is the only confirmation that should exist -- Glurff
 * never sees a key and never holds a balance.
 *
 * Nothing about Noltbook changes. The two things we read from it are the
 * things it already publishes: the recipient's wallet address, which is a
 * field of their Noltbook profile, and whether YOUR wallet is connected there,
 * which it keeps under `noltbook_wallet` in this same origin's localStorage.
 *
 * The envelope is Noltbook's own, field for field (lib/noltbook/index.html,
 * buildWalletSendEnvelope): api 1.0.0, object params, a fee in nicks, never
 * zero. A send built differently is a send Iris may read differently.
 */
import { nb, displayName } from 'lib/noltbook';

export const NICKS_PER_NOCK = 65536;         //  1 NOCK = 2^16 nicks
const API = '1.0.0';                         //  Iris RPC api version
const FEE_NICKS = 5 * NICKS_PER_NOCK;        //  the fixed 5 NOCK fee Noltbook sends
const NOLTBOOK_WALLET_KEY = 'noltbook_wallet';

/* Is the extension in this browser at all? */
export const irisPresent = () =>
  !!(window.nockchain && typeof window.nockchain.request === 'function');

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

/* Hand the transaction to Iris. IT asks the person to approve it; this
 * resolves with whatever it calls the transaction afterwards. */
export async function sendNock(ship, amount) {
  const blocked = sendBlocked(ship);
  if (blocked) throw new Error(blocked);
  const nock = Number(amount);
  if (!Number.isFinite(nock) || nock <= 0) throw new Error('Enter an amount to send.');
  const nicks = Math.floor(nock * NICKS_PER_NOCK);
  if (nicks < 1) throw new Error('That is less than one nick.');
  const to = walletAddressOf(ship);

  /* Connecting is what raises the extension's window the first time; it is
   * cheap and idempotent afterwards. */
  await window.nockchain.request({ method: 'nock_connect', api: API, timeout: 30000 });
  const r = await window.nockchain.request({
    method: 'nock_sendTransaction', api: API,
    params: { to, amount: nicks, fee: FEE_NICKS },
    timeout: 120000,
  });
  return txHash(r);
}

/* Iris has returned several shapes for this; take whichever one it gives. */
function txHash(r) {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object')
    for (const k of ['txid', 'txId', 'txHash', 'id', 'hash']) if (r[k]) return r[k];
  return null;
}

/* Our own posts, shown the moment they are sent.
 *
 * A post is drawn grey until our ship reports it saved and sent, then in the
 * normal colour until the real message arrives and takes its place. "Sent" is
 * the most Noltbook can tell us for a gossip post or a rumor: it does not
 * report when other ships receive one.
 *
 * The real message is recognised by the eid Noltbook returns for the post.
 * Rumors have none -- they are identified by their text, and an identical
 * rumor is stored only once -- so for those the text is what matches.
 *
 * HOW A SEND IS GOING (2026-10-22, as Noltbook's own client now shows it):
 *   sending   grey: not confirmed yet.
 *   slow      amber, "not sent yet": still unconfirmed after SLOW_MS -- or,
 *             where the post must come back from another ship (a note that
 *             ship hosts; a DM), confirmed but not back yet. It turns normal
 *             by itself when it lands.
 *   failed    red, with Retry: our ship refused it, so nothing was stored and
 *             sending again cannot make a second copy -- or nothing at all has
 *             been heard of it for GIVE_UP_MS.
 * A send whose answer never came (a timeout) may still have been stored, so
 * it is not offered again before GIVE_UP_MS: post-message takes no message id
 * of ours yet, so retrying a post that was stored would store it twice.
 */
export const SLOW_MS = 8000, GIVE_UP_MS = 120000;
/* How long a line that never resolves stays on screen. */
const KEEP_UNSETTLED_MS = 30 * 60000;

export function createPending({ now = Date.now, keepMs = 300000 } = {}) {
  const posts = new Map();
  let next = 0, revision = 0;
  const count = (messages, text) => messages.reduce((n, m) => n + (m?.text === text ? 1 : 0), 0);
  function arrived(p, messages) {
    // A remote group host replaces the sender's provisional EID. Its exact
    // original @da message ID and author survive that trip; text is not an ID.
    if (p.forwarded && p.msgId && p.author && messages.some(m =>
      m.author === p.author && m.msgIdRaw === p.msgId)) return true;
    if (p.eid) return messages.some((m) => m?.meta?.eid === p.eid);
    if (!p.byText) return false;
    const n = count(messages, p.text);
    return n > p.before || (p.sent && n > 0);
  }
  function stateOf(p, t = now()) {
    if (p.refused) return 'failed';
    if (!p.sent) return t - p.at >= GIVE_UP_MS ? 'failed' : t - p.at >= SLOW_MS ? 'slow' : 'sending';
    if (p.forwarded || p.untilArrival) return t - p.sentAt >= SLOW_MS ? 'slow' : 'sending';
    return 'sent';
  }
  /* Gone from the screen: arrived, or long enough without an answer. */
  function expired(p, t) {
    if (p.sent && !p.forwarded && !p.untilArrival) return t - p.sentAt > keepMs;
    return t - p.at > KEEP_UNSETTLED_MS;
  }
  return {
    /* `before` is what the note held when we posted, so an older identical
     * rumor is not mistaken for this one. `untilArrival`: stays grey after our
     * ship confirms it, until the real message is back (a DM). */
    add(note, text, parent = null, before = [], { byText = false, author = null, untilArrival = false } = {}) {
      const id = `pending:${++next}`;
      posts.set(id, { id, note, text, parent, author, at: now(), sent: false, sentAt: 0, eid: null, byText, untilArrival,
        refused: false, before: count(before, text) });
      revision++;
      return id;
    },
    sent(id, result) {
      const p = posts.get(id);
      if (!p) return;
      p.sent = true; p.sentAt = now();
      p.eid = typeof result?.eid === 'string' && result.eid ? result.eid : null;
      p.forwarded = result?.code === 'forwarded';
      p.msgId = typeof result?.msgId === 'string' ? result.msgId : null;
      revision++;
    },
    /* Our ship said no: nothing was stored. */
    refused(id) { const p = posts.get(id); if (p) { p.refused = true; revision++; } },
    /* No answer came. It may yet arrive, so it is still looked for -- by its
     * text, since no eid came back to look for. */
    unconfirmed(id) { const p = posts.get(id); if (p) { p.byText = true; revision++; } },
    /* Off the screen: dismissed, or about to be sent again. */
    drop(id) { if (posts.delete(id)) revision++; },
    get: (id) => posts.get(id) ?? null,
    /* The clock moved a line on (sending to slow, slow to failed). */
    tick() { revision++; },
    /* How long until some line changes by itself; null if none will. */
    wakeIn(t = now()) {
      let soonest = null;
      const at = (when) => { if (when > t && (soonest === null || when - t < soonest)) soonest = when - t; };
      for (const p of posts.values()) {
        if (p.refused) continue;
        if (!p.sent) { at(p.at + SLOW_MS); at(p.at + GIVE_UP_MS); }
        else if (p.forwarded || p.untilArrival) at(p.sentAt + SLOW_MS);
      }
      return soonest;
    },
    revision: () => revision,
    lines(note, messages, { who = null } = {}) {
      const out = [], t = now();
      for (const p of posts.values()) {
        if (p.note !== note) continue;
        if (arrived(p, messages) || expired(p, t)) { posts.delete(p.id); revision++; continue; }
        const state = stateOf(p, t);
        out.push({ eid: p.id, sendEid: null, parent: p.parent, who, author: p.author, text: p.text, at: p.at,
          pending: state !== 'sent', state, awaiting: p.sent });
      }
      return out;
    },
  };
}

/* A DM of ours after it is stored here: grey until the other ship has it
 * (Noltbook's dm-delivery fact), amber once that is overdue, red if their
 * agent turned it down. `receipt` is {ok} or nothing yet. */
export function deliveryState(sentAt, receipt, t = Date.now()) {
  if (receipt) return receipt.ok ? 'sent' : 'undelivered';
  return t - sentAt >= SLOW_MS ? 'slow' : 'sending';
}

/* What a line says about itself: nothing while it is going normally. Slow is
 * "not sent yet" until our ship confirms it, "not delivered yet" after. Only a
 * refused or long-lost post is offered again (see the top of this file). */
export function sendLabel(state, awaiting = false) {
  if (state === 'slow') return awaiting ? 'Not delivered yet' : 'Not sent yet';
  if (state === 'failed') return 'Not sent';
  if (state === 'undelivered') return 'Not delivered';
  return '';
}
export const canRetry = (state) => state === 'failed';

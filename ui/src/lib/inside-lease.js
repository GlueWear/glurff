/* LEASED WHILE YOU WERE INSIDE -- or removed from the note while you were.
 *
 * You are standing in a room that now belongs to a note you are not in:
 *   secret   you step outside. The room goes dark and you cannot ask.
 *   public   "Join?" -- join and stay, or step outside. No answer within
 *            ANSWER_MS is a no.
 *   private  "Request to join?" -- ask, and wait here for the host's answer
 *            for up to WAIT_MS; let in, you stay; declined or no answer, you
 *            step outside.
 * You can always walk back up to the door and ask again: the doorway's own
 * card is separate and unchanged.
 *
 * A SECRET room's members may not know its note yet -- its id reaches them
 * from the owner's ship, never the relay -- so they are given SECRET_GRACE_MS
 * for that answer, and asked for it, before anything happens. The owner's
 * ship saying "private" ends the wait at once.
 *
 * Everything it touches is passed in, so it can be exercised without a page.
 */
export const ANSWER_MS = 60000;
export const WAIT_MS = 120000;
export const SECRET_GRACE_MS = 8000;

export function createInsideLease({
  lease,                 //  () => {place, note, vis, host} | null: a lease here we are not in
  toldPrivate,           //  (place) => bool: the owner's ship said private
  joinAsked,             //  (note) => bool: our request is still pending
  ask,                   //  (lease, {timeout, signal}) => Promise<true|false|null>
  requestJoin,           //  (lease) => Promise
  askOwner,              //  (lease) => void: which note is this secret room?
  stepOutside,           //  (lease, reason) => void
  learn = () => {},      //  (lease) => void: fetch the group's name while we ask
  now = Date.now,
  trace = () => {},
} = {}) {
  let inside = null;     //  {key, lease, stage, at, abort}

  function leave(l, reason) {
    inside?.abort?.abort();
    inside = null;
    trace('room-lease', { place: l.place, host: l.host ?? '', reason: 'moved-out:' + reason });
    stepOutside(l, reason);
  }

  async function check() {
    const l = lease();
    if (!l) { if (inside) { inside.abort?.abort(); inside = null; } return; }
    const key = `${l.place}/${l.note ?? ''}/${l.vis}`;
    if (inside?.key === key) {
      if (inside.stage === 'waiting') {
        if (!joinAsked(l.note)) leave(l, 'declined');
        else if (now() - inside.at > WAIT_MS) leave(l, 'no-answer');
      } else if (inside.stage === 'secret' && (toldPrivate(l.place) || now() - inside.at > SECRET_GRACE_MS)) {
        leave(l, 'secret');
      }
      return;
    }
    inside?.abort?.abort();
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    inside = { key, lease: l, stage: 'asking', at: now(), abort };
    if (l.vis === 'secret' || !l.note) {
      if (toldPrivate(l.place)) { leave(l, 'secret'); return; }
      inside.stage = 'secret';
      try { askOwner(l); } catch {}
      return;
    }
    try { learn(l); } catch {}
    const answer = await ask(l, { timeout: ANSWER_MS, signal: abort?.signal ?? null });
    if (inside?.key !== key) return;                  //  settled some other way
    if (answer === null) return;
    if (!answer) { leave(l, 'not-now'); return; }
    try { await requestJoin(l); } catch { leave(l, 'failed'); return; }
    if (inside?.key === key) { inside.stage = 'waiting'; inside.at = now(); }
  }

  return {
    check,
    /* Anything with a deadline to watch. */
    active: () => !!inside,
    stage: () => inside?.stage ?? null,
  };
}

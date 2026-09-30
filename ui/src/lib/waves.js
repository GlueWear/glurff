/* WAVES. A way to get somebody's attention -- usually somebody asleep in a tab
 * they left open, waiting for company.
 *
 * Only to people in the world with us, over the relay, with a receipt (see
 * lib/reliable): a wave that cannot be delivered now is not queued for later.
 * No sound and no system notification. The person waved at gets a pop-up with
 * a way to look at who waved, a hand over the waver's head that only they see,
 * and -- when Glurff is in a background tab -- a title that flashes until they
 * come back.
 *
 * Limits on both ends: we send one wave per person every WAVE_SEND_GAP_MS, and
 * take at most one per sender every WAVE_TAKE_GAP_MS whatever they send.
 * Blocked people cannot wave at us, and we cannot wave at them.
 */
export const WAVE_KIND = 'wave';
export const WAVE_SEND_GAP_MS = 30000;
export const WAVE_TAKE_GAP_MS = 10000;
export const WAVE_NOTICE_MS = 8000;

export function createWaves({
  send,                    //  (ship, body) => Promise: rejects when they cannot be reached
  may,                     //  (ship) => bool: in the world with us, and not blocked
  onWaved = () => {},      //  (ship): show that they waved
  now = Date.now,
} = {}) {
  const sent = new Map(), taken = new Map();
  return {
    /* {ok: true} or {ok: false, why: 'absent' | 'soon', wait} */
    async wave(ship) {
      if (!may(ship)) return { ok: false, why: 'absent' };
      const t = now(), last = sent.get(ship) ?? -Infinity;
      if (t - last < WAVE_SEND_GAP_MS) return { ok: false, why: 'soon', wait: WAVE_SEND_GAP_MS - (t - last) };
      try { await send(ship, { kind: WAVE_KIND, t0: t }); } catch { return { ok: false, why: 'absent' }; }
      sent.set(ship, t);
      return { ok: true };
    },
    /* A wave from `who`. True if it was shown. */
    receive(who) {
      if (!may(who)) return false;
      const t = now(), last = taken.get(who) ?? -Infinity;
      if (t - last < WAVE_TAKE_GAP_MS) return false;
      taken.set(who, t);
      onWaved(who);
      return true;
    },
  };
}

/* A tab title that flashes while the tab is in the background, and stops the
 * moment it is looked at. */
export function createTitleFlash({ doc = document, every = (fn, ms) => setInterval(fn, ms),
  stop = (id) => clearInterval(id) } = {}) {
  let timer = null, base = '';
  const end = () => {
    if (timer === null) return;
    stop(timer); timer = null;
    doc.title = base;
  };
  doc.addEventListener?.('visibilitychange', () => { if (!doc.hidden) end(); });
  return {
    flash(text) {
      if (!doc.hidden) return false;
      if (timer === null) base = doc.title;
      else stop(timer);
      let on = true;
      doc.title = text;
      timer = every(() => { on = !on; doc.title = on ? text : base; }, 1000);
      return true;
    },
    end,
    flashing: () => timer !== null,
  };
}

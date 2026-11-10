/* A GLURFF'S CARD (2026-11-05): what its host says of it -- {note, name,
 * live: {release, doc, size} | null} -- asked through our own agent, which
 * watches the host's. null for a ship that hosts no world; undefined if no
 * answer came in time. A channel of its own, closed as soon as the card is
 * in, so it can be asked before the app has one (src/boot) or about a world
 * we are not in (travel, ui/content-card). In time is CARD_WAIT_MS, 20 s
 * (2026-11-10; it was 10, shorter than a busy ship's pause). */
import Urbit from '@urbit/http-api';
import { CARD_WAIT_MS } from './glurff-online.js';

export function cardOf(host, ms = CARD_WAIT_MS) {
  return new Promise((resolve) => {
    const api = new Urbit('', '', 'glurff');
    api.ship = window.ship; api.verbose = false;
    /* Its own unload beacon is unbound (see lib/api) and goes nowhere. */
    window.removeEventListener('beforeunload', api.delete);
    let done = false;
    /* CLOSED FOR REAL (2026-11-09): delete() only asks the ship to drop the
     * channel; the browser kept its stream open, and kept reopening it, for
     * as long as the page lived -- one connection per card asked, of the six a
     * browser allows a ship, until the editor, a playtest or a scry waited
     * for one. reset() also stops the stream. */
    const finish = (card) => {
      if (done) return;
      done = true; clearTimeout(timer);
      try { api.reset(); } catch {}
      resolve(card);
    };
    const timer = setTimeout(() => finish(undefined), ms);
    api.subscribe({
      app: 'glurff', path: `/card/${host}`,
      event: (u) => { const c = u?.['world-card']; if (c?.host === host) finish(c.card ?? null); },
      err: () => finish(undefined), quit: () => finish(undefined),
    }).catch(() => finish(undefined));
  });
}

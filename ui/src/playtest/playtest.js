/* PLAYTEST: the draft, in the real app (2026-11-06).
 *
 * The host's saved draft, read through the host's own API (so only the host
 * ship with editing turned on can open it), set as the world before the app
 * is loaded -- as src/boot does for a visit -- with WORLD_PREVIEW on: the
 * same screen, rooms, chat, cards, screens, websites and apps as a visit,
 * and nobody told we are there. No presence, no relay, no session lease, no
 * call, and nothing said is sent (see main.js and lib/rooms setPreview).
 * `?at=<arrival id>` starts at one of the draft's doors.
 */
import { setWorld } from '../lib/world-config.js';
import { validate } from '../world/world-doc.js';
import * as host from '../editor/host-api.js';

const screen = globalThis.glurffLoading ?? null;

(async () => {
  screen?.progress?.(0.01, 'Opening the playtest…');
  /* Both at once: the ship refuses the draft to anybody `home` would turn away. */
  const [h, d] = await Promise.all([host.home(), host.draft().catch(() => null)]);
  if (!h.hosting || !h.edit) throw new Error('Only the host ship, with editing on, can playtest its draft.');
  if (!d) throw new Error('There is no saved draft to playtest.');
  const doc = await host.documentOf(d.doc);
  /* What would stop it being published, said on the screen; it is walked
   * anyway, as far as it goes. */
  globalThis.glurffDraftProblems = validate(doc);
  setWorld({ host: host.ourShip(), note: h.note, name: doc.world.name ?? 'Glurff', doc, preview: true });
  screen?.to?.(`${doc.world.name ?? 'Glurff'} (playtest)`, host.ourShip());
  await import('../main.js');
})().catch((e) => {
  console.error('glurff: playtest', e);
  screen?.notice?.({ title: 'The playtest did not start', detail: e.message ?? String(e), stop: true,
    action: { label: 'Retry', run: () => location.reload() } });
});

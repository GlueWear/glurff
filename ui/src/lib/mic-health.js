/* IS OUR MICROPHONE ACTUALLY SENDING SOUND?
 *
 * FIELD CASE, 2026-09-29. ~natlut-minryx could hear everybody; nobody could
 * hear them. Every connection said "connected". Their microphone had stopped
 * giving sound, and nothing in Glurff was watching it: the call went on
 * sending silence -- the noise-reduction pipeline keeps a "live" track going
 * after the microphone behind it has gone -- and the only way anybody found
 * out was talking to nobody.
 *
 * While our microphone is on, every MIC_CHECK_MS this looks at:
 *
 *   ended    the microphone itself stopped: unplugged, a Bluetooth headset
 *            gone, taken by another app or by the system;
 *   muted    the system is giving it no sound (a mute switch, a privacy
 *            setting), for MIC_MUTED_MS;
 *   paused   our own sound processing was suspended, for MIC_PAUSED_MS;
 *   silent   PERFECT silence for MIC_SILENT_MS. Not quiet -- every working
 *            microphone picks up a faint hiss, and the browser's measure of
 *            the sound going out grows with it. Exactly nothing means the
 *            sound is not reaching us at all. It needs no knowledge of whether
 *            anybody is talking.
 *
 * What it does, once per episode: first it quietly opens the microphone again
 * -- the chosen one, or whichever the system offers if that one is gone -- and
 * puts it back into the call. If that does not bring the sound back, the person
 * is told what is wrong and given a way to try again. At most MIC_MAX_REOPENS
 * automatic reopenings per MIC_REOPEN_WINDOW_MS, so a microphone that is
 * simply switched off at the system is not reopened in a loop.
 *
 * Everything it touches is passed in.
 */
export const MIC_CHECK_MS = 2000;
export const MIC_MUTED_MS = 3000;
export const MIC_PAUSED_MS = 4000;
export const MIC_SILENT_MS = 10000;
export const MIC_MAX_REOPENS = 3;
export const MIC_REOPEN_WINDOW_MS = 2 * 60 * 1000;

export function createMicHealth({
  probe,                   //  () => Promise<null | {ended, muted, context, resume(), energy}>
  reopen,                  //  () => Promise: open the microphone again and put it in the call
  onTrouble = () => {},    //  (why | null): tell the person, or stop telling them
  now = Date.now,
  trace = () => {},
} = {}) {
  let mutedSince = null, pausedSince = null, quietSince = null, energy = null;
  let tried = null;        //  the episode we already reopened for, until it is healthy again
  let trouble = null, reopening = false, checking = false, last = null;
  const reopens = [];

  const clearClocks = () => { mutedSince = pausedSince = quietSince = null; energy = null; };
  function say(why) {
    if (why === trouble) return;
    trouble = why;
    trace('mic-health', { reason: why ?? 'ok' });
    try { onTrouble(why); } catch {}
  }

  async function doReopen(why, manual = false) {
    if (reopening) return;
    reopening = true;
    const t = now();
    reopens.push(t);
    trace('mic-health', { reason: `reopen:${why}${manual ? ':manual' : ''}` });
    try { await reopen(); } catch {}
    finally { reopening = false; clearClocks(); }
  }

  async function check() {
    if (checking || reopening) return;
    checking = true;
    try {
      const p = await probe();
      last = p;
      const t = now();
      /* Off -- muted by hand, or not in a call. Nothing to watch, and nothing
       * to be told about. */
      if (!p) { clearClocks(); say(null); return; }
      let why = null;
      if (p.ended) why = 'ended';
      if (!why && p.muted) { mutedSince ??= t; if (t - mutedSince >= MIC_MUTED_MS) why = 'muted'; }
      else mutedSince = null;
      if (!why && p.context && p.context !== 'running') {
        pausedSince ??= t;
        try { p.resume?.(); } catch {}
        if (t - pausedSince >= MIC_PAUSED_MS) why = 'paused';
      } else if (!why) pausedSince = null;
      const measured = Number.isFinite(p.energy);
      let heard = false;
      if (!why && measured) {
        if (energy !== null && p.energy > energy) { heard = true; quietSince = null; }
        else { quietSince ??= t; if (t - quietSince >= MIC_SILENT_MS) why = 'silent'; }
        energy = p.energy;
      }
      if (!why) {
        /* Healthy only on evidence: sound heard (where it can be measured),
         * nothing muted, nothing paused. Waiting out a threshold is not
         * healthy -- treating it so forgot the reopening already tried, and
         * reopened again instead of telling the person. */
        const settled = !p.muted && !(p.context && p.context !== 'running') && (!measured || heard);
        if (settled) { tried = null; say(null); }
        return;
      }
      while (reopens.length && t - reopens[0] >= MIC_REOPEN_WINDOW_MS) reopens.shift();
      if (tried === null && reopens.length < MIC_MAX_REOPENS) {
        tried = why;
        await doReopen(why);
        return;
      }
      say(why);
    } finally { checking = false; }
  }

  return {
    check,
    /* The person pressed "Try again". */
    async retry() {
      const why = trouble ?? 'manual';
      /* The message goes at once, whatever put it there; the checks bring it
       * back if the microphone is still not working. */
      tried = null; trouble = null;
      try { onTrouble(null); } catch {}
      await doReopen(why, true);
    },
    trouble: () => trouble,
    state: () => ({ trouble, tried, reopening, reopens: reopens.length,
      mic: last ? { ended: !!last.ended, muted: !!last.muted, context: last.context ?? null,
        measured: Number.isFinite(last.energy), quietMs: quietSince === null ? 0 : now() - quietSince } : null }),
  };
}

import { esc } from './html.js';
/* OPENED OVER HTTP (2026-11-17). A browser gives the microphone and the
 * camera only to a secure page -- https://, or localhost -- so a ship opened
 * over plain http:// can walk, chat and play, but has no voice, video or
 * screen sharing. Two things say so: a line on the loading screen
 * (public/loading.js), and this card, once we have landed.
 *
 * The card is shown once per browser: "Got it" is remembered, and only "Got
 * it" closes it (no Escape, no click outside), so whoever reads it has said
 * they read it. A browser that will not remember shows it each visit. */
export const INSECURE_SEEN_KEY = 'glurff-insecure-notice-seen';
export const INSECURE_TITLE = 'Calls are off in this browser.';
export const INSECURE_DETAIL = 'Your ship is open over http://, so your browser blocks the microphone and camera. '
  + 'You can walk around, chat and play as normal. To use voice, video and screen sharing, open your ship at its https:// address.';

const localStore = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const seen = (storage) => { try { return storage?.getItem(INSECURE_SEEN_KEY) === '1'; } catch { return false; } };

/* Whether the card is due: an insecure page, not yet acknowledged here. */
export function insecureNoticeDue({ secure = globalThis.isSecureContext, storage = localStore() } = {}) {
  return secure === false && !seen(storage);
}

/* Shows the card if it is due. Resolves true once "Got it" is pressed, false
 * if there was nothing to show. */
export function showInsecureNotice({ secure = globalThis.isSecureContext, storage = localStore(), doc = globalThis.document } = {}) {
  if (!doc || !insecureNoticeDue({ secure, storage })) return Promise.resolve(false);
  return new Promise((resolve) => {
    const root = doc.createElement('div');
    root.className = 'ask-overlay insecure-notice';
    root.innerHTML = `<div class="ask" role="alertdialog" aria-modal="true" aria-labelledby="insecure-notice-q">
      <div class="ask-q" id="insecure-notice-q">${esc(INSECURE_TITLE)}</div>
      <div class="ask-detail dim">${esc(INSECURE_DETAIL)}</div>
      <div class="ask-row"><button type="button" class="ask-yes">Got it</button></div>
    </div>`;
    const ok = root.querySelector('.ask-yes');
    ok.onclick = () => {
      try { storage?.setItem(INSECURE_SEEN_KEY, '1'); } catch {}
      root.remove();
      resolve(true);
    };
    doc.body.appendChild(root);
    ok.focus();
  });
}

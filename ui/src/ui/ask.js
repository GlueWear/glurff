import { esc } from 'ui/html';
/* A question, asked in Glurff's own voice.
 *
 * `window.confirm` is the browser's dialog, not ours: it arrives in the
 * operating system's font, with the page's URL above it, looking like a
 * security warning rather than a thing the world is asking you. Anything the
 * world asks should look like the world.
 */

/* Resolves true or false. Escape and a click outside both mean no, because a
 * question you dismissed is a question you did not answer yes to. A question
 * left unanswered for `timeout` ms is a no; one whose `signal` aborts closes
 * and resolves null -- the question stopped mattering. */
export function ask(question, { yes = 'Yes', no = 'Cancel', detail = null, dismiss = false, timeout = 0, signal = null } = {}) {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let timer = null;
    const root = document.createElement('div');
    root.className = 'ask-overlay';
    root.innerHTML = `<div class="ask" role="alertdialog" aria-modal="true">
      <div class="ask-q">${esc(question)}</div>
      ${detail ? `<div class="ask-detail dim">${esc(detail)}</div>` : ''}
      <div class="ask-row">
        <button class="ask-no">${esc(no)}</button>
        <button class="ask-yes">${esc(yes)}</button>
      </div>
    </div>`;
    let settled = false;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve(answer);
    };
    const onAbort = () => done(null);
    signal?.addEventListener?.('abort', onAbort);
    if (timeout > 0) timer = setTimeout(() => done(false), timeout);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); done(dismiss); }
      else if (e.key === 'Enter') { e.preventDefault(); done(true); }
    };
    root.querySelector('.ask-yes').onclick = () => done(true);
    root.querySelector('.ask-no').onclick = () => done(false);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) done(dismiss); });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    root.querySelector('.ask-yes').focus();
  });
}

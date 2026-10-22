/* MESSAGES, as the room chats and the DMs both show them (2026-10-13).
 *
 * One line is a name, a time and what was said -- in Glurff's colours, not a
 * forum's. Clicking (or tapping) a line opens a small menu where you clicked,
 * the way Noltbook's does (msgActionsHtml), with what Noltbook offers there
 * but pinning: REPLY, EDIT and DELETE for your own, SEND for somebody else's.
 * A payment message (lib/nock-receipt) reads as one, in green.
 */
import { render as renderText } from 'ui/media';
import { parseReceipt } from 'lib/nock-receipt';
import { sendLabel, canRetry } from 'lib/pending';

export { messageActions } from 'lib/message-actions';
export const ACTION_LABEL = { reply: 'Reply', edit: 'Edit', send: 'Send $NOCK', delete: 'Delete' };

/* The words of a line: a payment message as its sentence, else as typed
 * (pictures and links built as nodes; see ui/media). */
export function paintText(node, text, { our, name, embed = true } = {}) {
  const r = parseReceipt(text);
  node.classList.toggle('nock-send', !!r);
  if (!r) { renderText(node, String(text ?? ''), { embed }); return; }
  node.textContent = '';
  if (r.ship === our) { node.textContent = `sent you ${r.amount} $NOCK`; return; }
  const who = document.createElement('span');
  who.className = 'nock-recip'; who.title = r.ship; who.textContent = name ? name(r.ship) : r.ship;
  node.append(`sent ${r.amount} $NOCK to `, who);
}

/* THE MENU. One at a time, in the page; it closes on a choice, a click
 * elsewhere, Escape, or the list scrolling under it. */
let open = null;
export function closeMenu() { open?.el.remove(); open = null; }
export function openMenu(x, y, actions, choose) {
  closeMenu();
  if (!actions.length) return null;
  const el = document.createElement('div');
  el.className = 'msg-menu'; el.setAttribute('role', 'menu');
  el.innerHTML = actions.map((a) => `<button type="button" role="menuitem" data-act="${a}"${a === 'delete' ? ' class="danger"' : ''}>${ACTION_LABEL[a]}</button>`).join('');
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    e.stopPropagation(); closeMenu(); choose(b.dataset.act);
  });
  document.body.appendChild(el);
  /* Where we clicked, kept on screen. */
  const r = el.getBoundingClientRect(), pad = 6;
  el.style.left = `${Math.max(pad, Math.min(x, innerWidth - r.width - pad))}px`;
  el.style.top = `${Math.max(pad, Math.min(y, innerHeight - r.height - pad))}px`;
  open = { el };
  el.querySelector('button')?.focus({ preventScroll: true });
  return el;
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => { if (open && !open.el.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); closeMenu(); } }, true);
  window.addEventListener('blur', closeMenu);
}

/* A click on a line that is about the line, not something in it: a link, a
 * picture, a button keep their own. */
export const aboutLine = (e) => !e.target.closest('a, button, input, video, audio, iframe, img, .nock-recip');

/* How a post of ours is going, on its line: a word, and for one that did not
 * go, Retry and remove. Shared by the room chats (ui/hud) and the DMs (ui/dms). */
export function paintSendState(el, state, awaiting) {
  el.classList.toggle('slow', state === 'slow');
  el.classList.toggle('failed', state === 'failed' || state === 'undelivered');
  const slot = el.querySelector('.send-state');
  if (!slot) return;
  const label = sendLabel(state, awaiting), retry = canRetry(state);
  const key = `${label}|${retry}|${state === 'failed'}`;
  if (slot.dataset.key === key) return;
  slot.dataset.key = key;
  slot.textContent = label;
  if (retry) slot.append(sendButton('send-retry', 'Retry', 'Send it again'));
  if (state === 'failed') slot.append(sendButton('send-drop', '×', 'Remove'));
}
function sendButton(className, text, title) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = className; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
  return b;
}

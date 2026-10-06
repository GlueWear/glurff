/* SOMEBODY'S PICTURE, everywhere Glurff shows one: their profile picture,
 * else their sigil, else two letters. See lib/avatar-choice for the order and
 * why; this file draws it.
 *
 * Rows built as markup use avatarHtml. A picture that will not load falls
 * through to the next in place -- one listener for the whole page, since
 * an image's error does not bubble but can be caught on its way down. A call
 * tile (data-own) repaints itself instead.
 */
import { avatarUrl } from 'lib/noltbook';
import { esc } from 'ui/html';
import { createAvatarChoice, letters, sigilUrl } from 'lib/avatar-choice';

export { letters, sigilUrl };
const choice = createAvatarChoice({ avatarUrl });
export const pictureFor = (ship) => choice.pictureFor(ship);

export function avatarHtml(ship) {
  const p = choice.pictureFor(ship);
  return p
    ? `<img src="${esc(p.src)}" alt="" class="${p.step === 'sigil' ? 'sigil' : ''}" data-avatar="${esc(ship)}" data-step="${p.step}">`
    : `<span class="av-letters">${esc(letters(ship))}</span>`;
}

if (typeof window !== 'undefined') window.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.avatar) return;
  choice.failed(img.dataset.step, img.getAttribute('src'));
  if (img.dataset.own) return;
  const ship = img.dataset.avatar, next = choice.pictureFor(ship);
  if (next) {
    img.dataset.step = next.step;
    img.classList.toggle('sigil', next.step === 'sigil');
    img.src = next.src;
    return;
  }
  const span = document.createElement('span');
  span.className = 'av-letters';
  span.textContent = letters(ship);
  img.replaceWith(span);
}, true);

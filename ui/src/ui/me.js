/* You, in the top right.
 *
 * The same thing Noltbook puts there: your name and your picture. Clicking
 * either opens your own profile card, and your character -- with the editor
 * behind it -- is inside that. A separate "Character" button in the corner of
 * the world was a second door to the same room.
 */
import { displayName, avatarUrl, onChange } from 'lib/noltbook';
import { our } from 'lib/api';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Me {
  constructor(root, { onOpen } = {}) {
    this.root = root;
    this.root.className = 'me-btn-wrap';
    this.onOpen = onOpen ?? (() => {});
    this.root.innerHTML = `<button class="me-btn" title="Your profile"></button>`;
    this.btn = this.root.querySelector('.me-btn');
    this.btn.onclick = () => this.onOpen(our);
    /* Your name and picture are Noltbook's, and arrive after the world does. */
    onChange(() => this.paint(), (c) => c.field === 'profiles' && (!c.ship || c.ship === our));
    this.paint();
  }

  /* Kept so the world can tell us the look changed; nothing is drawn here. */
  setLook() {}

  paint() {
    const name = displayName(our), av = avatarUrl(our);
    const signature = name + '\u0000' + (av ?? '');
    if (signature === this.signature) return;
    this.signature = signature;
    this.btn.innerHTML = `<span class="who">${esc(name)}</span>
      <span class="av">${av ? `<img src="${esc(av)}" alt="">` : `<span>${esc(our.slice(1, 3))}</span>`}</span>`;
  }
}

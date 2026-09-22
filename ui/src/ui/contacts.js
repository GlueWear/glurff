/* Contacts and pals, using Noltbook's live graph and actions.
 *
 * This is deliberately not another address book. The list, statuses, profiles,
 * accept and dismiss operations all belong to Noltbook; Glurff only gives them
 * a compact home beside search. Incoming requests stay at the top, and the dot
 * stays lit until Noltbook says every request has been handled.
 */
import {
  nb, displayName, avatarUrl, onChange, addPal, removePal, blockPal, unblockPal,
  dismissPalRequest,
} from 'lib/noltbook';
import { contactRows, palPresentation } from 'lib/contact-list';
import { our } from 'lib/api';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CONTACTS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 18c.5-3.2 2.3-5 5.5-5s5 1.8 5.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M15.3 14.2c3.1-.7 5 .7 5.4 3.8"/></svg>';
const avatar = (ship) => `<span class="av">${avatarUrl(ship) ? `<img src="${esc(avatarUrl(ship))}" alt="">` : ''}</span>`;

export class Contacts {
  constructor(root, { onShowProfile = () => {} } = {}) {
    this.root = root;
    this.onShowProfile = onShowProfile;
    this.open = false;
    this.busy = new Map();
    root.className = 'contacts';
    root.innerHTML = `
      <button class="contacts-btn" title="Contacts" aria-label="Contacts" aria-expanded="false" aria-haspopup="true">${CONTACTS_ICON}<i class="dot" hidden></i></button>
      <div class="contacts-panel" hidden></div>`;
    this.btn = root.querySelector('.contacts-btn');
    this.panel = root.querySelector('.contacts-panel');
    this.btn.onclick = () => this.toggle(!this.open);
    this.panel.addEventListener('click', (e) => this.choose(e));
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !root.contains(e.target)) this.toggle(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.toggle(false);
    });
    onChange(() => {
      for (const [ship, pending] of this.busy) {
        if ((nb.pals[ship] ?? 'none') !== pending.status) this.busy.delete(ship);
      }
      this.paint();
    }, (c) => ['pals', 'contacts', 'profiles'].includes(c.field));
    this.paint();
  }

  rows() { return contactRows(nb, our); }

  toggle(open) {
    this.open = open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.paint();
  }

  paint() {
    const rows = this.rows();
    const requests = rows.filter((row) => row.status === 'requested');
    const others = rows.filter((row) => row.status !== 'requested');
    this.root.querySelector('.dot').hidden = requests.length === 0;
    this.panel.hidden = !this.open;
    if (!this.open) return;
    const section = (title, body) => `<div class="contacts-group">${title}</div>${body}`;
    let html = '';
    if (requests.length) html += section('Pal requests', requests.map((row) => this.requestRow(row)).join(''));
    html += section('Contacts', others.length
      ? others.map((row) => this.contactRow(row)).join('')
      : '<div class="dim pad">no other contacts yet</div>');
    this.panel.innerHTML = html;
  }

  requestRow({ ship, name, status }) {
    const pending = this.busy.get(ship)?.kind;
    return `<div class="contact-row requested" data-profile="${esc(ship)}">
      ${avatar(ship)}
      <span class="contact-person"><span class="who">${esc(name)}</span><span class="prev dim">${esc(ship)}</span></span>
      <span class="contact-request-actions">
        <button class="accept" data-act="accept" data-ship="${esc(ship)}"${pending ? ' disabled' : ''}>${pending === 'accept' ? 'Accepting…' : 'Accept'}</button>
        <button class="dismiss" data-act="dismiss" data-ship="${esc(ship)}"${pending ? ' disabled' : ''}>${pending === 'dismiss' ? 'Dismissing…' : 'Dismiss'}</button>
      </span>
    </div>`;
  }

  contactRow({ ship, name, status }) {
    const pal = palPresentation(status);
    const blocked = status === 'blocked';
    return `<div class="contact-row" data-profile="${esc(ship)}">
      ${avatar(ship)}
      <span class="contact-person"><span class="who">${esc(name)}</span><span class="prev dim">${esc(ship)}</span></span>
      <span class="contact-tags">
        <button class="contact-tag pal-${esc(pal.tone)}" data-act="pal" data-ship="${esc(ship)}"${blocked ? ' disabled' : ''}>${pal.label}</button>
        <button class="contact-tag ${blocked ? 'pal-blocked' : ''}" data-act="block" data-ship="${esc(ship)}">${blocked ? 'BLOCKED' : 'BLOCK'}</button>
      </span>
    </div>`;
  }

  choose(e) {
    const action = e.target.closest('[data-act]');
    if (action) {
      e.stopPropagation();
      const { act, ship } = action.dataset;
      const status = nb.pals[ship] ?? 'none';
      if (act === 'accept') return this.resolveRequest(ship, 'accept', () => addPal(ship));
      if (act === 'dismiss') return this.resolveRequest(ship, 'dismiss', () => dismissPalRequest(ship));
      if (act === 'pal' && status !== 'blocked') {
        const work = status === 'mutual' || status === 'requesting' ? removePal(ship) : addPal(ship);
        work.catch((error) => console.error('pal', error));
      }
      if (act === 'block') {
        if (status !== 'blocked' && !window.confirm(`Block ${displayName(ship)}?`)) return;
        (status === 'blocked' ? unblockPal(ship) : blockPal(ship))
          .catch((error) => console.error('block', error));
      }
      return;
    }
    const row = e.target.closest('[data-profile]');
    if (row) { this.toggle(false); this.onShowProfile(row.dataset.profile); }
  }

  async resolveRequest(ship, kind, work) {
    if (this.busy.has(ship)) return;
    const status = nb.pals[ship] ?? 'none';
    this.busy.set(ship, { kind, status });
    this.paint();
    try {
      await work();
    } catch (error) {
      this.busy.delete(ship);
      this.paint();
      console.error(`pal request ${kind}`, error);
    }
  }
}


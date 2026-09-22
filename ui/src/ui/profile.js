/* The profile card.
 *
 * Double-click somebody in the world and this is what opens. It is Noltbook's
 * card, not a second one: every field and every button here reads and writes
 * Noltbook's own graph, so a pal added in the world is a pal in Noltbook and
 * a block made here blocks there too. Glurff stores none of it.
 *
 * Rank, point and sponsor chain are derived from the @p locally -- Azimuth is
 * not something the ship needs to be asked about.
 */
import {
  nb, displayName, avatarUrl, palStatus, isContact, dmWith,
  addPal, removePal, blockPal, unblockPal, addContact, removeContact,
  requestProfile, retryProfile, requestRemoteNotes, onChange,
} from 'lib/noltbook';
import { our } from 'lib/api';
import { sendNock, sendBlocked } from 'lib/wallet';
import { paintCharacter } from 'world/paint';
import * as ob from 'urbit-ob';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Point number and sponsor chain.
 *
 * `sein` and `clan` do this properly. Deriving a sponsor arithmetically from
 * the point (star = point % 65536) gives the WRONG ship: planet names are
 * Feistel-obfuscated, so ~mignes-magtel's star is ~macten, which no modulus
 * will produce. A comet is self-signed and stops the walk on its own.
 */
function azimuth(ship) {
  let rank, point;
  try {
    rank = ob.clan(ship);
    point = ob.patp2dec(ship);
  } catch (e) { return null; }
  const chain = [];
  let cur = ship;
  while (chain.length < 4 && ob.clan(cur) !== 'galaxy') {
    const up = ob.sein(cur);
    if (!up || up === cur) break;
    chain.push(up);
    cur = up;
  }
  return { point, rank, chain };
}

/* The lookup strip, in Noltbook's words. The first two are still working and
 * animate; a verdict can be tapped to try again. */
const LOOKUP = {
  looking: ['LOOKING FOR NOLTBOOK', true],
  reachable: ['ONLINE · LOOKING FOR NOLTBOOK', true],
  unreachable: ["COULDN'T REACH · TAP TO RETRY", false],
  'noltbook-unavailable': ['ONLINE · NOLTBOOK NOT AVAILABLE', false],
};

const PAL_LABEL = {
  mutual: 'PALS', requesting: 'REQUESTING', requested: 'REQUESTED',
  blocked: 'BLOCKED', none: 'ADD PAL',
};

const PAL_TITLE = {
  mutual: 'You are pals', requesting: 'Your pal request is pending',
  requested: 'They sent you a pal request', blocked: 'This user is blocked',
  none: 'Send a pal request',
};

export class ProfileCard {
  constructor(root, { onOpenDm, look, onEditCharacter } = {}) {
    this.root = root;
    this.root.className = 'card-overlay';
    this.root.hidden = true;
    this.ship = null;
    this.onOpenDm = onOpenDm ?? (() => {});
    /* Your character is part of your profile, the way your picture is; the
     * editor is opened by clicking it. */
    this.look = look ?? (() => null);
    this.onEditCharacter = onEditCharacter ?? (() => {});
    this.sending = false;
    this.sprite = document.createElement('canvas');
    this.sprite.className = 'card-sprite';
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.ship) this.close(); });
    /* Profiles and pal status arrive after the card is already on screen. */
    onChange(() => { if (this.ship) this.paint(); }, c => ['notes', 'profiles', 'pals', 'contacts', 'remoteNotes', 'lookups'].includes(c.field) && (!c.ship || c.ship === this.ship));
  }

  open(ship) {
    if (this.ship !== ship) { this.sending = false; this.status = ''; }
    this.ship = ship;
    this.root.hidden = false;
    /* Ask for what we do not have. Someone standing next to us in the world is
     * not necessarily someone Noltbook has ever heard of. */
    /* A lookup already under way, or already answered, is shown rather than
     * started again; the strip's own tap is how you retry. */
    if (!nb.profiles[ship] && !nb.lookups[ship]) requestProfile(ship);
    if (!nb.remoteNotes[ship]) requestRemoteNotes(ship);
    this.paint();
  }

  close() {
    this.ship = null;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  /* A line under the buttons, without rebuilding the card under the caret. */
  say(text) {
    this.status = text;
    const el = this.root.querySelector('.send-status');
    if (el) el.textContent = text;
  }

  paint() {
    const ship = this.ship;
    const status = palStatus(ship);
    const blocked = status === 'blocked';
    const az = azimuth(ship);
    const av = avatarUrl(ship);
    const notes = nb.remoteNotes[ship] ?? [];
    const lookup = nb.lookups[ship];
    const dm = dmWith(ship);
    const worn = this.look(ship);

    this.root.innerHTML = `
      <div class="card">
        <button class="card-x" title="Close">&times;</button>
        <div class="card-top">
          <div class="card-av">${av ? `<img src="${esc(av)}" alt="">` : `<span>${esc(ship.slice(1, 3))}</span>`}</div>
          <div class="card-id">
            <div class="card-name">${esc(displayName(ship))}</div>
            <div class="card-ship">${esc(ship)}</div>
            ${az ? `<div class="dim">${az.rank} &middot; ${esc(az.point)}</div>` : ''}
            ${az?.chain.length ? `<div class="dim">sponsor ${az.chain.map(esc).join(' &rarr; ')}</div>` : ''}
            ${nb.profiles[ship]?.azimuthAddress ? `<div class="dim wrap">${esc(nb.profiles[ship].azimuthAddress)}</div>` : ''}
          </div>
        </div>
        ${ship !== our && LOOKUP[lookup] ? `<div class="card-lookup ${LOOKUP[lookup][1] ? 'busy' : 'done'}" data-state="${lookup}"${LOOKUP[lookup][1] ? ' aria-busy="true"' : ' role="button" tabindex="0"'}><span>${LOOKUP[lookup][0]}</span>${LOOKUP[lookup][1] ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}</div>` : ''}
        ${worn ? `<div class="card-me">
          <div class="card-sprite-slot"></div>
          <div class="card-me-text">${ship === our
            ? '<span class="dim">Your character</span><button class="b-edit">EDIT CHARACTER</button>'
            : '<span class="dim">In Glurff now</span>'}</div>
        </div>` : ''}
        ${ship === our ? '<div class="dim">This is you.</div>' : `
        <div class="card-btns">
          <button class="b-send">SEND $NOCK</button>
          <button class="b-dm">${dm ? 'OPEN DM' : 'DM'}</button>
          <button class="b-pal pal-${esc(status)}" title="${esc(PAL_TITLE[status] ?? PAL_TITLE.none)}">${PAL_LABEL[status] ?? 'ADD PAL'}</button>
          <button class="b-contact"${status !== 'none' ? ' hidden' : ''}>${isContact(ship) ? 'REMOVE CONTACT' : 'ADD CONTACT'}</button>
          <button class="b-block${blocked ? ' danger' : ''}">${blocked ? 'UNBLOCK' : 'BLOCK'}</button>
        </div>`}
        <form class="send-form"${this.sending ? '' : ' hidden'}>
          <input class="send-amount" type="number" min="0" step="0.0001" placeholder="NOCK" autocomplete="off">
          <button type="submit" class="b-confirm">SEND</button>
          <button type="button" class="b-cancel">CANCEL</button>
        </form>
        <div class="send-status" role="status">${esc(this.status ?? '')}</div>
        <div class="card-notes">
          ${notes.length
            ? notes.map((n) => `<div class="card-note"><span class="n">${esc(n.name)}</span>
                 <span class="dim">${esc(n.headline ?? '')}</span></div>`).join('')
            : `<div class="dim">${LOOKUP[lookup]?.[1] ? 'loading…' : 'no public notes'}</div>`}
        </div>
      </div>`;

    const q = (c) => this.root.querySelector(c);
    q('.card-x').onclick = () => this.close();
    /* The character STANDS STILL here. A card is something you read; a figure
     * marching on the spot beside the text is movement with nothing to say. */
    const slot = q('.card-sprite-slot');
    if (slot) {
      slot.appendChild(this.sprite);
      const draw = () => paintCharacter(this.sprite, worn, 'down', 0, 5, draw);
      draw();
      if (ship === our) this.sprite.onclick = () => { this.close(); this.onEditCharacter(); };
      this.sprite.classList.toggle('editable', ship === our);
      const edit = q('.b-edit');
      if (edit) edit.onclick = () => { this.close(); this.onEditCharacter(); };
    }
    const retry = q('.card-lookup.done');
    if (retry) {
      retry.onclick = () => retryProfile(ship);
      retry.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retryProfile(ship); } };
    }
    if (ship === our) return;
    /* SEND opens the amount, and Iris itself asks for approval -- Noltbook is
     * never opened and never involved. */
    q('.b-send').onclick = () => {
      const why = sendBlocked(ship);
      if (why) { this.say(why); return; }
      this.sending = true; this.status = '';
      this.paint();
      this.root.querySelector('.send-amount')?.focus();
    };
    const form = q('.send-form');
    if (form) {
      form.querySelector('.b-cancel').onclick = () => { this.sending = false; this.status = ''; this.paint(); };
      form.onsubmit = async (e) => {
        e.preventDefault();
        const amount = form.querySelector('.send-amount').value;
        const button = form.querySelector('.b-confirm');
        button.disabled = true;
        this.say('Approve it in Iris…');
        try {
          const tx = await sendNock(ship, amount);
          if (this.ship !== ship) return;
          this.sending = false;
          this.status = tx ? `Sent · ${String(tx).slice(0, 12)}…` : 'Sent.';
          this.paint();
        } catch (err) {
          if (this.ship !== ship) return;
          button.disabled = false;
          this.say(err?.message || 'Iris could not send that.');
        }
      };
    }
    q('.b-dm').onclick = () => { this.onOpenDm(ship); this.close(); };
    q('.b-pal').onclick = () => {
      if (blocked) return;
      /* Asking again while a request is out does nothing useful, so the
       * button turns a live relationship off and an absent one on. */
      (status === 'mutual' || status === 'requesting' ? removePal(ship) : addPal(ship))
        .catch((e) => console.error('pal', e));
    };
    q('.b-block').onclick = () =>
      (blocked ? unblockPal(ship) : blockPal(ship)).catch((e) => console.error('block', e));
    const c = q('.b-contact');
    if (c) c.onclick = () =>
      (isContact(ship) ? removeContact(ship) : addContact(ship)).catch((e) => console.error('contact', e));
  }
}

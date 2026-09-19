/* Who is here with you.
 *
 * Everyone in the room you are standing in -- or, in the commons, everyone in
 * the commons. Only people you can see: the same people the world draws, so
 * someone outside your pals and dial is not listed even when they are there.
 *
 * The host is marked. In a room, the host can hand hosting to anyone in it;
 * that person is asked, and the call moves to them if they accept.
 */
import { displayName, avatarUrl, onChange } from 'lib/noltbook';
import { our } from 'lib/api';
import { rooms, onRooms, offerHost, answerHostOffer, canHandOff, mayHandTo, chooseRoomHost,
         roleFor, mutedShip } from 'lib/rooms';
import { roomById, COMMONS } from 'world/places';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Members {
  constructor(root, { people, here, onShowProfile = () => {} }) {
    Object.assign(this, { root, people, here, onShowProfile });
    this.open = false;
    root.className = 'members';
    root.innerHTML = `
      <button class="members-btn" aria-expanded="false" aria-haspopup="true"></button>
      <div class="members-panel" hidden></div>
      <div class="host-offer" role="alertdialog" hidden></div>
      <div class="door-picker" role="dialog" hidden></div>`;
    this.btn = root.querySelector('.members-btn');
    this.panel = root.querySelector('.members-panel');
    this.offer = root.querySelector('.host-offer');
    this.door = root.querySelector('.door-picker');
    this.door.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-host]');
      if (b) chooseRoomHost(b.dataset.host);
    });
    this.btn.onclick = () => this.toggle(!this.open);
    document.addEventListener('click', (e) => { if (this.open && !root.contains(e.target)) this.toggle(false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.toggle(false); });
    this.panel.addEventListener('click', (e) => {
      const make = e.target.closest('.make-host');
      if (make) { e.stopPropagation(); offerHost(make.dataset.ship); return; }
      const row = e.target.closest('.member-row');
      if (row) this.onShowProfile(row.dataset.ship);
    });
    this.offer.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-answer]');
      if (b) answerHostOffer(b.dataset.answer === 'yes');
    });
    onRooms(() => this.paint());
    onChange(() => this.paint(), (c) => c.field === 'profiles');
    this.paint();
  }

  toggle(open) {
    this.open = open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.paint();
  }

  /* Cheap to call often: nothing is rebuilt unless what it shows changed. */
  paint() {
    const place = this.here();
    const name = place === COMMONS ? 'The Commons' : roomById(place)?.name ?? 'Room';
    /* In a room, its host. In the commons there is no room host, only the host
     * of the huddle you are in, if any. */
    const host = rooms.host;
    const people = [...new Set(this.people())].sort((a, b) =>
      (b === our) - (a === our) || (b === host) - (a === host) ||
      displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase()));
    /* Hosting can be handed on in a room AND in a proximity huddle -- but only
     * to somebody who is in that call, never to a bystander standing about in
     * the commons. */
    const handOff = canHandOff();
    const ask = rooms.hostAsk, offer = rooms.hostOffer;
    const picker = rooms.picker;
    const signature = JSON.stringify([place, host, this.open, handOff, ask?.to ?? null,
      picker ? picker.options.map((o) => [o.host, o.count, displayName(o.host)]) : null,
      offer ? [offer.from, offer.place, !!offer.accepted] : null,
      people.map((s) => [s, displayName(s), avatarUrl(s), roleFor(s), mutedShip(s), handOff && mayHandTo(s)])]);
    if (signature === this.signature) return;
    this.signature = signature;

    this.btn.textContent = `${name} · ${people.length} ▾`;
    this.panel.hidden = !this.open;
    if (this.open) {
      this.panel.innerHTML = people.map((ship) => `
        <div class="member-row" data-ship="${esc(ship)}">
          <span class="av">${avatarUrl(ship) ? `<img src="${esc(avatarUrl(ship))}" alt="">` : ''}</span>
          <span class="who">${esc(displayName(ship))}${ship === our ? ' <span class="dim">(you)</span>' : ''}</span>
          ${ship === host ? `<span class="tag">${place === COMMONS ? 'huddle host' : 'host'}</span>` : ''}
          ${roleFor(ship) === 'admin' ? '<span class="tag">ADMIN</span>' : ''}
          ${mutedShip(ship) ? '<span class="tag">MUTED</span>' : ''}
          ${handOff && mayHandTo(ship)
            ? (ask?.to === ship ? '<span class="dim">asked…</span>' : `<button class="make-host" data-ship="${esc(ship)}">Make host</button>`)
            : ''}
        </div>`).join('');
    }
    /* At the door of a room whose copies the people we know are spread across. */
    this.door.hidden = !picker;
    if (picker) {
      const room = esc(roomById(picker.place)?.name ?? 'this room');
      this.door.innerHTML = `<span>People you know are in more than one ${room}. Join:</span>
        <div class="options">${picker.options.map((o) =>
          `<button data-host="${esc(o.host)}">${esc(displayName(o.host))} · ${o.count}</button>`).join('')}</div>`;
    }
    this.offer.hidden = !offer;
    if (offer) {
      const room = esc(offer.huddle ? 'this huddle' : roomById(offer.place)?.name ?? 'this room');
      this.offer.innerHTML = offer.accepted
        ? `<span>Taking over as host of ${room}…</span>`
        : `<span>${esc(displayName(offer.from))} asked you to host ${room}.</span>
           <div class="row"><button data-answer="yes">Accept</button><button data-answer="no">Decline</button></div>`;
    }
  }
}

/* Who is here with you.
 *
 * Everyone in the room you are standing in -- or, in the commons, everyone in
 * the commons. Only people you can see: the same people the world draws, so
 * someone outside your pals and dial is not listed even when they are there.
 *
 * The host is marked. In a room, the host can hand hosting to anyone in it;
 * that person is asked, and the call moves to them if they accept.
 */
import { displayName, avatarUrl, onChange, myGroupNotes, noteName, noteVisibility,
         inNote, noteCreator, askToJoinNote, noteFacts, joinAsked, refreshNotes } from 'lib/noltbook';
import { our } from 'lib/api';
import { rooms, onRooms, offerHost, answerHostOffer, canHandOff, mayHandTo, chooseRoomHost,
         roleFor, mutedShip, canLease, takeLease, releaseLease, leaseNote, leaseAt, learnLease,
         leaseHolder, onRoommates } from 'lib/rooms';
import { roomById, COMMONS } from 'world/places';
import { ask } from 'ui/ask';

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

    /* Taking a room, and giving it back: in the room's own menu, with the rest
     * of what this room is. */
    this.panel.addEventListener('click', (e) => {
      const give = e.target.closest('.lease-drop');
      if (give && !give.disabled) {
        /* A RELEASE THAT DOES NOT HAPPEN MUST NOT LEAVE A DEAD BUTTON.
         * The poke can fail or never be answered -- a slow channel, an agent
         * that has not been committed -- and the panel only repaints when
         * something has changed. Greying the button out and swallowing the
         * failure therefore left `Release` disabled and the room still held,
         * with nothing to click and nothing said. */
        give.disabled = true;
        give.textContent = 'Releasing…';
        const done = () => { this.signature = null; this.paint(); };
        releaseLease().then((released) => {
          if (released) return;
          console.warn('the lease was not given back');
          done();
        }, (error) => {
          console.warn('could not release the room', error);
          done();
        });
        return;
      }
      const join = e.target.closest('.lease-ask');
      if (join && !join.disabled) {
        const note = leaseNote(this.here());
        if (!note) return;
        join.disabled = true;
        /* Noltbook's own wording for the two waits. */
        join.textContent = join.textContent === 'JOIN' ? 'JOINING…' : 'REQUESTED';
        askToJoinNote(note, leaseHolder(this.here()) ?? noteCreator(note) ?? rooms.host).catch(() => {});
      }
    });
    this.panel.addEventListener('change', async (e) => {
      const pick = e.target.closest('select[data-lease]');
      if (!pick || !pick.value) return;
      const note = pick.value;
      pick.value = '';
      const held = rooms.lease;
      /* One lease at a time. Taking a second ends the first, and the people
       * still in that room lose it -- so say so before doing it. */
      if (held && held.place !== rooms.here) {
        const where = roomById(held.place)?.name ?? 'another room';
        const what = noteName(held.note) ?? held.note;
        const go = await ask(`Release ${where} and take this room?`, {
          yes: 'Take this room', no: 'Keep ' + where,
          detail: `You are holding ${where} for ${what}. You can hold one room at a time, so taking this one gives that one back.`,
        });
        if (!go) return;
      }
      takeLease(note).catch(() => {});
    });
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
    /* A room's guest list and its lease change on their own beat, not the
     * call's. Without this the menu waited for the next tick to notice that a
     * room had been leased, opened up or closed. */
    onRoommates(() => this.paint());
    /* A Noltbook note can admit us without anything changing in Glurff's room
     * subscription. Repaint on note facts too so JOINING becomes "saved here"
     * as soon as that membership arrives. */
    onChange(() => this.paint(), (c) =>
      c.field === 'profiles' || c.field === 'notes' || c.field === 'remoteNotes');
    this.paint();
  }

  /* THE LEASE. A room can be bound to one of your own Noltbook notes: while you
   * hold it, what is said here is saved there and the note's own settings --
   * public, private, secret, its members, its admins -- decide who may take
   * part. You hold one room at a time and give it back by hand. */
  leaseRow(place) {
    if (place === COMMONS || !canLease(place)) return '';
    const held = rooms.lease;
    const mine = held?.place === place;
    const bound = leaseNote(place);
    if (mine) {
      const what = noteName(held.note) ?? held.note;
      const vis = noteVisibility(held.note);
      return `<div class="lease held">
        <span class="who">${esc(what)}${vis ? ` <span class="dim">${esc(vis)}</span>` : ''}</span>
        <button class="lease-drop">Release</button>
      </div><div class="lease-note dim">Saved to this note.</div>`;
    }
    /* SOMEBODY ELSE'S LEASED ROOM. What we may know about it is the note's
     * own business, and it is exactly what Noltbook shows on a profile card:
     *
     *   public   its name, its description, who is in it, and a JOIN that
     *            needs nobody's permission;
     *   private  the same, with REQUEST JOIN -- the host or an admin decides;
     *   secret   that the room is closed, and not one word more. Its id never
     *            even travels (see roommates), so there is nothing to look up
     *            and nothing to ask for.
     */
    const { vis } = leaseAt(place);
    if (vis === 'secret' && !bound) {
      return `<div class="lease closed">
        <span class="who">Closed</span>
        <span class="dim">secret</span>
      </div><div class="lease-note dim">This room is somebody's secret note.</div>`;
    }
    if (bound) {
      learnLease(place);
      /* Ask the ship that actually holds the lease, which need not be the host
       * we are following. */
      const facts = noteFacts(leaseHolder(place) ?? rooms.host, bound)
        ?? { id: bound, name: null, headline: null, visibility: vis, users: [], member: inNote(bound), removed: false };
      const open = facts.visibility ?? vis;
      if (facts.member) {
        return `<div class="lease other">
          <span class="who">${esc(facts.name ?? 'a note')}</span>
          <span class="dim">saved here</span>
        </div>`;
      }
      /* Not in it. Noltbook's own words, so the two applications agree. */
      const badge = open === 'public' ? 'PUBLIC' : open === 'private' ? 'PRIVATE' : '';
      const button = facts.removed
        ? '<button class="lease-ask" disabled>REMOVED</button>'
        : joinAsked(bound)
        ? `<button class="lease-ask" disabled>${open === 'public' ? 'JOINING…' : 'REQUESTED'}</button>`
        : open === 'public'
        ? '<button class="lease-ask">JOIN</button>'
        : '<button class="lease-ask">REQUEST JOIN</button>';
      return `<div class="lease other">
          <span class="who">${esc(facts.name ?? 'a note')}</span>
          ${badge ? `<span class="tag">${badge}</span>` : ''}
        </div>
        ${facts.headline ? `<div class="lease-note dim">${esc(facts.headline)}</div>` : ''}
        ${open === 'public' && facts.users.length
          ? `<div class="lease-note dim">${facts.users.length} member${facts.users.length === 1 ? '' : 's'}</div>` : ''}
        <div class="lease-join">${button}</div>`;
    }
    const notes = myGroupNotes();
    if (!notes.length) return '';
    /* ONE CLICK opens the notes themselves. A button that reveals a second
     * control which then reveals the list is two doors to one room. */
    return `<div class="lease free"><select data-lease="1">
      <option value="">Select Note</option>
      ${notes.map((n) => `<option value="${esc(n.id)}">${esc(n.name ?? n.id)} · ${esc(n.visibility ?? '')}</option>`).join('')}
    </select></div>`;
  }

  toggle(open) {
    this.open = open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.paint();
    if (open) refreshNotes().catch(() => {});
  }

  /* Cheap to call often: nothing is rebuilt unless what it shows changed. */
  paint() {
    const place = this.here();
    const physicalName = place === COMMONS ? 'The Commons' : roomById(place)?.name ?? 'Room';
    const bound = leaseNote(place);
    const name = bound
      ? noteName(bound) ?? noteFacts(leaseHolder(place) ?? rooms.host, bound)?.name ?? physicalName
      : physicalName;
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
      rooms.lease ? [rooms.lease.place, rooms.lease.note] : null,
      name, bound, leaseAt(place).vis, inNote(bound ?? ''),
      joinAsked(bound ?? ''), myGroupNotes().length,
      people.map((s) => [s, displayName(s), avatarUrl(s), roleFor(s), mutedShip(s), handOff && mayHandTo(s)])]);
    if (signature === this.signature) return;
    this.signature = signature;

    this.btn.textContent = `${name} · ${people.length} ▾`;
    this.panel.hidden = !this.open;
    if (this.open) {
      this.panel.innerHTML = this.leaseRow(place) + people.map((ship) => `
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

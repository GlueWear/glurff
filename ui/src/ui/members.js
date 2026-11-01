/* Who is here with you.
 *
 * Everyone in the room you are standing in -- or, in the commons, everyone in
 * the commons. Only people you can see: the same people the world draws, so
 * someone outside your pals and dial is not listed even when they are there.
 *
 * Admins are marked -- the Glurff's host, its moderators and the call's own,
 * all as "admin" -- and an admin can make anybody below them an admin of this
 * call. Every call is held on the Glurff's host, so nobody here hosts one.
 */
import { displayName, avatarUrl, onChange, myGroupNotes, noteName, noteVisibility,
         inNote, noteCreator, askToJoinNote, noteFacts, joinAsked, refreshNotes } from 'lib/noltbook';
import { our } from 'lib/api';
import { rooms, onRooms, moderate, mayActOn, rankFor, canModerate,
         roleFor, mutedShip, canLease, takeLease, releaseLease, leaseNote, leaseAt, learnLease,
         leaseHolder, onRoommates } from 'lib/rooms';
import { roomById, COMMONS } from 'world/places';
import { ask } from 'ui/ask';
import { esc } from 'ui/html';
import { avatarHtml } from 'ui/avatar';


export class Members {
  constructor(root, { people, here, onShowProfile = () => {}, onGlurffMembers = null }) {
    Object.assign(this, { root, people, here, onShowProfile, onGlurffMembers });
    this.open = false;
    root.className = 'members';
    root.innerHTML = `
      <button class="members-btn" aria-expanded="false" aria-haspopup="true"></button>
      <div class="members-panel" hidden></div>`;
    this.btn = root.querySelector('.members-btn');
    this.panel = root.querySelector('.members-panel');

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
    this.btn.onclick = () => this.toggle(!this.open);
    document.addEventListener('click', (e) => { if (this.open && !root.contains(e.target)) this.toggle(false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.toggle(false); });
    this.panel.addEventListener('click', (e) => {
      /* EVERYBODY IN THE GLURFF, not only who is in this room (ui/glurff-members). */
      if (e.target.closest('.gm-open')) { e.stopPropagation(); this.toggle(false); this.onGlurffMembers?.(); return; }
      /* Making somebody an admin ASKS the Glurff's host -- or, in a leased
       * room, the note's -- and shows once the record says so. */
      const make = e.target.closest('.make-admin');
      if (make) {
        e.stopPropagation();
        make.disabled = true;
        moderate(make.dataset.ship, 'promote');
        return;
      }
      const row = e.target.closest('.member-row');
      if (row) this.onShowProfile(row.dataset.ship);
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
    /* Us first, then the admins of the call we are in, then everybody else. */
    const people = [...new Set(this.people())].sort((a, b) =>
      (b === our) - (a === our) || rankFor(b) - rankFor(a) ||
      displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase()));
    /* "Make admin" for anybody below us -- in this call, so only while we are
     * in one. */
    const promotable = (ship) => canModerate() && rankFor(ship) === 0 && mayActOn(ship);
    const signature = JSON.stringify([place, this.open,
      rooms.lease ? [rooms.lease.place, rooms.lease.note] : null,
      name, bound, leaseAt(place).vis, inNote(bound ?? ''),
      joinAsked(bound ?? ''), myGroupNotes().length,
      people.map((s) => [s, displayName(s), avatarUrl(s), roleFor(s), mutedShip(s), promotable(s)])]);
    if (signature === this.signature) return;
    this.signature = signature;

    /* How many are here, said as that: "· 1" alone read as a page number. */
    this.btn.textContent = `${name} · ${people.length} here ▾`;
    this.panel.hidden = !this.open;
    if (this.open) {
      const everybody = this.onGlurffMembers
        ? '<button type="button" class="gm-open">Glurff Members</button>' : '';
      this.panel.innerHTML = everybody + this.leaseRow(place) + people.map((ship) => `
        <div class="member-row" data-ship="${esc(ship)}">
          <span class="av">${avatarHtml(ship)}</span>
          <span class="who">${esc(displayName(ship))}${ship === our ? ' <span class="dim">(you)</span>' : ''}</span>
          ${roleFor(ship) ? '<span class="tag">ADMIN</span>' : ''}
          ${mutedShip(ship) ? '<span class="tag">MUTED</span>' : ''}
          ${promotable(ship) ? `<button class="make-admin" data-ship="${esc(ship)}">Make admin</button>` : ''}
        </div>`).join('');
    }
  }
}

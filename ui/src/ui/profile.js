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
  requestProfile, retryProfile, requestRemoteNotes, onChange, profileBio,
  updateOwnProfile, uploadOwnAvatar,
} from 'lib/noltbook';
import { our } from 'lib/api';
import { bioHtml, externalAvatar } from 'lib/profile-text';
import { sendNock, sendBlocked } from 'lib/wallet';
import { paintCharacter } from 'world/paint';
/* urbit-ob, and the big-number library behind it, is loaded the first time a
 * profile card is opened rather than with the app: nothing else needs it. */
let ob = null, obLoading = null;
const loadOb = () => obLoading ??= import('urbit-ob')
  .then((m) => { ob = m.clan ? m : m.default ?? m; return ob; }, () => null);
import { esc } from 'ui/html';
import { avatarHtml } from 'ui/avatar';
import { MAX_CLOCKS, LABEL_MAX, SIZE_MIN, SIZE_MAX, validZone, localZone, addClock, zoneChoices, GOLD_HUE } from 'lib/clocks';


const canvasBlob = (canvas, quality) => new Promise((resolve) =>
  canvas.toBlob(resolve, 'image/jpeg', quality));

async function resizeAvatar(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Choose an image file.');
  const src = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Glurff could not read that image.'));
      image.src = src;
    });
    const scale = Math.min(128 / image.width, 128 / image.height, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await canvasBlob(canvas, .72);
    if (blob?.size > 51200) blob = await canvasBlob(canvas, .5);
    if (!blob) throw new Error('Glurff could not prepare that image.');
    if (blob.size > 51200) throw new Error('The profile picture is still too large. Try a simpler image.');
    return blob;
  } finally { URL.revokeObjectURL(src); }
}

/* Point number and sponsor chain.
 *
 * `sein` and `clan` do this properly. Deriving a sponsor arithmetically from
 * the point (star = point % 65536) gives the WRONG ship: planet names are
 * Feistel-obfuscated, so ~mignes-magtel's star is ~macten, which no modulus
 * will produce. A comet is self-signed and stops the walk on its own.
 */
function azimuth(ship) {
  if (!ob) return null;
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

/* A time zone dropdown with `zone` chosen: every zone the browser knows, by
 * region; see zoneChoices. */
function zoneSelect(zone) {
  return `<select class="clock-zone">${zoneChoices(zone).map(({ region, zones }) => {
    const opts = zones.map((z) => `<option value="${esc(z.zone)}"${z.zone === zone ? ' selected' : ''}>${esc(z.label)}</option>`).join('');
    return region ? `<optgroup label="${esc(region)}">${opts}</optgroup>` : opts;
  }).join('')}</select>`;
}

export class ProfileCard {
  constructor(root, { onOpenDm, look, onEditCharacter, presenceOf, onWave, clocks = null, onArrangeClocks } = {}) {
    this.root = root;
    this.root.className = 'card-overlay';
    this.root.hidden = true;
    this.ship = null;
    this.onOpenDm = onOpenDm ?? (() => {});
    /* Your character is part of your profile, the way your picture is; the
     * editor is opened by clicking it. */
    this.look = look ?? (() => null);
    this.onEditCharacter = onEditCharacter ?? (() => {});
    /* Whether they are in the world with us, and asleep since when; and how to
     * wave at them. See lib/waves. */
    this.presenceOf = presenceOf ?? (() => null);
    this.onWave = onWave ?? (async () => ({ ok: false, why: 'absent' }));
    /* Our clocks in the sky, edited with the rest of our profile; see lib/clocks. */
    this.clocks = clocks;
    this.onArrangeClocks = onArrangeClocks ?? (() => {});
    this.sending = false;
    this.editing = false;
    this.saving = false;
    this.editError = '';
    this.avatarFile = null;
    this.avatarCleared = false;
    this.sprite = document.createElement('canvas');
    this.sprite.className = 'card-sprite';
    this.root.addEventListener('click', (e) => { if (e.target === this.root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.ship) this.close(); });
    /* Profiles and pal status arrive after the card is already on screen. */
    onChange((change) => {
      if (this.ship && (!this.editing || change.field === 'profiles')) this.paint();
    }, c => ['notes', 'profiles', 'pals', 'contacts', 'remoteNotes', 'lookups'].includes(c.field) && (!c.ship || c.ship === this.ship));
  }

  open(ship) {
    if (this.ship !== ship) {
      this.sending = false; this.status = ''; this.editing = false; this.saving = false;
      this.editError = ''; this.avatarFile = null; this.avatarCleared = false;
    }
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
    this.editing = false;
    this.saving = false;
    this.avatarFile = null;
    this.avatarCleared = false;
    this.root.hidden = true;
    this.root.innerHTML = '';
  }

  /* ---- OUR CLOCKS: text, time zone and size for each, and more of them.
   * Every change shows in the sky at once and is kept a moment later; the list
   * is only redrawn when a clock is added or removed, never under the caret. */
  paintClocks() {
    const list = this.root.querySelector('.clock-list');
    if (!list) return;
    const all = this.clocks.get().clocks;
    list.innerHTML = all.map((c, i) => `<div class="clock-row" data-id="${esc(c.id)}">
      <div class="clock-top"><span class="dim">${i === 0 ? 'YOUR PLANET' : `CLOCK ${i + 1}`}</span>${i === 0 ? '' : '<button type="button" class="clock-remove" title="Remove this clock">&times;</button>'}</div>
      <label><span>TEXT</span><input class="clock-label" maxlength="${LABEL_MAX}" value="${esc(c.label)}" autocomplete="off"></label>
      <label><span>${i === 0 ? 'YOUR TIME ZONE' : 'TIME ZONE'}</span>${zoneSelect(c.zone)}</label>
      ${i === 0 ? '<button type="button" class="clock-here">USE THIS COMPUTER\'S TIME ZONE</button>' : ''}
      <label><span>SIZE</span><input class="clock-size" type="range" min="${SIZE_MIN * 100}" max="${SIZE_MAX * 100}" step="5" value="${Math.round(c.size * 100)}"></label>
      <label><span>DAY COLOUR</span><span class="hue-row"><input class="clock-hue" type="range" min="0" max="359" step="1" value="${c.hue ?? GOLD_HUE}" title="Its colour by day; night stays grey"><button type="button" class="clock-gold"${c.hue === null ? ' disabled' : ''} title="Back to gold">GOLD</button></span></label>
    </div>`).join('');
    const add = this.root.querySelector('.b-add-clock');
    if (add) add.hidden = all.length >= MAX_CLOCKS;
  }

  wireClocks() {
    const box = this.root.querySelector('.card-clocks');
    if (!box) return;
    this.paintClocks();
    const change = (id, fn) => this.clocks.update((s) => {
      const c = s.clocks.find((k) => k.id === id);
      if (c) fn(c, s);
      return s;
    });
    const idOf = (el) => el.closest('.clock-row')?.dataset.id;
    box.addEventListener('input', (e) => {
      const t = e.target, id = idOf(t);
      if (!id) return;
      if (t.classList.contains('clock-label')) change(id, (c) => { c.label = t.value; });
      if (t.classList.contains('clock-size')) change(id, (c) => { c.size = Number(t.value) / 100; });
      if (t.classList.contains('clock-hue')) {
        change(id, (c) => { c.hue = Math.round(Number(t.value)) % 360; });
        const gold = t.closest('.clock-row').querySelector('.clock-gold');
        if (gold) gold.disabled = false;
      }
    });
    box.addEventListener('change', (e) => {
      const t = e.target, id = idOf(t);
      if (!id || !t.classList.contains('clock-zone')) return;
      const zone = t.value.trim();
      if (validZone(zone)) change(id, (c) => { c.zone = zone; });
    });
    box.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('.b-arrange')) { this.close(); this.onArrangeClocks(); return; }
      if (t.closest('.b-add-clock')) {
        this.clocks.update((s) => addClock(s, s.clocks[0]?.zone === localZone() ? 'UTC' : localZone()) ?? s);
        this.paintClocks();
        return;
      }
      const id = idOf(t);
      if (!id) return;
      if (t.closest('.clock-remove')) {
        this.clocks.update((s) => ({ ...s, clocks: s.clocks.filter((c) => c.id !== id) }));
        this.paintClocks();
      }
      if (t.closest('.clock-gold')) {
        change(id, (c) => { c.hue = null; });
        const row = t.closest('.clock-row');
        row.querySelector('.clock-hue').value = GOLD_HUE;
        t.disabled = true;
        return;
      }
      if (t.closest('.clock-here')) {
        const zone = localZone();
        change(id, (c) => { c.zone = zone; });
        const select = t.closest('.clock-row').querySelector('.clock-zone');
        if (![...select.options].some((o) => o.value === zone)) select.insertAdjacentHTML('afterbegin', `<option value="${esc(zone)}">${esc(zone)}</option>`);
        select.value = zone;
      }
    });
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
    /* The rank and sponsor line fills in a moment later the first time. */
    if (!ob) loadOb().then((loaded) => { if (loaded && this.ship === ship && !this.root.hidden && !this.editing) this.paint(); });
    const az = azimuth(ship);
    const notes = nb.remoteNotes[ship] ?? [];
    const lookup = nb.lookups[ship];
    const dm = dmWith(ship);
    const worn = this.look(ship);
    const profile = nb.profiles[ship] ?? {};
    const bio = profileBio(ship);
    const externalUrl = profile.avatar?.type === 'external' ? profile.avatar.url ?? '' : '';
    const here = ship === our ? null : this.presenceOf(ship);
    const idleMin = Number.isFinite(here?.idleSince) ? Math.max(1, Math.round((Date.now() - here.idleSince) / 60000)) : null;

    this.root.innerHTML = `
      <div class="card">
        <button class="card-x" title="Close">&times;</button>
        <div class="card-top">
          <div class="card-av">${avatarHtml(ship)}</div>
          <div class="card-id">
            <div class="card-name">${esc(displayName(ship))}</div>
            <div class="card-ship">${esc(ship)}</div>
            ${az ? `<div class="dim">${az.rank} &middot; ${esc(az.point)}</div>` : ''}
            ${az?.chain.length ? `<div class="dim">sponsor ${az.chain.map(esc).join(' &rarr; ')}</div>` : ''}
          </div>
        </div>
        ${!this.editing && bio ? `<div class="card-bio"><span class="dim">BIO</span><div>${bioHtml(bio)}</div></div>` : ''}
        ${ship !== our && LOOKUP[lookup] ? `<div class="card-lookup ${LOOKUP[lookup][1] ? 'busy' : 'done'}" data-state="${lookup}"${LOOKUP[lookup][1] ? ' aria-busy="true"' : ' role="button" tabindex="0"'}><span>${LOOKUP[lookup][0]}</span>${LOOKUP[lookup][1] ? '<span class="dots"><i></i><i></i><i></i></span>' : ''}</div>` : ''}
        ${worn ? `<div class="card-me">
          <div class="card-sprite-slot"></div>
          <div class="card-me-text">${ship === our
            ? '<span class="dim">Your character</span><button class="b-edit">EDIT CHARACTER</button>'
            : `<span class="dim">${idleMin ? `In Glurff · idle ${idleMin} min` : 'In Glurff now'}</span>`}</div>
        </div>` : ''}
        ${ship === our ? `${this.editing ? '' : '<div class="card-btns"><button class="b-profile-edit">EDIT PROFILE</button></div>'}
        ${this.editing ? `<form class="card-profile-form">
          <label><span>USER NAME</span><input class="profile-name" maxlength="32" value="${esc(profile.displayName ?? '')}" placeholder="set display name…" autocomplete="off"></label>
          <label><span>BIO</span><textarea class="profile-bio" placeholder="say something about yourself…">${esc(bio)}</textarea></label>
          <label><span>PROFILE PICTURE URL</span><input class="profile-avatar-url" type="url" value="${esc(externalUrl)}" placeholder="https://…" autocomplete="off"></label>
          <label class="profile-file"><span>OR UPLOAD A PICTURE</span><input class="profile-avatar-file" type="file" accept="image/*"></label>
          <div class="profile-picture-state dim">${profile.avatar?.type === 'urbit' ? 'An uploaded picture is currently in use.' : ''}</div>
          <div class="profile-edit-actions">
            <button type="button" class="b-profile-clear">REMOVE PICTURE</button>
            <span class="spacer"></span>
            <button type="button" class="b-profile-cancel">CANCEL</button>
            <button type="submit" class="b-profile-save"${this.saving ? ' disabled' : ''}>${this.saving ? 'SAVING…' : 'SAVE'}</button>
          </div>
          <div class="profile-edit-status" role="status">${esc(this.editError)}</div>
        </form>
        ${this.clocks ? `<div class="card-clocks">
          <div class="clocks-head"><span>CLOCKS</span><button type="button" class="b-arrange" title="Drag your clocks where you want them">ARRANGE</button></div>
          <div class="clock-list"></div>
          <button type="button" class="b-add-clock">ADD CLOCK</button>
        </div>` : ''}` : ''}` : `
        <div class="card-btns">
          ${here?.inWorld && !blocked ? '<button class="b-wave" title="Get their attention">WAVE</button>' : ''}
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
    if (ship === our && this.editing && this.clocks) this.wireClocks();
    if (ship === our) {
      const edit = q('.b-profile-edit');
      if (edit) edit.onclick = () => {
        this.editing = true; this.editError = ''; this.avatarFile = null; this.avatarCleared = false;
        this.paint(); this.root.querySelector('.profile-name')?.focus();
      };
      const form = q('.card-profile-form');
      if (form) {
        const file = form.querySelector('.profile-avatar-file');
        const pictureState = form.querySelector('.profile-picture-state');
        file.onchange = () => {
          this.avatarFile = file.files?.[0] ?? null;
          this.avatarCleared = false;
          if (this.avatarFile) pictureState.textContent = `${this.avatarFile.name} selected.`;
        };
        form.querySelector('.b-profile-clear').onclick = () => {
          this.avatarFile = null; this.avatarCleared = true; file.value = '';
          form.querySelector('.profile-avatar-url').value = '';
          pictureState.textContent = 'The profile picture will be removed when you save.';
        };
        form.querySelector('.b-profile-cancel').onclick = () => {
          this.editing = false; this.saving = false; this.editError = '';
          this.avatarFile = null; this.avatarCleared = false; this.paint();
        };
        form.onsubmit = async (event) => {
          event.preventDefault();
          if (this.saving) return;
          const displayName = form.querySelector('.profile-name').value.trim();
          const bioText = form.querySelector('.profile-bio').value.trim();
          const typedUrl = form.querySelector('.profile-avatar-url').value.trim();
          let avatar;
          if (!this.avatarFile && !this.avatarCleared && typedUrl !== externalUrl) {
            const safe = externalAvatar(typedUrl);
            if (typedUrl && !safe) {
              this.editError = 'Profile picture links must begin with http:// or https://.';
              form.querySelector('.profile-edit-status').textContent = this.editError;
              return;
            }
            avatar = safe ? { type: 'external', url: safe } : null;
          } else if (this.avatarCleared) avatar = null;
          this.saving = true; this.editError = '';
          const save = form.querySelector('.b-profile-save');
          save.disabled = true; save.textContent = 'SAVING…';
          try {
            const fields = { displayName, bio: bioText };
            if (this.avatarFile) await uploadOwnAvatar(await resizeAvatar(this.avatarFile), fields);
            else await updateOwnProfile(avatar === undefined ? fields : { ...fields, avatar });
            if (this.ship !== ship) return;
            this.editing = false; this.saving = false; this.avatarFile = null; this.avatarCleared = false;
            this.paint();
          } catch (error) {
            if (this.ship !== ship) return;
            this.saving = false;
            this.editError = error?.result?.message || error?.message || 'Noltbook could not update the profile.';
            this.paint();
          }
        };
      }
      return;
    }
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
    const wave = q('.b-wave');
    if (wave) wave.onclick = async () => {
      wave.disabled = true;
      const r = await this.onWave(ship);
      if (this.ship !== ship) return;
      wave.disabled = false;
      this.say(r.ok ? 'Waved 👋' : r.why === 'soon' ? 'You just waved. Give them a moment.' : 'Not in Glurff right now.');
    };
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

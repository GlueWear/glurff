/* THE RINGED PLANET: YOUR GLURFFS (2026-11-07; a placeholder since 2026-10-31).
 *
 * The Glurffs you are a member of (lib/glurffs): how many people are in each
 * now, which is home -- where Glurff opens -- and going to one. Closed, the
 * planet shows one number: in green, how many people are in them all; in
 * amber instead, how many are waiting for you to let them in (2026-11-08).
 *
 * A row opens to what can be done with that Glurff: visit it, copy its
 * invite link (its note's link, as Noltbook copies it), make it home, invite
 * people, let in those who asked, or end your membership of it -- asked
 * twice, since a private one has to let you in again (2026-11-09). Who may do
 * what is Noltbook's rule for the note: anybody in a public or private one
 * may share its link, its host and admins invite and let people in, and
 * nobody leaves their own -- nor their home, until another is home.
 */
import { inviteLink } from 'lib/glurffs';
import { OFFLINE } from 'lib/glurff-online';

const PLANET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" aria-hidden="true">
  <circle cx="12" cy="12.2" r="6.4"/>
  <path d="M1.52 15.61A10.8 2.4 -14 0 0 22.48 10.39M1.52 15.61A10.8 2.4 -14 0 1 4.74 12.93M18.79 9.51A10.8 2.4 -14 0 1 22.48 10.39"/>
</svg>`;
const OPEN_TO = {
  public: 'Public: anybody can join.',
  private: 'Private: people ask, and the host or an admin lets them in.',
  secret: 'Secret: only people who are invited, and nobody else can see it.',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isShip = (s) => /^~[a-z]{3}(-?[a-z]{3}){0,7}$/.test(s);
/* A Glurff's icon (its Noltbook note's) over its first letter, which shows
 * where there is none or it does not load. */
const iconOf = (r) => `<span class="g-icon" aria-hidden="true">${esc(r.name.trim().replace(/^~/, '').charAt(0).toUpperCase())}${r.icon ? `<img src="${esc(r.icon)}" alt="" onerror="this.remove()">` : ''}</span>`;

export class GlurffsPanel {
  /* glurffs: lib/glurffs. go(host): to that Glurff. name(ship): who they are.
   * people(): ships we know, for inviting. ask: Glurff's question box.
   * visiting: the host of the Glurff we are in, when it is not ours, and
   * theirs(host): the Glurffs that ship is in (lib/world-card glurffsOf). */
  constructor(root, { glurffs, go, name = (s) => s, people = () => [], ask, visiting = null, theirs = async () => null }) {
    Object.assign(this, { root, glurffs, go, name, people, ask, visiting, theirs });
    this.open = false; this.expanded = null;
    /* THE GLURFFS OUR HOST IS IN (2026-11-08): asked when the panel opens,
     * again after a minute; the filter for a long list. */
    this.other = { list: undefined, at: 0, filter: '' };
    root.className = 'glurffs';
    root.innerHTML = `
      <button type="button" class="glurffs-btn" data-tip="Your Glurffs" aria-label="Your Glurffs" aria-expanded="false" aria-haspopup="true">${PLANET}<i class="g-badge" hidden></i></button>
      <div class="glurffs-panel" hidden>
        <div class="glurffs-head">Your Glurffs</div>
        <div class="glurffs-status" role="status" hidden></div>
        <div class="glurffs-list"></div>
      </div>`;
    this.btn = root.querySelector('.glurffs-btn');
    this.panel = root.querySelector('.glurffs-panel');
    this.status = root.querySelector('.glurffs-status');
    this.list = root.querySelector('.glurffs-list');
    this.btn.onclick = () => this.toggle(!this.open);
    this.list.addEventListener('click', (e) => this.act(e));
    this.list.addEventListener('input', (e) => { if (e.target.matches('.g-filter')) { this.other.filter = e.target.value; this.paintOther(); } });
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !root.contains(e.target) && !e.target.closest?.('.ask-overlay, dialog.g-invite')) this.toggle(false);
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open && !document.querySelector('dialog.g-invite[open]')) this.toggle(false); });
    glurffs.on(() => this.paint());
    this.paint();
  }

  toggle(open) {
    this.open = open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.panel.hidden = !open;
    if (!open) return;
    this.say('');
    void this.glurffs.refreshActivity();
    void this.glurffs.discover();
    this.glurffs.checkOwn();
    this.glurffs.check(true);
    this.paint();
    if (this.visiting && Date.now() - this.other.at > 60_000) {
      this.other.at = Date.now();
      this.theirs(this.visiting).then((list) => { this.other.list = list; this.paint(); });
    }
  }
  say(text) { this.status.hidden = !text; this.status.textContent = text; }

  paint() {
    const b = this.glurffs.badge();
    const dot = this.btn.querySelector('.g-badge');
    dot.hidden = !b.requests && !b.people;
    dot.classList.toggle('asks', !!b.requests);
    dot.textContent = b.requests || b.people || '';
    const tip = ['Your Glurffs', b.people && `${b.people} ${b.people === 1 ? 'person' : 'people'} in them`,
      b.requests && `${b.requests} asking to join`].filter(Boolean).join(' · ');
    this.btn.dataset.tip = tip; this.btn.setAttribute('aria-label', tip);
    if (!this.open) return;
    const rows = this.glurffs.rows();
    if (this.expanded == null) this.expanded = rows.find((r) => r.requests.length)?.note ?? null;
    const filtering = document.activeElement?.matches?.('.g-filter');
    if (filtering) return this.paintOther();
    this.list.innerHTML = (rows.map((r) => this.row(r)).join('') || '<div class="g-empty dim">None yet.</div>') + this.otherHtml();
  }

  /* The Glurffs the host of this one is in: the place to find others. */
  otherHtml() {
    if (!this.visiting) return '';
    const l = this.other.list, many = Array.isArray(l) && l.length > 12;
    return `<div class="glurffs-head g-other-head">${esc(this.name(this.visiting))}'s Glurffs</div>
      ${many ? `<input class="g-filter" type="search" placeholder="Find a Glurff" aria-label="Find a Glurff" value="${esc(this.other.filter)}">` : ''}
      <div class="g-other">${this.otherRows()}</div>`;
  }
  otherRows() {
    const l = this.other.list;
    if (l === undefined) return '<div class="g-empty dim">Asking…</div>';
    if (l === null) return '<div class="g-empty dim">Their Glurff does not say.</div>';
    const q = this.other.filter.trim().toLowerCase();
    const shown = l.filter((g) => !q || g.name.toLowerCase().includes(q) || g.host.includes(q))
      .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
    if (!shown.length) return `<div class="g-empty dim">${q ? 'None by that name.' : 'None yet.'}</div>`;
    const mine = new Set(this.glurffs.rows().map((r) => r.note));
    return shown.map((g) => `<div class="g-row g-listed" data-host="${esc(g.host)}">
      <div class="g-sum">${iconOf({ name: g.name || g.host })}<span class="g-name">${esc(g.name || g.host)}</span>
        ${mine.has(g.note) ? '<span class="g-tag">Yours</span>' : ''}<span class="g-count dim">${g.members} ${g.members === 1 ? 'member' : 'members'}</span>
        <button data-act="visit">Visit</button></div></div>`).join('');
  }
  paintOther() { const box = this.list.querySelector('.g-other'); if (box) box.innerHTML = this.otherRows(); }

  row(r) {
    if (r.waiting) return `<div class="g-row waiting"><div class="g-sum"><span class="g-live"></span>
      ${iconOf(r)}<span class="g-name">${esc(r.name)}</span><span class="g-count dim">asked to join</span></div>
      <div class="g-more"><div class="dim">Waiting for ${esc(this.name(r.host))} to let you in. It will be here when they do.</div></div></div>`;
    const open = this.expanded === r.note;
    /* OFFLINE (2026-11-10): kept, greyed, said on hover -- the browser's own
     * hover text, which the list's edge cannot cut off; Visit asks again. */
    const people = r.offline ? 'offline' : r.count ? `${r.count} here` : 'nobody here';
    const tags = [r.home && '<span class="g-tag">Home</span>', r.here && '<span class="g-tag here">You are here</span>'].filter(Boolean).join('');
    const link = r.visibility === 'public' || r.visibility === 'private';
    const acts = [
      !r.here && `<button data-act="go">Visit</button>`,
      link && `<button data-act="link">Copy invite link</button>`,
      !r.home && !r.offline && `<button data-act="home">Make home</button>`,
      r.admin && `<button data-act="invite">Invite people…</button>`,
      !r.own && !r.home && `<button data-act="leave" class="danger">End membership…</button>`,
    ].filter(Boolean).join('');
    const requests = r.requests.map((q) => `<div class="g-ask" data-ship="${esc(q.ship)}">
      <span class="g-who">${esc(this.name(q.ship))}${this.name(q.ship) !== q.ship ? ` <span class="dim">${esc(q.ship)}</span>` : ''} asks to join</span>
      <span class="g-ask-acts"><button data-act="in">Let in</button><button data-act="out">Turn away</button><button data-act="block" class="danger">Block</button></span></div>`).join('');
    return `<div class="g-row${r.here ? ' here' : ''}${r.offline ? ' offline' : ''}${open ? ' open' : ''}" data-note="${esc(r.note)}" data-host="${esc(r.host)}">
      <button type="button" class="g-sum" aria-expanded="${open}"${r.offline ? ` title="${OFFLINE}"` : ''}><span class="g-live${r.count ? ' on' : ''}"></span>
        ${iconOf(r)}<span class="g-name">${esc(r.name)}</span>${tags}<span class="g-count${r.count ? '' : ' dim'}">${people}</span>${r.requests.length ? `<span class="g-asking">${r.requests.length}</span>` : ''}</button>
      ${open ? `<div class="g-more">
        <div class="dim">${r.own ? 'Your Glurff' : `Hosted by ${esc(this.name(r.host))}${this.name(r.host) !== r.host ? ` (${esc(r.host)})` : ''}`}${r.offline ? ` · ${OFFLINE}.${r.own ? ' Publish it from the editor to open it.' : ''}` : r.visibility ? ` · ${OPEN_TO[r.visibility] ?? ''}` : ''}</div>
        ${requests}
        <div class="g-acts">${acts}</div>
      </div>` : ''}
    </div>`;
  }

  async act(e) {
    const listed = e.target.closest('.g-listed');
    if (listed) { if (e.target.closest('button[data-act="visit"]')) { this.toggle(false); this.go(listed.dataset.host); } return; }
    const rowEl = e.target.closest('.g-row'); if (!rowEl || rowEl.classList.contains('waiting')) return;
    const note = rowEl.dataset.note, host = rowEl.dataset.host;
    const r = this.glurffs.rows().find((x) => x.note === note); if (!r) return;
    if (e.target.closest('.g-sum')) { this.expanded = this.expanded === note ? null : note; this.say(''); this.paint(); return; }
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const what = b.dataset.act;
    try {
      if (what === 'go') { this.toggle(false); return this.go(host); }
      if (what === 'home') { this.glurffs.setHome(host); return this.say(`${r.name} is home: Glurff opens there.`); }
      if (what === 'link') {
        await navigator.clipboard.writeText(inviteLink(note, host, r.name));
        return this.say('Invite link copied. Paste it into Noltbook, or any chat in Glurff.');
      }
      if (what === 'invite') return this.invite(r);
      if (what === 'leave') {
        const back = r.visibility === 'public' ? 'To come back, you join it again.'
          : r.visibility === 'private' ? 'To come back, you ask to be let in again.' : 'To come back, you have to be invited again.';
        const yes = await this.ask(`Are you sure you no longer want to be a member of ${r.name}?`, { yes: 'END MEMBERSHIP', no: 'STAY A MEMBER', careful: true,
          detail: `It leaves your Glurffs${r.here ? ', and you go home' : ''}. ${back}` });
        if (!yes) return;
        await this.glurffs.leave(note);
        if (r.here) return this.go(this.glurffs.home(), { quiet: true });
        return this.say(`You are no longer a member of ${r.name}.`);
      }
      const ship = e.target.closest('.g-ask')?.dataset.ship;
      if (ship && ['in', 'out', 'block'].includes(what)) {
        b.disabled = true;
        await this.glurffs.answer(note, ship, what);
        return this.say({ in: `${this.name(ship)} is in.`, out: `${this.name(ship)} was turned away.`, block: `${this.name(ship)} was turned away and blocked.` }[what]);
      }
    } catch (error) {
      console.warn('glurffs:', error);
      this.say(`That did not work: ${error.message ?? error}`);
    }
  }

  /* INVITE PEOPLE: whoever is chosen is a member at once (Noltbook's
   * add-member), and finds it in their Glurffs and in Noltbook. */
  invite(r) {
    const dlg = document.createElement('dialog');
    dlg.className = 'g-invite';
    dlg.innerHTML = `<h3>Invite people to ${esc(r.name)}</h3>
      <input type="text" placeholder="Their name or ~ship" autocomplete="off" spellcheck="false">
      <div class="g-pick"></div><div class="g-said dim" role="status"></div>
      <div class="g-invite-acts"><button type="button" class="g-done">Done</button></div>`;
    document.body.append(dlg);
    const input = dlg.querySelector('input'), pick = dlg.querySelector('.g-pick'), said = dlg.querySelector('.g-said');
    const find = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { pick.innerHTML = ''; return; }
      const typed = isShip(`~${q.replace(/^~/, '')}`) ? `~${q.replace(/^~/, '')}` : null;
      const hits = this.people().filter((s) => s.includes(q) || this.name(s).toLowerCase().includes(q)).slice(0, 8);
      if (typed && !hits.includes(typed)) hits.unshift(typed);
      pick.innerHTML = hits.map((s) => `<button type="button" data-ship="${esc(s)}"><strong>${esc(this.name(s))}</strong>${this.name(s) !== s ? ` <span class="dim">${esc(s)}</span>` : ''}</button>`).join('')
        || '<div class="dim">Nobody by that name you know of. Type their ~ship.</div>';
    };
    input.addEventListener('input', find);
    pick.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-ship]'); if (!b) return;
      b.disabled = true; said.textContent = `Inviting ${this.name(b.dataset.ship)}…`;
      try { await this.glurffs.invite(r.note, b.dataset.ship); said.textContent = `${this.name(b.dataset.ship)} is a member now. It is in their Glurffs.`; }
      catch (error) { said.textContent = `Not invited: ${error.message ?? error}`; b.disabled = false; }
    });
    dlg.querySelector('.g-done').onclick = () => dlg.close();
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal(); input.focus();
  }
}

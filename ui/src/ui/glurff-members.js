/* GLURFF MEMBERS (2026-10-31): everybody in the Glurff's note, here or not,
 * from the room-name menu -- a panel on a desktop, a sheet on a phone.
 *
 * Who is in it, who is an admin, who is muted and who is blocked are all the
 * note's (lib/glurff-members). The host and the note's admins manage people
 * here without leaving for Noltbook: each row has one small menu, and whatever
 * is asked for shows as asked until the note itself says it is so -- and then
 * the host is asked to make it so in every call (lib/glurff callRecheck).
 *
 * "Here" is shown only for somebody we can see is here. Not seeing somebody
 * is not knowing that they are away, so nothing is said about anybody else.
 */
import { actionsFor, counts, visibleRows, manage, roleOf, LABELS, FILTERS } from 'lib/glurff-members';
import { esc } from 'ui/html';
import { avatarHtml } from 'ui/avatar';

const FILTER_NAMES = { all: 'All', admins: 'Admins', muted: 'Muted', blocked: 'Blocked' };
const DOING = { mute: 'Muting…', unmute: 'Unmuting…', block: 'Blocking…', unblock: 'Unblocking…',
  promote: 'Making admin…', demote: 'Removing admin…' };
const DONE = { mute: 'muted', unmute: 'unmuted', block: 'blocked from this Glurff', unblock: 'unblocked',
  promote: 'made an admin', demote: 'no longer an admin' };
/* What a refusal from Noltbook means, in words. */
const REFUSED = { rejected: 'Noltbook did not allow that.', 'invalid-ship': 'That is not a ship.',
  'missing-note': 'This Glurff’s note is not on this ship.' };

export class GlurffMembers {
  constructor({ our, host, load, request, recheck = () => {}, rows = () => null, name = (s) => s,
    present = () => false, onShowProfile = () => {}, onBack = () => {}, onChange = null } = {}) {
    Object.assign(this, { our, host, load, request, recheck, rowsNow: rows, name, present, onShowProfile, onBack });
    this.open = false; this.query = ''; this.filter = 'all';
    this.pending = new Map();   //  ship -> op
    this.notes = new Map();     //  ship -> {text, bad}
    this.menuFor = null; this.error = ''; this.loading = false;
    this.root = document.createElement('div');
    this.root.className = 'gm-overlay'; this.root.hidden = true;
    this.root.innerHTML = `<section class="gm" role="dialog" aria-modal="true" aria-labelledby="gm-title">
      <header class="gm-head">
        <button type="button" class="gm-back" aria-label="Back to the room" title="Back to the room">‹</button>
        <h3 id="gm-title">Glurff Members</h3>
        <button type="button" class="gm-close" aria-label="Close" title="Close">×</button>
      </header>
      <div class="gm-tools">
        <input type="search" class="gm-search" placeholder="Search by name or @p" aria-label="Search Glurff members" autocomplete="off">
        <div class="gm-filters" role="group" aria-label="Show"></div>
      </div>
      <div class="gm-status" role="status"></div>
      <div class="gm-list" role="list"></div>
    </section>`;
    document.body.appendChild(this.root);
    this.list = this.root.querySelector('.gm-list');
    this.root.querySelector('.gm-close').onclick = () => this.close();
    /* The room menu shuts on a click outside it: this click is not one. */
    this.root.querySelector('.gm-back').onclick = (e) => { e.stopPropagation(); this.close(); this.onBack(); };
    this.root.addEventListener('pointerdown', (e) => { if (e.target === this.root) this.close(); });
    this.root.querySelector('.gm-search').addEventListener('input', (e) => { this.query = e.target.value; this.paint(); });
    this.root.querySelector('.gm-filters').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-filter]');
      if (b) { this.filter = b.dataset.filter; this.paint(); }
    });
    this.list.addEventListener('click', (e) => {
      const more = e.target.closest('.gm-more');
      if (more) { e.stopPropagation(); this.menuFor = this.menuFor === more.dataset.ship ? null : more.dataset.ship; this.paint(); return; }
      const act = e.target.closest('.gm-act');
      if (act) { e.stopPropagation(); void this.act(act.dataset.op, act.dataset.ship); return; }
      const who = e.target.closest('.gm-who');
      if (who) this.onShowProfile(who.closest('.gm-row').dataset.ship);
    });
    window.addEventListener('keydown', (e) => {
      if (!this.open || e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      if (this.menuFor) { this.menuFor = null; this.paint(); } else this.close();
    }, true);
    /* The note changing under us -- here or in Noltbook -- is read again. */
    onChange?.(() => { if (this.open) this.reload(); });
  }

  show() {
    this.open = true; this.root.hidden = false; this.menuFor = null;
    this.paint(); this.reload();
    this.root.querySelector('.gm-search').focus({ preventScroll: true });
  }
  close() { this.open = false; this.root.hidden = true; this.menuFor = null; }

  reload() {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    Promise.resolve(this.load()).then(() => { this.error = ''; }, () => {
      this.error = 'Could not read this Glurff’s members from Noltbook.';
    }).finally(() => {
      this.loading = false; this.paint();
      if (this.again) { this.again = false; this.reload(); }
    });
  }

  async act(op, ship) {
    if (this.pending.has(ship)) return;
    this.menuFor = null; this.pending.set(ship, op); this.notes.delete(ship); this.paint();
    try {
      const how = await manage(op, ship, {
        request: (action, who) => this.request(action, who),
        reload: async () => { await this.load(); return this.rowsNow() ?? []; },
        after: (_, who) => this.recheck(who),
      });
      const who = (this.rowsNow() ?? []).find((r) => r.ship === ship)?.name ?? this.name(ship);
      this.notes.set(ship, how === 'done'
        ? { text: `${who} is ${DONE[op]}.` }
        : { text: 'Asked. Waiting for the note to confirm it.' });
    } catch (e) {
      const code = e?.result?.code;
      this.notes.set(ship, { bad: true, text: REFUSED[code] ?? (e?.message?.includes('timed out')
        ? 'Noltbook did not answer. Nothing has changed.' : 'That did not work. Nothing has changed.') });
    } finally {
      this.pending.delete(ship); this.paint();
    }
  }

  paint() {
    if (!this.open) return;
    const rows = this.rowsNow();
    const c = counts(rows ?? []);
    const filters = FILTERS.map((f) => `<button type="button" data-filter="${f}" aria-pressed="${this.filter === f}"${
      this.filter === f ? ' class="on"' : ''}>${FILTER_NAMES[f]} <span class="n">${c[f]}</span></button>`).join('');
    const bar = this.root.querySelector('.gm-filters');
    if (bar.dataset.html !== filters) { bar.innerHTML = filters; bar.dataset.html = filters; }
    const mine = roleOf(rows ?? [], this.our, this.host);
    const status = this.error || (rows === null ? 'Reading the members…' : '');
    this.root.querySelector('.gm-status').textContent = status;
    if (rows === null) { this.list.innerHTML = ''; return; }
    const shown = visibleRows(rows, { query: this.query, filter: this.filter, name: this.name });
    const html = shown.map((r) => this.row(r, rows)).join('') ||
      `<div class="gm-empty dim">${this.query ? 'Nobody matches.' : this.filter === 'blocked' ? 'Nobody is blocked.'
        : this.filter === 'muted' ? 'Nobody is muted.' : 'Nobody here yet.'}</div>`;
    const sig = JSON.stringify([html, mine]);
    if (this.list.dataset.sig !== sig) { this.list.innerHTML = html; this.list.dataset.sig = sig; }
  }

  row(r, rows) {
    const name = r.name ?? this.name(r.ship);
    const tags = [r.ship === this.host || r.role === 'host' ? '<span class="tag gm-host">HOST</span>'
      : r.role === 'admin' ? '<span class="tag">ADMIN</span>' : '',
      r.muted ? '<span class="tag gm-muted">MUTED</span>' : '',
      r.removed ? '<span class="tag gm-blocked">BLOCKED</span>' : '',
      !r.removed && (r.ship === this.our || this.present(r.ship)) ? '<span class="gm-here" title="In the Glurff now">here</span>' : '',
    ].join('');
    const busy = this.pending.get(r.ship);
    const can = busy ? [] : actionsFor(rows, this.our, r, this.host);
    const note = this.notes.get(r.ship);
    const menu = this.menuFor === r.ship && can.length
      ? `<div class="gm-menu" role="menu">${can.map((op) => `<button type="button" role="menuitem" class="gm-act${
          op === 'block' ? ' danger' : ''}" data-op="${op}" data-ship="${esc(r.ship)}">${esc(LABELS[op])}</button>`).join('')}</div>` : '';
    return `<div class="gm-row${r.removed ? ' removed' : ''}" role="listitem" data-ship="${esc(r.ship)}">
      <span class="av">${avatarHtml(r.ship)}</span>
      <button type="button" class="gm-who"><span class="gm-name">${esc(name)}${r.ship === this.our ? ' <span class="dim">(you)</span>' : ''}</span>
        <span class="gm-ship dim">${esc(r.ship)}</span></button>
      <span class="gm-tags">${tags}</span>
      ${busy ? `<span class="gm-busy dim">${esc(DOING[busy])}</span>`
        : can.length ? `<button type="button" class="gm-more" data-ship="${esc(r.ship)}" aria-haspopup="menu" aria-expanded="${this.menuFor === r.ship}"
          aria-label="Manage ${esc(name)}" title="Manage">⋯</button>` : ''}
      ${menu}
      ${note ? `<div class="gm-note${note.bad ? ' bad' : ''}" role="status">${esc(note.text)}</div>` : ''}
    </div>`;
  }
}

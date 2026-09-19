/* ADMIN and REC.
 *
 * Two panels that live OUTSIDE the rail's markup, for the same reason the call
 * settings do: the rail redraws several times a second by replacing its
 * innerHTML, and a panel rendered inside it is destroyed and rebuilt between
 * the click and the eye. These are built once and only their contents change.
 *
 * Neither panel decides anything. What they show is the authoritative record
 * the call's host keeps (lib/moderation), and pressing a button ASKS -- the
 * answer arrives as a snapshot like everybody else's. A button is never the
 * reason somebody is an admin.
 */
import { rooms, onRooms, moderate, mayActOn, roleFor, mutedShip, bootedShip, canModerate,
         mayRecord, startRecording, stopRecording, recordingElapsed } from 'lib/rooms';
import { displayName } from 'lib/noltbook';
import { our } from 'lib/api';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export class CallPanels {
  constructor(root, { members = () => [] } = {}) {
    this.root = root;
    this.root.className = 'call-panels';
    this.members = members;
    this.adminOpen = false;
    this.recOpen = false;
    /* The BUTTONS are the rail's, beside the microphone, camera and screen --
     * that is where the call's controls live. The panels are here, outside the
     * markup the rail replaces several times a second, and are opened by the
     * event those buttons send. */
    this.root.innerHTML = `
      <div class="call-rec-notice" role="status" hidden></div>
      <div class="call-panel admin" role="dialog" aria-label="Call moderation" hidden></div>
      <div class="call-panel rec" role="dialog" aria-label="Recording" hidden></div>`;
    this.notice = this.root.querySelector('.call-rec-notice');
    this.admin = this.root.querySelector('.call-panel.admin');
    this.rec = this.root.querySelector('.call-panel.rec');
    window.addEventListener('glurff-call-panel', (e) => {
      if (e.detail === 'admin') { this.adminOpen = !this.adminOpen; this.recOpen = false; }
      else { this.recOpen = !this.recOpen; this.adminOpen = false; }
      this.paint();
    });
    this.admin.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-op]');
      if (!b) return;
      b.disabled = true;
      moderate(b.dataset.ship, b.dataset.op);
    });
    this.rec.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-rec]');
      if (!b) return;
      if (b.dataset.rec === 'stop') stopRecording();
      else startRecording(b.dataset.rec === 'audio');
      this.recOpen = false;
      this.paint();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.adminOpen && !this.recOpen) return;
      /* The rail's own buttons toggle these; a click on one must not close
       * them here and reopen them there. */
      if (this.root.contains(e.target) || e.target.closest?.('.mod-btns')) return;
      this.adminOpen = this.recOpen = false;
      this.paint();
    });
    onRooms(() => this.paint());
    /* The elapsed time is the only thing that moves on its own. */
    setInterval(() => { if (rooms.recording) this.paintNotice(); }, 1000);
    this.paint();
  }

  paintNotice() {
    const rec = rooms.recording;
    this.notice.hidden = !rec;
    if (!rec) return;
    const who = rec.by === our ? 'You are' : `${displayName(rec.by)} is`;
    const text = `● REC — ${who} recording this call${rec.by === our ? ` · ${clock(recordingElapsed())}` : ''}`;
    if (this.notice.textContent !== text) this.notice.textContent = text;
  }

  paint() {
    /* The buttons exist only for the host and the admins of this call. Being
     * unable to see them is not the enforcement -- the host's record is -- but
     * showing them to everybody would be a lie about who decides. */
    /* A panel closes when its button is no longer offered. */
    if (!canModerate() && this.adminOpen) this.adminOpen = false;
    if (!mayRecord() && rooms.recording?.by !== our && this.recOpen) this.recOpen = false;
    this.paintNotice();

    this.admin.hidden = !this.adminOpen;
    if (this.adminOpen) this.paintAdmin();
    this.rec.hidden = !this.recOpen;
    if (this.recOpen) this.paintRec();
  }

  paintAdmin() {
    const people = [...new Set(this.members())].filter((s) => s !== our);
    const rows = people.map((ship) => {
      const role = roleFor(ship);
      const muted = mutedShip(ship);
      const can = mayActOn(ship);
      const tag = [role ? role.toUpperCase() : '', muted ? 'MUTED' : '', bootedShip(ship) ? 'REMOVED' : '']
        .filter(Boolean).join(' · ');
      const button = (op, label) => `<button data-op="${op}" data-ship="${esc(ship)}">${label}</button>`;
      return `<div class="mod-row">
        <span class="who">${esc(displayName(ship))}</span>
        ${tag ? `<span class="tag">${esc(tag)}</span>` : ''}
        ${can ? `<span class="acts">
          ${role === 'admin' ? button('demote', 'Remove admin') : button('promote', 'Make admin')}
          ${muted ? button('unmute', 'Unmute') : button('mute', 'Mute')}
          ${bootedShip(ship) ? button('unboot', 'Allow back') : button('boot', 'Remove')}
        </span>` : '<span class="dim">—</span>'}
      </div>`;
    }).join('');
    const html = `<h4>Call moderation</h4>${rows || '<div class="dim pad">nobody else is in this call</div>'}
      <small class="dim">The host decides. Nobody can act on the host, and an admin cannot act on another admin.</small>`;
    if (this.admin.dataset.html !== html) { this.admin.innerHTML = html; this.admin.dataset.html = html; }
  }

  paintRec() {
    const rec = rooms.recording;
    let html = '<h4>Record this call</h4>';
    if (rec && rec.by !== our) {
      html += `<div class="dim pad">${esc(displayName(rec.by))} is recording.</div>`;
      /* The host may stop somebody else's recording; nobody else may. */
      if (roleFor(our) === 'host') html += '<button data-rec="stop">Stop their recording</button>';
    } else if (rec) {
      html += `<div class="dim pad">Recording · ${clock(recordingElapsed())}</div>
        <button data-rec="stop">Stop and save</button>`;
    } else {
      html += `<button data-rec="video">Video and audio</button>
        <button data-rec="audio">Audio only</button>
        <small class="dim">The file is made in this browser and saved to this machine. It is never uploaded, and never written to Noltbook. Everybody in the call is told you are recording.</small>`;
    }
    if (this.rec.dataset.html !== html) { this.rec.innerHTML = html; this.rec.dataset.html = html; }
  }
}

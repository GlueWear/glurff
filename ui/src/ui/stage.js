/* THE STAGE: the whole screen, behind Glurff's own interface.
 *
 * The world usually has it. An app opened from a spot, a website, or a movie
 * screen sent full screen takes it instead, and everything else Glurff is --
 * the top bar, chat, messages, the call and its faces -- floats over it, as it
 * floats over the world. One thing on the stage at a time; while something is,
 * the world stops drawing (presence and calls go on), and our character shows
 * the others what we are doing (see lib/sites activityText).
 *
 * THE TAB, always on screen at the top: what is on the stage, a button that
 * hides Glurff's interface or brings it back, "Open in a new tab" for a
 * website, and the cross that closes it. A game that has taken the mouse
 * gives it back on Esc -- the browser guarantees that -- and then the tab is
 * one click away. Inside a game that runs on our own ship, Ctrl+Shift+G does
 * the same without Esc.
 *
 * A source: { id, kind: 'app' | 'web' | 'media', title, host?, frame?, url?,
 * close() }. Sources call enter() when they take the stage and leave(id) when
 * they let it go; enter() closes whatever was there before.
 */
import { esc } from 'ui/html';
import { activityText } from 'lib/sites';

const HINT_MS = 7000;
const SHORTCUT = (e) => e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyG';

export class Stage {
  constructor({ game, onActivity = () => {}, touch = () => false } = {}) {
    Object.assign(this, { game, onActivity, touch });
    this.source = null;
    this.hinted = false;
    this.overlay = true;
    this.tab = document.createElement('div');
    this.tab.className = 'stage-tab';
    this.tab.hidden = true;
    this.tab.innerHTML = `<div class="stage-bar"><span class="stage-title"></span>
      <button type="button" class="stage-overlay"></button>
      <button type="button" class="stage-newtab" hidden>Open in a new tab</button>
      <button type="button" class="stage-close" title="Close" aria-label="Close">&times;</button></div>
      <div class="stage-hint" hidden></div>`;
    document.body.appendChild(this.tab);
    this.q = (s) => this.tab.querySelector(s);
    this.q('.stage-overlay').onclick = () => this.setOverlay(!this.overlay);
    this.q('.stage-close').onclick = () => this.source?.close();
    this.q('.stage-newtab').onclick = () => { if (this.source?.url) window.open(this.source.url, '_blank', 'noopener'); };
    this.onKey = (e) => { if (this.source && SHORTCUT(e)) { e.preventDefault(); e.stopPropagation(); this.setOverlay(!this.overlay); } };
    window.addEventListener('keydown', this.onKey, true);
  }

  get active() { return this.source; }

  enter(source) {
    if (this.source && this.source.id !== source.id) { const old = this.source; this.source = null; old.close(); }
    this.source = source;
    document.documentElement.classList.add('staged');
    this.game?.pause?.();
    this.q('.stage-title').textContent = source.title ?? '';
    this.q('.stage-newtab').hidden = source.kind !== 'web';
    this.tab.hidden = false;
    this.setOverlay(true);
    if (source.frame) this.listenInside(source.frame);
    this.hint(source);
    this.onActivity(activityText(source));
  }

  leave(id) {
    if (!this.source || this.source.id !== id) return;
    this.source = null;
    document.documentElement.classList.remove('staged', 'overlay-off');
    this.overlay = true;
    this.tab.hidden = true;
    this.q('.stage-hint').hidden = true;
    this.game?.resume?.();
    this.onActivity(null);
  }

  /* Glurff's interface over the stage, or not. Wave notices still show. */
  setOverlay(on) {
    this.overlay = !!on;
    document.documentElement.classList.toggle('overlay-off', !this.overlay);
    const b = this.q('.stage-overlay');
    b.textContent = this.overlay ? 'Hide Glurff' : 'Show Glurff';
    b.title = this.touch() ? '' : 'Ctrl+Shift+G';
  }

  /* Ctrl+Shift+G inside a game that runs on our own ship. A website's page
   * cannot be listened to; there, it is Esc and the tab. Again on every page
   * the frame loads. */
  listenInside(frame) {
    const attach = () => { try { frame.contentWindow.addEventListener('keydown', this.onKey, true); } catch {} };
    attach();
    frame.addEventListener('load', attach);
  }

  /* Once a visit, the first time a game takes the stage: how to get the
   * mouse back. And for a website: what a blank page means. */
  hint(source) {
    const parts = [];
    if (source.kind !== 'media' && !this.hinted) {
      this.hinted = true;
      parts.push(this.touch() ? 'Tap “Hide Glurff” to give the game the whole screen.'
        : 'If the game has your mouse, press Esc, then use this bar. Ctrl+Shift+G works in Urbit games.');
    }
    if (source.kind === 'web') parts.push('Blank? This site doesn’t allow being shown inside Glurff — open it in a new tab.');
    const el = this.q('.stage-hint');
    if (!parts.length) { el.hidden = true; return; }
    el.innerHTML = parts.map((p) => `<div>${esc(p)}</div>`).join('');
    el.hidden = false;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { el.hidden = true; }, HINT_MS + (source.kind === 'web' ? 5000 : 0));
  }
}

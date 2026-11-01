/* THE STAGE: the whole screen, behind Glurff's own interface.
 *
 * The world usually has it. An app opened from a spot, a website, or a movie
 * screen sent full screen takes it instead, and everything else Glurff is --
 * the top bar, chat, messages, the call and its faces -- floats over it, as it
 * floats over the world. One thing on the stage at a time; while something is,
 * the world stops drawing (presence and calls go on), and our character shows
 * the others what we are doing (see lib/sites activityText).
 *
 * ROOM FOR GLURFF (2026-10-31). While Glurff's interface shows, what is on the
 * stage is fitted BETWEEN its bars, never under them: the space taken at the
 * top and at the bottom is measured from the bars actually on screen -- a
 * phone's notch and home bar, a call bar that grows -- and kept in
 * --stage-top and --stage-bottom, which staged apps, websites, videos and call
 * tiles keep clear of. With Glurff hidden, the stage has the whole screen.
 *
 * THE TAB, always on screen at the top: what is on the stage, "Hide Glurff"
 * and "Show Glurff", "Open in a new tab" for a website, and the cross that
 * closes it. A game that has taken the mouse
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
/* What is hidden, at a glance (2026-10-22): an app's own icon -- its docket
 * picture on its colour -- or, without one, its first letter; a website, a
 * globe; a video, a screen. */
const GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
const SCREEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="m10 9 4 2-4 2z" fill="currentColor"/></svg>';
function paintIcon(el, source) {
  const icon = source.icon ?? {};
  el.textContent = ''; el.style.backgroundImage = ''; el.style.backgroundColor = '';
  if (source.kind === 'web') { el.innerHTML = GLOBE; return; }
  if (source.kind === 'media') { el.innerHTML = SCREEN; return; }
  if (icon.color) el.style.backgroundColor = icon.color;
  /* Only an address of our own kind: a picture's URL goes into CSS. */
  if (typeof icon.image === 'string' && /^(https?:\/\/|\/)[^"'()\\\s]+$/.test(icon.image)) el.style.backgroundImage = `url("${icon.image}")`;
  else el.textContent = (source.title || '?').trim().charAt(0).toUpperCase();
}
const HIDE_TAB_MS = 5000;
/* What Glurff keeps on screen over the stage, at the top and at the bottom. */
const TOP_BARS = ['#top-left', '#top-mid', '#top-right', '.stage-tab .stage-bar'];
const BOTTOM_BARS = ['#rail', '#hud .chat-toggle'];
const BAR_GAP = 6;
const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0; };
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
    this.tab.innerHTML = `<div class="stage-wake" aria-hidden="true"></div><div class="stage-bar"><span class="stage-title"></span>
      <button type="button" class="stage-hide"></button>
      <button type="button" class="stage-overlay"></button>
      <button type="button" class="stage-newtab" hidden>Open in a new tab</button>
      <button type="button" class="stage-close" title="Close" aria-label="Close">&times;</button></div>
      <div class="stage-hint" hidden></div>`;
    document.body.appendChild(this.tab);
    /* HIDDEN, STILL RUNNING (2026-10-20): what was on the stage, put away to
     * the bottom right -- the game still connected, the video still playing --
     * and brought back from here; its cross stops it. */
    this.dock = document.createElement('div');
    this.dock.className = 'stage-dock';
    this.dock.hidden = true;
    this.dock.innerHTML = `<button type="button" class="stage-restore"><span class="stage-icon" aria-hidden="true"></span><span class="stage-name"></span></button>
      <button type="button" class="stage-dock-close" title="Close" aria-label="Close">&times;</button>`;
    document.body.appendChild(this.dock);
    this.dock.querySelector('.stage-restore').onclick = () => this.restore();
    this.dock.querySelector('.stage-dock-close').onclick = () => this.source?.close();
    this.minimized = false;
    this.q = (s) => this.tab.querySelector(s);
    this.q('.stage-hide').onclick = () => this.minimize();
    this.q('.stage-overlay').onclick = () => this.setOverlay(!this.overlay);
    this.q('.stage-close').onclick = () => this.source?.close();
    this.q('.stage-newtab').onclick = () => { if (this.source?.url) window.open(this.source.url, '_blank', 'noopener'); };
    this.q('.stage-wake').addEventListener('pointerenter',()=>this.wake());
    this.q('.stage-wake').addEventListener('pointerdown',e=>{e.preventDefault();this.wake();});
    this.q('.stage-bar').addEventListener('pointermove',()=>this.keepAwake());
    this.onKey = (e) => {
      if (this.source && SHORTCUT(e)) { e.preventDefault(); e.stopPropagation(); this.setOverlay(!this.overlay); return; }
      if(this.source&&!this.overlay&&e.key==='Escape')this.wake();
    };
    window.addEventListener('keydown', this.onKey, true);
    this.layout = this.layout.bind(this);
    window.addEventListener('resize', this.layout);
    window.visualViewport?.addEventListener?.('resize', this.layout);
    if (typeof ResizeObserver === 'function') this.bars = new ResizeObserver(() => this.layout());
  }

  /* The space Glurff's bars take, as they are laid out right now. A source may
   * ask for more at the bottom for its own buttons (`reserve.bottom`), which
   * then sit in that space rather than over what is playing. */
  layout() {
    const root = document.documentElement.style;
    const set = (top, bars, bottom) => {
      root.setProperty('--stage-top', `${top}px`);
      root.setProperty('--stage-bars-bottom', `${bars}px`);
      root.setProperty('--stage-bottom', `${bottom}px`);
    };
    if (!this.source || this.minimized || !this.overlay) { set(0, 0, 0); return; }
    const h = window.innerHeight;
    let top = 0, bottom = 0;
    for (const el of document.querySelectorAll(TOP_BARS.join(','))) {
      const r = el.getBoundingClientRect();
      if (r.height && r.top < h / 2 && shown(el)) top = Math.max(top, r.bottom);
    }
    for (const el of document.querySelectorAll(BOTTOM_BARS.join(','))) {
      const r = el.getBoundingClientRect();
      if (r.height && r.bottom > h / 2 && shown(el)) bottom = Math.max(bottom, h - r.top);
    }
    const bars = bottom ? Math.ceil(bottom + BAR_GAP) : 0;
    const ask = this.source.reserve?.bottom;
    const extra = Math.max(0, Number(typeof ask === 'function' ? ask() : ask) || 0);
    set(top ? Math.ceil(top + BAR_GAP) : 0, bars, bars + extra);
  }
  watchBars() {
    if (!this.bars) return;
    this.bars.disconnect();
    for (const el of document.querySelectorAll([...TOP_BARS, ...BOTTOM_BARS].join(','))) this.bars.observe(el);
  }

  /* Something on the stage, and showing: hidden in the corner, we are back
   * in the world (asleep when idle, waves with their button). */
  get active() { return this.minimized ? null : this.source; }

  enter(source) {
    if (this.source && this.source.id !== source.id) { const old = this.source; this.source = null; old.close(); }
    this.source = source;
    this.unminimize();
    document.documentElement.classList.add('staged');
    this.game?.pause?.();
    this.q('.stage-title').textContent = source.title ?? '';
    this.q('.stage-newtab').hidden = source.kind !== 'web';
    const hide = this.q('.stage-hide');
    hide.hidden = source.hideable === false;
    hide.textContent = source.hideLabel ?? (source.kind === 'media' ? 'Hide video' : `Hide ${source.title || 'app'}`);
    this.tab.hidden = false;
    this.setOverlay(true);
    this.watchBars();
    if (source.frame) this.listenInside(source.frame);
    this.hint(source);
    this.onActivity(activityText(source));
  }

  leave(id) {
    if (!this.source || this.source.id !== id) return;
    this.source = null;
    this.unminimize();
    document.documentElement.classList.remove('staged', 'overlay-off');
    clearTimeout(this.sleepTimer);this.sleepTimer=null;this.tab.classList.remove('sleeping');
    this.overlay = true;
    this.tab.hidden = true;
    this.q('.stage-hint').hidden = true;
    this.bars?.disconnect();
    this.layout();
    this.game?.resume?.();
    this.onActivity(null);
  }

  /* HIDE: off the stage, still running. A source may know where it goes (a
   * theater's video, back onto its painted screen); anything else shrinks away
   * to the corner and waits there. */
  minimize() {
    const source = this.source;
    if (!source || this.minimized || source.hideable === false) return;
    if (source.minimize) { source.minimize(); return; }
    this.minimized = true;
    const restore = this.dock.querySelector('.stage-restore');
    restore.querySelector('.stage-name').textContent = source.title || 'App';
    paintIcon(restore.querySelector('.stage-icon'), source);
    restore.title = `Back to ${source.title || 'it'}`;
    this.dock.hidden = false;
    this.shrink(this.stagedElements(), true).then(() => {
      if (!this.minimized || this.source !== source) return;
      document.documentElement.classList.add('stage-min');
      document.documentElement.classList.remove('staged', 'overlay-off');
      this.tab.hidden = true;
      this.layout();
      this.game?.resume?.();
    });
  }
  /* Back onto the stage, from the corner. */
  restore() {
    const source = this.source;
    if (!source || !this.minimized) return;
    this.minimized = false;
    this.dock.hidden = true;
    document.documentElement.classList.remove('stage-min');
    document.documentElement.classList.add('staged');
    this.game?.pause?.();
    this.tab.hidden = false;
    this.setOverlay(true);
    this.shrink(this.stagedElements(), false);
  }
  /* Forget any hiding: something new took the stage, or it was let go. */
  unminimize() {
    this.minimized = false;
    this.dock.hidden = true;
    document.documentElement.classList.remove('stage-min');
  }
  stagedElements() {
    return [...document.querySelectorAll('.app-panel.staged, #stage-media > *, #stage-call-media > *, .world-media.staged-media')];
  }
  /* The little animation: down into the corner, or up out of it. */
  shrink(elements, away) {
    const to = this.dock.getBoundingClientRect();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const runs = elements.map((el) => {
      if (reduced || typeof el.animate !== 'function') return Promise.resolve();
      const r = el.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (r.left + r.width / 2), dy = to.top + to.height / 2 - (r.top + r.height / 2);
      const small = { transform: `translate(${dx}px, ${dy}px) scale(.06)`, opacity: 0.2 }, full = { transform: 'none', opacity: 1 };
      return el.animate(away ? [full, small] : [small, full], { duration: 260, easing: away ? 'cubic-bezier(.5,0,1,.6)' : 'cubic-bezier(0,.4,.5,1)' })
        .finished.catch(() => {});
    });
    return Promise.all(runs);
  }

  /* Glurff over the stage, or not. The player's own play/pause and timeline
   * remain its own; wave notices still show. */
  setOverlay(on) {
    this.overlay = !!on;
    document.documentElement.classList.toggle('overlay-off', !this.overlay);
    const b = this.q('.stage-overlay');
    b.textContent = this.overlay ? 'Hide Glurff' : 'Show Glurff';
    b.setAttribute('aria-label', this.overlay ? 'Hide Glurff over this' : 'Show Glurff again');
    b.title = this.touch() ? '' : 'Ctrl+Shift+G';
    this.layout();
    clearTimeout(this.sleepTimer);this.sleepTimer=null;this.tab.classList.remove('sleeping');
    if(!this.overlay)this.keepAwake();
  }

  /* Hidden controls should leave the stage clean. The bar remains for five
   * seconds, then fades completely; the invisible top strip, Esc, and the
   * keyboard shortcut can always bring it back. */
  keepAwake(){
    if(!this.source||this.overlay)return;
    this.tab.classList.remove('sleeping');clearTimeout(this.sleepTimer);
    this.sleepTimer=setTimeout(()=>{if(this.source&&!this.overlay)this.tab.classList.add('sleeping');},HIDE_TAB_MS);
  }
  wake(){if(this.source&&!this.overlay)this.keepAwake();}

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

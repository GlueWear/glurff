/* THE STAGE: the whole screen, behind Glurff's own interface.
 *
 * The world usually has it. An app opened from a spot, a website, or a movie
 * screen sent full screen takes it instead, and everything else Glurff is --
 * the top bar, chat, messages, the call and its faces -- floats over it, as it
 * floats over the world. One thing on the stage at a time; while something is,
 * the world stops drawing (presence and calls go on), and our character shows
 * the others what we are doing (see lib/sites activityText).
 *
 * ROOM FOR GLURFF (2026-10-31). What is on the stage is fitted BETWEEN
 * Glurff's bars, never under them: the space taken at the top and at the
 * bottom is measured from the bars actually on screen -- a phone's notch and
 * home bar, a call bar that grows -- and kept in --stage-top and
 * --stage-bottom, which staged apps, websites, videos and call tiles keep
 * clear of. Only the bars count: a panel opened from one (who is here, the
 * chat) opens OVER what is on the stage rather than squeezing it (2026-11-06).
 *
 * THE BAR, beside our own name and picture at the top right (2026-11-06):
 * what is on the stage, "Open in a new tab" for a website, minimize, and the
 * cross that closes it. On a phone, under the picture. A game that has taken
 * the mouse gives it back on Esc -- the browser guarantees that -- and then
 * the bar is one click away. Inside a game that runs on our own ship,
 * Ctrl+Shift+G minimizes it without Esc.
 *
 * A source: { id, kind: 'app' | 'web' | 'media' | 'editor', title, host?,
 * frame?, url?, close() }. Sources call enter() when they take the stage and leave(id) when
 * they let it go; enter() closes whatever was there before.
 */
import { esc } from 'ui/html';
import { activityText } from 'lib/sites';
import { tileInk } from 'lib/app-spots';

const HINT_MS = 7000;
/* What is hidden, at a glance (2026-10-22): an app's own icon -- its docket
 * picture on its colour -- or, without one, its first letter; a website, a
 * globe; a video, a screen. */
const GLOBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
const SCREEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="m10 9 4 2-4 2z" fill="currentColor"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg>';
function paintIcon(el, source) {
  const icon = source.icon ?? {};
  el.textContent = ''; el.style.backgroundImage = ''; el.style.backgroundColor = ''; el.style.color = '';
  if (source.kind === 'web') { el.innerHTML = GLOBE; return; }
  if (source.kind === 'media') { el.innerHTML = SCREEN; return; }
  if (source.kind === 'editor') { el.innerHTML = PENCIL; return; }
  if (icon.color) { el.style.backgroundColor = icon.color; el.style.color = tileInk(icon.color); }
  /* Only an address of our own kind: a picture's URL goes into CSS. */
  if (typeof icon.image === 'string' && /^(https?:\/\/|\/)[^"'()\\\s]+$/.test(icon.image)) el.style.backgroundImage = `url("${icon.image}")`;
  else el.textContent = (source.title || '?').trim().charAt(0).toUpperCase();
}
const MINIMIZE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 17h12"/></svg>';
/* What Glurff keeps on screen over the stage, at the top and at the bottom. */
const TOP_BARS = ['#top-left', '#top-mid', '#top-right', '.stage-bar'];
const BOTTOM_BARS = ['#rail', '#hud .chat-toggle'];
/* The chat's button rides up on top of the chat when it opens: open, the
 * chat keeps the room its button took shut. */
const CHAT = '#hud .chat-toggle';
const BAR_GAP = 6;
const shown = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0; };
const SHORTCUT = (e) => e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyG';

export class Stage {
  /* onStaged(true) when something comes onto the stage, showing, and
   * onStaged(false) when it goes or is minimized. */
  constructor({ game, onActivity = () => {}, onStaged = () => {}, touch = () => false } = {}) {
    Object.assign(this, { game, onActivity, onStaged, touch });
    this.source = null;
    this.hinted = false;
    this.chatRoom = 0;
    this.tab = document.createElement('div');
    this.tab.className = 'stage-tab';
    this.tab.hidden = true;
    this.tab.innerHTML = `<div class="stage-hint" hidden></div>`;
    document.body.appendChild(this.tab);
    this.bar = document.createElement('div');
    this.bar.className = 'stage-bar';
    this.bar.hidden = true;
    this.bar.innerHTML = `<span class="stage-title"></span>
      <button type="button" class="stage-newtab" hidden>Open in a new tab</button>
      <button type="button" class="stage-hide">${MINIMIZE}</button>
      <button type="button" class="stage-close">&times;</button>`;
    this.tab.appendChild(this.bar);
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
    this.q = (s) => this.bar.querySelector(s) ?? this.tab.querySelector(s);
    this.q('.stage-hide').onclick = () => this.minimize();
    this.q('.stage-close').onclick = () => this.source?.close();
    this.q('.stage-newtab').onclick = () => { if (this.source?.url) window.open(this.source.url, '_blank', 'noopener'); };
    this.onKey = (e) => {
      if (this.source && !this.minimized && SHORTCUT(e)) { e.preventDefault(); e.stopPropagation(); this.minimize(); }
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
    if (!this.source || this.minimized) { set(0, 0, 0); return; }
    const h = window.innerHeight;
    let top = 0, bottom = 0;
    for (const el of document.querySelectorAll(TOP_BARS.join(','))) {
      const r = el.getBoundingClientRect();
      if (r.height && r.top < h / 2 && shown(el)) top = Math.max(top, r.bottom);
    }
    const chatOpen = document.documentElement.classList.contains('chat-open');
    for (const el of document.querySelectorAll(BOTTOM_BARS.join(','))) {
      const chat = el.matches(CHAT);
      if (chat && chatOpen) { bottom = Math.max(bottom, this.chatRoom); continue; }
      const r = el.getBoundingClientRect();
      const room = r.height && r.bottom > h / 2 && shown(el) ? h - r.top : 0;
      if (chat) this.chatRoom = room;
      bottom = Math.max(bottom, room);
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
    const fresh = !this.source;
    this.source = source;
    this.unminimize();
    document.documentElement.classList.add('staged');
    this.game?.pause?.();
    this.q('.stage-title').textContent = source.title ?? '';
    this.q('.stage-newtab').hidden = source.kind !== 'web';
    const name = source.title || (source.kind === 'media' ? 'video' : 'app');
    const hide = this.q('.stage-hide'), close = this.q('.stage-close');
    hide.hidden = source.hideable === false;
    hide.title = `Minimize ${name}`; hide.setAttribute('aria-label', `Minimize ${name}`);
    close.title = `Close ${name}`; close.setAttribute('aria-label', `Close ${name}`);
    this.showBar(true);
    if (fresh) this.onStaged(true);
    this.watchBars();
    this.layout();
    if (source.frame) this.listenInside(source.frame);
    this.hint(source);
    this.onActivity(activityText(source));
  }

  leave(id) {
    if (!this.source || this.source.id !== id) return;
    const wasShowing = !this.minimized;
    this.source = null;
    this.unminimize();
    document.documentElement.classList.remove('staged');
    this.showBar(false);
    this.q('.stage-hint').hidden = true;
    this.bars?.disconnect();
    this.layout();
    this.game?.resume?.();
    if (wasShowing) this.onStaged(false);
    this.onActivity(null);
  }

  /* The bar goes beside our name and picture, which are built after us. */
  showBar(on) {
    const home = document.getElementById('top-right');
    if (home && this.bar.parentNode !== home) home.prepend(this.bar);
    this.bar.hidden = !on;
    this.tab.hidden = !on;
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
      document.documentElement.classList.remove('staged');
      this.showBar(false);
      this.layout();
      this.game?.resume?.();
      this.onStaged(false);
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
    this.showBar(true);
    this.onStaged(true);
    this.layout();
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

  /* Ctrl+Shift+G inside a game that runs on our own ship. A website's page
   * cannot be listened to; there, it is Esc and the bar. Again on every page
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
    if ((source.kind === 'app' || source.kind === 'web') && !this.hinted) {
      this.hinted = true;
      if (!this.touch()) parts.push('If the game has your mouse, press Esc, then use the bar at the top right. In Urbit games, Ctrl+Shift+G minimizes.');
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

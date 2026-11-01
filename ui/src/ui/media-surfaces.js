import { createMediaAdapter, parseMediaRef, youtubeRef } from 'lib/player-providers';
import { playbackPosition, CONTROLLED_SURFACES } from 'lib/player-state';
import { SCREEN_RECTS } from 'world/hotspots';
import { roomBySlug } from 'world/places';
import { rooms, onRooms, callPeers, startScreen, screenShare } from 'lib/rooms';
import { esc } from 'ui/html';
import { ask } from 'ui/ask';
import { avatarHtml } from 'ui/avatar';
import { columnMode, defaultTileWidth, dragToSize, resetTileSizes, onTileReset, maxColumnTile } from 'ui/strip-column';

export const JUKEBOX_REF = 'https://www.youtube.com/watch?v=Bek5peeuUyU&list=PLo8ET_VWap-zw_uFQlI0JJesTJtepJ9N1';


const TITLES = { jukebox: 'Jukebox', amphitheatre: 'Amphitheatre screen', movie: 'Movie Theater screen' };
/* THE PAINTED SCREENS sit a little higher than their rectangles once the map
 * is zoomed out to 1x or further, so the video is lifted there, in page
 * pixels for each zoom: the Movie Theater's by a pixel and a half (three on a
 * Retina display), the Amphitheatre's by four of the map's pixels
 * (2026-11-01). */
const LIFT = { movie: { 0.5: 1.5, 1: 1.5 }, amphitheatre: { 0.5: 2, 1: 4 } };
/* The screen bar's symbols. */
const icon = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  sound: icon('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5M19 7a7 7 0 0 1 0 10"/>'),
  muted: icon('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5"/>'),
  play: icon('<path d="M8 5v14l11-7z" fill="currentColor"/>'),
  pause: icon('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>'),
  full: icon('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  unfull: icon('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>'),
  stop: icon('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none"/>'),
};
const SCREEN_ROOMS = {
  amphitheatre: roomBySlug('presentation')?.id ?? 2,
  movie: roomBySlug('movie')?.id ?? 3,
};
const maxPopupWidth = () => Math.max(720, (globalThis.innerWidth ?? 744) - 24);
const liveRef = ref => {
  if (typeof ref !== 'string') return null;
  const split=ref.indexOf('|'),ship=ref.slice(0,split),token=ref.slice(split+1);
  return split>0&&/^~[a-z-]{3,56}$/.test(ship)&&token.length>0&&token.length<=128?{ship,token}:null;
};
const screenRef = (ship, token) => `${ship}|${token}`;

/* PLAY FOR ROOM (2026-10-31): a deliberate replacement of whatever is on the
 * screen, for everybody here -- and whoever does it controls the new one.
 * There is no "stop for everyone": stopping is each viewer's own. */
function mediaQuestion(surface, current) {
  return new Promise(resolve => {
    const name = TITLES[surface];
    const root = document.createElement('div'); root.className = 'ask-overlay media-question';
    root.innerHTML = `<form class="ask" role="dialog" aria-modal="true">
      <div class="ask-q">${esc(name)}: play for the room</div>
      <div class="ask-sub dim">Everybody here switches to it, and you control its play, pause and seeking.</div>
      <label class="media-url">Media link<input type="url" required placeholder="YouTube, Vimeo, media, radio or SoundCloud" value="${esc(current?.provider==='screen'?'':current?.ref ?? '')}"></label>
      <!-- Screen-to-theater transport is retained for later work, but is not
           currently offered to users. Hidden removes it visually and disabled
           keeps it out of mouse and keyboard interaction. -->
      <div class="media-share-row" hidden><button type="button" class="media-share" disabled>SHARE SCREEN</button></div>
      <div class="media-error" role="alert"></div>
      <div class="ask-row"><button type="button" class="media-cancel">Cancel</button>
        <button type="submit" class="media-play">Play for room</button></div>
    </form>`;
    const finish = answer => { window.removeEventListener('keydown', key, true); root.remove(); resolve(answer); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
    root.querySelector('.media-cancel').onclick = () => finish(null);
    root.querySelector('.media-share').onclick = e => {
      e.preventDefault();
      finish({screen:true});
    };
    root.addEventListener('pointerdown', e => { if (e.target === root) finish(null); });
    root.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const parsed = parseMediaRef(root.querySelector('input').value);
      if (!parsed) { root.querySelector('.media-error').textContent = 'That is not a supported public media link.'; return; }
      finish(parsed);
    };
    window.addEventListener('keydown', key, true); document.body.appendChild(root);
    root.querySelector('input').focus(); root.querySelector('input').select();
  });
}

class SurfaceView {
  constructor(owner, surface, kind) {
    this.owner = owner; this.surface = surface; this.isScreen = surface !== 'jukebox';
    this.kind = kind; this.mode = kind === 'tile' ? 'popup' : 'docked';
    this.root = document.createElement('div');
    this.root.className = kind === 'tile' ? 'tile media-tile' : 'world-media';
    this.root.dataset.surface = surface;
    this.root.dataset.mode = this.mode;
    /* A SCREEN'S CONTROLS ARE NOT ON ITS VIDEO (2026-10-31). On the painted
     * screen a clear shield takes the click -- the player under it is never
     * operated by accident, and nothing is drawn over the picture -- and opens
     * a panel beside it, at a size that does not shrink with the map. Enlarged
     * or in a window the player is left to be used, and the same panel is a
     * bar below it. The jukebox keeps its own buttons. */
    this.root.innerHTML = this.isScreen
      ? `<div class="media-frame"></div><div class="media-notice" hidden></div>
      <button type="button" class="media-shield" aria-label="${esc(TITLES[surface])} controls" title="${esc(TITLES[surface])} controls"></button>
      <i class="grip" title="Drag to resize; double-click to put every one back to its normal size"></i>`
      : `<div class="media-frame"></div><div class="media-notice" hidden></div><div class="media-tools">
      <button type="button" class="media-mute" title="Mute this player locally"></button>
      <button type="button" class="media-skip" title="Skip this YouTube video" hidden>Skip</button>
      <button type="button" class="media-stop" title="Stop this stream for everyone">Stop all</button>
      <button type="button" class="media-close" title="Leave this stream locally">×</button>
    </div><button type="button" class="media-menu" title="Media controls" aria-label="Media controls" aria-expanded="false">•••</button>
      <i class="grip" title="Drag to resize; double-click to put every one back to its normal size"></i>`;
    this.frame = this.root.querySelector('.media-frame');
    const used=(e,action)=>{e.stopPropagation();this.setControls(false);action();};
    if (this.isScreen) {
      this.root.querySelector('.media-shield').onclick = e => { e.stopPropagation(); owner.openPanel(surface); };
      this.panel = document.createElement('div');
      this.panel.className = 'media-panel'; this.panel.dataset.surface = surface; this.panel.hidden = true;
      this.panel.setAttribute('role', 'group'); this.panel.setAttribute('aria-label', `${TITLES[surface]} controls`);
      this.panel.addEventListener('pointerdown', e => e.stopPropagation());
      this.panel.addEventListener('click', e => {
        const b = e.target.closest('button[data-act]');
        if (b) { e.stopPropagation(); owner.act(surface, b.dataset.act); }
      });
      document.body.appendChild(this.panel);
      this.panelOpen = false;
      document.addEventListener('pointerdown', e => {
        if (this.panelOpen && !this.panel.contains(e.target) && !this.root.contains(e.target)) { this.panelOpen = false; this.paintPanel(); }
      });
    } else {
      this.root.querySelector('.media-mute').onclick = e => used(e,()=>owner.toggleMute(surface));
      this.root.querySelector('.media-skip').onclick = e => used(e,()=>this.skip(true));
      this.root.querySelector('.media-stop').onclick = e => used(e,()=>owner.store.clear(surface));
      this.root.querySelector('.media-close').addEventListener('click', e => used(e,()=>owner.hide(surface)));
      this.root.querySelector('.media-menu').onclick=e=>{e.stopPropagation();this.setControls(!this.controlsOpen);};
      document.addEventListener('pointerdown',e=>{if(this.controlsOpen&&!this.root.contains(e.target))this.setControls(false);});
    }
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.adapter = null; this.key = null; this.state = null; this.suppressUntil = 0;
    this.armedUntil = 0; this.pointerInside = false;
    this.failed = new Map(); this.loadFailures = new Map(); this.consecutiveSkips = 0;
    this.root.addEventListener('pointerenter',()=>{this.pointerInside=true;});
    this.root.addEventListener('pointerleave',()=>{this.pointerInside=false;});
    /* Taking the shield's click is not using the player. */
    this.root.addEventListener('pointerdown',e=>{if(!e.target.closest('.media-shield'))this.armedUntil=Date.now()+5000;});
    /* Pointer events inside a cross-origin iframe do not bubble out. A click
     * there moves focus out of our window while the pointer is over the player,
     * which is enough to distinguish a person's control from an SDK event
     * caused by applying somebody else's state. */
    window.addEventListener('blur',()=>{if(this.pointerInside)this.armedUntil=Date.now()+5000;});
    this.makeResizable();
    this.root.querySelector('.grip').hidden = this.mode !== 'popup';
    this.setControlScale(1);
  }

  /* A phone gets one reliable target, then a tray of finger-sized actions.
   * At the furthest map zoom the painted player is composited down; counter
   * that transform for controls only, never for the movie itself. */
  setControls(open){
    this.controlsOpen=!!open && !this.isScreen;
    this.root.classList.toggle('media-controls-open',this.controlsOpen);
    this.root.querySelector('.media-tools')?.classList.toggle('open',this.controlsOpen);
    this.root.querySelector('.media-menu')?.setAttribute('aria-expanded',String(this.controlsOpen));
  }

  /* A SCREEN'S BAR (2026-10-31): one row -- sound, play or pause, full
   * screen, stop, and Change video -- each symbol named on hover, and Sync
   * while this viewer's own pause or seek has them out of step with the room.
   * On the painted screen it shows when the screen is clicked; in full screen
   * it is always there, in the bottom row with the call bar and the chat
   * button (placePanels). */
  paintPanel() {
    if (!this.panel) return;
    const o = this.owner, surface = this.surface, state = o.store.get(surface), v = o.viewing(surface);
    const playing = !!state && state.provider !== 'none';
    const staged = this.mode === 'stage';
    const show = o.game.scene === 'main' && playing && !v.stopped && (staged || this.panelOpen);
    const gagged = !o.mayShare();
    const b = (act, tip, body) => `<button type="button" data-act="${act}" data-tip="${esc(tip)}" aria-label="${esc(tip)}">${body}</button>`;
    const acts = [];
    /* WHOSE IT IS (2026-11-01). On the theater screens whoever started it
     * keeps the room's place in it: named, with their picture, for everybody
     * else, and "Your video" with our own for them. The jukebox is anybody's. */
    const owner = playing && CONTROLLED_SURFACES.includes(surface) ? state.startedBy ?? null : null;
    const mine = !!owner && owner === o.our, thing = state?.provider === 'screen' ? 'screen' : 'video';
    const whose = owner ? (mine ? `Your ${thing}` : `${o.name(owner)}’s ${thing}`) : '';
    if (owner) {
      const tip = thing === 'screen'
        ? (mine ? 'You are sharing this with the room.' : `${o.name(owner)} is sharing this with the room.`)
        : mine ? 'You started this. Your play, pause and skips move it for everybody here.'
        : `${o.name(owner)} started this and keeps the room’s place in it. Your pause and skips are just for you.`;
      acts.push(`<span class="mp-whose${mine ? ' mine' : ''}" tabindex="0" role="note" aria-label="${esc(`${whose}. ${tip}`)}" data-tip="${esc(tip)}">
        <span class="av">${avatarHtml(owner)}</span><span class="mp-whose-name">${esc(whose)}</span></span>`);
    }
    if (playing) {
      if (state.provider !== 'screen') {
        acts.push(o.isMuted(surface) ? b('sound', 'Listen', ICONS.muted) : b('sound', 'Mute', ICONS.sound));
        acts.push(this.paused() ? b('play', 'Play', ICONS.play) : b('pause', 'Pause', ICONS.pause));
      }
      if (v.independent) acts.push('<button type="button" data-act="sync" class="mp-text" data-tip="Back in step with the room">Sync</button>');
      acts.push(staged ? b('full', 'Exit full screen', ICONS.unfull) : b('full', 'Full screen', ICONS.full));
      acts.push(b('stop', !owner ? 'Stop video' : mine ? 'Stop for everyone' : 'Stop watching', ICONS.stop));
      acts.push(gagged
        ? '<button type="button" class="mp-text" aria-disabled="true" data-tip="You are muted in this Glurff">Change video</button>'
        : '<button type="button" data-act="choose" class="mp-text">Change video</button>');
    }
    const html = `<div class="mp-acts">${acts.join('')}</div>`;
    if (this.panel.dataset.html !== html) { this.panel.innerHTML = html; this.panel.dataset.html = html; }
    const who = playing ? (state.startedBy === o.our ? 'you are' : `${o.name(state.startedBy)} is`) : '';
    this.panel.setAttribute('aria-label', playing ? `${TITLES[surface]}: ${who} playing this for the room` : TITLES[surface]);
    /* Hovering the painted screen names it too, without opening anything. */
    const shield = this.root.querySelector('.media-shield');
    const named = owner ? `${whose} — click for controls` : `${TITLES[surface]} controls`;
    if (shield && shield.title !== named) { shield.title = named; shield.setAttribute('aria-label', named); }
    this.panel.classList.toggle('staged-bar', staged);
    const appearing = show && this.panel.hidden;
    this.panel.hidden = !show;
    /* Placed the moment it appears, not a frame later in the corner. */
    if (appearing) this.owner.placePanels();
  }
  /* Is our own player paused? What it last said, or what we last told it. */
  paused() {
    if (typeof this.localPaused === 'boolean') return this.localPaused;
    const v = this.owner.viewing(this.surface);
    return v.independent && v.local ? !!v.local.paused : !!this.state?.paused;
  }
  setControlScale(scale=1){
    const n=Number.isFinite(scale)&&scale>0?scale:1;
    this.root.style.setProperty('--media-control-scale',String(n));
    this.root.style.setProperty('--media-control-bottom',`${52*n}px`);
    this.root.style.setProperty('--media-control-inset',`${4*n}px`);
  }

  /* Sized by hand, on its own, from its corner square -- the player fills the
   * rest of it and keeps the mouse for itself. A double-click on the square
   * puts every tile and window back to its normal size (ui/strip-column). */
  makeResizable() {
    this.width = defaultTileWidth();
    this.root.style.width = `${this.width}px`;
    const grip = this.root.querySelector('.grip');
    const max = () => columnMode() && this.root.parentElement === this.owner.strip ? maxColumnTile() : maxPopupWidth();
    grip.addEventListener('pointerdown', e => {
      if (e.button !== 0 || this.mode !== 'popup') return;
      e.preventDefault(); e.stopPropagation();
      dragToSize(e, { width: this.root.offsetWidth, max, set: (w) => { this.width = w; this.root.style.width = `${w}px`; } });
    });
    grip.addEventListener('dblclick', e => {
      if (this.mode !== 'popup') return;
      e.preventDefault(); e.stopPropagation(); resetTileSizes();
    });
    onTileReset(() => { this.width = defaultTileWidth(); if (this.mode === 'popup') this.root.style.width = `${this.width}px`; });
  }

  /* Where this viewer's own playback had got to, kept when its player has to
   * be made again (a window and the room are different places on the page). */
  keepPlace() {
    const v = this.owner.viewing(this.surface);
    if (!this.isScreen || !v.independent || !this.adapter) return;
    v.local = { ...v.local, positionMs: this.here(), at: Date.now() };
  }
  /* How far into it the player is. Some players cannot say (Vimeo's answer
   * comes back later; a radio has none), and then the room's clock stands in. */
  here() {
    const t = this.adapter?.currentTime?.();
    return Number.isFinite(t) && t > 0 ? t : playbackPosition(this.state);
  }
  destroyAdapter() {
    this.adapter?.destroy?.(); this.adapter = null; this.key = null; this.localPaused = null;
    for(const video of this.frame.querySelectorAll('video')){try{video.pause();video.srcObject=null;}catch{}}
    this.frame.replaceChildren();this.owner.cancelMissing(this.surface);
  }

  setMode(mode) {
    if (!['docked','popup','hidden','stage'].includes(mode) || (!this.isScreen && mode==='docked') || (this.isScreen && mode==='popup')) return;
    if (this.mode === mode) return;
    if(mode==='stage')this.returnMode=this.mode==='hidden'?(this.isScreen?'docked':'popup'):this.mode;
    this.setControls(false);this.setControlScale(1);
    if (this.panel) this.panelOpen = false;
    /* Off the stage: let it go (see ui/stage). */
    if (this.mode === 'stage') { this.mode = mode; this.owner.stage?.leave(`media-${this.surface}`); }
    const tile = mode === 'popup', staged = mode === 'stage';
    /* KEPT PLAYING (2026-10-31): a screen goes onto the stage and back without
     * leaving its layer, so its player is never made again; only a move to a
     * window, or away, starts it again -- where it had got to. */
    const home = tile ? this.owner.strip : staged && !this.isScreen ? this.owner.stageRoot : this.owner.worldRoot;
    const moving = this.root.parentElement !== home;
    if (moving || mode === 'hidden') { this.keepPlace(); this.destroyAdapter(); }
    this.mode = mode; this.root.dataset.mode = mode; this.kind = tile ? 'tile' : 'world';
    this.root.className = tile ? 'tile media-tile' : staged ? 'world-media staged-media' : 'world-media';
    this.root.querySelector('.grip').hidden = !tile;
    const pop=this.root.querySelector('.media-pop');
    if(pop){pop.textContent=tile?'▣':'□';pop.title=tile?'Return to the painted screen':'Open in a resizable window';}
    const full=this.root.querySelector('.media-full');
    if(full){full.textContent=staged?'⤡':'⛶';full.title=staged?'Back to the screen':'Full screen';}
    if (moving) home.appendChild(this.root);
    this.owner.orderTiles();
    if (staged) {
      /* THE STAGE: the whole screen, behind Glurff's interface. */
      this.root.style.left='';this.root.style.top='';this.root.style.width='';this.root.style.height='';
      this.root.style.transform='';this.root.style.transformOrigin='';
      /* Hide puts it back where it was -- its painted screen, still playing;
       * the cross stops it, for us (2026-10-20). */
      this.owner.stage?.enter({ id:`media-${this.surface}`, kind:'media',
        title:this.surface==='jukebox'?'Jukebox':this.surface==='amphitheatre'?'Amphitheatre screen':'Movie Theater screen',
        hideLabel:this.surface==='jukebox'?'Hide jukebox':'Hide video',
        /* A screen's bar sits in the bottom row when there is room for it
         * there, and in space kept above that row when there is not. */
        reserve:this.isScreen?{bottom:()=>this.reserve??0}:undefined,
        minimize:()=>this.owner.leaveStage(this.surface),
        close:()=>this.owner.hide(this.surface) });
    }
    if (tile) {
      /* A docked screen is positioned over its painted counterpart. Those
       * coordinates and its low-zoom transform must not follow it into the
       * call strip, where they would visibly displace it from the camera row. */
      this.root.style.width=`${this.width}px`;this.root.style.height='';
      this.root.style.left='';this.root.style.top='';
      this.root.style.transform='';this.root.style.transformOrigin='';
    }
    else { this.root.style.width='';this.root.style.height=''; }
    if (mode === 'hidden') { this.root.hidden=true;this.root.style.display='none';this.paintPanel();return; }
    this.root.style.display='';
    if(this.state&&this.state.provider!=='none'&&this.owner.game.scene==='main'&&(moving||!this.adapter))void this.apply(this.state);
    this.paintPanel();
  }

  async apply(state) {
    this.state = state;
    this.paintPanel();
    /* Stopped for everyone: off the stage, back to the painted screen. */
    if ((!state || state.provider === 'none') && this.mode === 'stage') this.owner.leaveStage(this.surface);
    if (!state || state.provider === 'none') { this.destroyAdapter(); this.root.hidden = true; return; }
    if (this.mode === 'hidden') { this.destroyAdapter();this.root.hidden=true;return; }
    this.root.hidden = false;
    if(this.mode==='popup')this.owner.orderTiles();
    const skip = this.root.querySelector('.media-skip'), mute = this.root.querySelector('.media-mute');
    if (skip) skip.hidden = state.provider !== 'youtube';
    if (mute) mute.hidden = state.provider === 'screen';
    if(state.provider==='screen'){this.applyScreen(state);return;}
    /* Watching on our own: where WE had got to, not the room. */
    const own = this.isScreen ? this.owner.viewing(this.surface) : null;
    if (own?.independent && own.local) {
      const elapsed = own.local.paused ? 0 : Math.max(0, Date.now() - own.local.at);
      state = { ...state, positionMs: own.local.positionMs + elapsed, at: Date.now(), paused: own.local.paused,
        playlistIndex: own.local.playlistIndex ?? state.playlistIndex };
    }
    const key = `${state.provider}|${state.ref}|${state.playlistIndex??0}`;
    if (this.key !== key) {
      this.destroyAdapter(); this.key = key; this.notice('');
      try {
        this.adapter = createMediaAdapter(this.frame, state.provider, state.ref, {playlistIndex:state.playlistIndex??0});
        this.adapter.onStateChange(change => this.localChange(change));
      } catch (e) { this.error(e); return; }
    }
    const adapter = this.adapter;
    this.suppressUntil = Date.now() + 2500;
    this.paintMute();
    try {
      await adapter.ready;
      if (adapter !== this.adapter) return;
      this.loadFailures.delete(key);
      await adapter.muted(this.owner.isMuted(this.surface));
      const wanted = playbackPosition(state);
      if (state.provider !== 'radio' && Math.abs((adapter.currentTime?.() ?? 0) - wanted) > 1500) await adapter.seek(wanted);
      this.expectPaused = !!state.paused; this.localPaused = !!state.paused; this.paintPanel();
      void Promise.resolve(state.paused ? adapter.pause() : adapter.play()).catch(e=>console.warn('media playback was blocked',e));
    } catch (e) { if(adapter===this.adapter)this.error(e); }
  }

  applyScreen(state){
    const ref=liveRef(state.ref),key=`screen|${state.ref}`;
    if(!ref){this.destroyAdapter();this.notice('This screen share is no longer available.');return;}
    if(this.key!==key){this.destroyAdapter();this.key=key;this.notice('');}
    let video=this.frame.querySelector('video');
    if(!video){video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;this.frame.appendChild(video);}
    const live=this.owner.liveScreen(state);
    if(!live){
      if(video.srcObject){video.pause();video.srcObject=null;}
      this.notice(`Waiting for ${ref.ship}'s screen…`);this.owner.missing(this.surface,state);return;
    }
    this.owner.cancelMissing(this.surface);this.notice('');
    if(video.srcObject!==live.stream){video.srcObject=live.stream;video.play().catch(()=>{});}
  }

  localChange(change) {
    if (!this.state) return;
    if (change.error) { this.youtubeError(change); return; }
    if (change.playing) { this.consecutiveSkips=0;this.notice(''); }
    /* What the player is doing, whoever did it: the bar's play or pause
     * follows it (2026-10-31). */
    const pausedNow = typeof change.paused === 'boolean' && (change.stable !== false || change.paused) ? change.paused : null;
    if (pausedNow !== null && pausedNow !== this.localPaused) { this.localPaused = pausedNow; this.paintPanel(); }
    /* A pause or a play in the player that we did not tell it to make --
     * outside the moment after we told it something -- is the viewer's own,
     * however long ago they last touched it. The end of a video is nobody's. */
    const flipped = pausedNow !== null && !change.ended && typeof this.expectPaused === 'boolean' && pausedNow !== this.expectPaused;
    const nextRef = change.ref ?? this.state.ref;
    const nextIndex = Math.max(0,change.playlistIndex??this.state.playlistIndex??0);
    const oldYoutube=youtubeRef(this.state.ref), nextYoutube=youtubeRef(nextRef);
    const changedVideo=this.state.provider==='youtube'
      ? oldYoutube?.video!==nextYoutube?.video||oldYoutube?.list!==nextYoutube?.list||nextIndex!==(this.state.playlistIndex??0)
      : nextRef!==this.state.ref;
    /* YouTube reports unstarted, cued and buffering before a confirmed item.
     * Writing those old-video transitions is what swallowed the first Skip. */
    if(this.state.provider==='youtube'&&!changedVideo&&!change.stable)return;
    if(Date.now()<this.suppressUntil&&!changedVideo)return;
    /* A changed playlist item is authoritative even when the click happened
     * inside the cross-origin iframe. Pause/seek still require a recent local
     * gesture so applying somebody else's state cannot echo it back. */
    if(!changedVideo&&!flipped&&Date.now()>this.armedUntil)return;
    /* NOT OURS TO SHARE: on somebody else's screening a pause, a seek or a
     * move in the playlist is our own viewing, on our own from now on. A move
     * nobody made -- the next track, a skip past an unplayable one -- is not
     * a viewer's at all; the controller's own will follow. */
    if (this.isScreen && !this.owner.store.mayControl(this.surface)) {
      if (!flipped && Date.now() > this.armedUntil) return;
      const paused = typeof change.paused === 'boolean' ? change.paused : this.paused();
      this.expectPaused = paused;
      this.owner.goIndependent(this.surface, { positionMs: change.positionMs ?? this.here(), paused, at: Date.now(), playlistIndex: nextIndex });
      return;
    }
    this.owner.store.write(this.surface, {
      ref: nextRef, provider: this.state.provider,
      positionMs: change.positionMs ?? this.adapter?.currentTime?.() ?? 0,
      paused: typeof change.paused==='boolean'?change.paused:this.state.paused,
      playlistIndex:nextIndex,
    });
  }

  youtubeError(change) {
    const code=Number(change.error), ref=change.ref??this.state?.ref??'';
    if(code===5 && (this.failed.get(ref)??0)<1){
      this.failed.set(ref,1);this.notice('Playback failed — retrying…');
      this.destroyAdapter();this.key=null;
      setTimeout(()=>{if(this.state?.ref===ref)void this.apply(this.state);},500);
      return;
    }
    const hasPlaylist=(change.playlistLength??0)>1||/[?&]list=/.test(ref);
    if([5,100,101,150].includes(code)&&hasPlaylist){
      if(change.playlistLength>0&&change.playlistIndex>=change.playlistLength-1){
        this.notice('This video cannot play here, and it is the last track.');return;
      }
      this.skip(false);return;
    }
    if([5,100,101,150].includes(code)){
      this.notice('This video does not allow embedded playback.');return;
    }
    this.notice(code===153?'YouTube could not verify this embedded player.':'This YouTube video could not be loaded.');
  }

  skip(manual=false) {
    if(this.state?.provider!=='youtube'||!this.adapter?.next)return;
    if(!manual && ++this.consecutiveSkips>10){this.notice('No playable video found in the next ten tracks.');return;}
    if(manual){this.consecutiveSkips=0;this.owner.mutes.set(this.surface,false);this.setMuted(false);}
    /* A skip nobody asked for is never a viewer taking their own way. */
    if(manual||!this.isScreen||this.owner.store.mayControl(this.surface))this.armedUntil=Date.now()+7000;
    this.suppressUntil=0;
    this.notice(manual?'Skipping…':'Video unavailable here — skipping…');
    void Promise.resolve(this.adapter.next()).catch(()=>this.notice('Could not skip this video.'));
  }

  notice(text) {
    const el=this.root.querySelector('.media-notice');el.textContent=text;el.hidden=!text;
  }

  setMuted(muted) { void Promise.resolve(this.adapter?.muted?.(muted)).catch(()=>{}); this.paintMute(); }
  paintMute() {
    const button = this.root.querySelector('.media-mute');
    if (!button) { this.paintPanel(); return; }
    const muted = this.owner.isMuted(this.surface);
    button.textContent = muted ? 'Unmute' : 'Mute'; button.classList.toggle('on', !muted);
  }
  error(error) {
    console.warn('media player failed', error);
    const state=this.state,key=`${state?.provider}|${state?.ref}|${state?.playlistIndex??0}`;
    const failures=(this.loadFailures.get(key)??0)+1;this.loadFailures.set(key,failures);
    this.destroyAdapter();
    if(failures<=2){this.notice('Player service is still loading — retrying…');
      setTimeout(()=>{if(this.state===state&&this.mode!=='hidden')void this.apply(state);},failures*750);return;}
    this.notice('Could not load the player. Close and reopen it to retry.');
  }
}

export class MediaSurfaces {
  constructor({ game, strip, store, our, stage = null, name = (ship) => ship, mayShare = () => true, notify = () => {} }) {
    this.game=game;this.strip=strip;this.store=store;this.our=our;this.stage=stage;
    this.name=name;this.mayShare=mayShare;this.notify=notify;
    this.views = new Map(); this.mutes = new Map(); this.jukeboxClosed = false;
    /* How each of us is watching each screen, which is nobody else's business:
     * {screening, stopped, independent, local}. */
    this.watching = new Map();
    this.missingTimers = new Map();
    this.worldRoot = document.createElement('div'); this.worldRoot.id = 'world-media-layer'; document.body.appendChild(this.worldRoot);
    /* A screen sent full screen sits here, on the stage (ui/stage). */
    this.stageRoot = document.createElement('div'); this.stageRoot.id = 'stage-media'; document.body.appendChild(this.stageRoot);
    this.lastScene = game.scene;
    this.stopRooms=onRooms(()=>this.roomsChanged());
    this.frame = requestAnimationFrame(() => this.layout());
  }

  view(surface) {
    if (this.views.has(surface)) return this.views.get(surface);
    const kind = surface === 'jukebox' ? 'tile' : 'world';
    const view = new SurfaceView(this, surface, kind); this.views.set(surface, view);
    (kind === 'tile' ? this.strip : this.worldRoot).appendChild(view.root);
    this.orderTiles();
    return view;
  }

  orderTiles() {
    let cursor=this.strip.firstElementChild;
    for(const surface of ['jukebox','amphitheatre','movie']){
      const view=this.views.get(surface),el=view?.root;
      if(!el||view.mode!=='popup'||el.hidden)continue;
      if(el!==cursor)this.strip.insertBefore(el,cursor);
      cursor=el.nextElementSibling;
    }
  }

  viewing(surface) {
    let v = this.watching.get(surface);
    if (!v) this.watching.set(surface, v = { screening: null, stopped: false, independent: false, local: null });
    return v;
  }

  /* A SCREEN'S NEWS. A new screening is everybody's: whoever had gone their
   * own way follows it, and whoever had stopped watching sees it -- without
   * its sound, which a viewer turns on. The same screening moving on is only
   * for those following it: not for anybody watching on their own, and never
   * a reason to start a player somebody stopped. */
  stateChanged(surface, state) {
    if (surface !== 'jukebox') {
      const v = this.viewing(surface), view = this.view(surface);
      if (state.screening !== v.screening) {
        v.screening = state.screening; v.independent = false; v.local = null;
        if (!this.mutes.has(surface)) this.mutes.set(surface, state.startedBy !== this.our);
        if (v.stopped) {
          v.stopped = false;
          if (state.startedBy !== this.our) this.mutes.set(surface, true);
          view.state = state;
          if (view.mode === 'hidden' && state.provider !== 'none') { view.setMode('docked'); return; }
        }
      }
      if (this.game.scene !== 'main' || v.stopped || (v.independent && state.provider !== 'none')) {
        view.state = state; view.paintPanel(); return;
      }
      void view.apply(state);
      return;
    }
    if (!this.mutes.has(surface)) this.mutes.set(surface, state.startedBy !== this.our);
    if (this.game.scene !== 'main') return;
    void this.view(surface).apply(state);
  }

  goIndependent(surface, local) {
    const v = this.viewing(surface);
    v.independent = true; v.local = local;
    this.view(surface).paintPanel();
  }

  /* The painted screen's panel, opened: from its shield, or its hotspot. */
  openPanel(surface) {
    const view = this.view(surface);
    view.panelOpen = true; view.paintPanel();
    view.panel.querySelector('button[data-act]:not([data-act="close"])')?.focus({ preventScroll: true });
  }

  act(surface, what) {
    const view = this.view(surface), state = this.store.get(surface), v = this.viewing(surface);
    switch (what) {
      case 'sound': this.mutes.set(surface, !this.isMuted(surface)); view.setMuted(this.isMuted(surface)); return;
      case 'play': case 'pause': {
        if (!state) return;
        const pause = what === 'pause', at = view.adapter ? view.here() : playbackPosition(state);
        /* Ours to share: for the room. */
        if (this.store.mayControl(surface)) { this.store.write(surface, { paused: pause, positionMs: at }); return; }
        /* Somebody else's: our own viewing, from where we are. */
        view.expectPaused = pause; view.localPaused = pause; view.suppressUntil = Date.now() + 1500;
        this.goIndependent(surface, { positionMs: at, paused: pause, at: Date.now(), playlistIndex: v.local?.playlistIndex ?? state.playlistIndex ?? 0 });
        void Promise.resolve(pause ? view.adapter?.pause?.() : view.adapter?.play?.()).catch(() => {});
        return;
      }
      case 'sync': v.independent = false; v.local = null; if (state) void view.apply(state); return;
      case 'full': if (view.mode === 'stage') this.leaveStage(surface); else view.setMode('stage'); return;
      case 'stop': void this.stop(surface); return;
      case 'choose': void this.choose(surface); return;
    }
  }

  /* STOP, asked first. Whoever started the video stops it for everybody;
   * anybody else stops only their own, and clicks the screen to watch again. */
  async stop(surface) {
    const state = this.store.get(surface);
    if (!state || state.provider === 'none') return;
    const everyone = this.store.mayControl(surface);
    const sure = await ask(everyone ? 'Stop this video for everyone?' : 'Stop watching this video?', everyone
      ? { yes: 'Stop for everyone', no: 'Keep playing', detail: 'You started it, so it stops on this screen for everybody in the room.' }
      : { yes: 'Stop watching', no: 'Keep watching', detail: 'It keeps playing for everybody else. Click the screen to watch it again.' });
    if (!sure || this.store.get(surface)?.screening !== state.screening) return;
    if (everyone && this.store.clear(surface)) return;
    this.hide(surface);
  }

  isMuted(surface) { return this.mutes.get(surface) ?? true; }
  toggleMute(surface) {
    this.mutes.set(surface, !this.isMuted(surface)); this.view(surface).setMuted(this.isMuted(surface));
  }

  hide(surface) {
    if(surface!=='jukebox'){
      /* STOP WATCHING: our player stops, the room's screening does not, and
       * what we chose for its sound is kept for when we watch again. */
      const v=this.viewing(surface),view=this.view(surface);
      v.stopped=true;v.independent=false;v.local=null;
      view.loadFailures.clear();view.setMode('hidden');view.paintPanel();
      return;
    }
    this.jukeboxClosed=true;
    this.mutes.set(surface,true);
    const view=this.view(surface);view.loadFailures.clear();view.setMuted(true);view.setMode('hidden');
  }

  watchAgain(surface) {
    const v=this.viewing(surface),view=this.view(surface);
    v.stopped=false;v.independent=false;v.local=null;
    view.state=this.store.get(surface);
    if(view.mode==='hidden')view.setMode('docked');else if(view.state)void view.apply(view.state);
    view.panelOpen=true;view.paintPanel();
  }

  togglePopout(surface) {
    const view=this.view(surface);
    view.setMode(view.mode==='popup'?'docked':'popup');
  }

  /* Full screen, on the stage, and back to the painted screen. */
  toggleStage(surface) {
    const view=this.view(surface);
    if(view.mode==='stage')this.leaveStage(surface);else view.setMode('stage');
  }

  leaveStage(surface){
    const view=this.view(surface);
    view.setMode(view.returnMode??(view.isScreen?'docked':'popup'));
  }

  activate(surface) {
    if (surface === 'jukebox') {
      this.jukeboxClosed = false;
      const view=this.view(surface);if(view.mode==='hidden')view.setMode('popup');
      const current = this.store.get(surface);
      if (!current || current.provider === 'none') {
        this.mutes.set(surface, false);
        this.store.write(surface, { provider:'youtube', ref:JUKEBOX_REF, positionMs:0, paused:false }, { newItem:true });
      } else void this.view(surface).apply(current);
      return;
    }
    /* A screen: nothing on it, start something; stopped, watch again; else
     * its bar. */
    const state=this.store.get(surface);
    if(!state||state.provider==='none'){void this.choose(surface);return;}
    if(this.viewing(surface).stopped){this.watchAgain(surface);return;}
    this.openPanel(surface);
  }

  async choose(surface) {
    if (!this.mayShare()) { this.notify('You are muted in this Glurff, so you cannot play anything for the room.'); return; }
    const answer = await mediaQuestion(surface, this.store.get(surface));
    if (!answer) return;
    if(answer.screen){
      let live;
      try{live=await startScreen();}catch{return;}
      if(!live)return;
      this.mutes.set(surface,false);
      this.store.write(surface,{provider:'screen',ref:screenRef(this.our,live.token),positionMs:0,paused:false},{newItem:true});
      return;
    }
    const before = this.mutes.get(surface);
    this.mutes.set(surface, false);
    if (!this.store.write(surface, { provider:answer.provider, ref:answer.ref, positionMs:0, paused:false }, { newItem:true })) {
      if (before === undefined) this.mutes.delete(surface); else this.mutes.set(surface, before);
      this.notify('That could not be played for the room.');
    }
  }

  liveScreen(state){
    const ref=liveRef(state?.ref);if(!ref)return null;
    if(ref.ship===this.our){const live=screenShare();return live?.token===ref.token?{stream:live.stream,id:null}:null;}
    for(const [id,r] of rooms.remoteStreams)if(r.ship===ref.ship&&r.label===`screen:${ref.token}`&&
      r.stream?.getVideoTracks?.().some(t=>t.readyState!=='ended'))return{id,stream:r.stream};
    return null;
  }

  cancelMissing(surface){clearTimeout(this.missingTimers.get(surface));this.missingTimers.delete(surface);}
  missing(surface,state){
    if(this.missingTimers.has(surface)||state.startedBy===this.our||rooms.here!==SCREEN_ROOMS[surface]||rooms.voice!=='connected')return;
    const ref=liveRef(state.ref);if(!ref||callPeers().has(ref.ship))return;
    const timer=setTimeout(()=>{
      this.missingTimers.delete(surface);
      const current=this.store.get(surface),again=liveRef(current?.ref);
      if(current?.provider==='screen'&&current.rev===state.rev&&rooms.here===SCREEN_ROOMS[surface]&&
        rooms.voice==='connected'&&again&&!callPeers().has(again.ship))this.store.clear(surface);
    },8000);
    this.missingTimers.set(surface,timer);
  }

  roomsChanged(){
    for(const surface of ['amphitheatre','movie']){
      const state=this.store.get(surface);if(state?.provider!=='screen')continue;
      const ref=liveRef(state.ref),live=screenShare();
      if(state.startedBy===this.our&&(!ref||!live||ref.token!==live.token)){
        this.store.clear(surface);continue;
      }
      if(this.game.scene==='main'&&this.views.get(surface)?.mode!=='hidden')void this.view(surface).apply(state);
    }
  }

  layout() {
    if (this.lastScene !== this.game.scene) {
      const before=this.lastScene;this.lastScene=this.game.scene;
      if(this.game.scene!=='main')for(const view of this.views.values()){view.destroyAdapter();view.root.hidden=true;view.paintPanel();}
      else if(before!=='main')for(const surface of ['jukebox','amphitheatre','movie']){
        const view=this.views.get(surface);
        if(view?.mode==='hidden'){view.paintPanel();continue;}
        const state=this.store.get(surface);if(state&&state.provider!=='none')void this.view(surface).apply(state);
      }
    }
    this.placePanels();
    for (const [surface, rect] of Object.entries(SCREEN_RECTS)) {
      const view=this.views.get(surface); if(!view || view.root.hidden || view.mode!=='docked')continue;
      const canvas=this.game.app?.view, camera=this.game.camera;
      const visible=this.game.scene==='main' && canvas && camera;
      view.root.style.display=visible?'block':'none';
      if(!visible)continue;
      const box=canvas.getBoundingClientRect(), z=this.game.zoom;
      const screenLeft=box.left+camera.position.x+rect.x*z,screenTop=box.top+camera.position.y+rect.y*z-(LIFT[surface]?.[z]??0);
      view.root.style.left=`${screenLeft}px`;view.root.style.top=`${screenTop}px`;
      /* YouTube becomes unreliable when its real iframe viewport is reduced
       * to the half-zoom painted-screen dimensions. Keep the player at the
       * known-working 1x dimensions and let the browser composite it down to
       * the same visual rectangle. Both painted screens use this path. */
      const playerZoom=Math.max(1,z);
      view.setControlScale(z<1?1/z:1);
      view.root.style.width=`${rect.w*playerZoom}px`;view.root.style.height=`${rect.h*playerZoom}px`;
      view.root.style.transformOrigin='top left';
      view.root.style.transform=z<1?`scale(${z})`:'';
    }
    this.frame=requestAnimationFrame(()=>this.layout());
  }

  /* An open bar sits below its painted screen -- above it, if there is no
   * room below -- and always wholly on the page. In full screen, see stageBar. */
  placePanels() {
    const canvas=this.game.app?.view, camera=this.game.camera;
    for (const [surface, rect] of Object.entries(SCREEN_RECTS)) {
      const view=this.views.get(surface), panel=view?.panel;
      if(!panel||panel.hidden)continue;
      if(view.mode==='stage'){this.stageBar(view);continue;}
      if(!canvas||!camera){panel.style.left='8px';panel.style.top='8px';continue;}
      const box=canvas.getBoundingClientRect(), z=this.game.zoom;
      const left=box.left+camera.position.x+rect.x*z, top=box.top+camera.position.y+rect.y*z;
      const w=panel.offsetWidth, h=panel.offsetHeight, W=innerWidth, H=innerHeight, gap=8;
      let y=top+rect.h*z+gap;
      if(y+h>H-gap)y=top-h-gap;
      y=Math.max(gap,Math.min(H-h-gap,y));
      const x=Math.max(gap,Math.min(W-w-gap,left+rect.w*z/2-w/2));
      panel.style.left=`${Math.round(x)}px`;panel.style.top=`${Math.round(y)}px`;
    }
  }

  /* IN FULL SCREEN the bar is in the bottom row, between the call bar on the
   * left and the chat button on the right, level with them. Where they leave
   * it too little room -- a phone held upright -- it sits just above that
   * row, and the stage keeps the space for it (the source's `reserve`). */
  stageBar(view) {
    const panel=view.panel, W=innerWidth, H=innerHeight, gap=8;
    const seen=(q)=>{const e=document.querySelector(q);if(!e)return null;const st=getComputedStyle(e);
      if(st.display==='none'||st.visibility==='hidden')return null;const r=e.getBoundingClientRect();return r.width&&r.height?r:null;};
    const rail=seen('#rail'), chat=seen('#hud .chat-toggle'), talk=seen('#hud .chat-content');
    const left=rail?rail.right+gap:gap;
    const right=Math.min(chat?chat.left-gap:W-gap, talk&&talk.bottom>H-120?talk.left-gap:W-gap);
    const w=panel.offsetWidth, h=panel.offsetHeight, row=chat??rail;
    let x, y, reserve=0;
    if(row&&right-left>=w){x=left+(right-left-w)/2;y=row.bottom-h;}
    else{const floor=Math.min(rail?.top??H, chat?.top??H);x=(W-w)/2;y=floor-gap-h;reserve=h+gap;}
    panel.style.left=`${Math.round(Math.max(gap,x))}px`;panel.style.top=`${Math.round(Math.max(gap,y))}px`;
    if(view.reserve!==reserve){view.reserve=reserve;this.stage?.layout?.();}
  }
}

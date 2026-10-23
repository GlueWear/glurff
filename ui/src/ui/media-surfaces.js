import { createMediaAdapter, parseMediaRef, youtubeRef } from 'lib/player-providers';
import { playbackPosition } from 'lib/player-state';
import { SCREEN_RECTS } from 'world/hotspots';
import { roomBySlug } from 'world/places';
import { rooms, onRooms, callPeers, startScreen, screenShare } from 'lib/rooms';
import { esc } from 'ui/html';
import { columnMode, defaultTileWidth, dragToSize, resetTileSizes, onTileReset, maxColumnTile } from 'ui/strip-column';

export const JUKEBOX_REF = 'https://www.youtube.com/watch?v=Bek5peeuUyU&list=PLo8ET_VWap-zw_uFQlI0JJesTJtepJ9N1';


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

function mediaQuestion(surface, current) {
  return new Promise(resolve => {
    const name = surface === 'amphitheatre' ? 'Amphitheatre screen' : 'Movie Theater screen';
    const root = document.createElement('div'); root.className = 'ask-overlay media-question';
    root.innerHTML = `<form class="ask" role="dialog" aria-modal="true">
      <div class="ask-q">${esc(name)}</div>
      <label class="media-url">Media link<input type="url" required placeholder="YouTube, Vimeo, media, radio or SoundCloud" value="${esc(current?.provider==='screen'?'':current?.ref ?? '')}"></label>
      <!-- Screen-to-theater transport is retained for later work, but is not
           currently offered to users. Hidden removes it visually and disabled
           keeps it out of mouse and keyboard interaction. -->
      <div class="media-share-row" hidden><button type="button" class="media-share" disabled>SHARE SCREEN</button></div>
      <div class="media-error" role="alert"></div>
      <div class="ask-row"><button type="button" class="media-cancel">Cancel</button>
        ${current && current.provider !== 'none' ? '<button type="button" class="media-stop">Stop for everyone</button>' : ''}
        <button type="submit" class="media-play">Play</button></div>
    </form>`;
    const finish = answer => { window.removeEventListener('keydown', key, true); root.remove(); resolve(answer); };
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
    root.querySelector('.media-cancel').onclick = () => finish(null);
    root.querySelector('.media-stop')?.addEventListener('click', () => finish({ stop:true }));
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
    this.root.innerHTML = `<div class="media-frame"></div><div class="media-notice" hidden></div><div class="media-tools">
      <button type="button" class="media-mute" title="Mute this player locally"></button>
      <button type="button" class="media-skip" title="Skip this YouTube video" hidden>Skip</button>
      ${this.isScreen ? '<button type="button" class="media-full" title="Full screen">⛶</button><button type="button" class="media-pop" title="Open in a resizable window">□</button><button type="button" class="media-change">Change</button>' : ''}
      <button type="button" class="media-stop" title="Stop this stream for everyone">Stop all</button>
      <button type="button" class="media-close" title="Leave this stream locally">×</button>
    </div><button type="button" class="media-menu" title="Media controls" aria-label="Media controls" aria-expanded="false">•••</button>
      <i class="grip" title="Drag to resize; double-click to put every one back to its normal size"></i>`;
    this.frame = this.root.querySelector('.media-frame');
    const used=(e,action)=>{e.stopPropagation();this.setControls(false);action();};
    this.root.querySelector('.media-mute').onclick = e => used(e,()=>owner.toggleMute(surface));
    this.root.querySelector('.media-skip').onclick = e => used(e,()=>this.skip(true));
    this.root.querySelector('.media-stop').onclick = e => used(e,()=>owner.store.clear(surface));
    this.root.querySelector('.media-pop')?.addEventListener('click', e => used(e,()=>owner.togglePopout(surface)));
    this.root.querySelector('.media-full')?.addEventListener('click', e => used(e,()=>owner.toggleStage(surface)));
    this.root.querySelector('.media-change')?.addEventListener('click', e => used(e,()=>void owner.choose(surface)));
    this.root.querySelector('.media-close').addEventListener('click', e => used(e,()=>owner.hide(surface)));
    this.root.querySelector('.media-menu').onclick=e=>{e.stopPropagation();this.setControls(!this.controlsOpen);};
    document.addEventListener('pointerdown',e=>{if(this.controlsOpen&&!this.root.contains(e.target))this.setControls(false);});
    this.root.addEventListener('pointerdown', e => e.stopPropagation());
    this.root.addEventListener('dblclick',e=>{if(this.mode==='docked'&&!e.target.closest('button'))void owner.choose(surface);});
    this.adapter = null; this.key = null; this.state = null; this.suppressUntil = 0;
    this.armedUntil = 0; this.pointerInside = false;
    this.failed = new Map(); this.loadFailures = new Map(); this.consecutiveSkips = 0;
    this.root.addEventListener('pointerenter',()=>{this.pointerInside=true;});
    this.root.addEventListener('pointerleave',()=>{this.pointerInside=false;});
    this.root.addEventListener('pointerdown',()=>{this.armedUntil=Date.now()+5000;});
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
    this.controlsOpen=!!open;
    this.root.classList.toggle('media-controls-open',this.controlsOpen);
    this.root.querySelector('.media-tools').classList.toggle('open',this.controlsOpen);
    this.root.querySelector('.media-menu').setAttribute('aria-expanded',String(this.controlsOpen));
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

  destroyAdapter() {
    this.adapter?.destroy?.(); this.adapter = null; this.key = null;
    for(const video of this.frame.querySelectorAll('video')){try{video.pause();video.srcObject=null;}catch{}}
    this.frame.replaceChildren();this.owner.cancelMissing(this.surface);
  }

  setMode(mode) {
    if (!['docked','popup','hidden','stage'].includes(mode) || (!this.isScreen && mode==='docked')) return;
    if (this.mode === mode) return;
    if(mode==='stage')this.returnMode=this.mode==='hidden'?(this.isScreen?'docked':'popup'):this.mode;
    this.setControls(false);this.setControlScale(1);
    /* Off the stage: let it go (see ui/stage). */
    if (this.mode === 'stage') { this.mode = mode; this.owner.stage?.leave(`media-${this.surface}`); }
    this.destroyAdapter(); this.mode = mode; this.root.dataset.mode = mode;
    const tile = mode === 'popup', staged = mode === 'stage'; this.kind = tile ? 'tile' : 'world';
    this.root.className = tile ? 'tile media-tile' : staged ? 'world-media staged-media' : 'world-media';
    this.root.querySelector('.grip').hidden = !tile;
    const pop=this.root.querySelector('.media-pop');
    if(pop){pop.textContent=tile?'▣':'□';pop.title=tile?'Return to the painted screen':'Open in a resizable window';}
    const full=this.root.querySelector('.media-full');
    if(full){full.textContent=staged?'⤡':'⛶';full.title=staged?'Back to the screen':'Full screen';}
    (tile ? this.owner.strip : staged ? this.owner.stageRoot : this.owner.worldRoot).appendChild(this.root);
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
    if (mode === 'hidden') { this.root.hidden=true;this.root.style.display='none';return; }
    this.root.style.display='';
    if(this.state?.provider!=='none'&&this.owner.game.scene==='main')void this.apply(this.state);
  }

  async apply(state) {
    this.state = state;
    /* Stopped for everyone: off the stage, back to the painted screen. */
    if ((!state || state.provider === 'none') && this.mode === 'stage') this.owner.leaveStage(this.surface);
    if (!state || state.provider === 'none') { this.destroyAdapter(); this.root.hidden = true; return; }
    if (this.mode === 'hidden') { this.destroyAdapter();this.root.hidden=true;return; }
    this.root.hidden = false;
    if(this.mode==='popup')this.owner.orderTiles();
    this.root.querySelector('.media-skip').hidden = state.provider !== 'youtube';
    this.root.querySelector('.media-mute').hidden = state.provider === 'screen';
    if(state.provider==='screen'){this.applyScreen(state);return;}
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
    if(!changedVideo&&Date.now()>this.armedUntil)return;
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
    this.armedUntil=Date.now()+7000;this.suppressUntil=0;
    this.notice(manual?'Skipping…':'Video unavailable here — skipping…');
    void Promise.resolve(this.adapter.next()).catch(()=>this.notice('Could not skip this video.'));
  }

  notice(text) {
    const el=this.root.querySelector('.media-notice');el.textContent=text;el.hidden=!text;
  }

  setMuted(muted) { void Promise.resolve(this.adapter?.muted?.(muted)).catch(()=>{}); this.paintMute(); }
  paintMute() {
    const button = this.root.querySelector('.media-mute');
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
  constructor({ game, strip, store, our, stage = null }) {
    this.game=game;this.strip=strip;this.store=store;this.our=our;this.stage=stage;
    this.views = new Map(); this.mutes = new Map(); this.jukeboxClosed = false;
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

  stateChanged(surface, state) {
    if (!this.mutes.has(surface)) this.mutes.set(surface, state.startedBy !== this.our);
    if (this.game.scene !== 'main') return;
    void this.view(surface).apply(state);
  }

  isMuted(surface) { return this.mutes.get(surface) ?? true; }
  toggleMute(surface) {
    this.mutes.set(surface, !this.isMuted(surface)); this.view(surface).setMuted(this.isMuted(surface));
  }

  hide(surface) {
    if(surface==='jukebox')this.jukeboxClosed=true;
    this.mutes.set(surface,true);
    const view=this.view(surface);view.loadFailures.clear();view.setMuted(true);view.setMode('hidden');
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
    const current=this.store.get(surface), view=this.views.get(surface);
    if(current?.provider!=='none'&&view?.mode==='hidden'){view.setMode('docked');return;}
    void this.choose(surface);
  }

  async choose(surface) {
    const answer = await mediaQuestion(surface, this.store.get(surface));
    if (!answer) return;
    if (answer.stop) { this.store.clear(surface); return; }
    if(answer.screen){
      let live;
      try{live=await startScreen();}catch{return;}
      if(!live)return;
      this.mutes.set(surface,false);
      this.store.write(surface,{provider:'screen',ref:screenRef(this.our,live.token),positionMs:0,paused:false},{newItem:true});
      return;
    }
    this.mutes.set(surface, false);
    this.store.write(surface, { provider:answer.provider, ref:answer.ref, positionMs:0, paused:false }, { newItem:true });
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
      if(this.game.scene!=='main')for(const view of this.views.values()){view.destroyAdapter();view.root.hidden=true;}
      else if(before!=='main')for(const surface of ['jukebox','amphitheatre','movie']){
        if(this.views.get(surface)?.mode==='hidden')continue;
        const state=this.store.get(surface);if(state?.provider!=='none')void this.view(surface).apply(state);
      }
    }
    for (const [surface, rect] of Object.entries(SCREEN_RECTS)) {
      const view=this.views.get(surface); if(!view || view.root.hidden || view.mode!=='docked')continue;
      const canvas=this.game.app?.view, camera=this.game.camera;
      const visible=this.game.scene==='main' && canvas && camera;
      view.root.style.display=visible?'block':'none';
      if(!visible)continue;
      const box=canvas.getBoundingClientRect(), z=this.game.zoom;
      const screenLeft=box.left+camera.position.x+rect.x*z,screenTop=box.top+camera.position.y+rect.y*z;
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
}

/* URL parsing and the small common surface implemented by every media player.
 * Third-party SDKs are loaded only when somebody actually opens that kind of
 * media; the world itself never waits on them. */

const HTTP = /^https?:$/;
const VIDEO = /\.(?:mp4|webm|ogv|mov)(?:$|[?#])/i;
const AUDIO = /\.(?:mp3|m4a|aac|ogg|oga|wav|flac)(?:$|[?#])/i;

export function youtubeRef(value) {
  try {
    const u = new URL(value);
    if (!HTTP.test(u.protocol)) return null;
    let video = '';
    if (u.hostname === 'youtu.be') video = u.pathname.split('/').filter(Boolean)[0] ?? '';
    else if (/(^|\.)youtube(?:-nocookie)?\.com$/.test(u.hostname)) {
      video = u.searchParams.get('v') ?? '';
      const bits = u.pathname.split('/').filter(Boolean);
      if (!video && ['embed', 'shorts', 'live'].includes(bits[0])) video = bits[1] ?? '';
    } else return null;
    const list = u.searchParams.get('list') ?? '';
    if (!video && !list) return null;
    return { video, list };
  } catch { return null; }
}

export function parseMediaRef(value) {
  const ref = String(value ?? '').trim();
  if (!ref || ref.length > 2048) return null;
  const yt = youtubeRef(ref);
  if (yt) return { provider: 'youtube', ref };
  try {
    const u = new URL(ref);
    if (!HTTP.test(u.protocol)) return null;
    if (/(^|\.)spotify\.com$/.test(u.hostname)) return null;
    if (/(^|\.)vimeo\.com$/.test(u.hostname) && /\d+/.test(u.pathname))
      return { provider: 'vimeo', ref };
    if (/(^|\.)soundcloud\.com$/.test(u.hostname) && u.pathname !== '/')
      return { provider: 'soundcloud', ref };
    if (VIDEO.test(u.pathname + u.search)) return { provider: 'direct', ref, media: 'video' };
    if (AUDIO.test(u.pathname + u.search)) return { provider: 'direct', ref, media: 'audio' };
    return { provider: 'radio', ref, media: 'audio' };
  } catch { return null; }
}

const scripts = new Map();
function script(src, ready) {
  if (ready()) return Promise.resolve();
  if (scripts.has(src)) return scripts.get(src);
  const loading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.async = true; el.onload = resolve; el.onerror = () => reject(new Error('media service unavailable'));
    document.head.appendChild(el);
  }).then(() => { if (!ready()) throw new Error('media service did not load'); });
  const retryable = loading.catch(error => { scripts.delete(src); throw error; });
  scripts.set(src, retryable);
  return retryable;
}

/* The iframe_api script's load event can fire before YT.Player exists: it
 * loads YouTube's widget implementation and announces completion through a
 * global callback. Waiting only for `load` made a fresh Glurff tab fail while
 * a later Stop/restart worked. Honour the callback, keep polling for pages
 * that loaded the script first, and forget failures so Retry really retries. */
let youtubeLoading = null;
function youtubeScript() {
  if (globalThis.YT?.Player) return Promise.resolve();
  if (youtubeLoading) return youtubeLoading;
  const loading = new Promise((resolve, reject) => {
    const previous = globalThis.onYouTubeIframeAPIReady;
    let timer = null, poll = null, settled = false, el = null;
    const finish = error => {
      if (settled) return;
      if (!error && !globalThis.YT?.Player) return;
      settled = true; clearTimeout(timer); clearInterval(poll);
      if (globalThis.onYouTubeIframeAPIReady === callback)
        globalThis.onYouTubeIframeAPIReady = previous;
      if (error && el?.dataset.glurffYoutube) el.remove();
      error ? reject(error) : resolve();
    };
    const callback = () => {
      try { previous?.(); } catch (error) { console.warn('Earlier YouTube ready callback failed', error); }
      finish();
    };
    globalThis.onYouTubeIframeAPIReady = callback;
    poll = setInterval(() => finish(), 50);
    timer = setTimeout(() => finish(new Error('YouTube player service timed out')), 15_000);
    el = document.querySelector('script[data-glurff-youtube]');
    if (!el) {
      el = document.createElement('script');
      el.src = 'https://www.youtube.com/iframe_api'; el.async = true;
      el.dataset.glurffYoutube = '1';
      document.head.appendChild(el);
    }
    el.addEventListener('error', () => finish(new Error('YouTube player service unavailable')), { once:true });
    finish();
  });
  youtubeLoading = loading.catch(error => { youtubeLoading = null; throw error; });
  return youtubeLoading;
}

function events() {
  let listener = () => {};
  return { emit: value => listener(value), on: fn => { listener = fn ?? (() => {}); } };
}

function directAdapter(root, provider, ref) {
  const bus = events();
  const video = provider === 'direct' && VIDEO.test(ref);
  const el = document.createElement(video ? 'video' : 'audio');
  el.controls = true; el.playsInline = true; el.preload = 'auto'; el.src = ref;
  if (!video) el.className = 'audio-player';
  root.appendChild(el);
  let pendingSeek = null;
  el.addEventListener('loadedmetadata',()=>{if(pendingSeek!==null){el.currentTime=pendingSeek/1000;pendingSeek=null;}});
  const tell = () => bus.emit({ paused: el.paused, positionMs: provider === 'radio' ? 0 : (el.currentTime || 0) * 1000 });
  el.addEventListener('play', tell); el.addEventListener('pause', tell); el.addEventListener('seeked', tell);
  return {
    ready: Promise.resolve(), load: () => {}, play: () => el.play().catch(() => {}), pause: () => el.pause(),
    seek: ms => { if (provider !== 'radio') { if(Number.isFinite(el.duration))el.currentTime=ms/1000;else pendingSeek=ms; } },
    currentTime: () => provider === 'radio' ? 0 : (el.currentTime || 0) * 1000,
    onStateChange: bus.on, muted: value => { el.muted = value; },
    destroy: () => { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); },
  };
}

function youtubeAdapter(root, ref, { playlistIndex = 0 } = {}) {
  const bus = events(), holder = document.createElement('div'); root.appendChild(holder);
  let player = null, destroyed = false;
  const timers = new Set();
  const parsed = youtubeRef(ref) ?? {};
  const snapshot = status => {
    const video = player?.getVideoData?.().video_id ?? parsed.video;
    const list = player?.getPlaylistId?.() ?? parsed.list;
    const index = Math.max(0, player?.getPlaylistIndex?.() ?? playlistIndex ?? 0);
    const url = video ? `https://www.youtube.com/watch?v=${video}${list ? `&list=${list}` : ''}` : ref;
    const playing = status === globalThis.YT?.PlayerState?.PLAYING;
    const paused = status === globalThis.YT?.PlayerState?.PAUSED || status === globalThis.YT?.PlayerState?.ENDED;
    return { status, playing, paused, stable:playing||paused, positionMs:(player?.getCurrentTime?.()||0)*1000,
      ref:url, playlistIndex:index, playlistLength:player?.getPlaylist?.()?.length??0 };
  };
  const ready = youtubeScript().then(() => new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => { if (!settled) { settled=true; reject(new Error('YouTube player did not become ready')); } }, 15_000);
    player = new globalThis.YT.Player(holder, {
      width: '100%', height: '100%',
      videoId: parsed.video || undefined,
      playerVars: { controls: 1, playsinline: 1, listType: parsed.list ? 'playlist' : undefined,
        list: parsed.list || undefined, index:parsed.list ? Math.max(0,playlistIndex||0) : undefined,
        origin: location.origin },
      events: {
        onReady: () => {
          /* videoId+list is not enough for every YouTube playlist to honour a
           * non-zero item. Explicitly select it before apply() seeks/plays. */
          if(parsed.list&&playlistIndex>0)player.playVideoAt?.(playlistIndex);
          if (!settled) { settled=true;clearTimeout(timeout);resolve(); }
        },
        onStateChange: e => bus.emit(snapshot(e.data)),
        onError: e => {
          bus.emit({ ...snapshot(player?.getPlayerState?.()), error:e.data });
          /* An unavailable item still has a working player whose Next method
           * can recover the playlist. Do not strand apply() waiting for ready. */
          if (!settled) { settled=true;clearTimeout(timeout);resolve(); }
        },
      },
    });
  }));
  const next = () => ready.then(() => new Promise((resolve, reject) => {
    const expectedVideo=parsed.video, playlist=player?.getPlaylist?.()??[];
    let current=player?.getPlaylistIndex?.()??-1;
    current=Math.max(current,playlist.indexOf(expectedVideo),Math.max(0,playlistIndex||0));
    const target=current+1;
    if(playlist.length&&target>=playlist.length)return reject(new Error('end of playlist'));
    if(player?.playVideoAt)player.playVideoAt(target);
    else if(parsed.list&&player?.loadPlaylist)player.loadPlaylist({list:parsed.list,listType:'playlist',index:target});
    else player.nextVideo();
    const started=Date.now();
    const check=()=>{
      if(destroyed)return reject(new Error('player closed'));
      const video=player?.getVideoData?.().video_id,index=player?.getPlaylistIndex?.()??-1,status=player?.getPlayerState?.();
      const active=[globalThis.YT?.PlayerState?.PLAYING,globalThis.YT?.PlayerState?.BUFFERING,globalThis.YT?.PlayerState?.CUED].includes(status);
      if(index===target&&active&&(video!==expectedVideo||index!==playlistIndex)){
        bus.emit(snapshot(status));return resolve();
      }
      if(Date.now()-started>=5000)return reject(new Error('playlist did not advance'));
      const timer=setTimeout(()=>{timers.delete(timer);check();},100);timers.add(timer);
    };
    check();
  }));
  return {
    ready,
    load: nextRef => ready.then(() => { const p = youtubeRef(nextRef) ?? {}; p.list ? player.loadPlaylist({ list:p.list, listType:'playlist', index:0 }) : player.loadVideoById(p.video); }),
    play: () => ready.then(() => player.playVideo()), pause: () => ready.then(() => player.pauseVideo()),
    seek: ms => ready.then(() => player.seekTo(ms / 1000, true)),
    next,
    currentTime: () => (player?.getCurrentTime?.() || 0) * 1000,
    onStateChange: bus.on, muted: value => ready.then(() => value ? player.mute() : player.unMute()),
    destroy: () => { destroyed=true;for(const timer of timers)clearTimeout(timer);timers.clear();player?.destroy?.();holder.remove(); },
  };
}

function vimeoAdapter(root, ref) {
  const bus = events(), iframe = document.createElement('iframe');
  const id = ref.match(/(?:vimeo\.com\/(?:video\/)?)(\d+)/)?.[1];
  iframe.src = `https://player.vimeo.com/video/${id}?autoplay=0`; iframe.allow = 'autoplay; fullscreen; picture-in-picture';
  root.appendChild(iframe);
  let player = null;
  const ready = script('https://player.vimeo.com/api/player.js', () => !!globalThis.Vimeo?.Player).then(() => {
    player = new globalThis.Vimeo.Player(iframe);
    player.on('play', async () => bus.emit({ paused:false, positionMs:(await player.getCurrentTime())*1000 }));
    player.on('pause', async () => bus.emit({ paused:true, positionMs:(await player.getCurrentTime())*1000 }));
    player.on('seeked', e => bus.emit({ paused:false, positionMs:e.seconds*1000 }));
    return player.ready();
  });
  return {
    ready, load: () => {}, play: () => ready.then(() => player.play()), pause: () => ready.then(() => player.pause()),
    seek: ms => ready.then(() => player.setCurrentTime(ms/1000)), currentTime: () => 0,
    onStateChange: bus.on, muted: value => ready.then(() => player.setMuted(value)),
    destroy: () => { player?.destroy?.(); iframe.remove(); },
  };
}

function soundcloudAdapter(root, ref) {
  const bus = events(), iframe = document.createElement('iframe');
  iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(ref)}&auto_play=false&show_artwork=true`;
  iframe.allow = 'autoplay'; root.appendChild(iframe);
  let widget = null, position = 0;
  const ready = script('https://w.soundcloud.com/player/api.js', () => !!globalThis.SC?.Widget).then(() => new Promise(resolve => {
    widget = globalThis.SC.Widget(iframe);
    widget.bind(globalThis.SC.Widget.Events.READY, resolve);
    widget.bind(globalThis.SC.Widget.Events.PLAY_PROGRESS, e => { position = e.currentPosition || 0; });
    widget.bind(globalThis.SC.Widget.Events.PLAY, () => bus.emit({ paused:false, positionMs:position }));
    widget.bind(globalThis.SC.Widget.Events.PAUSE, () => bus.emit({ paused:true, positionMs:position }));
    widget.bind(globalThis.SC.Widget.Events.SEEK, e => { position=e.currentPosition||0;bus.emit({paused:false,positionMs:position}); });
  }));
  return {
    ready, load: () => {}, play: () => ready.then(() => widget.play()), pause: () => ready.then(() => widget.pause()),
    seek: ms => ready.then(() => widget.seekTo(ms)), currentTime: () => position,
    onStateChange: bus.on, muted: value => ready.then(() => widget.setVolume(value ? 0 : 100)),
    destroy: () => { widget?.unbind?.(); iframe.remove(); },
  };
}

export function createMediaAdapter(root, provider, ref, options = {}) {
  root.replaceChildren();
  if (provider === 'youtube') return youtubeAdapter(root, ref, options);
  if (provider === 'vimeo') return vimeoAdapter(root, ref);
  if (provider === 'soundcloud') return soundcloudAdapter(root, ref);
  if (provider === 'direct' || provider === 'radio') return directAdapter(root, provider, ref);
  throw new Error('unsupported media provider');
}

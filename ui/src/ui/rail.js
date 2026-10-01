/* The call rail, and the video strip.
 *
 * Walking into a room joins its call, so there is no join button -- this is a
 * readout of who can hear you and what you are sending. Video sits along the
 * top: double-click a tile to expand it, drag its corner to size it.
 */
import { rooms, onRooms, toggleMic, toggleCam, toggleScreen, occupantsOf, hostOf, currentHuddle, retryCall, reopenCapture, outputChanged, hostReach,
         canModerate, mayRecord, mutedShip, roleFor, callPeers, retryMic, soundless, micOff } from 'lib/rooms';
import { devices, onDevices, refreshDevices, chosenDevice, chooseDevice, canPickOutput, noiseReduction, setNoiseReduction } from 'lib/devices';
import { displayName, avatarUrl, onChange } from 'lib/noltbook';
import { copyDiagnostics } from 'lib/diagnostics';
import { roomById, COMMONS } from 'world/places';
import { our } from 'lib/api';
import { esc } from 'ui/html';

export class Rail {
  constructor(root, strip) {
    this.root = root;
    this.strip = strip;
    this.expanded = null;
    /* EACH FEED HAS ITS OWN SIZE. One shared width meant dragging a corner
     * resized every screen in the strip rather than the one under the hand. */
    this.sizes = new Map();
    /* What a feed starts at: smaller on a phone, where the world is small too. */
    this.size = smallScreen() ? 96 : 132;
    /* The settings panel lives OUTSIDE the repainted markup.
     *
     * The rail redraws on every presence tick -- several times a second -- and
     * it redraws by replacing its innerHTML. A panel rendered in there was
     * destroyed and recreated hidden between the click and the eye, which is
     * why the gear appeared to do nothing at all. It also cannot be rebuilt
     * under an open <select>, which would close the list mid-choice. */
    this.settings = document.createElement('div');
    this.settings.className = 'settings';
    this.settings.hidden = true;
    this.root.appendChild(this.settings);
    this.settingsOpen = false;
    onDevices(() => { if (this.settingsOpen) this.paintSettings(); });
    onRooms(() => this.paint());
    /* A picture arriving, or a name, changes a tile. */
    onChange(() => this.paintStrip(), (c) => c.field === 'profiles');
    this.paint();
  }

  /* What a recording should draw: the tiles as they are on screen. Elements,
   * not streams -- the recorder copies pixels and never re-attaches media. */
  recordableTiles() {
    const out = [];
    for (const v of this.videos()) {
      const el = this.tiles?.get(v.key);
      const video = el?.querySelector('video');
      if (video) out.push({ video, label: v.label, screen: v.key === 'screen' || v.label.endsWith('Screen') });
    }
    return out;
  }

  /* EVERYBODY IN THE CALL HAS A TILE. Their camera if it is on, otherwise
   * their profile picture -- or their initials, with no picture -- and their
   * name under it, with host, admin and muted as small tags. This is where the
   * call's names live now; the list that used to be squeezed in beside the
   * buttons is gone. Screens are tiles of their own, after the people.
   * Before the call connects only your own camera preview shows. */
  participants() {
    const connected = rooms.voice === 'connected';
    /* Somebody an admin has muted is not shown, by anybody. */
    const muted = new Set(rooms.blocked ?? []);
    const live = (stream) => stream?.getVideoTracks().some((t) => t.readyState !== 'ended');
    const cameras = new Map(), screens = [];
    for (const [id, r] of rooms.remoteStreams.entries()) {
      if (muted.has(r.ship) || !live(r.stream)) continue;
      if (r.label === 'screen') screens.push({ key: 'remote:' + id, ship: r.ship, label: `${displayName(r.ship)} · Screen`, stream: r.stream, mine: false, screen: true });
      else if (!cameras.has(r.ship)) cameras.set(r.ship, r.stream);
    }
    const byName = (a, b) => displayName(a).toLowerCase().localeCompare(displayName(b).toLowerCase());
    const people = connected ? [...callPeers()].filter((s) => s !== our && !muted.has(s)) : [];
    for (const s of cameras.keys()) if (!people.includes(s)) people.push(s);
    const out = [];
    const mine = rooms.localStreams.get('cam') ?? null;
    if (connected || mine) out.push({ key: 'person:' + our, ship: our, label: 'You', stream: mine, mine: true });
    for (const s of people.sort(byName))
      out.push({ key: 'person:' + s, ship: s, label: displayName(s), stream: cameras.get(s) ?? null, mine: false });
    const myScreen = rooms.localStreams.get('screen');
    if (myScreen) out.push({ key: 'screen', ship: our, label: 'Your screen', stream: myScreen, mine: true, screen: true });
    return [...out, ...screens];
  }

  /* The tiles that are showing video right now: what a recording draws. */
  videos() { return this.participants().filter((t) => t.stream); }

  /* Small tags after a name: who hosts, who is an admin, who is muted. */
  tags(ship) {
    if (!ship) return '';
    const host = currentHuddle()?.host ?? (rooms.here !== COMMONS ? rooms.host : null);
    /* "no sound": their audio should be reaching us and is not. Not our
     * speakers -- see lib/sfu soundless. */
    /* "mic off": muted by themselves. Their stream stays in the call now,
     * silent, so without this nobody could tell muted from quiet. */
    return [ship === host ? 'host' : '', roleFor(ship) === 'admin' ? 'admin' : '',
      mutedShip(ship) ? 'muted' : micOff(ship) ? 'mic off' : '',
      ship !== our && soundless().has(ship) ? 'no sound' : '']
      .filter(Boolean).join(' · ');
  }

  paintStrip() {
    const vids = this.participants();
    this.tiles ??= new Map();
    const wanted = new Set(vids.map(v=>v.key));
    for (const [key,el] of this.tiles) if(!wanted.has(key)) {
      const video=el.querySelector('video');video.pause();video.srcObject=null;el.remove();this.tiles.delete(key);
      this.sizes.delete(key);
      if(this.expanded===key)this.expanded=null;
    }
    /* Shared-media windows own the leading strip slots. Camera and screen
     * tiles start immediately after them instead of repainting over their
     * ordering several times a second. */
    const mediaCount=[...this.strip.children]
      .filter(el=>el.classList.contains('media-tile')&&!el.hidden&&el.dataset.mode==='popup').length;
    for (const [i,v] of vids.entries()) {
      /* The one you have opened up gets a floor of 320 and twice the width;
       * everything else keeps whatever it was last dragged to. */
      const own = this.sizes.get(v.key) ?? this.size;
      const w = this.expanded === v.key ? Math.max(own, 320) * 2 : own;
      let el=this.tiles.get(v.key);
      if(!el) {
        el=document.createElement('div');el.className='tile';
        el.innerHTML='<video autoplay playsinline muted></video><img class="face" alt=""><b class="initials"></b>'+
          '<span><em class="who"></em><small class="tags"></small></span><i class="grip"></i>';
        this.tiles.set(v.key,el);
        el.ondblclick=()=>{this.expanded=this.expanded===v.key?null:v.key;this.paintStrip();};
        /* Pointer events with capture: the drag follows the pointer even when
         * it leaves the little square, and it ends with the pointer wherever
         * that happens -- including a touch or pen. */
        const grip=el.querySelector('.grip');
        grip.addEventListener('pointerdown',e=>{
          if(e.button!==undefined && e.button!==0)return;
          e.preventDefault();e.stopPropagation();
          /* Drag sets THIS feed's own size. An opened-up feed is drawn at twice
           * that, so the drag is measured against the size, not the drawing. */
          const startX=e.clientX,scale=this.expanded===v.key?2:1,startW=el.offsetWidth/scale;
          try{grip.setPointerCapture?.(e.pointerId);}catch{}
          const move=ev=>{this.sizes.set(v.key,Math.max(96,Math.min(720,startW+(ev.clientX-startX)/scale)));this.paintStrip();};
          const up=()=>{
            grip.removeEventListener('pointermove',move);
            grip.removeEventListener('pointerup',up);
            grip.removeEventListener('pointercancel',up);
            try{grip.releasePointerCapture?.(e.pointerId);}catch{}
          };
          grip.addEventListener('pointermove',move);
          grip.addEventListener('pointerup',up);
          grip.addEventListener('pointercancel',up);
        });
      }
      el.classList.toggle('big',this.expanded===v.key);
      el.style.width=`${w}px`;
      /* Text only, never markup: a name is whatever its owner typed. */
      const who=el.querySelector('.who'),tags=el.querySelector('.tags'),tag=this.tags(v.screen?null:v.ship);
      if(who.textContent!==v.label)who.textContent=v.label;
      if(tags.textContent!==tag)tags.textContent=tag;
      const video=el.querySelector('video');video.muted=true; // Audio belongs to the SFU's volume-controlled elements.
      const face=el.querySelector('.face'),initials=el.querySelector('.initials');
      if(v.stream){
        if(video.srcObject!==v.stream){video.srcObject=v.stream;video.play().catch(()=>{});}
        video.hidden=false;face.hidden=true;initials.hidden=true;el.classList.remove('faced');
      } else {
        /* Camera off: their picture where the camera would be. */
        if(video.srcObject){video.pause();video.srcObject=null;}
        video.hidden=true;el.classList.add('faced');
        const url=avatarUrl(v.ship);
        if(url){ if(face.getAttribute('src')!==url)face.setAttribute('src',url); face.hidden=false; initials.hidden=true; }
        else {
          face.hidden=true;initials.hidden=false;
          const mark=(displayName(v.ship)||v.ship||'?').replace(/^~/,'').slice(0,2).toUpperCase();
          if(initials.textContent!==mark)initials.textContent=mark;
        }
      }
      const at=mediaCount+i;
      if(this.strip.children[at]!==el)this.strip.insertBefore(el,this.strip.children[at]??null);
    }
  }

  paint() {
    this.paintStrip();
    const room = rooms.here;
    const huddle = currentHuddle();
    /* In the commons there is no room, but there may be a huddle -- people
     * standing close enough to hear each other. Show that instead. */

    const r = room === COMMONS ? { name: 'Nearby' } : roomById(room);
    const host = room === COMMONS ? huddle?.host ?? null : hostOf(room);
    const people = room === COMMONS ? (huddle?.members ?? []) : occupantsOf(room);
    /* "connected" alone only meant we reached the call server; say so when
     * nobody else is in the call with us. A call that has not connected says
     * WHO it is waiting on rather than repeating "requesting". */
    const waitingOn = { 'waiting-ship': 'Waiting on your ship…', 'waiting-host': "Host isn't answering",
      transitioning: 'Switching call…' };
    /* Being muted by an admin is the first thing about a call you need to
     * know, so it takes the status line rather than hiding in a tooltip. */
    const status = rooms.mutedByAdmin ? 'Muted by an admin' : rooms.bootedByAdmin ? 'Removed from this call'
      : rooms.error ?? (rooms.callHealth?.failed ? unreachable(rooms.callHealth.missing, rooms.callHealth.reach) :
      rooms.mediaError ? mediaFailed(rooms.mediaError.kind) :
      room!==COMMONS && rooms.picker ? 'Choose which one…' :
      room!==COMMONS && rooms.waiting ? 'Connecting…' : room===COMMONS && !huddle ? 'No nearby call' :
      rooms.voice === 'connected' && !rooms.others ? 'Waiting for others' :
      /* Waiting on a host whose ship we cannot reach says so, rather than
       * "switching" for ever. See lib/reachability. */
      rooms.voice !== 'connected' && rooms.host && hostReach() === 'one-way' ? `${displayName(rooms.host)} can't hear your ship` :
      rooms.voice !== 'connected' && rooms.host && hostReach() === 'unreachable' ? `Can't reach ${displayName(rooms.host)}'s ship` :
      waitingOn[rooms.stage] ?? rooms.voice);

    const signature=JSON.stringify([room,host,people.map(s=>[s,displayName(s),roleFor(s),mutedShip(s)]),status,rooms.micTrouble,rooms.voice,
      rooms.micOn,rooms.camOn,rooms.screenOn,this.settingsOpen,canModerate(),mayRecord(),rooms.recording?.by??null]);
    if(signature===this.signature)return;
    this.signature=signature;
    this.root.innerHTML = `
      <div class="rail">
        <div class="rail-head">${esc(r?.name ?? 'Room')}
          <span class="dim ${status === 'connected' ? '' : 'warn'}">${esc(status)}</span>
        </div>
        ${rooms.micTrouble ? `<div class="mic-trouble" role="alert"><span>${esc(MIC_TROUBLE[rooms.micTrouble] ?? MIC_TROUBLE.silent)}</span><button class="mic-retry">Try again</button></div>` : ''}
        <div class="rail-btns">
          ${rooms.voice==='blocked'||rooms.callHealth?.failed||['quota','rate-limited','participant-limit','service-unavailable'].includes(rooms.error)?'<button class="retry-call">Retry call</button>':''}
          ${mediaButton('mic','Microphone',rooms.micOn)}
          ${mediaButton('cam','Camera',rooms.camOn)}
          ${canShareScreen() ? mediaButton('scr','Screen sharing',rooms.screenOn) : ''}
          <button class="set${this.settingsOpen ? ' on' : ''}">&#9881;</button>
        </div>
        <div class="rail-btns mod-btns">
          ${canModerate() ? '<button class="admin-call">ADMIN</button>' : ''}
          ${mayRecord() || rooms.recording?.by === our ? `<button class="rec-call${rooms.recording ? ' on' : ''}">REC</button>` : ''}
        </div>
      </div>`;
    /* Re-attached, because the markup above replaced everything else. */
    this.root.appendChild(this.settings);
    const q = (c) => this.root.querySelector(c);
    if(q('.retry-call'))q('.retry-call').onclick=()=>retryCall();
    if(q('.mic-retry'))q('.mic-retry').onclick=()=>{void retryMic();};
    q('.mic').onclick = () => toggleMic().catch((e) => console.error('mic', e));
    q('.cam').onclick = () => toggleCam().catch((e) => console.error('cam', e));
    if (q('.scr')) q('.scr').onclick = () => toggleScreen().catch((e) => console.error('share', e));
    q('.set').onclick = () => this.toggleSettings();
    /* ADMIN and REC sit with the other call controls, but their PANELS are
     * built once and live outside this markup -- the rail replaces all of it
     * several times a second. The panels listen for these. */
    const open=(which)=>window.dispatchEvent(new CustomEvent('glurff-call-panel',{detail:which}));
    if(q('.admin-call'))q('.admin-call').onclick=()=>open('admin');
    if(q('.rec-call'))q('.rec-call').onclick=()=>open('rec');
  }

  toggleSettings() {
    this.settingsOpen = !this.settingsOpen;
    this.settings.hidden = !this.settingsOpen;
    if (this.settingsOpen) { refreshDevices(); this.paintSettings(); }
    this.paint();
  }

  paintSettings() {
    const row = (kind, label, list) => {
      const cur = chosenDevice(kind);
      /* An empty value is "whatever the system picks", which is also what a
       * saved id falls back to once that device is unplugged. */
      const opts = [`<option value=""${cur ? '' : ' selected'}>System default</option>`]
        .concat(list.map((d) =>
          `<option value="${d.id}"${d.id === cur ? ' selected' : ''}>${esc(d.label)}</option>`));
      return `<label class="dev"><span class="dim">${label}</span>
                <select data-kind="${kind}">${opts.join('')}</select></label>`;
    };
    /* Names are blank until a capture has been permitted once -- the browser
     * withholds them, so say so instead of showing a list of "Microphone 2". */
    const unnamed = [...devices.mic, ...devices.cam].some((d) => !d.label || /^(Microphone|Camera) \d+$/.test(d.label));
    this.settings.innerHTML =
      `<label class="noise-option"><input type="checkbox" class="noise" ${noiseReduction()?'checked':''}> Reduce background noise</label>` +
      row('mic', 'Microphone', devices.mic) +
      row('cam', 'Camera', devices.cam) +
      (canPickOutput() ? row('out', 'Speaker', devices.out) : '') +
      (unnamed ? '<div class="dim note">Device names appear once you have allowed the mic or camera once.</div>' : '') +
      '<div class="diag"><button class="copy-diag" title="Copy what Glurff recorded about connections and calls, to send to whoever is fixing a problem">Copy diagnostics</button> <span class="dim diag-status" role="status"></span></div>';
    this.settings.querySelector('.copy-diag').onclick=async()=>{
      const ok=await copyDiagnostics();
      const s=this.settings.querySelector('.diag-status');if(s)s.textContent=ok?'copied':'could not copy';
    };
    this.settings.querySelector('.noise').onchange=e=>{setNoiseReduction(e.target.checked);reopenCapture('mic').catch(e=>console.error('noise switch',e));};
    this.settings.querySelectorAll('select').forEach((sel) => {
      sel.onchange = () => {
        const kind = sel.dataset.kind;
        chooseDevice(kind, sel.value);
        /* Apply immediately to whatever is already live, rather than at the
         * next call -- a picker that only takes effect later reads as broken. */
        if (kind === 'out') outputChanged();
        else reopenCapture(kind).catch((e) => console.error('device switch', e));
      };
    });
  }
}


/* Phones cannot share their screen from a browser: no button that cannot work. */
const canShareScreen = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;
const smallScreen = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px), (max-height: 500px)').matches;

/* Somebody we can see in the call's room, who repair could not bring into it. */
/* Status text is PLAIN text: the one place it becomes HTML escapes it. */
const unreachable = (missing = [], reach = {}) => missing.length === 1
  ? (reach[missing[0]] === 'one-way' ? `${displayName(missing[0])} can't hear your ship`
    : `Can't reach ${displayName(missing[0])} in this call`)
  : `Can't reach ${missing.length} people in this call`;
/* One publication given up on; the call itself is fine. */
/* What to tell somebody whose microphone is on but sending nothing. */
const MIC_TROUBLE = {
  ended: "Your microphone stopped. Check it's plugged in, or choose another in settings.",
  muted: 'Your microphone is muted by your system or its mute switch.',
  paused: "Your microphone's sound stopped. Try again, or turn it off and on.",
  silent: "Your microphone isn't sending any sound. Check it's plugged in, not muted, and allowed for this site.",
};
const mediaFailed = (kind) => `${{ mic: 'Microphone', cam: 'Camera', screen: 'Screen share' }[kind] ?? 'Media'} couldn't be sent`;

function mediaButton(kind,label,on) {
 const paths={mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',cam:'<rect x="2" y="5" width="13" height="14" rx="2"/><path d="m15 10 7-4v12l-7-4z"/>',scr:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 22h8M12 17v5M12 13V6m-4 4 4-4 4 4"/>'};
 return `<button class="${kind} media-icon ${on?'on':'off'}" aria-label="${label}: ${on?'on':'off'}" aria-pressed="${on}" title="${label}: ${on?'on':'off'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${paths[kind]}${on?'':'<path d="M2 2 22 22"/>'}</svg></button>`;
}

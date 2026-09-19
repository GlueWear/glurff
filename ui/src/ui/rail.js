/* The call rail, and the video strip.
 *
 * Walking into a room joins its call, so there is no join button -- this is a
 * readout of who can hear you and what you are sending. Video sits along the
 * top: double-click a tile to expand it, drag its corner to size it.
 */
import { rooms, onRooms, toggleMic, toggleCam, toggleScreen, occupantsOf, hostOf, currentHuddle, retryCall, reopenCapture, outputChanged,
         canModerate, mayRecord, mutedShip, roleFor } from 'lib/rooms';
import { devices, onDevices, refreshDevices, chosenDevice, chooseDevice, canPickOutput, noiseReduction, setNoiseReduction } from 'lib/devices';
import { displayName } from 'lib/noltbook';
import { copyDiagnostics } from 'lib/diagnostics';
import { roomById, COMMONS } from 'world/places';
import { our } from 'lib/api';

export class Rail {
  constructor(root, strip) {
    this.root = root;
    this.strip = strip;
    this.expanded = null;
    /* EACH FEED HAS ITS OWN SIZE. One shared width meant dragging a corner
     * resized every screen in the strip rather than the one under the hand. */
    this.sizes = new Map();
    this.size = 132;             //  what a feed starts at
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

  videos() {
    /* Our own camera and screen first, muted -- playing your own microphone
     * back at you is an echo, not a feature. */
    const mine = [...rooms.localStreams.entries()]
      .map(([kind, s]) => ({ key: kind, label: kind === 'screen' ? 'Your screen' : 'You', stream: s, mine: true }));
    /* Somebody an admin has muted is not shown, by anybody. */
    const muted = new Set(rooms.blocked ?? []);
    const theirs = [...rooms.remoteStreams.entries()]
      .filter(([, r]) => !muted.has(r.ship) && r.stream.getVideoTracks().some(t=>t.readyState!=='ended'))
      .map(([id, r]) => ({ key: 'remote:'+id, label: displayName(r.ship)+(r.label==='screen'?' · Screen':''), stream: r.stream, mine: false }));
    return [...mine, ...theirs];
  }

  paintStrip() {
    const vids = this.videos();
    this.tiles ??= new Map();
    const wanted = new Set(vids.map(v=>v.key));
    for (const [key,el] of this.tiles) if(!wanted.has(key)) {
      const video=el.querySelector('video');video.pause();video.srcObject=null;el.remove();this.tiles.delete(key);
      this.sizes.delete(key);
      if(this.expanded===key)this.expanded=null;
    }
    for (const [i,v] of vids.entries()) {
      /* The one you have opened up gets a floor of 320 and twice the width;
       * everything else keeps whatever it was last dragged to. */
      const own = this.sizes.get(v.key) ?? this.size;
      const w = this.expanded === v.key ? Math.max(own, 320) * 2 : own;
      let el=this.tiles.get(v.key);
      if(!el) {
        el=document.createElement('div');el.className='tile';
        el.innerHTML='<video autoplay playsinline muted></video><span></span><i class="grip"></i>';
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
      el.querySelector('span').textContent=v.label;
      const video=el.querySelector('video');video.muted=true; // Audio belongs to the SFU's volume-controlled elements.
      if(video.srcObject!==v.stream){video.srcObject=v.stream;video.play().catch(()=>{});}
      if(this.strip.children[i]!==el)this.strip.insertBefore(el,this.strip.children[i]??null);
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
    const waitingOn = { 'waiting-ship': 'Waiting on your ship…', 'waiting-host': "Host isn't answering" };
    /* Being muted by an admin is the first thing about a call you need to
     * know, so it takes the status line rather than hiding in a tooltip. */
    const status = rooms.mutedByAdmin ? 'Muted by an admin' : rooms.bootedByAdmin ? 'Removed from this call'
      : rooms.error ?? (room!==COMMONS && rooms.picker ? 'Choose which one…' :
      room!==COMMONS && rooms.waiting ? 'Connecting…' : room===COMMONS && !huddle ? 'No nearby call' :
      rooms.voice === 'connected' && !rooms.others ? 'Waiting for others' :
      waitingOn[rooms.stage] ?? rooms.voice);

    const signature=JSON.stringify([room,host,people.map(s=>[s,displayName(s),roleFor(s),mutedShip(s)]),status,rooms.voice,
      rooms.micOn,rooms.camOn,rooms.screenOn,this.settingsOpen,canModerate(),mayRecord(),rooms.recording?.by??null]);
    if(signature===this.signature)return;
    this.signature=signature;
    this.root.innerHTML = `
      <div class="rail">
        <div class="rail-head">${r?.name ?? 'Room'}
          <span class="dim ${status === 'connected' ? '' : 'warn'}">${status}</span>
        </div>
        <div class="rail-people">
          ${people.length
            ? people.map((s) => `<div class="p">${displayName(s)}${s === our ? ' <span class="dim">(you)</span>' : ''}${s === host ? ' <span class="dim">host</span>' : ''}${roleFor(s) === 'admin' ? ' <span class="dim">admin</span>' : ''}${mutedShip(s) ? ' <span class="muted-tag">muted</span>' : ''}</div>`).join('')
            : '<div class="dim">nobody else here</div>'}
        </div>
        <div class="rail-btns">
          ${rooms.voice==='blocked'||['quota','rate-limited','participant-limit','service-unavailable'].includes(rooms.error)?'<button class="retry-call">Retry call</button>':''}
          ${mediaButton('mic','Microphone',rooms.micOn)}
          ${mediaButton('cam','Camera',rooms.camOn)}
          ${mediaButton('scr','Screen sharing',rooms.screenOn)}
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
    q('.mic').onclick = () => toggleMic().catch((e) => console.error('mic', e));
    q('.cam').onclick = () => toggleCam().catch((e) => console.error('cam', e));
    q('.scr').onclick = () => toggleScreen().catch((e) => console.error('share', e));
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

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mediaButton(kind,label,on) {
 const paths={mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',cam:'<rect x="2" y="5" width="13" height="14" rx="2"/><path d="m15 10 7-4v12l-7-4z"/>',scr:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 22h8M12 17v5M12 13V6m-4 4 4-4 4 4"/>'};
 return `<button class="${kind} media-icon ${on?'on':'off'}" aria-label="${label}: ${on?'on':'off'}" aria-pressed="${on}" title="${label}: ${on?'on':'off'}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">${paths[kind]}${on?'':'<path d="M2 2 22 22"/>'}</svg></button>`;
}

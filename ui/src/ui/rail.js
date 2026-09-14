/* The call rail, and the video strip.
 *
 * Walking into a room joins its call, so there is no join button -- this is a
 * readout of who can hear you and what you are sending. Video sits along the
 * top: double-click a tile to expand it, drag its corner to size it.
 */
import { rooms, onRooms, toggleMic, toggleCam, toggleScreen, occupantsOf, hostOf, currentHuddle, retryCall, reopenCapture, outputChanged } from 'lib/rooms';
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
    this.size = 132;
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

  videos() {
    /* Our own camera and screen first, muted -- playing your own microphone
     * back at you is an echo, not a feature. */
    const mine = [...rooms.localStreams.entries()]
      .map(([kind, s]) => ({ key: kind, label: kind === 'screen' ? 'Your screen' : 'You', stream: s, mine: true }));
    const theirs = [...rooms.remoteStreams.entries()]
      .filter(([, r]) => r.stream.getVideoTracks().some(t=>t.readyState!=='ended'))
      .map(([id, r]) => ({ key: 'remote:'+id, label: displayName(r.ship)+(r.label==='screen'?' · Screen':''), stream: r.stream, mine: false }));
    return [...mine, ...theirs];
  }

  paintStrip() {
    const vids = this.videos();
    this.tiles ??= new Map();
    const wanted = new Set(vids.map(v=>v.key));
    for (const [key,el] of this.tiles) if(!wanted.has(key)) {
      const video=el.querySelector('video');video.pause();video.srcObject=null;el.remove();this.tiles.delete(key);
    }
    const w = this.expanded ? Math.max(this.size,320) : this.size;
    for (const [i,v] of vids.entries()) {
      let el=this.tiles.get(v.key);
      if(!el) {
        el=document.createElement('div');el.className='tile';
        el.innerHTML='<video autoplay playsinline muted></video><span></span><i class="grip"></i>';
        this.tiles.set(v.key,el);
        el.ondblclick=()=>{this.expanded=this.expanded===v.key?null:v.key;this.paintStrip();};
        el.querySelector('.grip').onmousedown=e=>{
          e.preventDefault();const startX=e.clientX,startW=el.offsetWidth;
          const move=ev=>{this.size=Math.max(96,Math.min(720,startW+ev.clientX-startX));this.paintStrip();};
          const up=()=>{window.removeEventListener('mousemove',move);window.removeEventListener('mouseup',up);};
          window.addEventListener('mousemove',move);window.addEventListener('mouseup',up);
        };
      }
      el.classList.toggle('big',this.expanded===v.key);
      el.style.width=`${this.expanded===v.key?w*2:w}px`;
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
     * nobody else is in the call with us. */
    const status = rooms.error ?? (room!==COMMONS && rooms.waiting ? 'Connecting…' : room===COMMONS && !huddle ? 'No nearby call' :
      rooms.voice === 'connected' && !rooms.others ? 'Waiting for others' : rooms.voice);

    const signature=JSON.stringify([room,host,people.map(s=>[s,displayName(s)]),status,rooms.voice,rooms.micOn,rooms.camOn,rooms.screenOn,this.settingsOpen]);
    if(signature===this.signature)return;
    this.signature=signature;
    this.root.innerHTML = `
      <div class="rail">
        <div class="rail-head">${r?.name ?? 'Room'}
          <span class="dim ${status === 'connected' ? '' : 'warn'}">${status}</span>
        </div>
        <div class="rail-people">
          ${people.length
            ? people.map((s) => `<div class="p">${displayName(s)}${s === our ? ' <span class="dim">(you)</span>' : ''}${s === host ? ' <span class="dim">host</span>' : ''}</div>`).join('')
            : '<div class="dim">nobody else here</div>'}
        </div>
        <div class="rail-btns">
          ${rooms.voice==='blocked'||['quota','rate-limited','participant-limit','service-unavailable'].includes(rooms.error)?'<button class="retry-call">Retry call</button>':''}
          ${mediaButton('mic','Microphone',rooms.micOn)}
          ${mediaButton('cam','Camera',rooms.camOn)}
          ${mediaButton('scr','Screen sharing',rooms.screenOn)}
          <button class="set${this.settingsOpen ? ' on' : ''}">&#9881;</button>
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

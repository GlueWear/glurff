/* Galene SFU transport for square huddles.
 *
 * ATTRIBUTION. No Galene code is copied here. This adapter was written against
 * the published Galene signalling protocol (galene-protocol.md, Juliusz
 * Chroboczek, MIT licence) and talks to an unmodified Galene server. The
 * credentials it uses are minted per participant by the Noltbook warden and
 * arrive through %glurff; nothing here ever asks the gateway directly.
 *
 * The join token travels INSIDE the protocol, in the join message. It is never
 * appended to the websocket URL, never put in a query string, never rendered
 * and never logged.
 *
 * What makes this the square's transport rather than a plain call: every remote
 * stream is routed through its own gain node, and the gain is a function of how
 * far away that person is standing. Walking away from someone makes them
 * quieter; it does not disconnect them.
 */

import { applyOutput } from 'lib/devices';

const PROTOCOL_VERSION = '2';
const LABEL_CAMERA = 'camera';

/* Audio falls off between these radii, in tiles. Inside FULL you hear someone
 * at full volume; past SILENT they are muted but still connected, so walking
 * back into range is instant rather than a reconnection. */
export const AUDIBLE_FULL = 2;      //  the huddle join radius
export const AUDIBLE_SILENT = 3;    //  the huddle leave radius

export function gainForDistance(d) {
  if (!isFinite(d)) return 0;
  if (d <= AUDIBLE_FULL) return 1;
  if (d >= AUDIBLE_SILENT) return 0;
  /* Linear in the log domain reads more natural than linear in amplitude. */
  const t = (d - AUDIBLE_FULL) / (AUDIBLE_SILENT - AUDIBLE_FULL);
  return Math.pow(1 - t, 1.8);
}

export class SfuSession {
  constructor({ our, onStream, onStreamRemoved, onPeerLeft, onStatus, onUsers, onPermissions } = {}) {
    this.our = our;
    this.onUsers = onUsers ?? (() => {});
    this.onStream = onStream ?? (() => {});
    this.onStreamRemoved = onStreamRemoved ?? (() => {});
    this.onPeerLeft = onPeerLeft ?? (() => {});
    this.onStatus = onStatus ?? (() => {});
    this.onPermissions = onPermissions ?? (() => {});
    /* What the SERVER says we may do. `present` is the right to publish, and a
     * mute takes it away: the credentials are reissued and a `change` arrives
     * saying so. Until we are told otherwise, assume we may. */
    this.mayPresent = true;

    this.ws = null;
    this.grant = null;
    this.clientId = null;
    this.username = null;
    this.joined = false;

    this.silenced = new Set(); //  ships an admin has muted: never played, never shown
    this.users = new Map(); //  galene client id -> username (a ship)
    this.down = new Map(); //  stream id -> {pc, ship, gain, el}
    this.up = new Map(); //  stream id -> {pc, stream, sent}
    /* Media asked for before we joined. Publishing needs a joined session, so
     * a mic switched on while the room is still being granted would otherwise
     * be silently dropped -- the button reads "on" and nothing is sent. */
    this.publications = new Map();
  }

  /* -------------------------------------------------------- connection */

  connect(grant) {
    /* Quietly: there is usually nothing to supersede, and reporting it leaves
     * a stale 'superseded' sitting in the UI next to a healthy connection. */
    this.close(null);
    this.grant = grant;
    this.clientId = cryptoId();
    this.onStatus('connecting');

    let ws;
    try {
      ws = new WebSocket(grant.sfu);
    } catch (e) {
      this.onStatus('failed', 'connect');
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      /* Pipelining is permitted: handshake then join without waiting. */
      this.send({ type: 'handshake', version: [PROTOCOL_VERSION], id: this.clientId });
      this.send({ type: 'join', kind: 'join', group: grant.group, token: grant.token });
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      let m = null;
      try {
        m = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; //  superseded by a newer session
      const wasJoined = this.joined;
      this.ws = null;
      this.joined = false;
      this.onStatus('failed', wasJoined ? 'disconnected' : 'connect');
    };
    ws.onerror = () => { if (this.ws === ws) this.onStatus('failed', 'connect'); };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    switch (m.type) {
      case 'handshake':
        return;
      case 'ping':
        return this.send({ type: 'pong' });
      case 'pong':
        return;
      case 'joined':
        return this.onJoined(m);
      case 'user':
        return this.onUser(m);
      case 'offer':
        return void this.onOffer(m);
      case 'answer':
        return void this.onAnswer(m);
      case 'ice':
        return void this.onIce(m);
      case 'close':
        return this.onRemoteClose(m);
      case 'abort':
        return this.close('aborted');
      case 'renegotiate':
        return void this.renegotiate(m);
      case 'usermessage':
        if (m.kind === 'error') console.error('[sfu] server error');
        return;
      default:
        return; //  chat and friends: not ours
    }
  }

  onJoined(m) {
    if (m.kind === 'fail') {
      this.onStatus('failed', 'join-refused');
      return;
    }
    if (m.kind === 'leave') {
      this.close('removed');
      return;
    }
    if (m.kind !== 'join' && m.kind !== 'change') return;

    /* The SERVER assigns the username from the minted token, and every stream
     * we publish is attributed to it. If it is not our ship, the token was
     * mis-minted or crossed, and publishing under someone else's name is worse
     * than not joining -- so fail closed.
     *
     * A `change` may carry only what changed: an absent username there means
     * unchanged, not anonymous, and must not tear down a live call. */
    const stated = typeof m.username === 'string' && m.username.length > 0;
    if (m.kind === 'join' && !stated) {
      this.close(null);
      this.onStatus('failed', 'identity-mismatch');
      return;
    }
    if (stated && (m.username !== this.our || this.grant.participant !== m.username)) {
      this.close(null);
      this.onStatus('failed', 'identity-mismatch');
      return;
    }
    if (stated) this.username = m.username;

    /* PERMISSIONS. Galene has sent them as a list and as an object across
     * versions; a message that carries neither says nothing about them and
     * must not be read as a refusal. */
    const said = readPermissions(m.permissions);
    if (said !== null) {
      const was = this.mayPresent;
      this.mayPresent = said;
      if (was && !said) {
        /* We may no longer publish. Close what is going out -- the server has
         * already stopped accepting it -- but leave the capture and the user's
         * intent alone: this is a mute, not a decision to give up the camera.
         * Media intent is restored if and when `present` comes back. */
        for (const [id, u] of this.up) {
          this.send({ type: 'close', id });
          try { u.pc.close(); } catch {}
          this.up.delete(id);
        }
      } else if (!was && said && this.joined) {
        for (const [id, q] of this.publications) void this.startPublication(id, q);
      }
      this.onPermissions(said);
    }

    if (m.kind === 'join') {
      this.joined = true;
      this.onStatus('connected');
      /* The empty key is the default that matches any label the server offers. */
      this.send({ type: 'request', request: { '': ['audio', 'video'] } });
      /* Anything switched on while we were still connecting goes out now. */
      for (const [id, q] of this.publications) this.startPublication(id, q);
    }
  }

  /* Capture belongs to the user's media toggles. Connections may change as
   * huddles split; preserve enabled tracks and their IDs across that change. */
  refreshGrant(grant) {
    if(!this.grant || grant.participant!==this.our || grant.group!==this.grant.group || grant.sfu!==this.grant.sfu)return false;
    // Extending a lease increments gen without replacing the Galene group.
    // A delayed credential must not roll the current lease back.
    if((grant.gen??0)<(this.grant.gen??0) || grant.expires<this.grant.expires)return true;
    this.grant=grant;
    for(const p of [...this.up.values(),...this.down.values()]) {
      try {p.pc.setConfiguration({...p.pc.getConfiguration(),iceServers:iceFrom(grant)});}catch{}
    }
    return true;
  }

  async publish(stream, label = LABEL_CAMERA) {
    const id = cryptoId();
    const q = { stream, label };
    this.publications.set(id, q);
    if (this.joined) await this.startPublication(id, q);
    return id;
  }

  async startPublication(id, q) {
    if (!this.joined || this.up.has(id)) return;
    /* The server is not accepting our media; queue it rather than offering
     * into a refusal. It goes out when `present` comes back. */
    if (!this.mayPresent) return;
    const pc = new RTCPeerConnection({ iceServers: iceFrom(this.grant) });
    const u = { pc, ...q, localIce: [], remoteIce: [], sent: false };
    this.up.set(id, u);
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.up.get(id) !== u) return;
      if (u.sent) this.send({ type: 'ice', id, candidate });
      else u.localIce.push(candidate);
    };
    try {
      for (const track of q.stream.getTracks()) {
        if (track.readyState === 'live') pc.addTrack(track, q.stream);
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.up.get(id) !== u) return;
      this.send({ type: 'offer', id, source: this.clientId,
        username: this.username, kind: '', label: q.label,
        sdp: pc.localDescription.sdp });
      u.sent = true;
      for (const candidate of u.localIce) this.send({ type: 'ice', id, candidate });
      u.localIce = [];
    } catch {
      if (this.up.get(id) !== u) return;
      pc.close();
      this.up.delete(id);
      this.onStatus('failed', 'publish-failed');
    }
  }

  /* Does the session still hold this publication? A reconnect clears them all,
   * so what the media layer thinks it published can outlive what is actually
   * being sent. */
  hasPublication(id) { return this.publications.has(id); }

  unpublish(id) {
    const q = this.publications.get(id);
    for (const track of q?.stream.getTracks() ?? []) track.stop();
    this.publications.delete(id);
    const u = this.up.get(id);
    if (u) {
      this.send({ type: 'close', id });
      u.pc.close();
      this.up.delete(id);
    }
  }

  resume() {
    for (const d of this.down.values()) d.audioEl?.play().catch(() => {});
  }

  async flushRemoteIce(rec) {
    for (const candidate of rec.remoteIce.splice(0)) {
      try { await rec.pc.addIceCandidate(candidate); } catch {}
    }
  }

  onUser(m) {
    if (typeof m.id !== 'string') return;
    if (m.kind === 'delete') {
      const name = this.users.get(m.id);
      this.users.delete(m.id);
      for (const [id,d] of this.down) if(d.source===m.id)this.dropDown(id);
      if (name && ![...this.users.values()].includes(name) && ![...this.down.values()].some(d=>d.ship===name)) this.onPeerLeft(name);
      this.onUsers();
      return;
    }
    if (typeof m.username === 'string') { this.users.set(m.id, m.username); this.onUsers(); }
  }

  /* Other ships in this call right now, as the server reports them. Joining the
   * server is not the same as being in a call with somebody. */
  others() {
    const out = new Set();
    for (const name of this.users.values()) { const s = shipOf(name); if (s && s !== this.our) out.add(s); }
    return out;
  }

  /* ---------------------------------------------------------- downstream */

  async onOffer(m) {
    let d = this.down.get(m.id);
    if (!d) {
      const pc = new RTCPeerConnection({ iceServers: iceFrom(this.grant) });
      d = { id:m.id, source:m.source, label:m.label??LABEL_CAMERA, pc, ship: shipOf(m.username ?? this.users.get(m.source)), audioEl: null, stream: null, remoteIce: [], localIce: [], sent: false };
      this.down.set(m.id, d);

      pc.onicecandidate = (e) => {
        if (!e.candidate || this.down.get(m.id) !== d) return;
        if (d.sent) this.send({ type: 'ice', id: m.id, candidate: e.candidate });
        else d.localIce.push(e.candidate);
      };
      pc.ontrack = (e) => {
        if (this.down.get(m.id) !== d) return;
        d.stream = e.streams[0] ?? d.stream ?? new MediaStream();
        if (!d.stream.getTracks().includes(e.track)) d.stream.addTrack(e.track);
        e.track.addEventListener?.('ended',()=>{if(this.down.get(m.id)===d)this.attach(d);},{once:true});
        this.attach(d);
      };
    }
    /* A later offer for a live stream is a renegotiation, not a new peer. */
    try {
      await d.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      await this.flushRemoteIce(d);
      const ans = await d.pc.createAnswer();
      await d.pc.setLocalDescription(ans);
      if (this.down.get(m.id) !== d) return;
      this.send({ type: 'answer', id: m.id, sdp: (d.pc.localDescription || ans).sdp });
      d.sent = true;
      for (const candidate of d.localIce) this.send({ type: 'ice', id: m.id, candidate });
      d.localIce = [];
    } catch (e) {
      console.error('[sfu] answering failed');
      this.dropDown(m.id);
    }
  }

  async onAnswer(m) {
    const u = this.up.get(m.id);
    if (!u) return;
    try {
      await u.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      await this.flushRemoteIce(u);
    } catch (e) {
      console.error('[sfu] remote answer rejected');
    }
  }

  async onIce(m) {
    const rec = this.down.get(m.id) || this.up.get(m.id);
    if (!rec || !m.candidate) return;
    if (!rec.pc.remoteDescription) { rec.remoteIce.push(m.candidate); return; }
    try {
      await rec.pc.addIceCandidate(m.candidate);
    } catch (e) {
      /* A candidate that arrives before the description is ordinary. */
    }
  }

  onRemoteClose(m) {
    this.dropDown(m.id);
    const u = this.up.get(m.id);
    if (u) {
      try {
        u.pc.close();
      } catch (e) {}
      this.up.delete(m.id);
    }
  }

  dropDown(id) {
    const d = this.down.get(id);
    if (!d) return;
    this.detach(d);
    try {
      d.pc.close();
    } catch (e) {}
    this.down.delete(id);
    this.onStreamRemoved(id, d.ship);
    if (d.ship && ![...this.down.values()].some(other => other.ship === d.ship)) this.onPeerLeft(d.ship);
  }

  /* ------------------------------------------------------ positional audio */

  /* Each remote stream gets its own gain node. Distance sets the gain; nothing
   * about proximity ever touches the connection itself, so walking in and out
   * of earshot is instant and free. */
  /* Remote audio plays through a real <audio> element, not WebAudio.
   *
   * A MediaStream that came from a peer connection is silent in Chrome if it
   * is only wired into an AudioContext -- the pipeline never starts unless the
   * stream is also attached to a media element. That is why video worked and
   * audio did not: video had an element, audio did not. Proximity is applied
   * with element.volume, which needs no AudioContext and no user gesture. */
  attach(d) {
    if (!d.stream) return;

    /* Galene sends our own published stream back down. Playing it is echo, not
     * presence -- take the video for self-preview, route none of the audio. */
    if (d.ship === this.our) {
      this.onStream(d.ship, d.stream, {id:d.id,label:d.label});
      return;
    }

    if (d.stream.getAudioTracks().length && !d.audioEl) {
      const el = document.createElement('audio');
      el.autoplay = true;
      el.hidden = true;
      document.body.appendChild(el);
      el.srcObject = d.stream;
      /* IN A ROOM, START AT THE ROOM'S LEVEL. Starting silent and waiting for
       * the next position update meant a stream that arrived while nobody was
       * walking stayed at zero: setPositions only runs on movement and on a
       * presence reconcile, so standing still could mute a newcomer
       * indefinitely. Proximity still overrides this on the next update. */
      el.volume = this.silent(d.ship) ? 0 : (this.flat ?? 0);
      applyOutput(el);
      /* Whether playback was actually allowed to start is worth knowing: a
       * blocked autoplay is silent in exactly the way a muted peer is. */
      d.played = null;
      Promise.resolve(el.play?.()).then(() => { d.played = true; }, () => { d.played = false; });
      d.audioEl = el;
    }
    this.onStream(d.ship, d.stream, {id:d.id,label:d.label});
  }

  detach(d) {
    if (!d.audioEl) return;
    try {
      d.audioEl.pause();
      d.audioEl.srcObject = null;
      d.audioEl.remove();
    } catch (e) {}
    d.audioEl = null;
  }

  /* ------------------------------------------------------ positional audio */

  /* Feed this the square's positions each time they change. Distance sets the
   * volume; nothing about proximity ever touches the connection, so walking in
   * and out of earshot is instant and free. */
  setPositions(us, peers) {
    for (const d of this.down.values()) {
      if (!d.audioEl || !d.ship) continue;
      const p = peers[d.ship];
      this.flat = null;
      const g = this.silent(d.ship) ? 0 : (p && us ? gainForDistance(Math.hypot(p.x - us.x, p.y - us.y)) : 0);
      if (Math.abs(d.audioEl.volume - g) > 0.01) d.audioEl.volume = g;
    }
  }

  /* Send everything already playing to a newly chosen speaker. Elements
   * created later pick it up on their own. */
  refreshOutput() {
    for (const d of this.down.values()) if (d.audioEl) applyOutput(d.audioEl);
  }

  /* Participants an admin has muted. Their audio is not played and their
   * video is not shown -- by everybody, not only by them, which is what makes
   * a mute a mute rather than a request they could ignore. */
  setSilenced(ships) {
    this.silenced = new Set(ships ?? []);
    for (const d of this.down.values()) {
      if (!d.audioEl || !d.ship) continue;
      if (this.silenced.has(d.ship)) d.audioEl.volume = 0;
    }
  }
  silent(ship) { return !!this.silenced?.has(ship); }

  /* Live audio tracks per ship, for a recorder to mix. Never the elements
   * themselves: nothing outside here reattaches a remote stream. */
  audioTracks() {
    const out = [];
    for (const d of this.down.values()) {
      if (!d.ship || d.ship === this.our || !d.stream) continue;
      for (const t of d.stream.getAudioTracks()) if (t.readyState === 'live') out.push({ ship: d.ship, track: t });
    }
    return out;
  }

  /* Every stream at full volume. Rooms use this: inside one, distance is not
   * what decides who you are talking to. */
  setFlatGain(g = 1, allowed = null) {
    this.flat = g;
    for (const d of this.down.values()) {
      if (!d.audioEl) continue;
      const gain = (allowed && !allowed.has(d.ship)) || this.silent(d.ship) ? 0 : g;
      if (Math.abs(d.audioEl.volume - gain) > 0.01) d.audioEl.volume = gain;
    }
  }

  /* Per-ship audio state: whether we are receiving any audio from them at all,
   * and how loud proximity is currently making it. Distance muting and "no
   * audio arriving" look identical from the outside, so the rail shows this. */
  /* WHY A PEER IS OR IS NOT AUDIBLE, per ship. Distance muting, a peer sending
   * no audio at all, a silenced peer and a browser that refused to start
   * playback are four different faults that look identical from the outside.
   * Ship names and booleans only -- never a token, never SDP. Bounded: one
   * row per received stream, and there cannot be more of those than there are
   * people in the call. */
  audioState() {
    const out = {};
    for (const d of this.down.values()) {
      if (!d.ship || d.ship === this.our) continue;
      const tracks = d.stream?.getAudioTracks?.() ?? [];
      const live = tracks.filter((t) => t.readyState === 'live');
      out[d.ship] = {
        track: tracks.length > 0,
        live: live.length > 0,
        enabled: live.some((t) => t.enabled),
        element: !!d.audioEl,
        playing: d.audioEl ? (d.played === true && !d.audioEl.paused) : false,
        started: d.played,
        silenced: this.silent(d.ship),
        volume: d.audioEl ? Math.round(d.audioEl.volume * 100) : null,
      };
    }
    return out;
  }

  levels() {
    const out = {};
    for (const d of this.down.values()) {
      if (!d.ship || d.ship === this.our) continue;
      if (!d.audioEl) continue;
      out[d.ship] = Math.round(d.audioEl.volume * 100);
    }
    return out;
  }

  /* Which ships we are receiving video from, so the UI can show tiles only
   * for people actually sending one. */
  videoShips() {
    const out = [];
    for (const d of this.down.values()) {
      if (d.ship && d.stream?.getVideoTracks?.().length) out.push(d.ship);
    }
    return out;
  }

  async renegotiate(m) {
    const u = this.up.get(m.id);
    if (!u) return;
    try {
      const off = await u.pc.createOffer({ iceRestart: true });
      await u.pc.setLocalDescription(off);
      this.send({
        type: 'offer',
        id: m.id,
        source: this.clientId,
        username: this.username,
        kind: 'renegotiate',
        label: u.label,
        sdp: (u.pc.localDescription || off).sdp,
      });
    } catch (e) {
      console.error('[sfu] renegotiation failed');
    }
  }

  /* --------------------------------------------------------------- close */

  close(why) {
    for (const id of [...this.down.keys()]) this.dropDown(id);
    for (const [id, u] of this.up) {
      this.send({ type: 'close', id });
      try {
        u.pc.close();
      } catch (e) {}
    }
    this.up.clear();
    this.users.clear();
    this.mayPresent = true;
    this.onUsers();
    this.joined = false;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try {
        ws.close();
      } catch (e) {}
    }
    if (why) this.onStatus('closed', why);
  }
}

function iceFrom(grant) {
  return (grant.ice ?? []).map((s) => {
    const out = { urls: s.urls };
    if (s.username) out.username = s.username;
    if (s.credential) out.credential = s.credential;
    return out;
  });
}

/* Galene's permissions, across the shapes it has used: a list of strings, an
 * object of flags, or nothing at all. Returns null when the message says
 * nothing -- which is not the same as saying no. */
function readPermissions(p) {
  if (Array.isArray(p)) return p.includes('present');
  if (p && typeof p === 'object') return !!p.present;
  return null;
}

function shipOf(username) {
  return typeof username === 'string' && username.charAt(0) === '~' ? username : null;
}

function cryptoId() {
  const a = new Uint8Array(16);
  (window.crypto || window.msCrypto).getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
/* One publication's own retries, independent of the call. */
export const PUBLICATION_TRIES = 4;
export const PUBLICATION_BACKOFF_MS = [1000, 3000, 8000, 15000];
/* CONNECT BEFORE BREAK: how long a replacement socket gets to be accepted by
 * the call server before we give up on it and keep the call we have. */
export const SWITCH_TIMEOUT_MS = 15000;
/* BROKEN MEDIA, NOT JUST BROKEN CONNECTIONS. WebRTC can say "connected" while
 * no audio is arriving at all. Every MEDIA_WATCH_MS each audio connection's
 * byte counter is read; one that has not moved for MEDIA_STALL_MS on a
 * connected link is stalled. Then, one step at a time: an ICE restart, and if
 * that has not brought bytes back within MEDIA_RECOVER_MS, that one stream is
 * rebuilt. Muting unpublishes, so a muted person has no stream to mistake for
 * a broken one; Opus keeps sending through silence. Audio only: a still screen
 * share legitimately sends nothing. */
export const MEDIA_WATCH_MS = 2000;
export const MEDIA_STALL_MS = 6000;
export const MEDIA_RECOVER_MS = 8000;
/* A STREAM THAT NEVER STARTED is as broken as one that stopped. Chrome only
 * creates the audio counter once the first packet has arrived, so a stream
 * that had never carried a sound had nothing to watch, and was skipped: a
 * listener hearing nothing, with every connection saying "connected". One that
 * should carry audio now counts from zero.
 *
 * NOT FOREVER, though. When the SOURCE is silent -- a microphone that has died
 * at the other end -- rebuilding the stream changes nothing, and rebuilding it
 * every fifteen seconds is churn everybody sees. After MEDIA_MAX_REBUILDS for
 * one person's audio within MEDIA_GIVEUP_MS we stop and wait for sound; the
 * other end's own microphone check is what tells them. */
export const MEDIA_MAX_REBUILDS = 2;
export const MEDIA_GIVEUP_MS = 3 * 60 * 1000;

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
  constructor({ our, onStream, onStreamRemoved, onPeerLeft, onStatus, onUsers, onPermissions,
                onPublication, onPeerState, onMedia } = {}) {
    this.our = our;
    /* One publication succeeding or giving up, reported on its own. A camera
     * that cannot be sent is not a failed CALL, and must not be reported as
     * one: that used to tear down healthy voice to retry a screen share. */
    this.onPublication = onPublication ?? (() => {});
    /* A single peer connection's WebRTC state changing -- for diagnostics. */
    this.onPeerState = onPeerState ?? (() => {});
    this.pubTries = new Map();     //  publication id -> attempts that failed
    this.pubTimers = new Map();    //  publication id -> retry timer
    this.renegotiated = new Set(); //  down stream ids we have asked to restart ICE
    this.restarted = new Set();    //  up stream ids we have re-offered with an ICE restart
    this.onMedia = onMedia ?? (() => {});   //  (id, direction, state, ship): stalled / restart / rebuild / recovered
    this.mediaTimer = null;
    this.checkingMedia = false;
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
    /* A replacement socket joining beside the live one: {grant, clientId, ws,
     * timer}. See connectBeside. */
    this.next = null;
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

  connect(grant, { overlap = false } = {}) {
    /* CONNECT BEFORE BREAK. Moving to another room used to close the live one
     * first and then dial the new one, so a replacement that never came up
     * left nothing at all. With `overlap` and a live call, the new socket joins
     * BESIDE the old one, and the old one is let go only once the call server
     * has accepted us into the new room. */
    if (overlap && this.ws && this.joined && this.grant) { this.connectBeside(grant); return; }
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
      this.hello(ws, grant, this.clientId);
    };
    this.bindSocket(ws);
  }

  /* Pipelining is permitted: handshake then join without waiting. */
  hello(ws, grant, id) {
    const raw = (m) => { try { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); } catch {} };
    raw({ type: 'handshake', version: [PROTOCOL_VERSION], id });
    raw({ type: 'join', kind: 'join', group: grant.group, token: grant.token });
  }

  /* The replacement: joined on its own socket, with the live call untouched.
   * Only the join is handled here -- no media is requested or offered until it
   * is promoted, so the two rooms never both carry our audio. */
  connectBeside(grant) {
    this.abandonNext(null);
    const next = { grant, clientId: cryptoId(), ws: null, timer: null };
    this.next = next;
    let ws;
    try { ws = new WebSocket(grant.sfu); }
    catch { this.abandonNext('connect'); return; }
    next.ws = ws;
    ws.onopen = () => { if (this.next === next) this.hello(ws, grant, next.clientId); };
    ws.onmessage = (ev) => {
      if (this.next !== next) return;
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m?.type === 'ping') { try { ws.send(JSON.stringify({ type: 'pong' })); } catch {} return; }
      if (m?.type !== 'joined') return;
      if (m.kind === 'fail') { this.abandonNext('join-refused'); return; }
      if (m.kind !== 'join') return;
      if (m.username !== this.our || grant.participant !== m.username) { this.abandonNext('identity-mismatch'); return; }
      this.promote(next, m);
    };
    ws.onclose = () => { if (this.next === next) this.abandonNext('connect'); };
    ws.onerror = () => { if (this.next === next) this.abandonNext('connect'); };
    next.timer = setTimeout(() => { if (this.next === next) this.abandonNext('join-timeout'); }, SWITCH_TIMEOUT_MS);
  }

  /* The call server took us into the new room: now, and only now, the old one
   * goes. Publications carry over -- they are re-offered on the new socket. */
  promote(next, m) {
    clearTimeout(next.timer);
    this.next = null;
    this.close(null);
    this.grant = next.grant;
    this.clientId = next.clientId;
    this.ws = next.ws;
    this.bindSocket(next.ws);
    this.onJoined(m);
  }

  /* The replacement did not make it. The live call is exactly as it was; the
   * caller is told, so it can go back to it. */
  abandonNext(why) {
    const n = this.next;
    if (!n) return false;
    this.next = null;
    clearTimeout(n.timer);
    try { n.ws?.close(); } catch {}
    if (why) this.onStatus('handoff-failed', why);
    return true;
  }

  /* Is a replacement joining beside the live call right now? */
  switching() { return !!this.next; }

  bindSocket(ws) {
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
      this.watchMedia();
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
    /* A socket that failed or was closed keeps its old grant for reference,
     * but a credential for it is no renewal: there is nothing to renew. Say
     * so, and the caller connects afresh. */
    if(!this.ws)return false;
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
    this.watchPeer(pc, id, 'up');
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
      this.retryPublication(id, 'publish-failed');
    }
  }

  /* ONE PUBLICATION, RETRIED ON ITS OWN. Bounded: after a few failures it is
   * reported as failed to the media layer and left alone, while the call and
   * every other publication carry on. */
  retryPublication(id, reason) {
    if (!this.publications.has(id)) return;
    clearTimeout(this.pubTimers.get(id));
    const tries = (this.pubTries.get(id) ?? 0) + 1;
    this.pubTries.set(id, tries);
    if (tries > PUBLICATION_TRIES) {
      this.pubTimers.delete(id);
      this.onPublication(id, 'failed', reason);
      return;
    }
    this.onPublication(id, 'retrying', reason);
    this.pubTimers.set(id, setTimeout(() => {
      this.pubTimers.delete(id);
      if (this.publications.has(id) && !this.up.has(id)) void this.startPublication(id, this.publications.get(id));
    }, PUBLICATION_BACKOFF_MS[Math.min(tries - 1, PUBLICATION_BACKOFF_MS.length - 1)]));
  }

  /* Rebuild one upstream connection from scratch: close what the server holds
   * for it and offer again under the same id. */
  rebuildPublication(id, reason) {
    const u = this.up.get(id);
    if (u) {
      this.send({ type: 'close', id });
      try { u.pc.close(); } catch {}
      this.up.delete(id);
    }
    this.retryPublication(id, reason);
  }

  /* WATCH THE CONNECTION, NOT ONLY THE SOCKET. The signalling socket can be
   * healthy while one audio or video connection has failed underneath it --
   * somebody present who sends nothing. Record both states, and repair just
   * that connection: an upstream one is rebuilt, a downstream one is asked to
   * restart ICE once, and dropped if that does not bring it back. */
  watchPeer(pc, id, direction) {
    const report = () => {
      const state = pc.connectionState ?? '', ice = pc.iceConnectionState ?? '';
      const rec = direction === 'up' ? this.up.get(id) : this.down.get(id);
      if (!rec || rec.pc !== pc) return;
      rec.connectionState = state; rec.iceState = ice;
      this.onPeerState(id, direction, state, ice, rec.ship ?? this.our);
      if (state === 'connected' && direction === 'up') { this.pubTries.delete(id); this.restarted.delete(id); }
      if (state === 'connected' && direction === 'down') this.renegotiated.delete(id);
      const failed = state === 'failed' || ice === 'failed';
      if (!failed) return;
      if (direction === 'up') {
        /* ICE restart first -- cheap, keeps the same stream on the server --
         * and a full rebuild only if that does not bring it back. */
        if (!this.restarted.has(id)) { this.restarted.add(id); void this.restartUp(id); return; }
        this.restarted.delete(id);
        this.rebuildPublication(id, 'ice-failed');
        return;
      }
      if (!this.renegotiated.has(id)) {
        this.renegotiated.add(id);
        this.send({ type: 'renegotiate', id });
        return;
      }
      this.renegotiated.delete(id);
      this.dropDown(id);
    };
    pc.onconnectionstatechange = report;
    pc.oniceconnectionstatechange = report;
  }

  /* Re-offer one upstream connection with new ICE credentials, as Galene's own
   * client does: same id, kind 'renegotiate'. */
  async restartUp(id) {
    const u = this.up.get(id);
    if (!u) return;
    try {
      u.pc.restartIce?.();
      const offer = await u.pc.createOffer({ iceRestart: true });
      await u.pc.setLocalDescription(offer);
      if (this.up.get(id) !== u) return;
      this.onPublication(id, 'restarting', 'ice-failed');
      this.send({ type: 'offer', id, source: this.clientId, username: this.username,
        kind: 'renegotiate', label: u.label, sdp: u.pc.localDescription.sdp });
    } catch {
      if (this.up.get(id) === u) { this.restarted.delete(id); this.rebuildPublication(id, 'ice-restart-failed'); }
    }
  }

  /* Does the session still hold this publication? A reconnect clears them all,
   * so what the media layer thinks it published can outlive what is actually
   * being sent. */
  hasPublication(id) { return this.publications.has(id); }

  unpublish(id) {
    clearTimeout(this.pubTimers.get(id)); this.pubTimers.delete(id); this.pubTries.delete(id);
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

  /* Try again to start audio the browser refused to autoplay. Records the
   * outcome the same way attach does, so the diagnostics stop saying
   * "refused" once it works. Returns how many elements were retried. */
  resume() {
    let tried = 0;
    for (const d of this.down.values()) {
      const el = d.audioEl;
      if (!el || (d.played === true && !el.paused)) continue;
      tried++;
      Promise.resolve(el.play?.()).then(() => { d.played = true; }, () => { d.played = false; });
    }
    return tried;
  }
  /* Is any received audio waiting on a user gesture? */
  blocked() {
    for (const d of this.down.values()) if (d.audioEl && d.played === false) return true;
    return false;
  }

  /* One compact line of state for the call timeline: signalling, credential,
   * each connection's WebRTC and ICE state, what arrived, and autoplay. */
  summary() {
    const pc = (r) => `${r.connectionState ?? r.pc?.connectionState ?? '?'}/${r.iceState ?? r.pc?.iceConnectionState ?? '?'}`;
    const tracks = {};
    for (const d of this.down.values()) {
      if (!d.ship) continue;
      const t = tracks[d.ship] ??= { audio: 0, video: 0, pcs: [] };
      for (const k of d.stream?.getTracks?.() ?? []) if (k.readyState === 'live') t[k.kind === 'video' ? 'video' : 'audio']++;
      t.pcs.push(pc(d));
    }
    return {
      socket: this.ws ? (['connecting', 'open', 'closing', 'closed'][this.ws.readyState] ?? '?') : 'none',
      joined: this.joined, switching: !!this.next,
      group: this.grant?.group ?? null, gen: this.grant?.gen ?? 0,
      users: this.users.size, present: this.mayPresent,
      up: [...this.up.values()].map((u) => `${u.label ?? '?'}:${pc(u)}`),
      down: tracks,
      autoplayBlocked: this.blocked(),
    };
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
      this.watchPeer(pc, m.id, 'down');

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
      this.onPublication(m.id, 'answered');
    } catch (e) {
      /* An answer we cannot apply leaves a publication that looks present and
       * sends nothing. It used to be logged and left like that. Rebuild it. */
      console.error('[sfu] remote answer rejected');
      if (this.up.get(m.id) === u) this.rebuildPublication(m.id, 'answer-rejected');
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
      /* The server closed something we are still publishing. That used to be
       * the end of it: the button said "on" and nothing was sent. Offer it
       * again, backed off -- unless we may not publish right now, which is a
       * mute and is put back when `present` returns. */
      if (this.publications.has(m.id) && this.mayPresent) this.retryPublication(m.id, 'server-closed');
    }
  }

  /* ---------------------------------------------------- the media watchdog */

  watchMedia() {
    clearInterval(this.mediaTimer);
    this.mediaTimer = setInterval(() => { void this.checkMedia(); }, MEDIA_WATCH_MS);
  }

  /* Audio bytes a connection has moved so far, or null if it carries none. */
  async audioBytes(pc, direction) {
    let stats;
    try { stats = await pc.getStats(); } catch { return null; }
    const type = direction === 'down' ? 'inbound-rtp' : 'outbound-rtp';
    const field = direction === 'down' ? 'bytesReceived' : 'bytesSent';
    let bytes = null;
    stats?.forEach?.((r) => {
      if (r.type === type && (r.kind ?? r.mediaType) === 'audio' && Number.isFinite(r[field])) bytes = (bytes ?? 0) + r[field];
    });
    return bytes;
  }

  async checkMedia(now = Date.now()) {
    if (this.checkingMedia || !this.joined) return;
    this.checkingMedia = true;
    this.noSound ??= new Map();      //  ship -> ms we stopped hearing them
    this.gaveUp ??= new Map();       //  `${direction}/${ship}/${label}` -> {count, since}
    try {
      const records = [...[...this.down].map(([id, r]) => [id, r, 'down']), ...[...this.up].map(([id, r]) => [id, r, 'up'])];
      for (const [id, rec, direction] of records) {
        if ((direction === 'down' ? this.down : this.up).get(id) !== rec) continue;
        let bytes = await this.audioBytes(rec.pc, direction);
        if (bytes === null) {
          if (!(rec.stream?.getAudioTracks?.().length > 0)) continue;   //  no audio on this one
          bytes = 0;                                                    //  audio due, none yet
        }
        const who = rec.ship ?? this.our, key = `${direction}/${who}/${rec.label ?? ''}`;
        const m = rec.media ??= { bytes, at: now, stage: 0, stageAt: 0 };
        if (bytes > m.bytes) {
          if (m.stage) this.onMedia(id, direction, 'recovered', who);
          m.bytes = bytes; m.at = now; m.stage = 0;
          this.gaveUp.delete(key);
          if (direction === 'down' && this.noSound.delete(who)) this.onMedia(id, direction, 'sound', who);
          continue;
        }
        const linked = (rec.pc.connectionState ?? 'connected') === 'connected';
        if (!linked || now - m.at < MEDIA_STALL_MS) continue;
        if (direction === 'down' && !this.noSound.has(who)) this.noSound.set(who, m.at);
        if (m.stage === 0) {
          const gave = this.gaveUp.get(key);
          if (gave && gave.count >= MEDIA_MAX_REBUILDS && now - gave.since < MEDIA_GIVEUP_MS) {
            /* Rebuilt twice already and still silent: it is the source. */
            m.stage = 3; m.stageAt = now;
            this.onMedia(id, direction, 'gave-up', who);
            continue;
          }
          /* One ICE restart first: cheap, and the same stream on the server. */
          m.stage = 1; m.stageAt = now;
          this.onMedia(id, direction, 'restart', who);
          if (direction === 'down') this.send({ type: 'renegotiate', id });
          else { this.restarted.add(id); void this.restartUp(id); }
        } else if (m.stage === 1 && now - m.stageAt >= MEDIA_RECOVER_MS) {
          /* Still nothing: rebuild just this stream. */
          m.stage = 2; m.stageAt = now;
          const gave = this.gaveUp.get(key);
          if (!gave || now - gave.since >= MEDIA_GIVEUP_MS) this.gaveUp.set(key, { count: 1, since: now });
          else gave.count++;
          this.onMedia(id, direction, 'rebuild', rec.ship ?? this.our);
          if (direction === 'up') this.rebuildPublication(id, 'media-stalled');
          else {
            this.send({ type: 'abort', id });
            this.dropDown(id);
            this.send({ type: 'request', request: { '': ['audio', 'video'] } });
          }
        }
      }
    } finally { this.checkingMedia = false; }
  }

  /* People whose audio should be reaching us and is not -- stalled, or never
   * started. Their call tile says so: it is not the listener's speakers. */
  soundless() {
    const here = new Set([...this.down.values()].map((d) => d.ship));
    return new Set([...(this.noSound ?? new Map()).keys()].filter((s) => here.has(s)));
  }

  /* Every audio stream the watchdog is following, for the diagnostics. */
  mediaState(now = Date.now()) {
    const rows = [];
    for (const [direction, map] of [['up', this.up], ['down', this.down]]) {
      for (const r of map.values()) if (r.media) rows.push({ direction, who: r.ship ?? this.our,
        label: r.label ?? '', bytes: r.media.bytes, quietMs: now - r.media.at, stage: r.media.stage });
    }
    return { streams: rows, soundless: [...this.soundless()] };
  }

  /* How much sound our own publication is carrying, as the browser measures it
   * before encoding: `energy` only grows while there is sound -- even the
   * faint hiss every working microphone picks up. Null where not measured. */
  async upAudio(id) {
    const u = this.up.get(id);
    if (!u) return null;
    let stats;
    try { stats = await u.pc.getStats(); } catch { return null; }
    let energy = null, bytes = null;
    stats?.forEach?.((r) => {
      if (r.type === 'media-source' && r.kind === 'audio' && Number.isFinite(r.totalAudioEnergy)) energy = (energy ?? 0) + r.totalAudioEnergy;
      if (r.type === 'outbound-rtp' && (r.kind ?? r.mediaType) === 'audio' && Number.isFinite(r.bytesSent)) bytes = (bytes ?? 0) + r.bytesSent;
    });
    return { energy, bytes };
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
    if (d.ship && ![...this.down.values()].some(other => other.ship === d.ship)) {
      this.noSound?.delete(d.ship);
      this.onPeerLeft(d.ship);
    }
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
        /* The connection underneath, which can fail while signalling is fine. */
        connection: d.connectionState ?? d.pc?.connectionState ?? null,
        ice: d.iceState ?? d.pc?.iceConnectionState ?? null,
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
    this.abandonNext(null);
    clearInterval(this.mediaTimer); this.mediaTimer = null;
    for (const t of this.pubTimers.values()) clearTimeout(t);
    this.pubTimers.clear(); this.pubTries.clear(); this.renegotiated.clear(); this.restarted.clear();
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

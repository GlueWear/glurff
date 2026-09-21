/* Positions, over the movement session's realtime service, bypassing Eyre and
 * Ames entirely.
 *
 * A SEPARATE, LONG-LIVED CONNECTION. Calls come and go as people walk into
 * rooms and form huddles; movement must not. This socket is never closed by a
 * room or huddle change.
 *
 * NO MEDIA. It never calls getUserMedia and never offers an upstream. A
 * participant with microphone and camera off is fully connected here.
 *
 * PERMISSION. Galene lets a participant send application messages only with the
 * `message` permission. The call service now mints it for every room (verified
 * by implementation/movement-relay/probe.js). Refusal is still surfaced as a
 * distinct state rather than failing silently.
 *
 * PER-VIEWER ROUTING. Every position is addressed with `dest` to the client ids
 * of ships allowed to see us -- the presence layer's authorised audience -- and
 * to nobody else. Being connected to the relay grants no visibility: a stranger
 * admitted to the room receives the participant list Galene publishes, but no
 * positions, because nobody routes to them.
 *
 * CONGESTION NEVER QUEUES. One slot holds the newest position. If the socket is
 * backed up, the tick is skipped and the NEWEST position is retried next tick;
 * an old journey is never replayed. Galene disconnects a participant that
 * cannot accept a message within 500 ms, so a close is ordinary: reconnect with
 * the grant already held rather than asking for a new room.
 *
 * RELAY SILENCE IS NOT DEPARTURE. Only the presence layer removes people.
 */

export const KIND = 'glurff.move';
export const ACK_KIND = 'glurff.move-ack';
export const DELIVERY_MS = 3000;
const ACK_MS = 1000, REPAIR_MS = 2000;
/* A start, a stop or a turn jumps the tick -- but no faster than this, so
 * somebody wiggling on the spot cannot send twenty a second. */
const URGENT_MS = 50;
/* Eight a second while walking, so the person drawing us always has a next
 * position to walk towards; nothing is sent while we stand still. Starting,
 * stopping and turning do not wait for the next one of these at all. */
export const SEND_MS = 125;
export const BUFFER_LIMIT = 64 * 1024;
export const SUB = 16;                    //  wire units per tile, as presence uses

const MAX_X = 1024;                       //  64 tiles * SUB
const MAX_Y = 736;                        //  46 tiles * SUB
/* Velocity rides with the position, in wire units per second. Running is about
 * eight tiles a second; anything past twenty is not a walk. */
const MAX_V = 20 * SUB;
const DIRS = new Set(['down', 'right', 'up', 'left']);
const PROTOCOL_VERSION = '2';
const MAX_TRACKED = 512;

export const IDLE = 'idle';
export const OPENING = 'opening';
export const LIVE = 'live';
export const RETRYING = 'retrying';
export const REFUSED = 'refused';
export const FAILED = 'failed';
export const EXPIRED = 'expired';

const isShip = (s) => typeof s === 'string' && /^~[a-z-]{3,70}$/.test(s);

export function createMovementRelay({
  our,
  now = Date.now,
  every = (fn, ms) => setInterval(fn, ms),
  stopEvery = (id) => clearInterval(id),
  later = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  socket = (url) => new WebSocket(url),
  random = () => Math.random().toString(36).slice(2, 12),
  onPosition = () => {},                  //  (ship, {x,y,dir}, {t, seq, host, client})
  onStatus = () => {},                    //  (state, reason)
  onRoster = () => {},                    //  (Set<ship>) ships connected to this room
  diagnostic = () => {},
} = {}) {
  let ws = null;
  let state = IDLE;
  let grant = null;
  let clientId = null;
  let joined = false;
  let permissions = null;
  let seq = 0;
  let pending = null;
  let latest = null;
  let lastHeard = 0, lastPing = 0, openedAt = 0;
  let pump = null;
  let retryTimer = null;
  let attempts = 0;
  let routes = new Set();
  const users = new Map();                //  galene client id -> ship
  const lastSeq = new Map();              //  galene client id -> last accepted seq
  const lag = new Map();                  //  ship -> {min, last, max}
  const deliveries = new Map(), acknowledgements = new Map(), receivedAt = new Map();
  let lastAckFlush = -Infinity, lastRepair = -Infinity, lastUrgent = -Infinity;
  const counts = { sent: 0, dropped: 0, received: 0, stale: 0, invalid: 0,
                   refused: 0, reconnects: 0, unrouted: 0, ackSent:0, ackReceived:0, repairs:0 };

  /* DELIVERY IS PER PERSON, NOT PER TAB. One ship may be connected from more
   * than one client -- a reloaded tab whose old connection has not been cleaned
   * up yet, or two devices. Their positions reach them if ANY of those clients
   * is acknowledging; requiring every client meant one dead tab turned on the
   * slow ship-to-ship fallback and a repair every couple of seconds. */
  const clientsOf = (ship) => { const out = []; for (const [id, who] of users) if (who === ship) out.push(id); return out; };
  const acking = (id) => {
    const d = deliveries.get(id);
    return !d || d.sent === d.acked || now() - Math.max(d.firstUnackedAt, d.lastAckAt) < DELIVERY_MS;
  };
  const stalled = (id) => { const d = deliveries.get(id); return !!d && d.sent > d.acked && now() - d.lastSentAt >= REPAIR_MS; };

  const set = (next, reason = '') => {
    if (state === next) return;
    state = next;
    diagnostic('movement-relay', { state: next, reason });
    onStatus(next, reason);
  };
  const roster = () => new Set(users.values());

  const usable = (g) => !!g && typeof g.sfu === 'string' && typeof g.group === 'string' &&
    typeof g.token === 'string' && (!Number.isFinite(g.expires) || g.expires > now() + 5000);

  function raw(msg) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(msg)); return true; } catch { return false; }
  }

  function teardown() {
    stopEvery(pump); pump = null;
    if (!ws) return;
    const s = ws;
    ws = null;
    s.onopen = s.onclose = s.onerror = s.onmessage = null;
    try { s.close(); } catch {}
  }

  function forgetRoster() {
    const had = users.size > 0;
    users.clear();
    deliveries.clear();acknowledgements.clear();receivedAt.clear();
    if (had) onRoster(roster());
  }

  function open() {
    retryTimer = null;
    if (!usable(grant)) { set(EXPIRED, 'grant'); return; }
    teardown();
    forgetRoster();
    lastSeq.clear();
    joined = false;
    permissions = null;
    openedAt = lastHeard = lastPing = now();
    clientId = random();
    set(attempts ? RETRYING : OPENING, attempts ? 'reconnect' : '');
    let s;
    try { s = socket(grant.sfu); } catch { scheduleRetry('connect'); return; }
    ws = s;
    s.onopen = () => {
      if (ws !== s) return;
      /* Pipelined, as the protocol allows. No stream is ever offered. */
      raw({ type: 'handshake', version: [PROTOCOL_VERSION], id: clientId });
      raw({ type: 'join', kind: 'join', group: grant.group, token: grant.token });
    };
    s.onclose = () => { if (ws === s) { ws = null; lost('closed'); } };
    s.onerror = () => { if (ws === s) { teardown(); lost('socket'); } };
    s.onmessage = (ev) => {
      if (ws !== s) return;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      lastHeard = now();
      handle(m);
    };
    pump = every(flush, SEND_MS);
  }

  /* An ordinary disconnect -- including Galene dropping a slow consumer. */
  function lost(reason) {
    stopEvery(pump); pump = null;
    joined = false;
    forgetRoster();
    if (state === REFUSED || state === FAILED || state === IDLE) return;
    scheduleRetry(reason);
  }

  function scheduleRetry(reason) {
    if (retryTimer !== null) return;
    if (!usable(grant)) { set(EXPIRED, 'grant'); return; }
    attempts++;
    counts.reconnects++;
    set(RETRYING, reason);
    retryTimer = later(open, Math.min(30000, 1000 * 2 ** Math.min(attempts - 1, 5)));
  }

  function handle(m) {
    switch (m.type) {
      case 'ping':
        raw({ type: 'pong' });
        return;
      case 'joined':
        if (m.kind === 'fail') {
          /* A refused join means this token is no good. Reconnecting with it
           * again would only be refused again; a new grant is needed. */
          teardown(); joined = false; forgetRoster();
          set(FAILED, 'join-refused');
          return;
        }
        if (m.kind === 'leave') {
          teardown(); joined = false; forgetRoster();
          set(FAILED, 'removed');
          return;
        }
        if (m.kind !== 'join' && m.kind !== 'change') return;
        joined = true;
        attempts = 0;
        permissions = Array.isArray(m.permissions) ? m.permissions.map(String) : null;
        if (permissions && !permissions.includes('message')) {
          refuse('no-message-permission');
          return;
        }
        set(LIVE);
        onRoster(roster());
        return;
      case 'user':
        if (typeof m.id !== 'string' || m.id === clientId) return;
        if (m.kind === 'delete') {
          if (users.delete(m.id)) { lastSeq.delete(m.id);deliveries.delete(m.id);acknowledgements.delete(m.id);receivedAt.delete(m.id);onRoster(roster()); }
          return;
        }
        if (isShip(m.username) && users.get(m.id) !== m.username && (users.has(m.id) || users.size < MAX_TRACKED)) {
          users.set(m.id, m.username);
          if (routes.has(m.username) && latest) pending = latest;
          onRoster(roster());
        }
        return;
      case 'usermessage':
        if (m.kind === 'error' && !m.source) {
          counts.refused++;
          if (/author/i.test(String(m.value ?? ''))) refuse('not-authorised');
          diagnostic('movement-relay', { state: 'error', reason: String(m.value ?? '').slice(0, 64) });
          return;
        }
        if (m.kind === KIND) receive(m);
        if (m.kind === ACK_KIND) {
          const d=deliveries.get(m.source), s=m.value?.s;
          if(users.has(m.source) && d && Number.isSafeInteger(s) && s>d.acked && s<=d.sent){
            d.acked=s;d.lastAckAt=now();counts.ackReceived++;
          }
        }
        return;
      case 'abort':
        teardown(); lost('aborted');
        return;
      default:
        return;       //  offers, ice, chat: not ours, we carry no media
    }
  }

  function refuse(reason) {
    teardown(); joined = false; forgetRoster();
    set(REFUSED, reason);
  }

  function receive(m) {
    const from = typeof m.source === 'string' ? m.source : null;
    const who = from && users.get(from);
    if (!who || who === our) return;
    const v = m.value;
    if (!v || !Number.isSafeInteger(v.s) || !Number.isFinite(v.t) ||
        !Number.isSafeInteger(v.x) || !Number.isSafeInteger(v.y) ||
        v.x < 0 || v.y < 0 || v.x > MAX_X || v.y > MAX_Y || !DIRS.has(v.d) ||
        (v.h != null && !isShip(v.h)) ||
        (v.z != null && v.z !== 0 && v.z !== 1) ||
        //  Velocity and the walking flag are optional: an older sender has neither.
        (v.vx != null && !(Number.isSafeInteger(v.vx) && Math.abs(v.vx) <= MAX_V)) ||
        (v.vy != null && !(Number.isSafeInteger(v.vy) && Math.abs(v.vy) <= MAX_V)) ||
        (v.m != null && v.m !== 0 && v.m !== 1)) {
      counts.invalid++;
      return;
    }
    /* Ordered per CLIENT, not per ship: two tabs of one ship each number their
     * own positions, and ship-level recency is decided by `t` downstream. */
    const k = from ?? who;
    const last = lastSeq.get(k);
    if (last !== undefined && v.s <= last) { counts.stale++; return; }
    lastSeq.set(k, v.s);
    if (lastSeq.size > MAX_TRACKED) lastSeq.delete(lastSeq.keys().next().value);
    counts.received++;

    /* Delivery delay without trusting the sender's clock: the smallest lag
     * seen from a sender approximates their clock offset, and anything above
     * it is delay. */
    const d = now() - v.t;
    const l = lag.get(who) ?? { min: Infinity, last: 0, max: 0 };
    l.min = Math.min(l.min, d);
    l.last = d - l.min;
    l.max = Math.max(l.max, l.last);
    lag.set(who, l);
    if (lag.size > MAX_TRACKED) lag.delete(lag.keys().next().value);

    const accepted=onPosition(who, { x: v.x / SUB, y: v.y / SUB, dir: v.d,
                                      scene: v.z === 1 ? 'vatican' : 'main' },
               { t: v.t, seq: v.s, host: v.h ?? null, client: from,
                 //  Undefined, not false, from a sender that does not send them:
                 //  the receiver then works movement out from the positions.
                 vx: v.vx == null ? undefined : v.vx / SUB,
                 vy: v.vy == null ? undefined : v.vy / SUB,
                 moving: v.m == null ? undefined : v.m === 1 });
    receivedAt.set(from,now());
    // ACK only a valid position accepted by the visibility layer. This carries
    // no position or identity claim; attribution comes from Galene's roster.
    if(accepted!==false)acknowledgements.set(from,v.s);
  }

  function flush() {
    if (!ws) return;
    if ((!joined && now() - openedAt >= 15000) || now() - lastHeard >= 35000) {
      teardown(); lost('timeout'); return;
    }
    if (now() - lastPing >= 10000 && ws.bufferedAmount <= BUFFER_LIMIT) {
      lastPing = now(); raw({ type: 'ping' });
    }
    if (!joined || state !== LIVE) return;
    if(now()-lastAckFlush>=ACK_MS && ws.bufferedAmount<=BUFFER_LIMIT){
      lastAckFlush=now();
      for(const [id,s] of acknowledgements){
        if(ws.bufferedAmount>BUFFER_LIMIT || !raw({type:'usermessage',source:clientId,dest:id,kind:ACK_KIND,value:{s}}))break;
        acknowledgements.delete(id);counts.ackSent++;
      }
    }
    /* Repair only for a PERSON nothing is getting through to: every client of
     * theirs is behind. One stalled client beside a live one is a dead tab, not
     * a lost position. */
    if(!pending && latest && now()-lastRepair>=REPAIR_MS && [...routes].some(ship=>{const c=clientsOf(ship);return c.length>0 && c.every(stalled);})){
      pending=latest;lastRepair=now();counts.repairs++;
    }
    if(!pending)return;
    const targets = [];
    for (const [id, who] of users) if (routes.has(who)) targets.push(id);
    /* Nobody entitled to see us is here yet: keep the position for when they
     * arrive instead of throwing it away. */
    if (!targets.length) { counts.unrouted++; return; }
    if (ws.bufferedAmount > BUFFER_LIMIT) { counts.dropped++; return; }
    const value = { s: ++seq, t: pending.t, x: pending.x, y: pending.y, d: pending.dir,
                    ...(pending.scene === 'vatican' ? { z: 1 } : {}),
                    ...(pending.host ? { h: pending.host } : {}),
                    ...(pending.vx || pending.vy ? { vx: pending.vx, vy: pending.vy } : {}),
                    m: pending.moving ? 1 : 0 };
    let all = true;
    for (const id of targets) {
      if (ws.bufferedAmount > BUFFER_LIMIT) { counts.dropped++; all = false; break; }
      if (!raw({ type: 'usermessage', source: clientId, dest: id, kind: KIND, value })) { all = false; break; }
      const d=deliveries.get(id)??{sent:0,acked:0,lastAckAt:0,firstUnackedAt:now()};
      if(d.sent===d.acked)d.firstUnackedAt=now();
      d.sent=value.s;d.lastSentAt=now();deliveries.set(id,d);
      counts.sent++;
    }
    /* A local send only queues bytes. Application ACKs independently verify
     * delivery; repair always resends the latest position, never a journey. */
    if (all) pending = null;
  }

  return {
    /* Join a room. Same group and already live: just keep the newer token. */
    connect(g) {
      if (!usable(g)) { set(EXPIRED, 'grant'); return false; }
      if (grant && ws && joined && g.group === grant.group && g.sfu === grant.sfu) {
        grant = g;
        return true;
      }
      cancel(retryTimer); retryTimer = null;
      grant = g;
      attempts = 0;
      open();
      return true;
    },
    /* A fresher token for the room we are in. Never reconnects a live socket:
     * the token only matters at join. Rejects a grant for any other room. */
    refresh(g) {
      if (!usable(g) || !grant || g.group !== grant.group || g.sfu !== grant.sfu) return false;
      grant = g;
      if (state === EXPIRED || state === FAILED || state === REFUSED) { attempts = 0; open(); }
      return true;
    },
    close(reason = 'closed') {
      cancel(retryTimer); retryTimer = null;
      teardown();
      joined = false;
      pending = null;
      latest = null;
      grant = null;
      forgetRoster();
      set(IDLE, reason);
    },
    /* Offer our position. Tiles in, wire units out. `urgent` is a start, a stop
     * or a turn: it goes now rather than on the next tick, which is what made
     * people slide past where they stopped and cut corners. */
    send(p, urgent = false) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !DIRS.has(p.dir)) return;
      const wire = (v) => Number.isFinite(v) ? Math.max(-MAX_V, Math.min(MAX_V, Math.round(v * SUB))) : 0;
      pending = latest = { x: Math.round(p.x * SUB), y: Math.round(p.y * SUB), dir: p.dir, t: now(),
                  scene: p.scene === 'vatican' ? 'vatican' : 'main',
                  host: isShip(p.host) ? p.host : null,
                  vx: wire(p.vx), vy: wire(p.vy), moving: !!p.moving };
      if (urgent && now() - lastUrgent >= URGENT_MS) { lastUrgent = now(); flush(); }
    },
    /* Ships allowed to see us. Positions go to these and no others. */
    route(ships) {
      const next = new Set(ships);
      if (latest && [...next].some(s => !routes.has(s))) pending = latest;
      routes = next;
      for(const id of deliveries.keys())if(!routes.has(users.get(id)))deliveries.delete(id);
    },
    state: () => state,
    live: () => state === LIVE && joined,
    group: () => grant?.group ?? null,
    expires: () => grant?.expires ?? null,
    renewAfter: () => grant?.renewAfter ?? null,
    ships: roster,
    has: (ship) => { for (const who of users.values()) if (who === ship) return true; return false; },
    delivering: ship => { const c=clientsOf(ship); return c.length>0 && c.some(acking); },
    stats: () => ({
      ...counts, state, joined, permissions,
      peers: users.size, routed: routes.size,
      buffered: ws?.bufferedAmount ?? 0,
      delivery:[...users].map(([id,ship])=>{const d=deliveries.get(id);return {ship,authorized:routes.has(ship),sent:d?.sent??0,acknowledged:d?.acked??0,ackAge:d?.lastAckAt?now()-d.lastAckAt:null,receiveAge:receivedAt.has(id)?now()-receivedAt.get(id):null};}),
      delay: Object.fromEntries([...lag].map(([s, l]) => [s, { last: l.last, max: l.max }])),
    }),
  };
}

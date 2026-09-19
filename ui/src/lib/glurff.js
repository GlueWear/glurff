/* Talking to our own %glurff agent.
 *
 * Every action carries the peer set, because the agent keeps no membership of
 * its own -- it is a fan-out with almost no memory, and the client is what
 * decides who should hear us. That set comes from Noltbook's pal list at the
 * user's current dial, so visibility follows the graph Noltbook already owns.
 */
import { latestSender } from 'lib/motion';
import { api, poke, subscribe, our } from 'lib/api';
import { glurffAudience } from 'lib/noltbook';
import { trafficStart, recordCallQuota } from 'lib/diagnostics';

/* Every Urbit poke is counted by what it is FOR. "presence-event" alone covered
 * discovery, call control, world events and positions, which is why a stalled
 * capture could not say which of them was the problem. */
const tracked = (kind, p) => {
  const done = trafficStart(kind);
  return Promise.resolve(p).then((v) => { done(true); return v; }, (e) => { done(false); throw e; });
};
const ACTION_CLASS = {
  move: 'legacy-movement', leave: 'legacy-movement', dress: 'avatar', 'fetch-look': 'avatar',
  claim: 'room-control', release: 'room-control', lock: 'room-control', knock: 'room-control',
  splash: 'world-event', roll: 'world-event', 'ensure-commons': 'note-install',
};
const classify = (event) => {
  const k = event?.kind;
  if (k === 'state') return event.here === null ? 'presence-departure' : 'presence-snapshot';
  if (k === 'query' || k === 'cut' || k === 'cancel') return 'presence-discovery';
  if (typeof k === 'string' && k.startsWith('call-')) return 'call-control';
  if (k === 'room-state') return 'room-state';
  if (typeof k === 'string' && k.startsWith('room-')) return 'room-list';
  if (k === 'shot') return 'world-event';
  return 'presence-other';
};
/* Positions published inside this call are the movement FALLBACK, not the
 * presence beat. Presence builds and hands over its packets synchronously, so
 * the flag only needs to hold for the duration of the call. */
let fallbackMark = false;
export function asFallback(fn) {
  fallbackMark = true;
  try { return fn(); } finally { fallbackMark = false; }
}

const act = (op, extra = {}) =>
  tracked(ACTION_CLASS[op] ?? 'action-other', poke('glurff', 'glurff-action', { op, peers: glurffAudience(), ...extra }));

/* Position rate while moving. Positions travel over the relay now, where ten a
 * second is cheap and is what makes somebody else's walk look continuous. The
 * SLOW path is rate-limited separately, in lib/movement.js: nothing here fans a
 * position out to ships at this rate. */
export const MOVE_HZ = 10;
export const BEAT_MS = 10000;
export const PEER_TTL_MS = 30000;
export const SUB = 16; //  wire positions are scaled, so tiles keep sub-tile precision without floats

export const move = (place, x, y, dir, rev, host) =>
  act('move', {
    place,
    x: Math.round(x * SUB),
    y: Math.round(y * SUB),
    dir,
    rev,
    host: host ?? '',
  });

export const leave = () => act('leave');
export const dress = (look) => act('dress', { look });
export const fetchLook = (who) => act('fetch-look', { who });
export const claimRoom = (place) => act('claim', { place });
export const releaseRoom = (place) => act('release', { place });
export const lockRoom = (place, mode) => act('lock', { place, mode });
export const knock = (host, place) => act('knock', { host, place });
export const splash = (target) => act('splash', { target });
export const roll = (place, stage) => act('roll', { place, ...stage });

/* Open a room's call. The room key is derived agent-side from the place id
 * alone, so this cannot be steered into another agent's namespace. */
/* Open a room: ensure it exists and mint for everyone named. Called once, by
 * whoever is hosting it. */
export const openRoom = (place, who, session, ttl = 3600) =>
  tracked('call-operation', poke('glurff', 'glurff-room', { op: 'open', place, ttl, session, who }));

/* Admit somebody to a room we already hold. Deliberately NOT the same as
 * opening: re-ensuring an existing room bumps its generation and invalidates
 * the tokens of everyone already inside. */
export const admitToRoom = (place, who, session) =>
  tracked('call-operation', poke('glurff', 'glurff-room', { op: 'admit', place, ttl: 3600, session, who }));

export const callOperation=(op,place,who,session)=>tracked('call-operation',poke('glurff','glurff-room',{op,place,who:[who],session,ttl:180}));

/* Moderation the CALL SERVER enforces, not just our own browser.
 *
 * A mute that only the muted person's app honours is a request; these make it
 * true for every client. %noltbook-calls already publishes all three -- mute
 * and unmute reissue that participant's credentials after changing what they
 * may publish, and evict removes them from the room. Only the host of the call
 * can ask: the agent mints against the room key it derives from the place, and
 * the broker answers to the room's authority alone. */
const modOperation=(op,place,who)=>tracked('call-operation',
  poke('glurff','glurff-room',{op,place,who:[who],session:Date.now()*1000+Math.floor(Math.random()*1000),ttl:180}));
export const muteInCall=(place,who)=>modOperation('mute-access',place,who);
export const unmuteInCall=(place,who)=>modOperation('unmute-access',place,who);
export const evictFromCall=(place,who)=>modOperation('evict',place,who);

/* Movement sessions. `peers` is empty on purpose: a movement room is found
 * through presence announcements, so the agent broadcasts nothing. A knock on a
 * movement place admits us and extends the room's lease on the host's ship. */
export const claimMovement = (place) =>
  tracked('movement-control', poke('glurff', 'glurff-action', { op: 'claim', place, peers: [] }));
export const releaseMovement = (place) =>
  tracked('movement-control', poke('glurff', 'glurff-action', { op: 'release', place, peers: [] }));
export const openMovement = (place, session, ttl) =>
  tracked('movement-control', poke('glurff', 'glurff-room', { op: 'open', place, ttl, session, who: [our] }));
export const knockMovement = (host, place) =>
  tracked('movement-control', poke('glurff', 'glurff-action', { op: 'knock', host, place, peers: [] }));

/* Materialise a place's chat note -- the commons, or a room. Only ever call
 * this when the note is genuinely absent AND Noltbook's note list has arrived:
 * the receiver REPLACES the note and clears its messages, so asking for one
 * that already exists destroys that room's history.
 *
 * The place is a key into a table of fixed ids in the agent, never an id. */
export const installNote = (place) => tracked('note-install', poke('glurff', 'glurff-commons', place));

export const watchWorld = (onFact) => subscribe('glurff', '/world', onFact);
export const watchCallAccess = (onFact) => subscribe('glurff', '/call-access', (name,p) => {
  // Diagnostics share the existing owner-local channel but never reach either
  // call controller: a late quota detail must not change media or retry state.
  if(name==='call-quota'){recordCallQuota(p,our);return;}
  onFact(name,p);
});

/* Ordinary room messages and games: transient relay, never Noltbook notes. */
export const sendRoomEvent = (place, event, peers) =>
  tracked('room-event', poke('glurff','glurff-action',{op:'room-event',place,body:JSON.stringify(event),peers}));

const sendPresenceNow=(who,event,kind=classify(event))=>
  tracked(kind,poke('glurff','glurff-action',{op:'presence-event',peers:[who],body:JSON.stringify(event)}));
/* At most one in-flight snapshot plus its newest replacement per route. */
const snapshots=latestSender(sendPresenceNow);
if(typeof window!=='undefined')window.addEventListener('glurff-exit',()=>snapshots.close());
export const sendPresence=(who,event)=>{
  const kind=event?.kind==='state' && event.here && fallbackMark ? 'movement-fallback' : classify(event);
  const key=who+'/'+event.origin+'/'+event.viewer;
  if(event.kind==='state' && event.here){snapshots.put(key,who,event,kind);return Promise.resolve();}
  /* A room-mate's state, like a snapshot: only the newest one per recipient matters. */
  if(event.kind==='room-state'){snapshots.put(who+'/room-state',who,event,kind);return Promise.resolve();}
  if(event.kind==='state')snapshots.cancel(key);
  return sendPresenceNow(who,event,kind);
};

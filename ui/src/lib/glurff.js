/* Talking to our own %glurff agent.
 *
 * Every action carries the peer set, because the agent keeps no membership of
 * its own -- it is a fan-out with almost no memory, and the client is what
 * decides who should hear us. That set is the official world's live members.
 */
import { latestSender } from 'lib/motion';
import { api, poke, subscribe, our } from 'lib/api';
import { glurffAudience } from 'lib/noltbook';
import { WORLD_ID } from 'lib/world-config';
import { trafficStart, recordCallQuota, diagnostic } from 'lib/diagnostics';
import { CONTROL_ACK_MS } from 'lib/connection';

/* Every Urbit poke is counted by what it is FOR. "presence-event" alone covered
 * discovery, call control, world events and positions, which is why a stalled
 * capture could not say which of them was the problem. */
const tracked = (kind, p) => {
  const done = trafficStart(kind);
  return Promise.resolve(p).then((v) => { done(true); return v; }, (e) => { done(false); throw e; });
};
const ACTION_CLASS = {
  move: 'legacy-movement', leave: 'legacy-movement', dress: 'avatar', 'fetch-look': 'avatar', 'unlock-equipment': 'avatar',
  claim: 'room-control', release: 'room-control', lock: 'room-control', knock: 'room-control',
  lease: 'room-control', unlease: 'room-control',
  splash: 'world-event', roll: 'world-event', 'ensure-commons': 'note-install',
  prefs: 'settings',
};
const classify = (event) => {
  const k = event?.kind;
  if (k === 'state') return event.here === null ? 'presence-departure' : 'presence-snapshot';
  if (k === 'query' || k === 'cut' || k === 'cancel') return 'presence-discovery';
  if (typeof k === 'string' && k.startsWith('call-')) return 'call-control';
  if (typeof k === 'string' && k.startsWith('player-')) return 'player-state';
  if (k === 'room-state') return 'room-state';
  if (typeof k === 'string' && k.startsWith('room-')) return 'room-list';
  if (k === 'shot' || k === 'arrow' || k === 'arrow-hit' || k === 'strike' || k === 'strike-hit' || k === 'wave' || k === 'nock') return 'world-event';
  return 'presence-other';
};

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
/* One poke per shot/hit, regardless of the number of viewers. The agent does
 * the fan-out; arrows themselves are never streamed or persisted. */
/* An emote, an arrow, a hit: live, so over the relay to whoever is on it. */
export const sendWorldEffect = (peers, event) => {
  if (!peers.length) return Promise.resolve();
  if (live) return sendLive(peers, {...event, world: WORLD_ID}, 'world-event');
  return tracked('world-event', poke('glurff','glurff-action',
    {op:'presence-event',peers,body:JSON.stringify({...event,world:WORLD_ID})}));
};
/* One live body to several ships over the relay. Somebody who is not on it
 * does not get it; if NOBODY could, the caller hears so, and can say the
 * message was not delivered rather than pretend. */
function sendLive(peers, body, kind) {
  let sent = 0;
  for (const who of peers) if (live.has(who) && live.send(who, body)) sent++;
  const done = trafficStart('live:' + kind); done(sent > 0);
  return sent || !peers.length ? Promise.resolve(sent) : Promise.reject(new Error('Reconnecting'));
}
export const fetchLook = (who) => act('fetch-look', { who });
/* The Library's secret was said: weapons and the rest are ours to choose (lib/unlock). */
export const unlockEquipment = () => act('unlock-equipment');
export const claimRoom = (place) => act('claim', { place });
export const releaseRoom = (place) => act('release', { place });
/* THE LEASE. One room, held for one of our own Noltbook notes, until we give
 * it back. It lives in the agent so it outlives the tab. */
export const takeLease = (place, note) => act('lease', { place, note });
/* EVERY CALL ON THE GLURFF'S HOST (2026-10-31). Every room's call and every
 * huddle's is held on the ship that created the Glurff's note, and its agent
 * decides everything about them. These reach it through our own agent -- or
 * are answered by our own agent, when we are that host.
 *
 * Ask for credentials to the call at `place`: agent to agent, over Ames, which
 * is where the credential comes back from anyway. */
export const callKnock = (host, place, attempt, mode) =>
  tracked('call-control', poke('glurff', 'glurff-action', { op: 'call-knock', host, place, attempt, mode, peers: [] },
    { ackTimeout: CONTROL_ACK_MS }));
/* We have left that call. */
export const callLeave = (host, place) =>
  tracked('call-control', poke('glurff', 'glurff-action', { op: 'call-leave', host, place, peers: [] }));
/* Moderate that call -- `mod` is promote, demote, mute, unmute, boot, unboot,
 * record-start or record-stop -- or, with 'sync', ask for its record. `inc` is
 * the run of the call our record is about, so a request about a call that has
 * since started over does nothing. */
export const callMod = (host, place, inc, target, mod) =>
  tracked('call-operation', poke('glurff', 'glurff-action', { op: 'call-mod', host, place, inc, target, mod, peers: [] }));
/* As the member a huddle elected: who is in it, so the host lets them -- and
 * nobody else -- into its call. */
export const callRoster = (host, place, ships) =>
  tracked('call-operation', poke('glurff', 'glurff-action', { op: 'call-roster', host, place, ships, peers: [] }));
/* Somebody's standing in the Glurff changed in its note -- muted, unmuted,
 * blocked: ask the host to put it into effect in every call now (2026-10-31). */
export const callRecheck = (host, who) =>
  tracked('call-operation', poke('glurff', 'glurff-action', { op: 'call-recheck', host, who, peers: [] }));
/* THE DOOR of the room we lease: the note's members and how open it is. Our
 * agent tells the members which note it is; a secret note's id never goes on
 * the relay. */
export const leaseDoor = (vis, members) =>
  tracked('room-control', poke('glurff', 'glurff-action', { op: 'lease-door', vis, members, peers: [] }));
/* Ask a room's lease owner which note it is -- or be told it is private. */
export const leaseAsk = (host, place) =>
  tracked('room-control', poke('glurff', 'glurff-action', { op: 'lease-ask', host, place, peers: [] }));
/* This browser session asking to be, or to stay, the ship's live one. */
export const session = (tab, take) =>
  tracked('session', poke('glurff', 'glurff-action', { op: 'session', tab, take: !!take, peers: [] }));
export const dropLease = () => act('unlease', {});
/* Our tab's seat in somebody's leased room. `host` owns the lease; our agent
 * carries it to theirs, which is the authority on who is in the room. */
export const seat = (host, place, gen, tab, what) =>
  act('seat', { host, place, gen, tab, what });
export const knock = (host, place) => act('knock', { host, place });
export const splash = (target) => act('splash', { target });
/* Our own settings, kept by our agent so they follow us to any browser: the
 * clocks in the sky, our time zone. Nobody else is sent them. */
export const savePrefs = (text) =>
  tracked('settings', poke('glurff', 'glurff-action', { op: 'prefs', text, peers: [] }));
export const roll = (place, stage) => act('roll', { place, ...stage });

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

export const watchWorld = (onFact) => subscribe('glurff', '/world', onFact);
/* THE WORLD'S SPOTS: which app each spot opens, as the world's host set them.
 * Through our own agent, which watches the host's for us: a page cannot take
 * facts from another ship's agent itself. */
export const watchSpots = (host, onSpots) =>
  subscribe('glurff', `/spots/${host}`, (name, p) => { if (name === 'spots' || name === 'spot-webs') onSpots(name, p); });
export const watchCallAccess = (onFact) => subscribe('glurff', '/call-access', (name,p) => {
  // Diagnostics share the existing owner-local channel but never reach either
  // call controller: a late quota detail must not change media or retry state.
  if(name==='call-quota'){recordCallQuota(p,our);return;}
  onFact(name,p);
});

/* Ordinary room messages and games: transient relay, never Noltbook notes. */
export const sendRoomEvent = (place, event, peers) => {
  const body=JSON.stringify({...event,world:WORLD_ID});
  if(new TextEncoder().encode(body).length>8192)return Promise.reject(new Error('Message too long'));
  /* Room chat is live too: over the relay, wrapped so the receiver can tell
   * it from a presence event. */
  if(live)return sendLive(peers,{kind:'room-chat',place,event:{...event,world:WORLD_ID},world:WORLD_ID},'room-event');
  return tracked('room-event', poke('glurff','glurff-action',{op:'room-event',place,body,peers}));
};

const sendPresenceNow=(who,event,kind=classify(event))=>
  tracked(kind,poke('glurff','glurff-action',{op:'presence-event',peers:[who],body:JSON.stringify({...event,world:WORLD_ID})},
    kind==='call-control'?{ackTimeout:CONTROL_ACK_MS}:undefined));
/* At most one in-flight snapshot plus its newest replacement per route. */
const snapshots=latestSender(sendPresenceNow);
if(typeof window!=='undefined')window.addEventListener('glurff-exit',()=>snapshots.close());
/* RELAY FIRST, AND NO AMES BACKUP FOR LIVE DATA.
 *
 * Everything live goes over the world's relay -- the movement session everyone
 * is connected to -- when the ship it is for is there. Only a few things may
 * still go ship to ship over Ames:
 *
 *   discovery   the presence query/answer that finds the relay in the first
 *               place, for a ship not on ours yet;
 *   answers     a refusal, an error or a "wait" for a call request that
 *               arrived over Ames, so the asker is not left guessing.
 *
 * Anything else for a ship not on the relay is not sent: a second, slower copy
 * of live data is what made two paths disagree. A secret note's id never goes
 * on the relay at all -- the relay is not end-to-end encrypted; it reaches the
 * note's members from the owner's agent instead. */
let live=null;                         //  {has(ship), send(ship, body)}
export const setLiveChannel=l=>{live=l;};
const AMES_KINDS=new Set(['query','state','cut','cancel','call-refused','call-error','call-wait']);
const unrouted=new Map();
function liveBody(event){
  const body={...event,world:WORLD_ID};
  if(event?.kind==='room-roster' && event.vis==='secret' && 'note' in body)delete body.note;
  return body;
}
export const sendPresence=(who,event)=>{
  if(live?.has(who) && live.send(who,liveBody(event))){
    const done=trafficStart('live:'+classify(event));done(true);
    if(event?.kind==='state')snapshots.cancel(who+'/'+event.origin+'/'+event.viewer);
    return Promise.resolve();
  }
  if(!AMES_KINDS.has(event?.kind)){
    const key=who+'/'+event?.kind,at=Date.now();
    if(!(at-(unrouted.get(key)??0)<10000)){unrouted.set(key,at);if(unrouted.size>256)unrouted.delete(unrouted.keys().next().value);
      diagnostic('live-unrouted',{who,kind:String(event?.kind??'')});}
    return Promise.reject(new Error('Not on the relay'));
  }
  const kind=classify(event);
  const key=who+'/'+event.origin+'/'+event.viewer;
  if(event.kind==='state' && event.here){snapshots.put(key,who,event,kind);return Promise.resolve();}
  /* A room-mate's state, like a snapshot: only the newest one per recipient matters. */
  if(event.kind==='room-state'){snapshots.put(who+'/room-state',who,event,kind);return Promise.resolve();}
  if(event.kind==='state')snapshots.cancel(key);
  return sendPresenceNow(who,event,kind);
};

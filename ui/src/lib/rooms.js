import { CallController } from 'lib/call-controller';
import { diagnostic } from 'lib/diagnostics';
import { processMicrophone } from 'lib/noise';
import { createMicHealth, MIC_CHECK_MS } from 'lib/mic-health';
/* Room calls.
 *
 * Walking into a room joins its call, and every room's call and every huddle's
 * is held on the GLURFF'S HOST (2026-10-31): the ship that created the
 * Glurff's note, which keeps the world room too. Its agent lets people in and
 * keeps each call's moderation, so no browser of anybody's has to be open for
 * either. Whoever starts a call is its admin; the Glurff's host and its
 * moderators are admins of every call. A room leased to a note is the one
 * exception: its call is the note's own (lib/notecall).
 *
 * A room still has a KEEPER -- the first one in, as presence agrees -- who
 * keeps its guest list (lib/roommates): who can see whom through its walls, and
 * which note it is leased to. That is all a keeper does now; it hosts nothing
 * and nobody is shown as one.
 */
import * as G from 'lib/glurff';
import { our } from 'lib/api';
import { displayName, visiblePeers, palStatus, worldMember, worldBanned, noteCreator, nb, onChange as onNoltbook, nbAction, noteCallRole, noteCallMuted, noteCallBooted, noteCallRecording, noteModerate, noteVisibility, requestRemoteNotes, inNote, noteFacts, glurffMuted } from 'lib/noltbook';
import { subscribeRaw } from 'lib/api';
import { createRoommates } from 'lib/roommates';
import { SfuSession } from 'lib/sfu';
import { regionAt, COMMONS } from 'world/places';
import { clusterPeers, agreedMembers, electHost, huddleKey, huddlePlace, HUDDLE_BASE } from 'lib/huddle';
import { micConstraints, camConstraints, refreshDevices } from 'lib/devices';
import { createModeration } from 'lib/moderation-session';
import { roleOf, rankOf, mayModerate, isMuted, isCallMuted, isBooted, mayPlay, recordingOf } from 'lib/moderation';
import { WORLD_HOST } from 'lib/world-config';
import { createRecorder, canRecord } from 'lib/recording';
import { createNoteCall } from 'lib/notecall';

export const rooms = {
  /* room id -> { host, occupants:Set } , derived from presence every tick. */
  live: new Map(),
  /* The room we are in, and the host we believe holds it. */
  here: COMMONS,
  host: null,
  voice: 'idle',
  error: null,
  /* A single publication that could not be sent, {kind, reason}: the camera
   * or screen, never the call as a whole. */
  mediaError: null,
  /* Our microphone is on but sending no sound, and reopening it did not help:
   * 'ended' | 'muted' | 'paused' | 'silent'. See lib/mic-health. */
  micTrouble: null,
  /* The room we are standing in is leased to a note we are not a member of:
   * {place, host}. Its call is not ours to ask for. */
  privateRoom: null,
  /* Somebody who should be in the call with us is not, and repair did not
   * bring them: {missing:[ships], failed:true}. See watchAlone. */
  callHealth: null,
  streams: new Map(),        //  ship -> MediaStream, from the SFU
  remoteStreams: new Map(),  // SFU stream id -> {ship, stream, label}
  localStreams: new Map(),   //  'cam' | 'screen' -> our own stream, for self-preview
  micOn: false,
  camOn: false,
  screenOn: false,
  /* A call is being held back until positions can be trusted. */
  waiting: false,
  /* What a call that has not connected is waiting on: 'waiting-ship' is our own
   * ship not having taken the request yet, 'waiting-host' is the Glurff's host
   * not answering. Everything else is the call's own phase. */
  stage: 'idle',
  /* Other ships actually in the call with us, as the call server reports. */
  others: 0,
  /* MODERATION, as the Glurff's host keeps it; see lib/moderation. `role` is
   * ours in this call -- 'host', 'mod', 'admin' or null; everybody sees all
   * three as "admin" -- and the two flags are what an admin has done TO US.
   * `recording` is whoever is recording, for the notice everybody sees. */
  /* THE LEASE we hold: {place, note} or null. One at a time, by rule. */
  lease: null,
  mod: null,
  role: null,
  mutedByAdmin: false,
  /* Muted across the whole Glurff by its note, rather than in this call. */
  mutedInGlurff: false,
  bootedByAdmin: false,
  recording: null,
};
if (typeof window !== 'undefined') window.rooms = rooms;

let sfu=null, controller=null, huddle=null, lastPeers=new Map();
let moderation=null, recorder=null, noteCall=null;
/* Keep live SFU publications while membership updates catch up. A temporarily
 * unknown participant is silent/hidden, then restored without renegotiating. */
const receivedStreams=new Map();
const mayReceiveMedia=ship=>worldMember(our) && palStatus(ship)!=='blocked' && !worldBanned(ship) &&
  (!!noteCall?.note() || worldMember(ship));
const subscribeNoltbook=(path,fn)=>subscribeRaw('noltbook',path,fn);
/* The video tiles on screen, for the recorder's picture. The rail owns them;
 * this keeps the recorder from reaching into the DOM on its own. */
let callTiles=()=>[];
export const setCallTiles=fn=>{callTiles=fn;};
/* Movement-session grants arrive on the same /call-access path as call grants.
 * They belong to the movement relay, never to a call, so they are handed over
 * before the call controller can see them. */
let movementResult=null;
export const setMovementResultHandler=fn=>{movementResult=fn;};
/* Whether positions are good enough to decide calls on, supplied by the
 * movement layer. The defaults keep this module usable on its own. */
/* Movement's readiness, as separate decisions (see lib/movement readiness):
 * `ready` -- may we START a call or form a huddle; `roster` -- may we CHANGE
 * who is in one or who hosts it. Keeping a call we are in is never gated. A
 * gate that only says `ready` answers both. */
/* Per-ship reachability (lib/reachability), supplied by the app. Optional:
 * every use is `reach?.`, so rooms work without it. */
let reach=null;
export const setReachability=r=>{reach=r;};
/* Requests whose answer proves the host can hear us. */
const ASKS=new Set(['call-request','call-huddle-sync','room-hello']);
const sendAsking=(to,e)=>{
  if(ASKS.has(e?.kind))reach?.asked(to);
  const p=G.sendPresence(to,e);
  /* The last control message our own ship accepted, for the call timeline. */
  if(typeof e?.kind==='string' && e.kind.startsWith('call-'))
    Promise.resolve(p).then(()=>{lastControl={...lastControl,out:{kind:e.kind,who:to,at:Date.now()}};},()=>{});
  return p;
};
/* What the person should be told about the host they are waiting on -- the
 * Glurff's host, or a leased room's note's -- if the trouble is the path to
 * them rather than slowness. */
export const hostReach=()=>{const h=controller?.current?.host??rooms.host;return h && h!==our?reach?.status(h)??null:null;};
/* The ship our Glurff call is on -- the Glurff's host -- or null. */
export const callHost=()=>controller?.current?.host??null;
let positionGate={ready:()=>true,roster:null,reliable:()=>true,confidence:()=> 'live-stationary'};
export const setPositionGate=gate=>{positionGate={...positionGate,...gate};};
const rosterReady=()=>(positionGate.roster??positionGate.ready)();
/* The room's guest list and who can see into it; see lib/roommates. Its view
 * of us -- our state, and who already sees us through presence -- is supplied
 * by main.js, which owns both. */
let mates=null;
let roomContext={here:()=>null,watchers:()=>new Set()};
export const setRoomContext=context=>{roomContext={...roomContext,...context};};
const mateListeners=new Set();
export const onRoommates=fn=>{mateListeners.add(fn);return()=>mateListeners.delete(fn);};
let roomCallSyncQueued=false;
/* A lease is part of the room roster, so it can change without the local
 * lease action running -- most importantly for every guest when the owner
 * releases it. Re-select after the roster mutation finishes: a leased room
 * uses the note call; an ordinary room uses Glurff's call. */
function queueRoomCallSync() {
  if(roomCallSyncQueued)return;
  roomCallSyncQueued=true;
  Promise.resolve().then(()=>{
    roomCallSyncQueued=false;
    if(!mates || rooms.here===COMMONS || !rooms.host)return;
    const bound=leaseNote(rooms.here,rooms.host);
    const active=noteCall?.note()??null;
    if(bound===active)return;
    /* Both null means an ordinary call already selected. Any other mismatch
     * is a real transition between the two call systems. */
    if(!bound && !active)return;
    diagnostic('room-lease-call',{place:rooms.here,host:rooms.host,
      reason:bound?'leased':'released'});
    if(active)noteCall.leave();
    controller?.select(null);
    selectCall(rooms.here,rooms.host);
    changed();
  });
}
/* Where each peer was last seen standing. The body point may keep somebody in
 * a room they are already in; it must never put them in one they have not
 * walked into, so the answer depends on where they were. See regionAt. */
const peerRooms=new Map();
function roomOfPeer(who,spot){
  const was=peerRooms.get(who)??COMMONS;
  const now=regionAt(spot.x,spot.y,spot.scene,was);
  if(now!==was)peerRooms.set(who,now);
  return now;
}
export const forgetPeerRoom=(who)=>peerRooms.delete(who);
/* Presence reports the room transition after the local collision/hysteresis
 * decision has settled. Prefer that decision over re-running geometry against
 * rounded or stalled relay coordinates. Older clients omit it and keep the
 * coordinate fallback. */
function settledRoomOfPeer(who,peer){
  const spot=peer?.spot??peer;
  const place=peer?.chatPlace;
  const scene=spot?.scene??'main';
  const valid=Number.isSafeInteger(place) && place>=COMMONS &&
    (scene==='vatican'?place===900:place<=15);
  if(valid){peerRooms.set(who,place);return place;}
  return roomOfPeer(who,spot);
}
export const roomOf=(who,spot,chatPlace)=>settledRoomOfPeer(who,{spot,chatPlace});
const isRoomPlace=place=>Number.isSafeInteger(place) && place>COMMONS && place<1000;
/* Rooms and huddles both keep a guest list; see lib/roommates. */
const isListPlace=place=>Number.isSafeInteger(place) && place>COMMONS && place<HUDDLE_BASE+900000;
function createMates(){
  return createRoommates({our,send:sendAsking,trace:diagnostic,
    blocked:who=>palStatus(who)==='blocked',
    member:worldMember,
    /* Asking a keeper for its list is asking to be on it. A room's list takes
     * anybody the room would; a huddle's, only its members. */
    accepts:(who,place)=>place>=HUDDLE_BASE
      ? huddle?.place===place && huddle.host===our && huddle.members.includes(who)
      : rooms.here===place && admitsToRoom(who,place),
    here:()=>roomContext.here(),
    standing:()=>rooms.here,
    watchers:()=>roomContext.watchers(),
    changed:why=>{gateEpoch++;queueRoomCallSync();for(const fn of mateListeners){try{fn(why);}catch(e){console.error(e);}}
      /* The list says who belongs in the call; a change can make somebody expected. */
      try{watchAlone();}catch{}},
  });
}
/* MAY THIS SHIP BE ON THIS ROOM'S LIST?
 *
 * An ordinary room admits world members. A LEASED room
 * does not get to answer at all: its note decides, because the note is what
 * the room now is. Without this the host's guest list admitted anybody who
 * asked, so somebody who is not in a private note turned up on the room's list
 * the moment their client asked to join the call -- which it does whenever it
 * has not yet heard that the room is leased.
 *
 * Noltbook remains the authority; this only stops us listing people it would
 * refuse. Membership we have not learned yet is not membership. */
function admitsToRoom(who,place){
  if(!worldMember(who))return false;
  const note=leaseNote(place,our);
  if(!note)return true;
  const n=nb.notes[note];
  if(!n)return false;
  return (n.users??[]).includes(who);
}

/* ------------------------------------------------------------- the lease */

/* A room is leased when somebody has bound it to one of their own Noltbook
 * notes. While they hold it the room's chat IS that note, saved, and the
 * note's own settings decide who may take part.
 *
 * You hold at most one. Taking another replaces it, and the UI asks first. */
export function setLease(lease, { reselect = true } = {}) {
  const next = lease && Number.isSafeInteger(lease.place) && typeof lease.note === 'string'
    ? { place: lease.place, note: lease.note, gen: Number.isSafeInteger(lease.gen) ? lease.gen : 0 }
    : null;
  /* The GENERATION counts as a difference. Re-leasing the same room to the same
   * note mints a new one, and every seat and in-flight message about the old
   * one is now about a lease that no longer exists -- so our own seat has to be
   * retaken rather than silently renewed against a dead generation. */
  const same = (rooms.lease?.place ?? null) === (next?.place ?? null) &&
               (rooms.lease?.note ?? null) === (next?.note ?? null) &&
               (rooms.lease?.gen ?? 0) === (next?.gen ?? 0);
  if (same) return;
  const was = rooms.lease;
  rooms.lease = next;
  /* Our seat was in the old incarnation. Let it go rather than renew it into a
   * generation the owner's agent will refuse. */
  if (seated && (was?.gen ?? 0) !== (next?.gen ?? 0)) dropSeat();
  /* TAKING A ROOM IS OCCUPYING IT. The owner is an occupant like anybody else,
   * and their seat must not wait on the call being selected -- that needs
   * trustworthy positions, and the lease is what keeps the room theirs whether
   * or not a call has started. */
  if (next && next.place === rooms.here) takeSeat(rooms.here, our);
  diagnostic('room-lease', { place: next?.place ?? 0, reason: next ? 'held' : 'released' });
  /* Our own list carries it, so everyone who can see us learns of it. */
  if (mates && rooms.here !== COMMONS && rooms.host === our) republishLease();
  /* Taking or giving back the lease on the room we are STANDING IN changes
   * which call this room has: the note's, or Glurff's own. Move to it rather
   * than waiting for somebody to walk out and back in. */
  if (reselect && (next?.place === rooms.here || was?.place === rooms.here) && rooms.here !== COMMONS && rooms.host) {
    const to = rooms.host;
    if (noteCall?.note()) noteCall.leave();
    controller?.select(null);
    selectCall(rooms.here, to);
  }
  changed();
}
/* ------------------------------------------------- our seat in a leased room */

/* A LEASE LASTS AS LONG AS SOMEBODY IS IN THE ROOM.
 *
 * The owner's agent is the authority on that, not any browser -- the whole
 * point is that the lease survives the owner closing Glurff. Each tab in the
 * room registers a seat with that agent and renews it slowly; a seat nobody
 * renews expires, which is how a crash is noticed without anybody reporting
 * it. See the occupancy section of app/glurff.hoon.
 *
 * The tab id is per TAB and not per ship: two tabs, or a reload whose old seat
 * has not yet expired, must not be mistaken for each other. */
const TAB = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID() : String(Math.random()).slice(2);
export const seatTab = () => TAB;
/* Renewed well inside the agent's seat TTL, so one dropped poke is not an
 * eviction. Kept in step with the agent's own seat-renew. */
const SEAT_RENEW_MS = 15000;
let seated = null;        //  {host, place, gen} -- the seat we are holding
let seatTimer = null;

/* The generation the owner's agent admitted us to, which is the one our
 * renewals and our eventual leave must name. */
export function seatAdmitted(place, gen) {
  if (!seated || seated.place !== place || !Number.isSafeInteger(gen) || gen <= 0) return;
  seated.gen = gen;
}

function sendSeat(what) {
  if (!seated) return;
  G.seat(seated.host, seated.place, seated.gen ?? 0, TAB, what).catch(() => {});
}

/* Take a seat in this leased room, or keep the one we have. Idempotent: the
 * same room and owner is a renewal, not a second seat. */
function takeSeat(place, host) {
  if (!isRoom(place) || !host) return;
  const gen = leaseAt(place, host).gen ?? 0;
  if (seated && seated.place === place && seated.host === host) {
    /* The roster may have told us the generation only after we sat down. */
    if (gen > 0 && !seated.gen) seated.gen = gen;
    return;
  }
  dropSeat();
  seated = { host, place, gen };
  sendSeat('enter');
  seatTimer = setInterval(() => sendSeat('renew'), SEAT_RENEW_MS);
  diagnostic('room-seat', { place, host, gen, reason: 'enter' });
}

/* Give up our seat. Only ours: this can never release somebody else's lease. */
function dropSeat() {
  if (seatTimer) { clearInterval(seatTimer); seatTimer = null; }
  if (!seated) return;
  const was = seated;
  sendSeat('leave');
  seated = null;
  diagnostic('room-seat', { place: was.place, host: was.host, gen: was.gen ?? 0, reason: 'leave' });
}
export const seatHeld = () => (seated ? { ...seated } : null);

/* THE LEASE WE WERE SITTING IN HAS ENDED, and its owner said so directly --
 * which is the only way we could hear it once their browser is closed. Forget
 * the note, give up the seat, and let the room become an ordinary room with an
 * ordinary Glurff call. */
export function leaseGone(host, place, gen) {
  if (!isRoom(place) || !host) return false;
  const forgot = mates?.leaseGone?.(host, place, gen) ?? false;
  if (seated && seated.place === place && seated.host === host) dropSeat();
  /* A private room we were shut out of is an ordinary room again. */
  const wasPrivate = rooms.privateRoom?.place === place && rooms.privateRoom.host === host;
  if (wasPrivate) clearPrivate();
  if (!forgot && !wasPrivate) return false;
  diagnostic('room-lease', { place, host, reason: 'gone' });
  /* Standing in it: move to what the room now is, rather than waiting for
   * somebody to walk out and back in. */
  if (rooms.here === place) {
    if (noteCall?.note()) noteCall.leave();
    controller?.select(null);
    selectCall(place, roomHost(place));
  }
  changed();
  return true;
}
/* A tab closing says goodbye if it can, but NOTHING depends on it arriving:
 * the seat expires on the agent's own clock either way. This only makes an
 * ordinary departure quick. */
if (typeof window !== 'undefined')
  window.addEventListener('glurff-exit', () => { try { dropSeat(); } catch {} });

/* THE DOOR, from our agent. Whenever our lease or its note's members change,
 * the agent is told who they are; it tells them which note the room is, and
 * answers them when they ask. See %lease-door in app/glurff.hoon. */
let saidDoor='';
function pushDoor(){
  const note=rooms.lease?.note??null;
  if(!note){saidDoor='';return;}
  const vis=noteVisibility(note)??'private';
  const members=(nb.notes[note]?.users??[]).filter(s=>s!==our && worldMember(s)).sort().slice(0,256);
  const key=JSON.stringify([rooms.lease.place,note,rooms.lease.gen??0,vis,members]);
  if(key===saidDoor)return;
  saidDoor=key;
  Promise.resolve(G.leaseDoor?.(vis,members)).catch(()=>{saidDoor='';});
}
function republishLease() {
  pushDoor();
  const note = rooms.lease?.place === rooms.here ? rooms.lease.note : null;
  /* The note's own visibility travels with it: it is what tells everybody
   * else whether this room is open, asks first, or is closed. */
  mates?.setNote?.(note, note ? noteVisibility(note) : null,
    note ? (rooms.lease?.gen ?? 0) : 0);
  if (rooms.here === COMMONS) return;
  if (note) {
    /* THE ROOM'S LIST IS THE NOTE'S MEMBERS.
     *
     * A leased room's call is Noltbook's, so nobody ever asks Glurff to join
     * it and nothing would otherwise put a single person on this list. The
     * list is what carries the note's id to the people who are entitled to
     * it -- and for a SECRET note it is the only thing that does, because its
     * id never rides presence. Without it two members of one secret note
     * stood in the same room and could not see each other. */
    mates?.setMembers?.((nb.notes[note]?.users ?? []).filter((s) => s !== our && worldMember(s)),
      occupantsOf(rooms.here));
    return;
  }
  /* No longer the note's: anybody on the list who may not be there comes off,
   * here and on everybody else's copy of the list. */
  mates?.keepOnly?.((who) => admitsToRoom(who, rooms.here));
}
/* The note a room is leased to, from where we are standing: our own lease, or
 * the lease of the copy we are following. Null means an ordinary room. */
export function leaseNote(place = rooms.here, host = rooms.host) {
  if (!isRoom(place)) return null;
  if (rooms.lease?.place === place && host === our) return rooms.lease.note;
  return mates?.noteOf?.(place, host) ?? null;
}
/* The whole lease as we can see it: the note, and how open it is. A room
 * leased to a SECRET note answers `{note: null, vis: 'secret'}` -- closed, and
 * nothing else, because its id never travels. */
export function leaseAt(place = rooms.here, host = null) {
  if (!isRoom(place)) return { note: null, vis: null };
  if (rooms.lease?.place === place)
    /* WITH ITS GENERATION. Without it our own seat entered as generation 0 --
     * which the agent allows only for an enter -- so every renewal afterwards
     * was refused and the owner's own seat expired and stayed expired. */
    return { note: rooms.lease.note, vis: noteVisibility(rooms.lease.note),
             gen: rooms.lease.gen ?? 0 };
  /* WHOEVER HOLDS IT, not whoever we happen to be following. A stranger who
   * walks into a room somebody else leased is not on that host's list and may
   * not be following them at all -- but the room is still leased, and saying
   * otherwise is how a stranger ended up unable to join a public note. */
  const named = host ?? rooms.host;
  const mine = named ? mates?.leaseOf?.(place, named) : null;
  if (mine?.note || mine?.vis) return mine;
  const holder = hostSeenIn(place);
  return holder ? mates?.leaseOf?.(place, holder) ?? { note: null, vis: null }
                : { note: null, vis: null };
}
/* Somebody else's leased room: ask their ship about it the way Noltbook does,
 * so we can show its name and description before anybody joins. One request
 * per host, not one per look. */
const asked = new Set();
/* A room shut to us: leased to somebody's SECRET note, and we are not in it. */
/* THE DOOR TABLE. Whether a room is shut to us, and what its door says, was
 * worked out from scratch on every frame -- the room covers ask for every room
 * and the doorway check for up to 48 points around us -- and each answer
 * rebuilt lists by scanning every visible person's room report. The answers
 * only change when rooms, lists, leases or notes do, so they are kept until
 * one of those changes (gateEpoch) and never longer than a second, which also
 * covers an invitation quietly expiring. */
let gateEpoch=0;
const GATE_MAX_AGE_MS=1000;
const gateCache=new Map();
let gateCacheEpoch=-1,gateCacheAt=0;
function gated(kind,place,compute){
  const t=Date.now();
  if(gateCacheEpoch!==gateEpoch || t-gateCacheAt>=GATE_MAX_AGE_MS || t<gateCacheAt){
    gateCache.clear();gateCacheEpoch=gateEpoch;gateCacheAt=t;
  }
  const key=kind+place;
  if(gateCache.has(key))return gateCache.get(key);
  const value=compute();
  gateCache.set(key,value);
  return value;
}
export const roomClosed=(place)=>gated('c',place,()=>closedNow(place));
function closedNow(place) {
  if (!isRoom(place) || place === rooms.here) return false;
  if (rooms.lease?.place === place) return false;      //  our own room is never shut to us
  const { note, vis } = leaseAt(place);
  if (vis !== 'secret') return false;
  /* A member of the note is not a stranger to it. A secret note's id never
   * travels, so the only way we know one is by being in it. */
  return !(note && nb.notes[note]);
}
/* Whoever we can see holding a lease on that room. */
function hostSeenIn(place) {
  for (const [host, r] of mates?.instances?.(place) ?? new Map())
    if (host !== our && (r.vis || r.note)) return host;
  /* A room we have been handed the list for. Its host may be invisible to us
   * from out here -- a secret note's members are not necessarily pals -- but
   * they told us the room is ours to walk into. */
  return mates?.invitedTo?.(place) ?? null;
}
export const leaseHolder = (place = rooms.here) => hostSeenIn(place);

/* THE DOOR. A non-member never enters a leased room and only then discovers
 * its call cannot admit them. Secret rooms are simply shut. Public and private
 * rooms stop them at the doorway with enough information for Glurff to ask the
 * same JOIN / REQUEST JOIN question Noltbook asks on a profile card. */
export const roomGate=(place)=>gated('g',place,()=>gateNow(place));
function gateNow(place) {
  if (!isRoom(place) || place === rooms.here || rooms.lease?.place === place)
    return { blocked: false, place, note: null, visibility: null, host: null, facts: null };
  const lease = leaseAt(place);
  if (!lease.note && !lease.vis)
    return { blocked: false, place, note: null, visibility: null, host: null, facts: null };
  const host = leaseHolder(place);
  if (lease.vis === 'secret')
    return { blocked: roomClosed(place), place, note: null, visibility: 'secret', host, facts: null };
  const facts = lease.note ? noteFacts(host, lease.note) : null;
  if (lease.note && (inNote(lease.note) || facts?.member))
    return { blocked: false, place, note: lease.note, visibility: facts?.visibility ?? lease.vis,
      host, facts };
  return { blocked: true, place, note: lease.note,
    visibility: facts?.visibility ?? lease.vis ?? 'private', host, facts };
}
export const roomBlocked = (place) => roomGate(place).blocked;

export function learnLease(place = rooms.here, host = rooms.host, force = false) {
  const { note, vis } = leaseAt(place, host);
  if (!note || !host || host === our || nb.notes[note] || vis === 'secret') return Promise.resolve(false);
  if (!force && asked.has(host)) return Promise.resolve(false);
  asked.add(host);
  return requestRemoteNotes(host).then(() => true, () => false);
}
export const leasedNote = () => leaseNote();
/* Every note a room we can see is leased to. These are lease/chat metadata;
 * membership in a leased note does not grant membership in the world. */
export function leasedNotes(){
  const out=new Set();
  if(rooms.lease?.note)out.add(rooms.lease.note);
  const here=leaseNote();
  if(here)out.add(here);
  for(const [,r] of mates?.instances(rooms.here)??new Map())if(r.note)out.add(r.note);
  return [...out];
}
/* Whose note this is: the ship whose Noltbook allocates and mints its call. */
const noteHostOf=(note)=>noteCreator(note)??null;
/* Are we in a note's call rather than one of Glurff's own? */
export const inNoteCall=()=>!!noteCall?.note();
export const noteCallOf=()=>noteCall?.note()??null;

/* Can we take this room? Only a room, only for a note we made ourselves, and
 * only one at a time -- taking a second asks first, in the UI. */
export const canLease = (place = rooms.here) => isRoom(place);
export async function takeLease(note) {
  const place = rooms.here;
  if (!isRoom(place) || noteCreator(note) !== our) return false;
  await G.takeLease(place, note);
  setLease({ place, note });
  return true;
}
export async function releaseLease() {
  if (!rooms.lease) return false;
  const was = rooms.lease.place;
  await G.dropLease();
  setLease(null);
  if (was === rooms.here && rooms.host === our) republishLease();
  return true;
}

/* WHO IS IN THIS CALL, as the call server reports it -- not who is standing in
 * the region. A room's list is its call's list: walking up to a wall from
 * outside put people on a room's list who had never joined it, because the
 * list was being worked out from feet and geometry rather than from the call
 * they were or were not in. */
export const callPeers=()=>new Set([...(sfu?.others()??[])].filter(mayReceiveMedia));
/* AUDIO THE BROWSER REFUSED TO AUTOPLAY. A browser may refuse to start a
 * received stream until the person has interacted with the page, and it does
 * so silently: video plays, audio does not. The refusal is recorded (see
 * SfuSession.audioState) but nothing ever retried it. Any click, key or call
 * control is exactly the gesture the browser was waiting for, so try again
 * then -- cheaply, and only while something is actually waiting. */
export function resumeAudio(reason='gesture'){
  if(!sfu?.blocked?.())return 0;
  const tried=sfu.resume();
  diagnostic('room-audio',{reason:'resume:'+reason,count:tried});
  mark('autoplay',`resume:${reason}:${tried}`);
  return tried;
}
if(typeof window!=='undefined'){
  const onGesture=()=>{try{resumeAudio('gesture');}catch{}};
  window.addEventListener('pointerdown',onGesture,{capture:true,passive:true});
  window.addEventListener('keydown',onGesture,{capture:true});
}
/* Why each peer in this call is or is not audible. Read by the diagnostics
 * bundle and by the audio trace below; see SfuSession.audioState. */
export const callAudioState=()=>sfu?.audioState?.()??{};

/* AUDIBLE-BUT-SILENT is the fault this exists to catch: a stream whose video
 * is on screen while its volume sits at zero for a reason nobody can see.
 * Traced only when the answer CHANGES, so a steady call writes nothing, and
 * capped so a large room cannot flood the log. */
let audioSaid = '';
function traceRoomAudio(reason) {
  if (!sfu) return;
  const state = callAudioState();
  const ships = Object.keys(state).sort().slice(0, 24);
  if (!ships.length) { audioSaid = ''; return; }
  const rows = ships.map((s) => {
    const a = state[s];
    return `${s}:${a.track ? (a.live ? 'live' : 'ended') : 'none'}/${a.playing ? 'play' : a.started === false ? 'refused' : 'idle'}/${a.volume}${a.silenced ? '/muted' : ''}`;
  });
  const key = reason + '|' + rows.join(',');
  if (key === audioSaid) return;
  audioSaid = key;
  diagnostic('room-audio', { reason, place: rooms.here, count: ships.length,
    silent: rows.filter((r) => r.endsWith('/0') || r.includes('/0/')).length, detail: rows.join(' ') });
}
export const roomPeers=()=>mates?.peers()??new Map();
export const roomAudience=()=>mates?.audience()??new Set();
export const roomSummary=()=>mates?.summary()??null;
export const heardRooms=peers=>mates?.heard(peers);
export const introduceRoom=viewers=>mates?.introduce(viewers);
export const publishRoom=(only=null)=>mates?.publish(only);
export const receiveRoomEvent=(who,event)=>{
  /* A list from the host we asked is its answer. */
  if(event?.kind==='room-roster' && event.host===who)reach?.answered(who);
  return mates?.receive(who,event);
};
export const tickRoom=()=>{mates?.tick();pushDoor();askUnknownLeases();};
/* A SECRET LEASE WE CAN SEE BUT NOT READ: somebody's room is leased, and how
 * open it is rides the relay, but a secret note's id does not. Ask its owner's
 * ship -- well inside the life of the answer, so a member standing there keeps
 * their way through the door -- and be told the note, or that it is private. */
const LEASE_ASK_MS=45000;
const leaseAsked=new Map();      //  `${host}/${place}` -> ms asked
function askUnknownLeases(){
  const t=Date.now();
  for(const {host,place} of mates?.unknownLeases?.()??[]){
    if(!worldMember(host))continue;
    const key=`${host}/${place}`;
    if(t-(leaseAsked.get(key)??-Infinity)<LEASE_ASK_MS)continue;
    leaseAsked.set(key,t);
    if(leaseAsked.size>128)leaseAsked.delete(leaseAsked.keys().next().value);
    Promise.resolve(G.leaseAsk?.(host,place)).catch(()=>{});
  }
}
/* The owner's ship told us which note their room is. */
export function leaseInfo(who,place,note,vis,gen){
  if(!worldMember(who) || !mates?.leaseInfo?.(who,place,note,vis,gen))return false;
  if(rooms.privateRoom?.place===place && rooms.privateRoom.host===who){rooms.privateRoom=null;rooms.error=null;}
  diagnostic('room-lease',{place,host:who,reason:'info'});
  queueRoomCallSync();changed();
  return true;
}
/* The owner's ship told us their room is private to a note we are not in. */
export function leasePrivate(who,place){
  if(!worldMember(who) || !isRoom(place))return false;
  diagnostic('room-lease',{place,host:who,reason:'private'});
  rooms.privateRoom={place,host:who,at:Date.now()};
  if(rooms.here===place)closeToPrivate();
  changed();
  return true;
}
const PRIVATE_TEXT="This room is private to its note's members";
function clearPrivate(){rooms.privateRoom=null;if(rooms.error===PRIVATE_TEXT)rooms.error=null;}
/* Standing in somebody else's private room: no call to ask for, and said so. */
function closeToPrivate(){
  if(noteCall?.note())noteCall.leave();
  controller?.select(null);releaseMedia();
  rooms.voice='blocked';rooms.error=PRIVATE_TEXT;
  mark('private',`${rooms.privateRoom?.place??0}/${rooms.privateRoom?.host??''}`);
}
/* The Glurff's host turned our knock away, with why. */
export function receiveShipRefusal(who,place,attempt,why){
  receiveCallEvent(who,{kind:'call-refused',place,attempt,reason:String(why??'refused')});
}
/* THE GLURFF'S HOST told us a call's record: its admins, who is muted or
 * removed, and who is recording. Taken only from the host of the call we are
 * in, and only if it is newer; see lib/moderation-session. */
export function receiveModSnap(who,snap){
  if(!snap || typeof snap!=='object')return false;
  return moderation?.receive(who,snap)??false;
}
let listeners=new Set();
export const onRooms=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};

/* WHO IS TALKING (2026-10-20), for a mark on their tile. Polled while in a
 * call: a voice louder than SPEAKING_LEVEL marks its ship, and the mark
 * lingers SPEAKING_HOLD_MS so it does not flicker between words. Others'
 * loudness is the receivers' (lib/sfu levels); ours, our own microphone's.
 * Told on its own channel: a tile's ring changing is no reason to repaint
 * everything that listens to the rooms. */
export const SPEAKING_LEVEL=0.03, OWN_SPEAKING_LEVEL=0.02, SPEAKING_HOLD_MS=450, SPEAKING_POLL_MS=150;
rooms.speaking=new Set();
const speakListeners=new Set(),lastHeard=new Map();
export const onSpeaking=fn=>{speakListeners.add(fn);return()=>speakListeners.delete(fn);};
let meter=null;
function ownLevel(){
  const stream=published.mic?.stream;
  const live=rooms.micOn&&!!stream?.getAudioTracks().some(t=>t.enabled&&t.readyState==='live');
  if(!live){meter?.close();meter=null;return null;}
  if(meter?.stream!==stream){meter?.close();meter=makeMeter(stream);}
  return meter?.level()??null;
}
function makeMeter(stream){
  try{
    const Ctx=globalThis.AudioContext??globalThis.webkitAudioContext;if(!Ctx)return null;
    const ctx=new Ctx(),source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();
    analyser.fftSize=512;source.connect(analyser);
    const buf=new Float32Array(analyser.fftSize);
    return {stream,
      level(){if(ctx.state==='suspended')ctx.resume().catch(()=>{});analyser.getFloatTimeDomainData(buf);
        let sum=0;for(const v of buf)sum+=v*v;return Math.sqrt(sum/buf.length);},
      close(){try{source.disconnect();ctx.close();}catch{}}};
  }catch{return null;}
}
export function pollSpeaking(now=performance.now()){
  if(rooms.voice!=='connected'&&!rooms.speaking.size&&!lastHeard.size)return;
  if(rooms.voice==='connected'){
    for(const [ship,level] of sfu?.levels?.()??[])if(level>=SPEAKING_LEVEL&&!(rooms.blocked??[]).includes(ship))lastHeard.set(ship,now);
    const mine=ownLevel();if(mine!=null&&mine>=OWN_SPEAKING_LEVEL)lastHeard.set(our,now);
  }else{meter?.close();meter=null;lastHeard.clear();}
  for(const [ship,at] of lastHeard)if(now-at>=SPEAKING_HOLD_MS)lastHeard.delete(ship);
  const next=new Set(lastHeard.keys());
  if(next.size===rooms.speaking.size&&[...next].every(s=>rooms.speaking.has(s)))return;
  rooms.speaking=next;
  speakListeners.forEach(fn=>{try{fn(next);}catch(e){console.error(e);}});
}
if(typeof window!=='undefined')setInterval(()=>{try{pollSpeaking();}catch{}},SPEAKING_POLL_MS);
const changed=()=>{gateEpoch++;listeners.forEach(fn=>{try{fn();}catch(e){console.error(e);}});};

function selectRemoteCamera(ship) {
  const video=[...rooms.remoteStreams.values()].find(r=>r.ship===ship && !String(r.label).startsWith('screen') && r.stream.getVideoTracks().some(t=>t.readyState!=='ended'));
  if(video)rooms.streams.set(ship,video.stream);else rooms.streams.delete(ship);
}
function removeRemoteStream(id,ship) {
  receivedStreams.delete(id);
  rooms.remoteStreams.delete(id);selectRemoteCamera(ship);changed();
}

export function initRooms() {
  mates=createMates();
  if(typeof window!=='undefined')window.glurffRoomDiagnostics=()=>({...mates.stats(),current:mates.current(),
    huddle:huddle?{state:huddle.state,host:huddle.host,place:huddle.place,session:huddle.session,
      epoch:huddle.epoch,rev:huddle.rev,members:[...huddle.members],pending:huddlePending?.key??null,
      recovery:huddleRecovery?.tries??0}:null,
    call:controller?.diagnostics?.()??null,
    /* The newest of the call timeline; all of it is glurffCallTimeline(). */
    timeline:compactTimeline(),
    reach:reach?.stats?.()??null,
    /* What every audio stream is doing right now, both ways, and our own
     * microphone: which side of a silent call is silent. */
    audio:{peers:callAudioState(),media:sfu?.mediaState?.()??null,mic:micHealth?.state()??null,
      /* Our microphone: held in the call, and whether it is sending sound. */
      ours:{held:!!published.mic,sending:(published.mic?.stream.getAudioTracks()??[]).some(t=>t.enabled&&t.readyState==='live')}}});
  sfu=new SfuSession({our,
    /* Membership, never transient avatar visibility, controls ordinary call
     * streams. Leased calls also retain genuine Noltbook-only participants. */
    onStream:(ship,stream,meta={})=>{if(ship && ship!==our){
      receivedStreams.set(meta.id??stream.id,{ship,stream,label:meta.label??'camera'});
      applyPlayable(moderation?.record()??null,moderation?.call()??null);changed();
    }},
    onStreamRemoved:removeRemoteStream,
    onPeerLeft:ship=>{for(const [id,r] of receivedStreams)if(r.ship===ship)receivedStreams.delete(id);
      for(const [id,r] of rooms.remoteStreams)if(r.ship===ship)rooms.remoteStreams.delete(id);
      rooms.streams.delete(ship);changed();},
    onStatus:(status,why)=>{
      mark('sfu',`${status}${why?':'+why:''}`);
      /* In a leased room the call is Noltbook's, so the Glurff controller is
       * not the thing to tell. */
      if(noteCall?.note()){
        if(status==='connected'){rooms.voice='connected';rooms.error=null;noteCall.connected?.();restoreIntent();}
        /* A new incarnation's socket could not join; the one we are on is
         * still carrying the call. Stay on it and ask again, backed off. */
        else if(status==='handoff-failed'){diagnostic('note-call',{note:noteCall.note(),status:'handoff-failed',reason:why??''});noteCall.retry(why||status);}
        /* The old socket dropping while its replacement is joining is not a
         * failure: the replacement is what we are waiting for. */
        else if((status==='failed'||status==='closed') && sfu?.switching?.()){}
        /* Backed off inside noteCall, and bounded: a call server that keeps
         * dropping us is not re-asked on every drop. */
        else if(status==='failed'||status==='closed'){rooms.voice='retrying';noteCall.retry(why||status);}
        changed();refreshStage();return;
      }
      controller?.status(status,why);
    },
    onUsers:()=>{const others=callPeers();mates?.inCall(others);const n=others.size;if(n!==rooms.others){rooms.others=n;changed();}
      refreshCallMembership();watchAlone();},
    /* ONE PUBLICATION'S FATE, on its own. A camera or a screen that cannot be
     * sent is reported against that kind and nothing else: the call, and the
     * microphone in it, carry on. */
    onPublication:(id,state,reason)=>{
      const kind=['mic','cam','screen'].find(k=>published[k]?.id===id)??null;
      if(state==='answered'||state==='connected'){
        if(rooms.mediaError?.kind===kind){rooms.mediaError=null;changed();}
        return;
      }
      diagnostic('call-publication',{kind:kind??'',state,reason:reason??'',place:controller?.current?.place??0});
      mark('publication',`${kind??'?'}:${state}:${reason??''}`);
      if(state==='failed' && kind){rooms.mediaError={kind,reason:reason??'failed'};changed();}
    },
    /* A single WebRTC connection's own state: the socket can be fine while one
     * of these has failed. Only the transitions worth reading are recorded. */
    onPeerState:(id,direction,state,ice,ship)=>{
      if(!['connected','disconnected','failed'].includes(state) && ice!=='failed')return;
      diagnostic('call-peer-state',{direction,state,ice,who:ship??'',place:controller?.current?.place??noteCall?.note()??0});
      mark('peer',`${direction}:${state}/${ice}:${ship??''}`);
    },
    /* Audio that stopped flowing on a connection that still says connected,
     * and what the watchdog did about it. See MEDIA_STALL_MS in lib/sfu. */
    onMedia:(id,direction,state,ship)=>{
      diagnostic('call-media',{direction,state,who:ship??'',place:controller?.current?.place??noteCall?.note()??0});
      mark('media',`${direction}:${state}:${ship??''}`);
      /* The call tiles show who we are not hearing. */
      changed();
    },
    onPermissions:(may)=>{
      /* The call server withdrew the right to publish: a mute we may not have
       * heard about yet. Our own capture is left alone until the record says
       * so -- this only stops us offering into a refusal. */
      diagnostic('call-permissions',{present:!!may,place:controller?.current?.place??0});
      if(may && rooms.voice==='connected')restoreIntent();
      changed();
    },
  });
  /* Moderation is asked of the Glurff's host's ship, which decides, enforces
   * on the call server and tells everybody in the call. */
  moderation=createModeration({our,send:G.callMod,trace:diagnostic,
    enforce:applyModeration,
    changed:()=>{readModeration();changed();},
  });
  recorder=createRecorder({our,displayName,trace:diagnostic,
    tiles:()=>callTiles(),
    audioTracks:()=>recordableAudio(),
    changed:()=>{readModeration();changed();},
  });
  /* A LEASED ROOM'S CALL IS THE NOTE'S CALL, not one of ours: one room on the
   * call server with two doors into it, the world and Noltbook. See
   * lib/notecall. */
  noteCall=createNoteCall({our,trace:diagnostic,
    calls:()=>nb.calls??{},
    action:(a,data)=>nbAction(a,data),
    watch:(fn)=>subscribeNoltbook('/call-access',fn),
    onGrant:(grant)=>{
      if(!worldMember(our))return;
      rooms.host=noteHostOf(grant.noteId)??rooms.host;
      if(sfu?.refreshGrant?.(grant)===true)return;   //  a renewal of the same room
      /* A new incarnation of the note's call joins beside the live one. */
      sfu?.connect(grant,{overlap:true});
    },
    onStatus:(status,why)=>{
      mark('note-call',`${status}${why?':'+why:''}`);
      rooms.voice=status==='requesting'?'requesting':status==='failed'?'blocked':status==='ended'?'idle':rooms.voice;
      rooms.error=status==='failed'?(why??'refused'):null;
      changed();refreshStage();
    },
  });
  controller=new CallController({our,sfu,trace:diagnostic,
    /* Every request goes to the Glurff's host's SHIP -- our own agent, when we
     * are that host -- which decides it alone (+call-knock in app/glurff). */
    transport:{
      knock:(host,place,attempt,mode)=>{reach?.asked(host);return G.callKnock(host,place,attempt,mode);},
      leave:(host,place)=>G.callLeave(host,place)},
    changed:(phase,error)=>{
      mark('phase',`${phase}${error?':'+error:''}`);
      rooms.voice=phase;rooms.error=error;watchAlone();
      if(phase==='connected'){
        /* The call's record is the host's, and arrives as a snapshot; which
         * run of the call it is about is in the snapshot, not in anything we
         * could work out here. */
        const c=controller?.current;
        if(c)moderation?.enter({place:c.place,host:c.host});
        /* A reconnect throws away every publication the session held, so what
         * we think we are sending can outlive what is actually going out.
         * Forget those before restoring intent, or a reconnected call is
         * silent with the microphone button lit. */
        reconcilePublications();
        restoreIntent();
        rooms.timings={...rooms.timings,connected:performance.now()};
      }
      /* Going idle usually means the call is over and its moderation with it.
       * NOT while we are removed from a call we are still standing in: the
       * boot is what disconnected us, and dropping the record here would make
       * "allowed back in" unhearable. */
      if(phase==='idle' && !booted)moderation?.enter(null);
      changed();refreshStage();
    },
  });
  /* Noltbook's note calls and their moderation move under us; a leased room
   * follows them rather than keeping a second copy. */
  onNoltbook(()=>{
    const note=noteCall?.note();
    if(note)noteCall.snapshot(nb.calls[note]??null);
    readModeration();
    if(!note)applyModeration(moderation?.record()??null,moderation?.call()??null);
    changed();
  },c=>['calls','callMods','noteAdmins','noteMuted'].includes(c.field));
  /* OUR OWN LEASED NOTE changing its settings -- opened up, closed down, a
   * member added -- has to reach everybody standing in the room. The roster is
   * how they hear it, so publish it again. */
  onNoltbook(()=>{
    if(rooms.lease?.place===rooms.here && rooms.host===our)republishLease();
    changed();
  },c=>c.field==='notes' && (!c.noteId || c.noteId===rooms.lease?.note));
  onNoltbook(refreshWorldMembership,c=>c.field==='world'||c.field==='pals');
  /* A note's members or facts decide who a leased room's door lets in. */
  onNoltbook(()=>{gateEpoch++;},c=>['notes','remoteNotes','world','pals'].includes(c.field));
  if(typeof window!=='undefined')window.__grants=[];
  return G.watchCallAccess((name,p)=>{
    if(name==='call-granted' || name==='call-failed'){
      lastControl={...lastControl,in:{kind:name,who:p?.participant??'',at:Date.now()}};
      mark('credential',`${name}:${p?.gen??''}${p?.err?':'+p.err:''}`);
    }
    /* A credential minted by the host's ship is the surest answer there is. */
    if(name==='call-granted' && p?.participant===our){
      const h=String(p.context??'').split('/')[3]??controller?.current?.host;
      if(h && h!==our)reach?.answered(h);
      else if(controller?.current?.host && controller.current.host!==our)reach?.answered(controller.current.host);
    }
    if(movementResult?.(name,p))return;
    if(typeof window!=='undefined'){
      window.__grants.push({name,room:p.room,gen:p.gen,err:p.err,who:p.participant??p.who});
      if(window.__grants.length>100)window.__grants.shift();
    }
    controller.result(name,p);
  });
}
/* Membership changes must reach calls even while everyone is stationary.
 * Note-call participants remain note-call participants; only world presence
 * and ordinary Glurff calls require the official world's roster. Somebody who
 * has left the Glurff is neither played nor shown (mayReceiveMedia), and the
 * Glurff's host turns them away at their next renewal. */
function refreshCallMembership(){
  if(!sfu)return;
  applyPlayable(moderation?.record()??null,moderation?.call()??null);
  rooms.others=callPeers().size;
}
export function refreshWorldMembership(){
  mates?.refreshMembership();
  if(!worldMember(our)){
    if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
    recorder?.stop();closeTab({permanent:false});lastPeers=new Map();rooms.live=new Map();peerRooms.clear();
    rooms.waiting=false;changed();return;
  }
  for(const who of peerRooms.keys())if(!worldMember(who))peerRooms.delete(who);
  refreshCallMembership();
  if(huddle){
    if(!worldMember(huddle.host))clearHuddle('world-membership');
    else if(huddle.host===our){
      const members=huddle.members.filter(worldMember);
      if(members.length<2)clearHuddle('world-membership',true);
      else if(members.length!==huddle.members.length)updateHostedHuddle(members,'world-membership');
    }
  }
  if(rooms.lease?.place===rooms.here && rooms.host===our)republishLease();
  refresh(lastPeers);
  if(huddleSelf && rooms.here===COMMONS)updateHuddle(huddleSelf,lastPeers);
  changed();
}
function selectCall(place,host,{preserve=false}={}) {
  if(!worldMember(our) || !worldMember(host))return;
  mark('select',`${place}/${host}${preserve?' preserve':''}`);
  /* Somebody else's room, leased to a note we are not in: nothing to ask for. */
  /* Believed for a minute: a lease can end without us hearing, and asking
   * again is how we find out. */
  if(rooms.privateRoom?.place===place && rooms.privateRoom.host===host && rooms.lease?.place!==place &&
     Date.now()-rooms.privateRoom.at<60000){
    rooms.host=host;closeToPrivate();changed();return;
  }
  /* A LEASED ROOM: the call is the note's, so Glurff opens nothing. Noltbook
   * decides who may join it -- membership of the note -- and the note owner's
   * ship mints for everybody, whether or not they are here. */
  const bound=leaseNote(place,host);
  /* A private note we can name but are not in: its call would only refuse
   * us. Say so here rather than asking Noltbook to. */
  if(bound && rooms.lease?.place!==place && !nb.notes[bound] &&
     ['private','secret'].includes(leaseAt(place,host).vis)){
    rooms.privateRoom={place,host,at:Date.now()};rooms.host=host;closeToPrivate();changed();return;
  }
  if(bound){
    if(noteCall?.note()===bound)return;
    releaseMedia();controller?.select(null);moderation?.enter(null);
    rooms.host=noteHostOf(bound)??host;
    rooms.timings={requested:performance.now(),role:noteCreator(bound)===our?'host':'guest'};
    if(isListPlace(place) && host)mates?.follow(place,host);
    /* Hosting our own leased room: the list carries the lease, so anybody who
     * can see us knows which note this room is. */
    if(host===our)republishLease();
    /* Being in the room is what keeps the lease alive; see takeSeat. This runs
     * for the owner too -- they are an occupant like anybody else, and the
     * lease must not depend on their browser in particular. */
    takeSeat(place,rooms.host??host);
    noteCall?.enter(bound);
    refreshStage();return;
  }
  /* Not a leased room any more, or never was: our seat goes back. */
  dropSeat();
  if(noteCall?.note())noteCall.leave();
  /* THE CALL IS THE GLURFF'S HOST'S, whoever keeps the room's list: one call
   * per room, so a new keeper is never a new call. */
  rooms.host=host;
  if(isListPlace(place) && host)mates?.follow(place,host);
  else mates?.leave();
  /* A room we hold a lease on carries it from the moment we keep its list. */
  if(host===our)republishLease();
  if(controller?.current?.place===place && controller.current.host===WORLD_HOST){refreshStage();return;}
  /* Removed from this call: standing in the room is not a way back in. The bar
   * lifts when an admin allows us back, or when the call is a new one. */
  if(barred(place,WORLD_HOST)){releaseMedia();controller?.select(null);changed();return;}
  if(!preserve)releaseMedia();
  rooms.timings={requested:performance.now(),role:WORLD_HOST===our?'host':'guest'};
  controller?.select({place,host:WORLD_HOST},{preserve});
  refreshStage();
}
/* Who a call is waiting on changes with TIME, not only with the call's phase:
 * "still requesting" becomes "your ship has not taken this" and then "the host
 * is not answering". Re-read it every second while a call is trying. */
let stageTimer=null;
const TRYING=new Set(['requesting','waiting-ship','waiting-host','retrying','transitioning']);
function refreshStage() {
  const next=controller?.stage()??'idle';
  if(next!==rooms.stage){rooms.stage=next;changed();}
  clearTimeout(stageTimer);stageTimer=null;
  if(TRYING.has(next))stageTimer=setTimeout(refreshStage,1000);
}
export function receiveCallEvent(who,event){
  /* The ACTOR is the ship the agent says sent this, never a field in it. The
   * Glurff's host answers for its calls whether or not it is a member itself. */
  if(!worldMember(who) && who!==WORLD_HOST)return;
  if(typeof event?.kind==='string'){
    lastControl={...lastControl,in:{kind:event.kind,who,at:Date.now()}};
    if(['call-refused','call-error','call-huddle-end'].includes(event.kind))mark('control-in',`${event.kind}:${who}`);
  }
  /* ASKED FOR A GLURFF CALL IN A ROOM WE HAVE LEASED. There is no Glurff call
   * there -- the room's call is the note's -- and "not hosting" sent the asker
   * round in circles. Say what it is: private to the note's members, or
   * leased, which tells a member to ask for the note. */
  if(event?.kind==='call-request' && rooms.lease?.place===event.place && Number.isSafeInteger(event.attempt)){
    const member=(nb.notes[rooms.lease.note]?.users??[]).includes(who);
    const vis=noteVisibility(rooms.lease.note);
    const reason=member || vis==='public' ? 'leased' : 'private';
    diagnostic('call-request-dropped',{who,place:event.place,attempt:event.attempt,reason});
    Promise.resolve(sendAsking(who,{kind:'call-refused',place:event.place,attempt:event.attempt,reason})).catch(()=>{});
    return;
  }
  if(event?.kind==='call-refused' && event.place===rooms.here && isRoom(event.place)){
    if(event.reason==='private'){leasePrivate(who,event.place);return;}
    if(event.reason==='leased'){leaseAsked.delete(`${who}/${event.place}`);Promise.resolve(G.leaseAsk?.(who,event.place)).catch(()=>{});}
  }
  if(event?.kind==='call-huddle-roster' || event?.kind==='call-huddle-end' || event?.kind==='call-huddle-sync'){
    if(event.kind==='call-huddle-roster' && event.host===who)reach?.answered(who);
    receiveHuddleEvent(who,event);return;
  }
  /* A call's record comes only from the Glurff's host's agent now (see
   * receiveModSnap); one a browser sends is from before, and means nothing. */
  if(typeof event?.kind==='string' && event.kind.startsWith('call-mod-'))return;
  if(event?.kind==='call-leave' && isListPlace(event.place))mates?.left(who,event.place);
  /* A refusal or an error is still an answer: they heard us. */
  if(event?.kind==='call-refused' || event?.kind==='call-error')reach?.answered(who);
  controller?.receive(who,event);
}
export function recoverCall(){controller?.restored();}
export function retryCall(){
  callWatch=null;if(rooms.callHealth){rooms.callHealth=null;changed();}
  if(noteCall?.note()){sfu?.close(null);rooms.voice='retrying';changed();noteCall.retry('manual');return;}
  controller?.retry();
}
export const currentHuddle=()=>huddle;
export const huddleSummary=()=>huddle?{host:huddle.host,place:huddle.place,session:huddle.session,
  epoch:huddle.epoch,rev:huddle.rev,members:[...huddle.members].sort()}:null;

/* Passers-by do not open calls. Adding somebody to a conversation is quicker
 * than ending one: leaving earshot already silences them at once in sfu.js, so
 * keeping the roster for a few seconds costs no privacy and prevents a late
 * movement packet from tearing a healthy call apart. */
export const HUDDLE_FORM_MS=3000;
export const HUDDLE_JOIN_MS=2000;
export const HUDDLE_LEAVE_MS=5000;
/* How long one member's untrustworthy position may hold the host's roster
 * still. Past this, that member alone is decided from what else we know. */
export const HUDDLE_FREEZE_MS=30000;
const frozenSince=new Map();   //  member -> {since, said}: when their position went untrustworthy
/* Kept for callers/tests that used the old single threshold. */
export const HUDDLE_SETTLE_MS=HUDDLE_FORM_MS;
let huddlePending=null, huddleTimer=null, huddleSelf=null;
let huddleRecovery=null;
const safeShip=s=>typeof s==='string' && /^~[a-z-]{3,70}$/.test(s);
const huddleSession=()=>({epoch:Date.now()*1000+Math.floor(Math.random()*1000),
  session:globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`});
function readHuddleRecord(m){
  if(!m || !safeShip(m.host) || !Number.isSafeInteger(m.place) || m.place!==huddlePlace(m.host) ||
    !Number.isSafeInteger(m.epoch) || m.epoch<=0 || !Number.isSafeInteger(m.rev) || m.rev<0 ||
    typeof m.session!=='string' || !m.session.length || m.session.length>80 || !Array.isArray(m.members) ||
    m.members.length<2 || m.members.length>32 || !m.members.every(safeShip))return null;
  const members=[...new Set(m.members)].sort();
  if(members.length!==m.members.length || !members.includes(m.host))return null;
  return {host:m.host,place:m.place,epoch:m.epoch,session:m.session,rev:m.rev,members};
}
function sendHuddle(kind,record,targets=record.members){
  const body={kind,...huddleSummaryOf(record)};
  for(const who of targets)if(who!==our && worldMember(who))Promise.resolve(G.sendPresence(who,body)).catch(()=>{});
}
const huddleSummaryOf=r=>({host:r.host,place:r.place,epoch:r.epoch,session:r.session,rev:r.rev,
  members:[...r.members].sort()});
/* THE HUDDLE'S ROSTER, told to the Glurff's host by the member the huddle
 * elected: the host lets those on it, and nobody else, into the huddle's call,
 * and makes that member its admin. Said again every so often in case the host
 * missed it, and emptied when the huddle ends. */
const ROSTER_MS=60000;
let rosterTimer=null;
function tellRoster(record){
  clearInterval(rosterTimer);rosterTimer=null;
  if(!record || record.host!==our)return;
  const say=()=>Promise.resolve(G.callRoster?.(WORLD_HOST,record.place,
    huddle?.place===record.place?huddle.members:record.members)).catch(()=>{});
  say();
  rosterTimer=setInterval(()=>{
    if(huddle?.host===our && huddle.place===record.place)say();
    else{clearInterval(rosterTimer);rosterTimer=null;}
  },ROSTER_MS);
}
function clearHuddle(reason='ended',notify=false){
  const before=huddle;if(!before)return;
  if(notify && before.host===our)sendHuddle('call-huddle-end',before,before.members);
  if(before.host===our){
    clearInterval(rosterTimer);rosterTimer=null;
    Promise.resolve(G.callRoster?.(WORLD_HOST,before.place,[])).catch(()=>{});
  }
  diagnostic('huddle',{reason,place:before.place,host:before.host,count:0,detail:before.session});
  huddle=null;huddlePending=null;huddleRecovery=null;frozenSince.clear();rooms.host=null;booted=null;
  releaseMedia();controller?.select(null);mates?.leave();changed();
}
function useHuddle(record,reason='roster',preserve=false){
  if(!worldMember(our) || !worldMember(record.host))return;
  const before=huddle;
  huddle={...record,key:huddleKey(record.members),state:preserve?'transitioning':'active',authorityAt:Date.now()};
  huddlePending=null;
  diagnostic('huddle',{reason,place:record.place,host:record.host,count:record.members.length,
    detail:`${record.session}/${record.rev}`});
  const changedCall=!before || before.place!==record.place || before.host!==record.host;
  if(changedCall)selectCall(record.place,record.host,{preserve:preserve && rooms.voice==='connected'});
  if(huddle.state!=='active')huddle.state='active';
  changed();watchAlone();
}
function hostHuddle(members,reason='formed'){
  const token=huddleSession();
  const record={...token,rev:1,host:our,place:huddlePlace(our),members:[...members].sort()};
  /* The roster first, so the Glurff's host has it before anybody -- us
   * included -- asks for the call. Both go through our ship, in order. */
  tellRoster(record);
  useHuddle(record,reason,!!huddle);
  sendHuddle('call-huddle-roster',record);
}
function updateHostedHuddle(members,reason='changed'){
  const before=huddle;if(!before || before.host!==our)return;
  const old=[...before.members];
  const record={...before,rev:before.rev+1,members:[...members].sort(),authorityAt:Date.now(),state:'active'};
  huddle={...record,key:huddleKey(record.members)};
  tellRoster(record);
  mates?.keepOnly?.(who=>record.members.includes(who));
  sendHuddle('call-huddle-roster',record,new Set([...old,...record.members]));
  diagnostic('huddle',{reason,place:record.place,host:our,count:record.members.length,
    detail:`${record.session}/${record.rev}`});
  changed();
}
function recordIsNewer(record,current=huddle){
  if(!current)return true;
  if(record.session===current.session)return record.rev>current.rev;
  if(record.host===current.host)return record.epoch>current.epoch;
  /* Competing sessions converge on the deterministic host when both proposed
   * rosters describe the same group. */
  /* Our own ship is deliberately absent from `lastPeers`. Do not mistake that
   * for a vanished authority: doing so lets the local host adopt any competing
   * session while every guest deterministically keeps the local host. */
  if(current.host!==our && !lastPeers.has(current.host))return true;
  const union=new Set([...current.members,...record.members]);
  return record.members.includes(current.host) && [...union].sort()[0]===record.host;
}
function locallyNearRoster(record){
  if(record.host===our)return true;
  const us=huddleSelf;if(!us)return false;
  return record.members.some(who=>{
    if(who===our)return false;
    const peer=lastPeers.get(who),p=peer?.spot;
    return p && settledRoomOfPeer(who,peer)===COMMONS && Math.hypot(p.x-us.x,p.y-us.y)<=3;
  });
}
function receiveHuddleEvent(who,event){
  if(who===our || !safeShip(who) || !worldMember(who))return;
  if(event.kind==='call-huddle-sync'){
    if(huddle?.host===our && huddle.members.includes(who))sendHuddle('call-huddle-roster',huddle,[who]);
    return;
  }
  const record=readHuddleRecord(event);if(!record || record.host!==who)return;
  record.members=record.members.filter(worldMember);
  if(event.kind==='call-huddle-end'){
    if(huddle?.host===who && huddle.session===record.session && event.rev>=huddle.rev)clearHuddle('host-ended');
    return;
  }
  if(!record.members.includes(our)){
    if(huddle?.host===who && huddle.session===record.session && record.rev>huddle.rev)
      clearHuddle('roster-left');
    return;
  }
  if(!locallyNearRoster(record))return;
  if(!recordIsNewer(record))return;
  useHuddle(record,'authoritative',!!huddle && huddle.host!==record.host);
}
function recheckHuddle(ms) {
  clearTimeout(huddleTimer);
  huddleTimer=setTimeout(()=>{huddleTimer=null;if(huddleSelf)updateHuddle(huddleSelf,lastPeers);},Math.max(50,ms));
}
export function updateHuddle(self,peers) {
  huddleSelf={x:self.x,y:self.y};
  if(rooms.here!==COMMONS || !worldMember(our))return;
  peers=new Map([...peers].filter(([who])=>worldMember(who)));
  /* Never START a call from positions we cannot trust. Right after startup the
   * movement relay is not carrying positions yet and each browser's picture of
   * the other is seconds old: two browsers pick different huddles, and neither
   * ever admits the other. Wait for positions, then decide. A huddle that
   * already exists keeps its members, so a relay hiccup never hangs one up. */
  if(!huddle && !positionGate.ready())return;
  const near={[our]:{x:self.x,y:self.y}},hosts={};
  for(const [who,p] of peers)if(settledRoomOfPeer(who,p)===COMMONS && (positionGate.reliable(who) || huddle?.members.includes(who))){near[who]=p.spot;hosts[who]=p.host??null;}
  /* The host's presence snapshot is the durable copy of its roster. Direct
   * events normally arrive first; this repairs a lost event or a late join. */
  const authority=huddle?.host?peers.get(huddle.host)?.huddle:null;
  if(authority)receiveHuddleEvent(huddle.host,{kind:'call-huddle-roster',...authority});
  /* Membership agreed with what the people near us say they are in; see
   * agreedMembers in lib/huddle. */
  const together=agreedMembers(our,near,hosts,huddle?.members??[],huddle?.host??null);
  let mine=clusterPeers(near,together).find(c=>c.includes(our));
  let key=mine?huddleKey(mine):null;
  /* A guest follows the host's roster. Position can prove the host has really
   * disappeared, but delayed movement never edits an established call. */
  if(huddle && huddle.host!==our){
    if(peers.has(huddle.host)){huddlePending=null;return;}
    const now=Date.now(),pendingKey=`failover/${key??''}`;
    if(huddlePending?.key!==pendingKey)huddlePending={key:pendingKey,since:now};
    const held=now-huddlePending.since;
    if(held<HUDDLE_LEAVE_MS){recheckHuddle(HUDDLE_LEAVE_MS-held);return;}
    const old=huddle;huddle=null;huddlePending=null;
    if(!mine){clearTimeout(huddleTimer);rooms.host=null;releaseMedia();controller?.select(null);mates?.leave();changed();return;}
    const host=electHost(mine,null,hosts,false);
    if(host===our)hostHuddle(mine,'failover');
    else {rooms.host=null;releaseMedia();controller?.select(null);mates?.leave();
      G.sendPresence(host,{kind:'call-huddle-sync',host,place:huddlePlace(host)}).catch(()=>{});changed();}
    diagnostic('huddle',{reason:'host-missing',place:old.place,host:old.host,count:mine.length});
    return;
  }
  if((huddle?.key??null)===key){huddlePending=null;frozenSince.clear();return;}
  /* An established huddle keeps its members while positions cannot be
   * trusted to change them; it is re-examined when they can. */
  if(huddle && !rosterReady()){recheckHuddle(1000);return;}
  /* An unreliable member freezes a live host roster. In particular, a final
   * stationary packet can be old and healthy, while an old moving packet is a
   * stalled route; neither is authority to remove somebody.
   *
   * BUT NOT FOREVER. One member with a stalled route used to hold the whole
   * roster still indefinitely -- nobody could join or leave the huddle. Now
   * the hold lasts HUDDLE_FREEZE_MS per member, and then that member alone is
   * decided from what else we know: still in our presence, still in the
   * commons, and still on the call server with us means they stay, whatever
   * their position says; anything else, and their last position decides like
   * anybody's. */
  if(huddle?.host===our){
    const now=Date.now();
    const shaky=huddle.members.filter(who=>who!==our &&
      ['delayed','stalled'].includes(positionGate.confidence(who)));
    for(const who of [...frozenSince.keys()])if(!shaky.includes(who))frozenSince.delete(who);
    let holding=0;const pinned=[];
    const inCall=callPeers();
    for(const who of shaky){
      if(!frozenSince.has(who))frozenSince.set(who,{since:now,said:null});
      const f=frozenSince.get(who),age=now-f.since;
      if(age<HUDDLE_FREEZE_MS){holding=Math.max(holding,HUDDLE_FREEZE_MS-age);continue;}
      const p=peers.get(who);
      const present=!!p && settledRoomOfPeer(who,p)===COMMONS;
      const keep=present && inCall.has(who);
      if(keep)pinned.push(who);
      const verdict=keep?'freeze-kept':'freeze-released';
      if(f.said!==verdict){f.said=verdict;
        diagnostic('huddle',{reason:verdict,place:huddle.place,host:our,count:huddle.members.length,detail:who});}
    }
    if(holding){recheckHuddle(holding+50);return;}
    if(pinned.length && mine){
      mine=[...new Set([...mine,...pinned])].sort();key=huddleKey(mine);
      if(huddle.key===key){huddlePending=null;return;}
    }
  }
  /* Something changed. Wait for the appropriate transition to hold still. */
  const now=Date.now();
  const removed=huddle?.members.some(who=>!mine?.includes(who));
  const wait=!huddle?HUDDLE_FORM_MS:removed?HUDDLE_LEAVE_MS:HUDDLE_JOIN_MS;
  const pendingKey=`${huddle?'active':'candidate'}/${key??''}`;
  if(huddlePending?.key!==pendingKey)huddlePending={key:pendingKey,since:now};
  const held=now-huddlePending.since;
  if(held<wait){recheckHuddle(wait-held);return;}
  huddlePending=null;
  if(!mine){if(huddle)clearHuddle('ended',true);return;}
  // Presence determines the same elected host on both ships. Timeouts never
  // create a competing host while that participant remains in the huddle.
  /* The call is the elected member's place (see huddlePlace), on the
   * Glurff's host: somebody joining or leaving changes who is in it, not which
   * call it is, so nobody reconnects. */
  /* `hosts` is what each person near us says their elected member is. Passing
   * it in is what lets two browsers notice they disagree and settle on the
   * same answer; see electHost. */
  const host=electHost(mine,huddle?.host??null,hosts,false);
  if(!huddle){
    if(host===our)hostHuddle(mine,'formed');
    else G.sendPresence(host,{kind:'call-huddle-sync',host,place:huddlePlace(host)}).catch(()=>{});
    return;
  }
  updateHostedHuddle(mine,'changed');
}
const occupantsIn=room=>[our,...[...lastPeers].filter(([who,p])=>settledRoomOfPeer(who,p)===room).map(([s])=>s)].sort();
/* WHO KEEPS A ROOM'S LIST (lib/roommates), and for a leased room who holds
 * the lease. Never who hosts its call: that is always the Glurff's host. */
function roomHost(room) {
  /* A LEASED ROOM'S HOST IS WHOEVER HOLDS THE LEASE -- not whoever we happen
   * to be able to see standing in it. The call is the note's, minted by the
   * note's own ship, and in a SECRET room the holder may be invisible to us
   * until their list arrives. Picking a visible occupant instead is how two
   * members ended up hosting two separate copies of the same room. */
  if(rooms.lease?.place===room)return our;
  const holder=leaseHolder(room);
  if(holder && leaseAt(room,holder).note)return holder;
  const occupants=occupantsIn(room);
  const announced=[...lastPeers].filter(([who,p])=>settledRoomOfPeer(who,p)===room).map(([,p])=>p.host).filter(h=>occupants.includes(h));
  if(rooms.here===room && occupants.includes(rooms.host))announced.push(rooms.host);
  return announced.sort()[0]??occupants[0];
}
export function refresh(peers) {
  peers=new Map([...peers].filter(([who])=>worldMember(who)));
  lastPeers=peers;
  const live=new Map();
  for(const [who,p] of peers){const room=settledRoomOfPeer(who,p);if(room===COMMONS)continue;
    const r=live.get(room)??{host:null,occupants:new Set()};r.occupants.add(who);if(p.host)r.host=p.host;live.set(room,r);}
  if(rooms.here!==COMMONS && worldMember(our)){const host=roomHost(rooms.here),r=live.get(rooms.here)??{host,occupants:new Set()};r.occupants.add(our);r.host=host;live.set(rooms.here,r);
    /* The room's keeper is only chosen once positions are trustworthy; see
     * updateHuddle for why. main.js re-runs this when that changes. A new
     * keeper is a new list to follow, never a new call. */
    if(host!==rooms.host && rosterReady())selectCall(rooms.here,host,{preserve:rooms.voice==='connected'});}
  const waiting=rooms.here!==COMMONS && rooms.host===null && !positionGate.ready();
  if(waiting!==rooms.waiting){rooms.waiting=waiting;changed();}
  const same=live.size===rooms.live.size && [...live].every(([id,r])=>{const old=rooms.live.get(id);return old && old.host===r.host && old.occupants.size===r.occupants.size && [...r.occupants].every(s=>old.occupants.has(s));});
  /* SOMEBODY HAS ARRIVED IN THE ROOM WE LEASED. Their client is waiting for
   * the list -- it is how they learn which note this room is, and for a secret
   * note it is the only way -- so say it now rather than at the next heartbeat
   * with them standing outside a door that is theirs. */
  if(!same && rooms.lease?.place===rooms.here && rooms.host===our)republishLease();
  rooms.live=live;if(!same)changed();
  /* Somebody walking in is somebody the call should now have. */
  if(!same)watchAlone();
}
export function enterRoom(room) {
  if(!worldMember(our))return;
  if(room===rooms.here)return;
  if(room===COMMONS){leaveRoom();return;}
  if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
  mates?.leave();booted=null;
  if(rooms.privateRoom)clearPrivate();
  huddle=null;huddlePending=null;rooms.here=room;rooms.host=null;
  const host=roomHost(room);if(host===our)G.claimRoom(room).catch(()=>{});
  if(positionGate.ready())selectCall(room,host);
  else {releaseMedia();controller?.select(null);rooms.waiting=true;}   //  never stay in the call we walked out of
  changed();
}
export function leaveRoom() {
  dropSeat();
  if(rooms.privateRoom)clearPrivate();
  noteCall?.leave();
  if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
  mates?.leave();booted=null;
  rooms.here=COMMONS;rooms.host=null;rooms.waiting=false;huddlePending=null;releaseMedia();controller?.select(null);changed();
}
// Legacy room claims update the display; admission uses correlated call-request.
export function noteHost(who,room){if(rooms.here===room && lastPeers.has(who))refresh(lastPeers);}
export function clearHost(who,room){const r=rooms.live.get(room);r?.occupants.delete(who);if(r?.host===who)r.host=null;}
export function answerKnock(){}

const isRoom=place=>Number.isSafeInteger(place) && place>COMMONS && place<1000;
export const occupantsOf=room=>[...(rooms.live.get(room)?.occupants??[])];
export const hostOf=room=>rooms.live.get(room)?.host??null;
export const hostName=room=>{const h=hostOf(room);return h?displayName(h):null;};
/* EXPECTED VERSUS CONNECTED, for every kind of call.
 *
 * Connected to the call server is not the same as being in the call with the
 * people we can see in it. This used to be watched only for a huddle of one.
 * Now, for huddles, ordinary rooms and leased-note calls alike: somebody who
 * should be in the call with us and has not been for CALL_WATCH_MS starts a
 * ladder, one rung per interval, each only if the last did not help --
 *
 *   1. resync the roster   (ask the authority who is in this call)
 *   2. refresh credentials (a new token, same socket)
 *   3. reconnect           (the same target, from scratch)
 *   4. say so              (callHealth: who we cannot reach, and a Retry)
 *
 * Progress survives the reconnect in rung 3 -- otherwise a call that can never
 * reach somebody would climb the ladder forever -- and is forgotten when
 * everybody expected is there, or the call becomes a different call. */
export const CALL_WATCH_MS=20000;
/* ONE CORRELATED CALL TIMELINE.
 *
 * A call problem used to need five captures stitched together by timestamp:
 * the controller's phases, the SFU socket, each WebRTC connection, the roster
 * and presence. Here every transition that matters to a call writes one row
 * holding all of it at once -- what room we meant, which host, who the roster
 * says, which credential generation, the socket and each connection's state,
 * what tracks arrived, whether autoplay is blocked, and the last control
 * message that got through in each direction. Bounded; nothing leaves the
 * browser unless the person copies diagnostics. */
const TIMELINE_MAX=150;
const timeline=[];
let lastControl={in:null,out:null};
function mark(event,detail=''){
  try{
    const c=controller?.current;
    timeline.push({at:Date.now(),event,detail:String(detail??'').slice(0,80),
      room:rooms.here,host:rooms.host??null,voice:rooms.voice,
      call:noteCall?.note()?{note:noteCall.note(),callId:noteCall.callId()}:
        c?{place:c.place,host:c.host,attempt:c.attempt,phase:controller.phase,gen:c.grant?.gen??0,
          previous:c.previous?`${c.previous.place}/${c.previous.host}`:null}:null,
      roster:huddle?{huddle:huddle.session,rev:huddle.rev,members:[...huddle.members]}:
        (()=>{const m=mates?.current?.();return m?{host:m.host,rev:m.rev,guests:m.guests}:null;})(),
      inCall:[...callPeers()].sort(),
      missing:callWatch?{step:callWatch.step,failed:callWatch.failed}:null,
      hostReach:hostReach(),
      sfu:sfu?.summary?.()??null,
      control:{...lastControl}});
    if(timeline.length>TIMELINE_MAX)timeline.shift();
  }catch{}
}
export const callTimeline=()=>timeline.map(r=>JSON.parse(JSON.stringify(r)));
/* For a capture that has to fit in a message: each row keeps when and what,
 * and only the fields that CHANGED since the row before. The full rows are
 * still glurffCallTimeline() in the console. */
export function compactTimeline(rows=timeline,max=60){
  const out=[];let prev={};
  for(const r of rows.slice(-max)){
    const row={at:r.at,event:r.event,...(r.detail?{detail:r.detail}:{})};
    for(const k of Object.keys(r))if(!['at','event','detail'].includes(k)){
      const v=JSON.stringify(r[k]);
      if(v!==JSON.stringify(prev[k]))row[k]=r[k];
    }
    prev=r;out.push(JSON.parse(JSON.stringify(row)));
  }
  return out;
}
if(typeof window!=='undefined')window.glurffCallTimeline=callTimeline;
let aloneTimer=null;
let callWatch=null;      //  {key, step, failed}
const callKey=()=>noteCall?.note()?`note/${noteCall.note()}`:
  controller?.current?`${controller.current.place}/${controller.current.host}`:'';
/* Who should be in this call with us: the huddle's members, or the people we
 * can see standing in this room who say they follow the same host AND whom the
 * room admits -- the note's members in a leased room, the host's list in an
 * ordinary one. Somebody standing in a room they may not join is not missing
 * from its call, and must not be reported as unreachable. */
function expectedInCall(){
  if(huddle)return huddle.members.filter(s=>s!==our && mayReceiveMedia(s));
  if(rooms.here===COMMONS || !rooms.host)return [];
  const note=noteCall?.note()??null;
  const members=note?nb.notes?.[note]?.users??null:null;
  if(note && !Array.isArray(members))return [];          //  membership not known: expect nobody
  const listed=note?null:mates?.current?.()?.guests??null;
  return occupantsOf(rooms.here).filter(s=>s!==our && mayReceiveMedia(s) &&
    (lastPeers.get(s)?.host ?? rooms.host)===rooms.host &&
    (note?members.includes(s):!listed || listed.includes(s)));
}
function missingFromCall(){
  if(rooms.voice!=='connected')return [];
  const inCall=callPeers();
  return expectedInCall().filter(s=>!inCall.has(s)).sort();
}
function watchAlone(){
  /* Not connected: nothing to compare, but keep the progress. */
  if(rooms.voice!=='connected'){clearTimeout(aloneTimer);aloneTimer=null;return;}
  const missing=missingFromCall(),key=callKey();
  if(!missing.length || !key){
    clearTimeout(aloneTimer);aloneTimer=null;huddleRecovery=null;
    if(callWatch?.step)diagnostic('call-expected',{place:controller?.current?.place??0,host:rooms.host??'',
      count:0,detail:callWatch.key,reason:'recovered'});
    callWatch=null;
    if(rooms.callHealth){rooms.callHealth=null;changed();}
    return;
  }
  if(!callWatch || callWatch.key!==key){
    callWatch={key,step:0,failed:false};
    if(rooms.callHealth){rooms.callHealth=null;changed();}
  }
  if(aloneTimer || callWatch.failed)return;
  aloneTimer=setTimeout(callWatchStep,CALL_WATCH_MS);
}
function callWatchStep(){
  aloneTimer=null;
  const w=callWatch;
  const missing=missingFromCall();
  if(!w || !missing.length || w.key!==callKey()){watchAlone();return;}
  w.step++;
  const base={place:controller?.current?.place??0,host:rooms.host??'',count:missing.length,
    detail:missing.slice(0,8).join(',')};
  if(!rooms.others)diagnostic('call-alone',{place:base.place,host:base.host,
    count:huddle?.members.length??occupantsOf(rooms.here).length,
    context:huddle?`${huddle.session}/${huddle.rev}`:w.key});
  if(huddle)huddleRecovery={session:huddle.session,tries:w.step};
  mark('watch',`step ${w.step}: ${missing.join(',')}`);
  if(w.step===1){
    diagnostic('call-expected',{...base,reason:'resync'});
    /* A huddle asks its authority what the current session is; the reply
     * repairs a stale host/place without inventing a competing call. A room
     * asks its host for the list (or, hosting, says it again). */
    if(huddle && huddle.members.length>1){
      if(huddle.host===our)sendHuddle('call-huddle-roster',huddle);
      else G.sendPresence(huddle.host,{kind:'call-huddle-sync',host:huddle.host,place:huddle.place,
        session:huddle.session,epoch:huddle.epoch,rev:huddle.rev}).catch(()=>{});
    } else mates?.resync?.();
  } else if(w.step===2){
    diagnostic('call-expected',{...base,reason:'refresh'});
    if(noteCall?.note())noteCall.renew();else controller?.refresh?.();
  } else if(w.step===3){
    diagnostic('call-expected',{...base,reason:'reconnect'});
    if(noteCall?.note()){sfu?.close(null);rooms.voice='retrying';changed();noteCall.retry('missing-peers');}
    else controller?.retry();
  } else {
    w.failed=true;
    diagnostic('call-expected',{...base,reason:'unreachable'});
    rooms.callHealth={missing,failed:true,
      reach:Object.fromEntries(missing.map(s=>[s,reach?.status(s)??'unknown']))};changed();
    return;
  }
  watchAlone();
}
function releaseMedia() {
  captureEpoch++;
  for(const kind of ['mic','cam','screen']){
    const p=published[kind];if(!p)continue;
    try{sfu?.unpublish(p.id);}catch{}
    p.cleanup?.();
    /* Neither the camera preview nor the shared screen is the call's to stop:
     * leaving a call keeps both running, and only the CLONE published into the
     * call is dropped. */
    if(p.stream!==preview?.stream && p.stream!==display?.stream)for(const t of p.stream.getTracks())t.stop();
    published[kind]=null;
  }
  rooms.micOn=intent.mic;rooms.camOn=intent.cam;rooms.screenOn=intent.screen;
  receivedStreams.clear();
  rooms.streams.clear();rooms.remoteStreams.clear();
  for(const k of [...rooms.localStreams.keys()])if(!(k==='cam' && preview) && !(k==='screen' && display))rooms.localStreams.delete(k);
}
export async function reopenCapture(kind){
  if(kind==='cam'){
    /* Another camera chosen: restart the preview, and the call's copy if any. */
    if(!preview)return;
    const live=!!published.cam;
    unpublish('cam');stopPreview();
    await startPreview();
    if(live)await publish('cam',cameraForCall,'camera');
    return;
  }
  if(!published[kind])return;
  unpublish(kind);
  await publish('mic',()=>navigator.mediaDevices.getUserMedia(micConstraints()),'camera');
}
export const outputChanged=()=>sfu?.refreshOutput();
export function closeTab({permanent=true}={}){noteCall?.leave();mates?.leave();if(permanent)controller?.close();else controller?.select(null);clearTimeout(huddleTimer);clearInterval(rosterTimer);rosterTimer=null;huddleTimer=null;huddlePending=null;clearTimeout(stageTimer);stageTimer=null;huddle=null;rooms.here=COMMONS;rooms.host=null;intent.mic=intent.cam=intent.screen=false;releaseMedia();stopPreview();stopDisplay();}

/* The world never opens a microphone or camera on its own: each of these is an
 * explicit act, and each can be undone without leaving the room. */
const published = { mic: null, cam: null, screen: null };
const acquiring = {};
let captureEpoch = 0;

/* User intent survives every room/huddle transition -- SCREEN SHARING TOO.
 * Walking from a room into a huddle used to end a share and make the browser
 * ask for the window again, because leaving a call stopped the display
 * capture. The capture is owned here now, like the camera preview, and only
 * the things that really end a share end it. No preferences survive a reload. */
const intent = {mic:false,cam:false,screen:false};

/* Your own camera, shown to you whenever it is on -- in a call or not.
 *
 * The preview owns the camera. A call publishes a CLONE of its track, because
 * the SFU stops whatever it published when that is unpublished, and that must
 * never blank your own view. Walking between calls keeps the same capture
 * running; turning the camera off is what releases the hardware. */
let preview=null, previewing=null;
const cloneStream=s=>typeof MediaStream==='undefined'?s:new MediaStream(s.getTracks().map(t=>t.clone()));
function startPreview(){
  if(preview)return Promise.resolve(preview);
  if(previewing)return previewing;
  const task=navigator.mediaDevices.getUserMedia(camConstraints()).then(stream=>{
    if(previewing!==task || !intent.cam){stream.getTracks().forEach(t=>t.stop());return null;}
    previewing=null;
    preview={stream};
    rooms.localStreams.set('cam',stream);
    for(const t of stream.getTracks())t.addEventListener?.('ended',()=>{
      /* Unplugged, or taken away by the browser: the camera is off. */
      if(preview?.stream!==stream)return;
      intent.cam=false;unpublish('cam');stopPreview();rooms.camOn=false;changed();
    },{once:true});
    refreshDevices();changed();
    return preview;
  },e=>{
    if(previewing===task){previewing=null;intent.cam=false;rooms.camOn=false;rooms.error=String(e.message??e);changed();}
    throw e;
  });
  previewing=task;
  return task;
}
function stopPreview(){
  previewing=null;
  if(!preview)return;
  const {stream}=preview;preview=null;
  rooms.localStreams.delete('cam');
  stream.getTracks().forEach(t=>t.stop());
}
const cameraForCall=()=>startPreview().then(p=>{if(!p)throw new Error('Camera is off');return cloneStream(p.stream);});

/* THE SHARED SCREEN, owned the same way as the camera preview.
 *
 * One display capture, taken once, with its own "Your screen" tile. Each call
 * publishes a CLONE of it, because unpublishing stops whatever was published
 * -- and stopping the capture is what made the browser ask for the window
 * again every time you walked through a door. Leaving a call drops the clone;
 * the capture keeps running and the next call publishes a fresh one.
 *
 * It ends when it should: you turn it off, the browser's own "stop sharing"
 * ends it, an admin mutes you, the track fails, or the tab closes. */
let display=null, displaying=null;
const freshScreenToken=()=>globalThis.crypto?.randomUUID?.()??`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
function startDisplay(){
  if(display)return Promise.resolve(display);
  if(displaying)return displaying;
  /* Ask for audio as part of the display capture. Browsers only offer the
   * checkbox for sources and operating systems that support it; declining it
   * still returns an ordinary video-only screen share. */
  const task=navigator.mediaDevices.getDisplayMedia({video:true,audio:true}).then(stream=>{
    /* Asked again while this one was in flight, or switched off while the
     * browser was still asking: do not leave a capture running unwatched. */
    if(displaying!==task || !intent.screen){stream.getTracks().forEach(t=>t.stop());return null;}
    displaying=null;
    display={stream,token:freshScreenToken()};
    rooms.localStreams.set('screen',stream);
    /* Losing optional system audio must not stop healthy screen video. The
     * browser's own Stop sharing control ends the display video track. */
    for(const t of stream.getVideoTracks())t.addEventListener?.('ended',()=>{
      /* The browser's own "stop sharing", or the window going away. */
      if(display?.stream!==stream)return;
      intent.screen=false;unpublish('screen');stopDisplay();rooms.screenOn=false;changed();
    },{once:true});
    changed();
    return display;
  },e=>{
    if(displaying===task){displaying=null;intent.screen=false;rooms.screenOn=false;rooms.error=String(e.message??e);changed();}
    throw e;
  });
  displaying=task;
  return task;
}
function stopDisplay(){
  displaying=null;
  if(!display)return;
  const {stream}=display;display=null;
  rooms.localStreams.delete('screen');
  stream.getTracks().forEach(t=>t.stop());
}
const screenForCall=()=>startDisplay().then(d=>{if(!d)throw new Error('Screen sharing is off');return cloneStream(d.stream);});
export const screenSource=()=>display?.stream??null;
export const screenShare=()=>display?{stream:display.stream,token:display.token}:null;

/* Drop any publication the SFU no longer holds -- a reconnect clears them all
 * -- so intent can be restored into the new connection. The capture itself is
 * kept: only the call's own copy is dropped. */
function reconcilePublications(){
  for(const kind of ['mic','cam','screen']){
    const p=published[kind];
    if(!p || sfu?.hasPublication?.(p.id)!==false)continue;
    p.cleanup?.();
    if(p.stream!==preview?.stream && p.stream!==display?.stream)for(const t of p.stream.getTracks())t.stop();
    published[kind]=null;
  }
}
const GET={mic:()=>navigator.mediaDevices.getUserMedia(micConstraints()),cam:cameraForCall,screen:screenForCall};
const LABEL={mic:'camera',cam:'camera',screen:'screen'};
function restoreIntent() {
  /* A forced mute is the one thing that outranks intent: it turns everything
   * off and holds it off until an admin lifts it. */
  if(rooms.mutedByAdmin || !worldMember(our))return;
  for(const kind of ['mic','cam','screen'])if(intent[kind] && !published[kind])
    publish(kind,GET[kind],LABEL[kind]).catch(e=>{rooms.error=String(e.message??e);changed();});
}

function publish(kind,get,label) {
  if(!worldMember(our))return Promise.resolve();
  if (published[kind]) return Promise.resolve();
  if (acquiring[kind]) return acquiring[kind];
  const epoch=captureEpoch;
  let failed=false;
  const task = capture(kind,get,label).catch(e=>{failed=true;throw e;}).finally(() => {
    if(acquiring[kind]===task)delete acquiring[kind];
    if(!failed && epoch!==captureEpoch && rooms.voice==='connected')restoreIntent();
  });
  acquiring[kind]=task;
  return task;
}
async function capture(kind, get, label) {
  const epoch = captureEpoch;
  const raw = await get();
  const owned = (s) => s !== preview?.stream && s !== display?.stream;
  const media = kind === 'mic' ? await processMicrophone(raw) : {stream:raw,cleanup:()=>{if(owned(raw))raw.getTracks().forEach(t=>t.stop());}};
  const stream = media.stream;
  if(epoch !== captureEpoch || !intent[kind]) {media.cleanup();return;}
  let id;
  /* A capture token distinguishes this screen share from a later share by the
   * same ship. Theater surfaces use it to avoid reviving stale live content. */
  const publicationLabel=kind==='screen'&&display?.token?`screen:${display.token}`:label;
  try { id = await sfu.publish(stream, publicationLabel); } catch(e) {media.cleanup();throw e;}
  if(epoch !== captureEpoch || !intent[kind]) {sfu.unpublish(id);media.cleanup();return;}
  published[kind] = { id, stream, cleanup:media.cleanup, raw:media.raw??null, context:media.context??null };
  if(kind==='mic')watchMic();
  /* The call's own copy dying -- a renegotiation gone wrong -- is not the end
   * of the share: drop the publication and let restoreIntent make another. */
  if(kind==='screen')for(const track of stream.getVideoTracks())track.addEventListener?.('ended',()=>{
    if(published.screen?.id!==id)return;
    unpublish('screen');
    if(intent.screen && display && rooms.voice==='connected')restoreIntent();
  },{once:true});
  rooms[`${kind}On`] = true;
  /* Device LABELS only exist once a capture has been allowed, so this is the
   * first moment the settings picker can show real names. */
  refreshDevices();
  changed();
}

/* ---- SOFT MUTE (2026-09-29) ----
 * Our microphone stays open for the whole call; muting only stops the sound
 * going out -- a silenced track sends silence. Closing and reopening it on
 * every mute made the system switch audio modes each time -- Bluetooth
 * headsets between music and headset modes, computers in and out of voice-call
 * processing -- and the people we were listening to dropped out with it. The
 * microphone is let go when we leave the call (releaseMedia), and an admin's
 * mute still takes it away outright (applyModeration). */
function setMicSending(on){
  for(const t of published.mic?.stream.getAudioTracks()??[])t.enabled=on;
}
/* Who has their microphone off, for the call tiles. Ours is known here; other
 * people's ride their presence (see main). */
let peerMicOff=()=>false;
export const setPeerMicOff=fn=>{peerMicOff=fn;};
export const micOff=(ship)=>ship===our?!rooms.micOn:peerMicOff(ship);
/* Something the call panel shows changed outside this module. */
export const roomsChanged=()=>changed();

/* ---- IS OUR MICROPHONE SENDING SOUND? See lib/mic-health. ----
 * Made when a microphone is first published: no microphone, nothing to watch. */
let micHealth=null;
const makeMicHealth=()=>createMicHealth({
  probe:async()=>{
    const p=published.mic;
    /* Muted: silence is the point, not a fault. */
    if(!p||!sfu||!intent.mic)return null;
    const raw=p.raw??p.stream.getAudioTracks()[0]??null;
    const sent=await sfu.upAudio?.(p.id);
    return {ended:raw?.readyState==='ended',muted:!!raw?.muted,context:p.context?.state??null,
      resume:()=>p.context?.resume?.(),energy:sent?.energy??null};
  },
  /* The chosen microphone, or whichever the system offers if that one is
   * gone (the device is asked for as `ideal`, never `exact`). */
  reopen:()=>reopenCapture('mic'),
  onTrouble:(why)=>{rooms.micTrouble=why;changed();},
  trace:(type,d)=>{diagnostic(type,d);mark('mic',d.reason);},
});
let micTimer=null;
function watchMic(){
  micHealth??=makeMicHealth();
  if(micTimer!==null)return;
  micTimer=setInterval(()=>{
    if(!published.mic && !acquiring.mic){clearInterval(micTimer);micTimer=null;}
    void micHealth?.check();
  },MIC_CHECK_MS);
}
/* "Try again", from the call panel. */
export const retryMic=()=>(micHealth??=makeMicHealth()).retry();
/* People whose sound should be reaching us and is not. */
export const soundless=()=>sfu?.soundless?.()??new Set();

function unpublish(kind) {
  const p = published[kind];
  if (!p) return;
  sfu.unpublish(p.id);
  p.cleanup?.();
  published[kind] = null;
  if (!(kind === 'cam' && preview) && !(kind === 'screen' && display)) rooms.localStreams.delete(kind);
  rooms[`${kind}On`] = intent[kind];
  changed();
}

async function toggleMedia(kind) {
  /* A call control is a gesture too, and the likeliest one when audio is
   * silent: somebody reaching for the mic because they cannot hear. */
  resumeAudio('control');
  /* Touching the control that failed is the person dealing with it. */
  if(rooms.mediaError?.kind===kind){rooms.mediaError=null;changed();}
  if(!worldMember(our))return;
  /* An admin's mute locks all three until it is lifted. */
  if(rooms.mutedByAdmin && !intent[kind])return;
  intent[kind]=!intent[kind];
  rooms[`${kind}On`]=intent[kind];
  /* SOFT MUTE: a microphone already in the call is not closed, only silenced. */
  if(kind==='mic' && published.mic){
    setMicSending(intent.mic);
    diagnostic('mic-mute',{reason:intent.mic?'on':'off'});
    changed();
    return;
  }
  if(!intent[kind]){unpublish(kind);if(kind==='cam')stopPreview();if(kind==='screen')stopDisplay();}
  else{
    /* Seen at once, call or not. The screen's picker is a user gesture, so it
     * has to be asked for here rather than from a later callback. */
    if(kind==='cam')startPreview().catch(()=>{});
    if(kind==='screen')startDisplay().catch(()=>{});
    if(rooms.voice==='connected')restoreIntent();
  }
  changed();
}
export const toggleMic = () => toggleMedia('mic');
export const toggleCam = () => toggleMedia('cam');
export const toggleScreen = () => toggleMedia('screen');
/* Turn screen sharing on without making an already-live share toggle off.
 * The theater's SHARE SCREEN button uses this and then points its painted
 * surface at the capture token. */
export async function startScreen(){
  resumeAudio('control');
  if(!worldMember(our) || (rooms.mutedByAdmin&&!intent.screen))return null;
  if(!intent.screen){intent.screen=true;rooms.screenOn=true;changed();}
  const live=await startDisplay();
  if(!live)return null;
  if(rooms.voice==='connected')await publish('screen',screenForCall,LABEL.screen);
  changed();
  return {stream:live.stream,token:live.token};
}

/* ------------------------------------------------------------ moderation */

/* Who is in this call, as far as we can tell. Membership decides who may be
 * promoted, who a snapshot goes to, and whether a recorder is still here. */
export function callMembers(){
  const place=controller?.current?.place??null;
  if(place===null)return [];
  const others=sfu?.others?.()??new Set();
  const here=huddle&&huddle.place===place?huddle.members:occupantsOf(rooms.here);
  /* The room's own guest list as well. Somebody the call server has not
   * reported yet, or who is standing somewhere our copy of the world has not
   * caught up with, is still in this call -- and a snapshot that never reaches
   * them is a mute or a removal that never happens. */
  const guests=mates?.summary()?.guests??[];
  return [...new Set([our,...others,...here,...guests])].filter(worldMember);
}

/* Copy the record into the shape the UI reads, and keep the recorder pointed
 * at it. Nothing here decides anything: the record does. */
function readModeration(){
  /* A LEASED ROOM'S CALL IS NOLTBOOK'S, and so are its rules: the note's
   * creator hosts it, its admins are admins, and whoever started it is an
   * admin of the call but not of the note. Glurff keeps no second record for
   * it -- two sets of rules for one call is how they come apart. */
  const note=noteCall?.note();
  if(note){
    rooms.mod=null;
    rooms.role=noteCallRole(note,our);
    rooms.recording=noteCallRecording(note);
    /* The Glurff's own mute holds here too, though Noltbook's call server
     * knows nothing of it: our page locks our media, and everybody's page
     * stops playing us. */
    lockMedia(noteCallMuted(note,our)||glurffMuted(our),'muted');
    rooms.mutedInGlurff=glurffMuted(our);
    rooms.bootedByAdmin=noteCallBooted(note,our);
    rooms.recordingMine=!!recorder?.active();
    applyPlayable(null,null);
    recorder?.follow(null,{place:rooms.here,host:rooms.host,gen:0},rooms.recording);
    return;
  }
  const call=moderation?.call()??null;
  const record=moderation?.record()??null;
  rooms.mod=record;
  rooms.role=roleOf(record,call,our);
  rooms.recording=recordingOf(record,call);
  rooms.recordingMine=!!recorder?.active();
  recorder?.follow(record,call,rooms.recording);
}

/* What the record does TO US.
 *
 * A mute turns mic, camera and screen off and locks all three until it is
 * lifted -- and it genuinely ends the share rather than pausing it, because a
 * muted participant nobody can see must not be left holding a live capture.
 * Unmuting only unlocks: it never turns anything back on by itself, least of
 * all a screen share.
 *
 * A boot disconnects us and keeps us disconnected while we are still standing
 * in the room, which is the only way "removed from this call" can mean
 * anything when the room is a place you can walk back into. */
let booted=null;   //  the run of the call we were removed from: {place, host, inc}
function lockMedia(muted,reason,place=0){
  const wasMuted=rooms.mutedByAdmin;
  rooms.mutedByAdmin=muted;
  if(muted && !wasMuted){
    intent.mic=intent.cam=intent.screen=false;
    for(const kind of ['mic','cam','screen'])unpublish(kind);
    stopPreview();stopDisplay();
    rooms.micOn=rooms.camOn=rooms.screenOn=false;
    diagnostic('call-mod-applied',{place,reason});
  }
}
function applyModeration(record,call){
  const run=record?.inc??0;
  /* Muted in this call, or across the whole Glurff -- which Noltbook says at
   * once, before the host's next record of the call says it too. */
  rooms.mutedInGlurff=glurffMuted(our);
  lockMedia(isMuted(record,call,our)||rooms.mutedInGlurff,'muted',call?.place??0);
  const bootedNow=isBooted(record,call,our);
  rooms.bootedByAdmin=bootedNow;
  if(bootedNow && call){
    if(!booted || booted.place!==call.place || booted.host!==call.host || booted.inc!==run){
      booted={place:call.place,host:call.host,inc:run};
      diagnostic('call-mod-applied',{place:call.place,reason:'booted'});
      releaseMedia();controller?.select(null);
    }
  } else if(booted && call && booted.place===call.place && booted.host===call.host && booted.inc===run){
    /* Allowed back in, without having to walk out and in again. */
    booted=null;
    diagnostic('call-mod-applied',{place:call.place,reason:'unbooted'});
    selectCall(call.place,rooms.host??call.host);
  }
  /* A muted participant is not played and not shown by anybody. */
  applyPlayable(record,call);
}
const barred=(place,host)=>!!booted && booted.place===place && booted.host===host;

/* Stop playing and showing anyone the record mutes. */
function applyPlayable(record,call){
  if(!sfu)return;
  const note=noteCall?.note();
  const blocked=new Set();
  for(const ship of sfu.others())if(!mayReceiveMedia(ship))blocked.add(ship);
  /* `remoteStreams` is the visible subset. Retain live publications separately
   * so a roster arriving after a stream can reveal it without a second offer. */
  for(const [id,r] of receivedStreams){
    const {ship}=r;if(!ship)continue;
    const hide=!mayReceiveMedia(ship) || glurffMuted(ship) || (note?(noteCallMuted(note,ship)||noteCallBooted(note,ship)):!mayPlay(record,call,ship));
    if(hide)blocked.add(ship);
    else rooms.remoteStreams.set(id,r);
  }
  sfu.setSilenced?.(blocked);
  traceRoomAudio('moderation');
  for(const [id,r] of [...rooms.remoteStreams])if(blocked.has(r.ship))rooms.remoteStreams.delete(id);
  for(const ship of blocked)rooms.streams.delete(ship);
  for(const {ship} of rooms.remoteStreams.values())selectRemoteCamera(ship);
  if(rooms.here!==COMMONS)sfu.setFlatGain?.(1);
  rooms.blocked=[...blocked];
}

/* Ask for something. The Glurff's host's ship decides, makes it true on the
 * call server, and tells everybody in the call; its answer is the snapshot
 * everybody takes, ourselves included. */
export function moderate(target,op){
  const note=noteCall?.note();
  if(note){
    /* Ask Noltbook. Its host ship decides, enforces on the call server, and
     * tells everybody -- including the people who joined from Noltbook. */
    if(!rooms.role)return false;
    noteModerate(note,target,op).catch(()=>{});
    return true;
  }
  return moderation?.request(target,op)??false;
}
export const modRecord=()=>moderation?.record()??null;
export const modCall=()=>moderation?.call()??null;
export const myRole=()=>rooms.role;
export const canModerate=()=>!!rooms.role;
/* HOW HIGH SOMEBODY STANDS in the call we are in, for who may act on whom:
 * 3 the host, 2 a Glurff moderator, 1 an admin of this call, 0 anybody else.
 * In a leased room it is Noltbook's own two: the note's creator, then its
 * admins and the call's together. */
export function rankFor(ship){
  const note=noteCall?.note();
  if(note){const r=noteCallRole(note,ship);return r==='host'?3:r?1:0;}
  return rankOf(moderation?.record()??null,moderation?.call()??null,ship);
}
/* Admins may act on anybody below them, and never on themselves. */
export function mayActOn(ship){
  const note=noteCall?.note();
  if(note){
    if(!rooms.role || ship===our || ship===noteCreator(note))return false;
    const theirs=noteCallRole(note,ship);
    return !(theirs && rooms.role!=='host');
  }
  return mayModerate(moderation?.record()??null,moderation?.call()??null,our,ship);
}
/* What everybody is SHOWN: "admin" for anybody with rights in this call --
 * the host, a moderator or the call's own -- and nothing for anybody else. */
export const roleFor=(ship)=>rankFor(ship)>0?'admin':null;
/* Somebody else's recording may be stopped by anybody above its recorder. */
export const mayStopRecording=()=>{
  const rec=rooms.recording;
  return !!rec && (rec.by===our || rankFor(our)>rankFor(rec.by));
};
export const mutedShip=(ship)=>{
  const note=noteCall?.note();
  return glurffMuted(ship) || (note?noteCallMuted(note,ship):isMuted(moderation?.record()??null,moderation?.call()??null,ship));
};
/* Muted by THIS call's admins, which is all a call's Unmute can lift. */
export const callMutedShip=(ship)=>{
  const note=noteCall?.note();
  return note?noteCallMuted(note,ship):isCallMuted(moderation?.record()??null,moderation?.call()??null,ship);
};
/* Muted across the whole Glurff: lifted only in the Glurff's members. */
export const glurffMutedShip=(ship)=>glurffMuted(ship) ||
  (!noteCall?.note() && !!moderation?.record()?.gmuted?.includes?.(ship));
export const bootedShip=(ship)=>{
  const note=noteCall?.note();
  return note?noteCallBooted(note,ship):isBooted(moderation?.record()??null,moderation?.call()??null,ship);
};

/* ------------------------------------------------------------- recording */

export const mayRecord=()=>canRecord() && !!rooms.role && rooms.voice==='connected';
export function startRecording(audioOnly){
  const note=noteCall?.note();
  const call=note?{place:rooms.here,host:rooms.host,gen:0}:moderation?.call();
  if(!call || !mayRecord() || rooms.recording)return false;
  recorder.ask(call,audioOnly);
  moderate(our,'record-start');
  return true;
}
export function stopRecording(){
  const rec=rooms.recording;
  if(!rec)return false;
  if(rec.by===our)recorder.stop();
  moderate(rec.by,'record-stop');
  return true;
}
export const recordingElapsed=()=>recorder?.elapsed()??0;
/* What the recorder may mix: our own outgoing audio, and everyone an admin has
 * not muted. */
function recordableAudio(){
  const out=[];
  const mine=published.mic?.stream?.getAudioTracks?.()??[];
  for(const t of mine)out.push({key:'self:'+t.id,track:t});
  const record=moderation?.record()??null,call=moderation?.call()??null;
  for(const {ship,stream} of rooms.remoteStreams.values()){
    if(!ship || ship===our || !mayReceiveMedia(ship) || glurffMuted(ship) || !mayPlay(record,call,ship))continue;
    for(const t of stream.getAudioTracks?.()??[])out.push({key:ship+':'+t.id,track:t});
  }
  return out;
}

/* Proximity volume, applied per stream from how far away someone is standing. */
export function setPositions(self, peers) {
  if (!sfu) return;
  /* INSIDE A ROOM, THE CALL IS THE BOUNDARY -- NOT PRESENCE.
   *
   * This used to pass an allowed set worked out from `peers`, the presence
   * map, so a stream was audible only while its sender also had a live avatar
   * standing in this room. Presence and the call are two different channels
   * with two different lifetimes: a presence gap, a stale avatar, or a peer we
   * simply cannot see drops somebody out of that set while their stream stays
   * in `rooms.remoteStreams`. The rail went on drawing their video and their
   * audio was silently turned down to zero.
   *
   * Being connected to this call is already proof of membership: the SFU only
   * hands us streams from the room we authenticated into, so there is nothing
   * presence can add. Mutes, boots and blocks are enforced separately by
   * applyPlayable -> setSilenced, which setFlatGain honours, so dropping the
   * allowed set loosens nothing. */
  if (rooms.here !== COMMONS) { sfu.setFlatGain(1); traceRoomAudio('room'); return; }
  const near = {};
  for (const [ship, p] of peers) near[ship] = { x: p.spot.x, y: p.spot.y };
  sfu.setPositions({ x: self.x, y: self.y }, near);
}

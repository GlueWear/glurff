import { CallController } from 'lib/call-controller';
import { diagnostic } from 'lib/diagnostics';
import { processMicrophone } from 'lib/noise';
/* Room calls.
 *
 * Walking into a room joins its call. The first person in becomes its host, and
 * the host's own broker mints tokens for everyone else -- which is what spreads
 * hosting cost across the network instead of concentrating it on one ship.
 *
 * Ames does not care about pals, so knowing a host's @p is enough to ask them
 * for a way in. Presence carries the host of whatever room a peer is standing
 * in, which means anyone you can see is an introduction to a room you could not
 * otherwise reach.
 */
import * as G from 'lib/glurff';
import { our } from 'lib/api';
import { displayName, visiblePeers, palStatus, noteCreator, nb, onChange as onNoltbook, nbAction, noteCallRole, noteCallMuted, noteCallBooted, noteCallRecording, noteModerate, noteVisibility, requestRemoteNotes, inNote, noteFacts } from 'lib/noltbook';
import { subscribeRaw } from 'lib/api';
import { createRoommates } from 'lib/roommates';
import { SfuSession } from 'lib/sfu';
import { regionAt, COMMONS } from 'world/places';
import { clusterPeers, agreedMembers, electHost, huddleKey, huddlePlace, HUDDLE_BASE } from 'lib/huddle';
import { micConstraints, camConstraints, refreshDevices } from 'lib/devices';
import { createModeration } from 'lib/moderation-session';
import { roleOf, isMuted, isBooted, mayPlay, recordingOf } from 'lib/moderation';
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
  streams: new Map(),        //  ship -> MediaStream, from the SFU
  remoteStreams: new Map(),  // SFU stream id -> {ship, stream, label}
  localStreams: new Map(),   //  'cam' | 'screen' -> our own stream, for self-preview
  micOn: false,
  camOn: false,
  screenOn: false,
  /* A call is being held back until positions can be trusted. */
  waiting: false,
  /* What a call that has not connected is waiting on: 'waiting-ship' is our own
   * ship not having taken the request yet, 'waiting-host' is the host not
   * answering. Everything else is the call's own phase. */
  stage: 'idle',
  /* Hosting being handed over: the offer we made, and one made to us. */
  hostAsk: null,
  hostOffer: null,
  /* Other ships actually in the call with us, as the call server reports. */
  others: 0,
  /* At the door of a room whose copies our pals are spread across: the copies
   * to choose from, {place, options:[{host, count}]}. No call until one is chosen. */
  picker: null,
  /* MODERATION, as the call's host keeps it; see lib/moderation. `role` is
   * ours in this call -- 'host', 'admin' or null -- and the two flags are what
   * an admin has done TO US. `recording` is whoever is recording, for the
   * notice everybody sees. */
  /* THE LEASE we hold: {place, note} or null. One at a time, by rule. */
  lease: null,
  mod: null,
  role: null,
  mutedByAdmin: false,
  bootedByAdmin: false,
  recording: null,
};
if (typeof window !== 'undefined') window.rooms = rooms;

let sfu=null, controller=null, huddle=null, lastPeers=new Map();
let moderation=null, recorder=null, noteCall=null;
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
let positionGate={ready:()=>true,reliable:()=>true,confidence:()=> 'live-stationary'};
export const setPositionGate=gate=>{positionGate={...positionGate,...gate};};
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
export const roomOf=(who,spot)=>roomOfPeer(who,spot);
const isRoomPlace=place=>Number.isSafeInteger(place) && place>COMMONS && place<1000;
/* Rooms and huddles both keep a guest list; see lib/roommates. */
const isListPlace=place=>Number.isSafeInteger(place) && place>COMMONS && place<HUDDLE_BASE+900000;
function createMates(){
  return createRoommates({our,send:G.sendPresence,trace:diagnostic,
    blocked:who=>palStatus(who)==='blocked',
    pal:who=>['mutual','requesting'].includes(palStatus(who)),
    here:()=>roomContext.here(),
    standing:()=>rooms.here,
    watchers:()=>roomContext.watchers(),
    changed:why=>{queueRoomCallSync();for(const fn of mateListeners){try{fn(why);}catch(e){console.error(e);}}},
  });
}
/* MAY THIS SHIP BE ON THIS ROOM'S LIST?
 *
 * An ordinary room answers with its own mode -- open, or pals. A LEASED room
 * does not get to answer at all: its note decides, because the note is what
 * the room now is. Without this the host's guest list admitted anybody who
 * asked, so somebody who is not in a private note turned up on the room's list
 * the moment their client asked to join the call -- which it does whenever it
 * has not yet heard that the room is leased.
 *
 * Noltbook remains the authority; this only stops us listing people it would
 * refuse. Membership we have not learned yet is not membership. */
function admitsToRoom(who,place){
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
    ? { place: lease.place, note: lease.note } : null;
  const same = (rooms.lease?.place ?? null) === (next?.place ?? null) &&
               (rooms.lease?.note ?? null) === (next?.note ?? null);
  if (same) return;
  const was = rooms.lease;
  rooms.lease = next;
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
function republishLease() {
  const note = rooms.lease?.place === rooms.here ? rooms.lease.note : null;
  /* The note's own visibility travels with it: it is what tells everybody
   * else whether this room is open, asks first, or is closed. */
  mates?.setNote?.(note, note ? noteVisibility(note) : null);
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
    mates?.setMembers?.((nb.notes[note]?.users ?? []).filter((s) => s !== our));
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
    return { note: rooms.lease.note, vis: noteVisibility(rooms.lease.note) };
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
export function roomClosed(place) {
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
export function roomGate(place) {
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
/* Every note a room we can see is leased to. Members of those notes see each
 * other in the world; see setLeasedNotes in lib/noltbook. */
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
export const callPeers=()=>sfu?.others()??new Set();
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
export const receiveRoomEvent=(who,event)=>mates?.receive(who,event);
export const tickRoom=()=>mates?.tick();
let listeners=new Set();
export const onRooms=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
const changed=()=>listeners.forEach(fn=>{try{fn();}catch(e){console.error(e);}});

function selectRemoteCamera(ship) {
  const video=[...rooms.remoteStreams.values()].find(r=>r.ship===ship && r.label!=='screen' && r.stream.getVideoTracks().some(t=>t.readyState!=='ended'));
  if(video)rooms.streams.set(ship,video.stream);else rooms.streams.delete(ship);
}
function removeRemoteStream(id,ship) {
  rooms.remoteStreams.delete(id);selectRemoteCamera(ship);changed();
}

export function initRooms() {
  mates=createMates();
  if(typeof window!=='undefined')window.glurffRoomDiagnostics=()=>({...mates.stats(),current:mates.current(),picker:rooms.picker,
    huddle:huddle?{state:huddle.state,host:huddle.host,place:huddle.place,session:huddle.session,
      epoch:huddle.epoch,rev:huddle.rev,members:[...huddle.members],pending:huddlePending?.key??null,
      recovery:huddleRecovery?.tries??0}:null,
    call:controller?.diagnostics?.()??null});
  sfu=new SfuSession({our,
    /* WHOEVER THE CALL SERVER GAVE US. Gating this on `visiblePeers` made a
     * call stream depend on world visibility: a legitimate participant we
     * could not currently see was dropped outright and never heard again,
     * even after they became visible. Blocking is still honoured -- that is a
     * decision about a person, not about whether we can see them. */
    onStream:(ship,stream,meta={})=>{if(ship && ship!==our && palStatus(ship)!=='blocked'){
      rooms.remoteStreams.set(meta.id??stream.id,{ship,stream,label:meta.label??'camera'});selectRemoteCamera(ship);changed();
    }},
    onStreamRemoved:removeRemoteStream,
    onPeerLeft:ship=>{for(const [id,r] of rooms.remoteStreams)if(r.ship===ship)rooms.remoteStreams.delete(id);rooms.streams.delete(ship);changed();},
    onStatus:(status,why)=>{
      /* In a leased room the call is Noltbook's, so the Glurff controller is
       * not the thing to tell. */
      if(noteCall?.note()){
        if(status==='connected'){rooms.voice='connected';rooms.error=null;restoreIntent();}
        else if(status==='failed'||status==='closed'){rooms.voice='retrying';noteCall.retry();}
        changed();refreshStage();return;
      }
      controller?.status(status,why);
    },
    onUsers:()=>{const others=sfu?.others()??new Set();mates?.inCall(others);const n=others.size;if(n!==rooms.others){rooms.others=n;changed();}
      /* A recording whose recorder has left the call is stopped by the host:
       * nobody else can, and a REC notice for a recording that is not
       * happening is worse than none. */
      moderation?.membersChanged();watchAlone();},
    onPermissions:(may)=>{
      /* The call server withdrew the right to publish: a mute we may not have
       * heard about yet. Our own capture is left alone until the record says
       * so -- this only stops us offering into a refusal. */
      diagnostic('call-permissions',{present:!!may,place:controller?.current?.place??0});
      if(may && rooms.voice==='connected')restoreIntent();
      changed();
    },
  });
  moderation=createModeration({our,send:G.sendPresence,trace:diagnostic,
    members:callMembers,
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
      rooms.host=noteHostOf(grant.noteId)??rooms.host;
      if(sfu?.refreshGrant?.(grant)===true)return;   //  a renewal of the same room
      sfu?.connect(grant);
    },
    onStatus:(status,why)=>{
      rooms.voice=status==='requesting'?'requesting':status==='failed'?'blocked':status==='ended'?'idle':rooms.voice;
      rooms.error=status==='failed'?(why??'refused'):null;
      changed();refreshStage();
    },
  });
  controller=new CallController({our,sfu,trace:diagnostic,
    transport:{send:G.sendPresence,operation:G.callOperation},
    known:who=>visiblePeers().includes(who),
    /* Rooms and huddles admit by their guest list, not by where the host
     * happens to see you standing: asking for the call is asking to be on the
     * list, and the mode decides. Somebody the host cannot see yet is on the
     * list the moment they ask, and seen as soon as their state arrives. */
    accepts:(who,place)=>place>=HUDDLE_BASE
      ? huddle?.place===place && huddle.host===our && !!mates?.admit(who,place)
      : rooms.here===place && admitsToRoom(who,place) && !!mates?.admit(who,place),
    changed:(phase,error)=>{
      rooms.voice=phase;rooms.error=error;watchAlone();
      if(phase==='connected'){
        /* The call server's own generation is what tells two incarnations of
         * the same room apart, so moderation is bound to it rather than to
         * anything we could invent. */
        const c=controller?.current;
        if(c){
          const incarnation={place:c.place,host:c.host,gen:c.grant?.gen??0};
          /* Hosting just moved to us: take up the record that came with it,
           * bound to the generation of the call we have actually joined. */
          if(c.host===our && carriedMod){moderation?.assume(incarnation,carriedMod);carriedMod=null;}
          else moderation?.enter(incarnation);
        }
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
    readModeration();changed();
  },c=>['calls','callMods','noteAdmins'].includes(c.field));
  /* OUR OWN LEASED NOTE changing its settings -- opened up, closed down, a
   * member added -- has to reach everybody standing in the room. The roster is
   * how they hear it, so publish it again. */
  onNoltbook(()=>{
    if(rooms.lease?.place===rooms.here && rooms.host===our)republishLease();
    changed();
  },c=>c.field==='notes' && (!c.noteId || c.noteId===rooms.lease?.note));
  if(typeof window!=='undefined')window.__grants=[];
  return G.watchCallAccess((name,p)=>{
    if(movementResult?.(name,p))return;
    if(typeof window!=='undefined'){
      window.__grants.push({name,room:p.room,gen:p.gen,err:p.err,who:p.participant??p.who});
      if(window.__grants.length>100)window.__grants.shift();
    }
    controller.result(name,p);
  });
}
function selectCall(place,host,{preserve=false}={}) {
  /* A LEASED ROOM: the call is the note's, so Glurff opens nothing. Noltbook
   * decides who may join it -- membership of the note -- and the note owner's
   * ship mints for everybody, whether or not they are here. */
  const bound=leaseNote(place,host);
  if(bound){
    if(noteCall?.note()===bound)return;
    releaseMedia();controller?.select(null);moderation?.enter(null);
    rooms.host=noteHostOf(bound)??host;
    rooms.timings={requested:performance.now(),role:noteCreator(bound)===our?'host':'guest'};
    if(isListPlace(place) && host)mates?.follow(place,host);
    /* Hosting our own leased room: the list carries the lease, so anybody who
     * can see us knows which note this room is. */
    if(host===our)republishLease();
    noteCall?.enter(bound);
    refreshStage();return;
  }
  if(noteCall?.note())noteCall.leave();
  if(controller?.current?.place===place && controller.current.host===host)return;
  /* Removed from this call: standing in the room is not a way back in. The bar
   * lifts when an admin allows us back, or when the call is a new one. */
  if(barred(place,host)){releaseMedia();controller?.select(null);rooms.host=host;changed();return;}
  if(!preserve)releaseMedia();rooms.host=host;
  rooms.timings={requested:performance.now(),role:host===our?'host':'guest'};
  controller?.select({place,host},{preserve});
  /* In a room or a huddle, we are on its host's list -- or keep the list, if the
   * host is us. */
  if(isListPlace(place) && host)mates?.follow(place,host);
  else mates?.leave();
  /* A room we hold a lease on carries it from the moment we host it. */
  if(host===our)republishLease();
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
  /* The ACTOR is the ship the agent says sent this, never a field in it. */
  if(event?.kind==='call-huddle-roster' || event?.kind==='call-huddle-end' || event?.kind==='call-huddle-sync'){
    receiveHuddleEvent(who,event);return;
  }
  if(typeof event?.kind==='string' && event.kind.startsWith('call-mod-')){moderation?.receive(who,event);return;}
  if(HANDOFF.has(event?.kind)){receiveHandoff(who,event);return;}
  if(event?.kind==='call-leave' && isListPlace(event.place))mates?.left(who,event.place);
  controller?.receive(who,event);
}
export function recoverCall(){controller?.restored();}
export function retryCall(){controller?.retry();}
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
  for(const who of targets)if(who!==our)Promise.resolve(G.sendPresence(who,body)).catch(()=>{});
}
const huddleSummaryOf=r=>({host:r.host,place:r.place,epoch:r.epoch,session:r.session,rev:r.rev,
  members:[...r.members].sort()});
function clearHuddle(reason='ended',notify=false){
  const before=huddle;if(!before)return;
  if(notify && before.host===our)sendHuddle('call-huddle-end',before,before.members);
  diagnostic('huddle',{reason,place:before.place,host:before.host,count:0,detail:before.session});
  huddle=null;huddlePending=null;huddleRecovery=null;rooms.host=null;booted=null;
  releaseMedia();controller?.select(null);mates?.leave();changed();
}
function useHuddle(record,reason='roster',preserve=false){
  const before=huddle;
  huddle={...record,key:huddleKey(record.members),state:preserve?'transitioning':'active',authorityAt:Date.now()};
  huddlePending=null;
  diagnostic('huddle',{reason,place:record.place,host:record.host,count:record.members.length,
    detail:`${record.session}/${record.rev}`});
  const changedCall=!before || before.place!==record.place || before.host!==record.host;
  if(changedCall)selectCall(record.place,record.host,{preserve:preserve && rooms.voice==='connected'});
  if(huddle.state!=='active')huddle.state='active';
  changed();
}
function hostHuddle(members,reason='formed'){
  const token=huddleSession();
  const record={...token,rev:1,host:our,place:huddlePlace(our),members:[...members].sort()};
  useHuddle(record,reason,!!huddle);
  sendHuddle('call-huddle-roster',record);
}
function updateHostedHuddle(members,reason='changed'){
  const before=huddle;if(!before || before.host!==our)return;
  const old=[...before.members];
  const record={...before,rev:before.rev+1,members:[...members].sort(),authorityAt:Date.now(),state:'active'};
  huddle={...record,key:huddleKey(record.members)};
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
   * rosters describe the same group. A deliberate handoff is trusted too. */
  if(huddleHandoff?.host===record.host)return true;
  if(!lastPeers.has(current.host))return true;
  const union=new Set([...current.members,...record.members]);
  return record.members.includes(current.host) && [...union].sort()[0]===record.host;
}
function locallyNearRoster(record){
  if(record.host===our)return true;
  const us=huddleSelf;if(!us)return false;
  return record.members.some(who=>{
    if(who===our)return false;
    const p=lastPeers.get(who)?.spot;
    return p && roomOfPeer(who,p)===COMMONS && Math.hypot(p.x-us.x,p.y-us.y)<=3;
  });
}
function receiveHuddleEvent(who,event){
  if(who===our || !safeShip(who))return;
  if(event.kind==='call-huddle-sync'){
    if(huddle?.host===our && huddle.members.includes(who))sendHuddle('call-huddle-roster',huddle,[who]);
    return;
  }
  const record=readHuddleRecord(event);if(!record || record.host!==who)return;
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
  if(rooms.here!==COMMONS)return;
  /* Never START a call from positions we cannot trust. Right after startup the
   * movement relay is not carrying positions yet and each browser's picture of
   * the other is seconds old: two browsers pick different huddles, and neither
   * ever admits the other. Wait for positions, then decide. A huddle that
   * already exists keeps its members, so a relay hiccup never hangs one up. */
  if(!huddle && !positionGate.ready())return;
  const near={[our]:{x:self.x,y:self.y}},hosts={};
  for(const [who,p] of peers)if(roomOfPeer(who,p.spot)===COMMONS && (positionGate.reliable(who) || huddle?.members.includes(who))){near[who]=p.spot;hosts[who]=p.host??null;}
  /* The host's presence snapshot is the durable copy of its roster. Direct
   * events normally arrive first; this repairs a lost event or a late join. */
  const authority=huddle?.host?peers.get(huddle.host)?.huddle:null;
  if(authority)receiveHuddleEvent(huddle.host,{kind:'call-huddle-roster',...authority});
  /* Membership agreed with what the people near us say they are in; see
   * agreedMembers in lib/huddle. */
  const together=agreedMembers(our,near,hosts,huddle?.members??[],huddle?.host??null);
  const mine=clusterPeers(near,together).find(c=>c.includes(our));
  const key=mine?huddleKey(mine):null;
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
  if((huddle?.key??null)===key){huddlePending=null;return;}
  /* An unreliable member freezes a live host roster. In particular, a final
   * stationary packet can be old and healthy, while an old moving packet is a
   * stalled route; neither is authority to remove somebody. */
  if(huddle?.host===our && huddle.members.some(who=>who!==our &&
    ['delayed','stalled'].includes(positionGate.confidence(who))))return;
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
  /* The call is the host's (see huddlePlace): somebody joining or leaving
   * changes who is in it, not which call it is, so nobody reconnects. */
  /* A huddle handed to somebody stays theirs while they are in it. Without
   * this the lowest @p wins the election straight back and the handoff undoes
   * itself in the same beat. */
  if(huddleHandoff && !mine.includes(huddleHandoff.host))huddleHandoff=null;
  /* `hosts` is what each person near us says their own host is. Passing it in
   * is what lets two browsers notice they disagree and settle on the same
   * answer; see electHost. A handoff we are running is trusted over it. */
  const host=electHost(mine,huddleHandoff?.host??huddle?.host??null,hosts,!!huddleHandoff);
  if(!huddle){
    if(host===our)hostHuddle(mine,'formed');
    else G.sendPresence(host,{kind:'call-huddle-sync',host,place:huddlePlace(host)}).catch(()=>{});
    return;
  }
  updateHostedHuddle(mine,'changed');
}
const occupantsIn=room=>[our,...[...lastPeers].filter(([who,p])=>roomOfPeer(who,p.spot)===room).map(([s])=>s)].sort();
/* THE DOOR. The copies of a room that people we can see are in, where a copy
 * counts only once it has somebody besides its host: a host alone in a room is
 * somebody who just walked in, not a party to choose. Hosts we cannot see
 * standing in the room are not offered. */
const chosen=new Map();   //  room -> the host picked at its door, this visit
function doorOptions(room){
  if(!mates)return [];
  const occupants=new Set(occupantsIn(room));
  return [...mates.instances(room)].filter(([host,r])=>r.count>=2 && host!==our && occupants.has(host))
    .map(([host,r])=>({host,count:r.count,note:r.note??null}))
    .sort((a,b)=>b.count-a.count || (a.host<b.host?-1:1));
}
export function chooseRoomHost(host){
  const picker=rooms.picker;
  if(!picker || rooms.here!==picker.place || !picker.options.some(o=>o.host===host))return false;
  chosen.set(picker.place,host);rooms.picker=null;
  diagnostic('room-door',{place:picker.place,host,count:picker.options.length,reason:'chosen'});
  if(positionGate.ready())selectCall(picker.place,host);
  else rooms.waiting=true;
  changed();
  return true;
}
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
  /* A room handed to someone stays theirs while they are in it. */
  const handed=handoffs.get(room);
  if(handed && occupants.includes(handed))return handed;
  if(handed)handoffs.delete(room);
  /* So does a copy chosen at the door. */
  const picked=chosen.get(room);
  if(picked && occupants.includes(picked))return picked;
  if(picked)chosen.delete(room);
  const announced=[...lastPeers].filter(([who,p])=>roomOfPeer(who,p.spot)===room).map(([,p])=>p.host).filter(h=>occupants.includes(h));
  if(rooms.here===room && occupants.includes(rooms.host))announced.push(rooms.host);
  return announced.sort()[0]??occupants[0];
}
export function refresh(peers) {
  lastPeers=peers;
  const live=new Map();
  for(const [who,p] of peers){const room=roomOfPeer(who,p.spot);if(room===COMMONS)continue;
    const r=live.get(room)??{host:null,occupants:new Set()};r.occupants.add(who);if(p.host)r.host=p.host;live.set(room,r);}
  if(rooms.here!==COMMONS){const host=roomHost(rooms.here),r=live.get(rooms.here)??{host,occupants:new Set()};r.occupants.add(our);r.host=host;live.set(rooms.here,r);
    /* The room's host is only chosen once positions are trustworthy; see
     * updateHuddle for why. main.js re-runs this when that changes. */
    /* Standing at the door of a room split between copies: nothing until one
     * is chosen. If the split goes away meanwhile, so does the question. */
    if(rooms.picker){
      const options=doorOptions(rooms.here);
      if(options.length<2){rooms.picker=null;changed();}
      else if(JSON.stringify(options)!==JSON.stringify(rooms.picker.options)){rooms.picker={place:rooms.here,options};changed();}
    }
    if(!rooms.picker && host!==rooms.host && positionGate.ready())selectCall(rooms.here,host);}
  const waiting=rooms.here!==COMMONS && rooms.host===null && !positionGate.ready();
  if(waiting!==rooms.waiting){rooms.waiting=waiting;changed();}
  const same=live.size===rooms.live.size && [...live].every(([id,r])=>{const old=rooms.live.get(id);return old && old.host===r.host && old.occupants.size===r.occupants.size && [...r.occupants].every(s=>old.occupants.has(s));});
  /* SOMEBODY HAS ARRIVED IN THE ROOM WE LEASED. Their client is waiting for
   * the list -- it is how they learn which note this room is, and for a secret
   * note it is the only way -- so say it now rather than at the next heartbeat
   * with them standing outside a door that is theirs. */
  if(!same && rooms.lease?.place===rooms.here && rooms.host===our)republishLease();
  rooms.live=live;if(!same)changed();
}
export function enterRoom(room) {
  if(room===rooms.here)return;
  if(room===COMMONS){leaveRoom();return;}
  if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
  mates?.leave();chosen.clear();booted=null;
  huddle=null;huddlePending=null;rooms.here=room;rooms.host=null;rooms.picker=null;clearHandoff();
  /* People we can see are in more than one copy of this room: ask which. */
  const options=doorOptions(room);
  if(options.length>=2){
    releaseMedia();controller?.select(null);
    rooms.picker={place:room,options};
    diagnostic('room-door',{place:room,count:options.length,reason:'asked'});
    changed();return;
  }
  const host=roomHost(room);if(host===our)G.claimRoom(room).catch(()=>{});
  if(positionGate.ready())selectCall(room,host);
  else {releaseMedia();controller?.select(null);rooms.waiting=true;}   //  never stay in the call we walked out of
  changed();
}
export function leaveRoom() {
  noteCall?.leave();
  if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
  clearHandoff();mates?.leave();chosen.clear();booted=null;
  rooms.here=COMMONS;rooms.host=null;rooms.waiting=false;rooms.picker=null;huddlePending=null;releaseMedia();controller?.select(null);changed();
}
// Legacy room claims update the display; admission uses correlated call-request.
export function noteHost(who,room){if(rooms.here===room && lastPeers.has(who))refresh(lastPeers);}
export function clearHost(who,room){const r=rooms.live.get(room);r?.occupants.delete(who);if(r?.host===who)r.host=null;}
export function answerKnock(){}

/* Handing a room's hosting to someone else in it.
 *
 * The host asks; the person answers. On a yes the host tells everyone in the
 * room, releases its claim and joins the new host's call like any guest, while
 * the new host claims the room and opens the call on its own broker. Only the
 * host everyone already follows can move hosting, only to someone standing in
 * the room, and only with their yes -- hosting spends their broker. The call
 * drops for a moment while everyone reconnects to the new host.
 *
 * Everyone who saw the handover keeps following the new host while that host
 * stays in the room; otherwise the lowest @p would win the election straight
 * back. Anyone arriving later hears the new host announced by those inside.
 * Commons huddles are not handed over: their host follows from who is in them. */
const HANDOFF=new Set(['call-host-offer','call-host-accept','call-host-decline','call-host-moved']);
/* A huddle handed over: the host chosen, kept while they are still in it. A
 * huddle's call is its HOST's (see huddlePlace), so moving hosting moves
 * everybody to a different place -- which is why the move is announced to the
 * members rather than derived, and why a late arrival hears it from them. */
let huddleHandoff=null;
const HANDOFF_MS=30000;
const handoffs=new Map();   //  room -> the host it was handed to
const isRoom=place=>Number.isSafeInteger(place) && place>COMMONS && place<1000;
function clearHandoff(){handoffs.clear();huddleHandoff=null;rooms.hostAsk=null;rooms.hostOffer=null;}
/* The huddle we are in, as a place a handoff can name. */
const huddleNow=()=>huddle&&rooms.here===COMMONS?huddle:null;
const inHuddle=(ship)=>!!huddleNow()?.members.includes(ship);
function expireHandoffLater(){
  setTimeout(()=>{
    const t=Date.now();let moved=false;
    if(rooms.hostAsk && t>=rooms.hostAsk.until){rooms.hostAsk=null;moved=true;}
    if(rooms.hostOffer && t>=rooms.hostOffer.until){rooms.hostOffer=null;moved=true;}
    if(moved)changed();
  },HANDOFF_MS+100);
}
const tellHandoff=(who,kind,place,id,extra={})=>Promise.resolve(G.sendPresence(who,{kind,place,attempt:id,...extra})).catch(()=>{});
/* Hosting can be handed on in an authored room, and in a proximity huddle --
 * where the members are the people actually in it, never everyone standing
 * about in the commons. */
export const canHandOff=()=>positionGate.ready() &&
  ((isRoom(rooms.here) && rooms.host===our) || (!!huddleNow() && huddleNow().host===our));
/* Who this host may hand to: a member of THIS call, not a bystander. */
export function mayHandTo(ship){
  if(!canHandOff() || ship===our || !visiblePeers().includes(ship))return false;
  const h=huddleNow();
  return h && h.host===our ? h.members.includes(ship) : occupantsOf(rooms.here).includes(ship);
}
export function offerHost(ship){
  if(!mayHandTo(ship))return false;
  const h=huddleNow();
  const place=h&&h.host===our?h.place:rooms.here;
  const id=Date.now()*1000+Math.floor(Math.random()*1000);
  rooms.hostAsk={to:ship,place,id,until:Date.now()+HANDOFF_MS,huddle:!!h};
  tellHandoff(ship,'call-host-offer',place,id,h?{members:h.members}:{});
  expireHandoffLater();changed();
  return true;
}
export function answerHostOffer(accept){
  const offer=rooms.hostOffer;
  if(!offer || offer.accepted)return;
  /* Still the same offer, about a call we are still in, from the host of it.
   * A huddle's place is not where we are standing -- the commons is -- so it
   * is the huddle's own place and host that have to match. */
  const h=huddleNow();
  const current=Date.now()<offer.until && (offer.huddle
    ? !!h && h.place===offer.place && h.host===offer.from
    : rooms.here===offer.place && rooms.host===offer.from);
  if(!accept || !current){
    rooms.hostOffer=null;tellHandoff(offer.from,'call-host-decline',offer.place,offer.id);changed();return;
  }
  /* Nothing changes here until the host confirms: it may have moved on. */
  rooms.hostOffer={...offer,accepted:true};
  tellHandoff(offer.from,'call-host-accept',offer.place,offer.id);changed();
}
/* Where a handoff event is about: an authored room, or the huddle whose place
 * the sender named. A huddle's place is a function of its HOST, so the place
 * in the event identifies the call being moved, not where it is going. */
const handoffPlace=(place)=>isRoom(place)?'room':(huddleNow()?.place===place?'huddle':null);

/* The moderation record handed over with hosting, held until our own call
 * connects and we know the generation it belongs to. */
let carriedMod=null;

function receiveHandoff(who,event){
  const {kind,place,attempt:id}=event;
  const scope=handoffPlace(place);
  if(!scope || !Number.isSafeInteger(id) || who===our)return;
  const h=scope==='huddle'?huddleNow():null;
  const hostNow=h?h.host:rooms.host;
  const membersNow=()=>h?h.members:occupantsOf(place);

  if(kind==='call-host-offer'){
    /* Only the host of the call we are actually in may offer it, and only to
     * somebody who is in it -- us. */
    const ours=scope==='huddle'?h.members.includes(our):rooms.here===place;
    if(!ours || hostNow!==who || !visiblePeers().includes(who)){tellHandoff(who,'call-host-decline',place,id);return;}
    rooms.hostOffer={from:who,place,id,until:Date.now()+HANDOFF_MS,huddle:scope==='huddle'};
    expireHandoffLater();changed();return;
  }
  if(kind==='call-host-decline'){
    if(rooms.hostAsk?.to===who && rooms.hostAsk.id===id){rooms.hostAsk=null;changed();}
    return;
  }
  if(kind==='call-host-accept'){
    const ask=rooms.hostAsk;
    if(!ask || ask.to!==who || ask.id!==id || ask.place!==place)return;
    rooms.hostAsk=null;
    if(Date.now()>=ask.until || hostNow!==our || !membersNow().includes(who)){
      tellHandoff(who,'call-host-decline',place,id);changed();return;
    }
    /* A recording is the outgoing host's to finish: it must not be left
     * running against a call that is about to become somebody else's. */
    if(rooms.recording)stopRecording();
    /* Promotions, mutes and boots go with hosting, so a transfer does not
     * quietly un-mute somebody. */
    const carry=moderation?.carry()??null;
    for(const s2 of membersNow())if(s2!==our)
      tellHandoff(s2,'call-host-moved',place,id,{host:who,...(s2===who&&carry?{mod:carry}:{})});
    if(scope==='huddle'){
      huddleHandoff={host:who,at:Date.now()};
      moderation?.enter(null);
      controller?.hosted.delete(place);
      /* The recipient mints the new authoritative session. Everyone else gets
       * the ordinary moved notice and then its roster. */
      huddle={...huddle,host:who,place:huddlePlace(who),state:'transitioning'};
      selectCall(huddlePlace(who),who,{preserve:true});changed();return;
    }
    /* HANDING A LEASED ROOM ON GIVES THE ROOM BACK.
     *
     * A leased room's call is the note's, minted by the note's own ship -- it
     * is not ours to hand to anybody. Worse, while the lease stands every
     * client picks the lease holder as the room's host, so a handoff was
     * immediately elected back and the call flapped between the two of them.
     *
     * So the lease ends here and what is handed over is an ordinary Glurff
     * room. No re-select: the handoff is about to choose the new host's call
     * itself, and selecting our own in between would start a call we are in
     * the middle of giving away. */
    if(rooms.lease?.place===place){
      diagnostic('room-lease',{place,reason:'handed-on'});
      G.dropLease().catch(()=>{});
      setLease(null,{reselect:false});
    }
    handoffs.set(place,who);
    G.releaseRoom(place).catch(()=>{});
    controller?.hosted.delete(place);   //  our broker's room is no longer the call
    moderation?.enter(null);
    selectCall(place,who);changed();return;
  }
  if(kind==='call-host-moved'){
    const host=event.host;
    /* Only the host we follow can say hosting moved, and never to itself. */
    if(typeof host!=='string' || hostNow!==who || host===who)return;
    if(scope==='huddle' && !h.members.includes(host))return;   //  never to a non-member
    if(host===our){
      const offer=rooms.hostOffer;
      if(!offer?.accepted || offer.from!==who || offer.id!==id || offer.place!==place)return;   //  we never agreed
      rooms.hostOffer=null;
      /* Carried moderation is applied once our own call connects and its
       * generation is known; see the controller's `connected`. */
      carriedMod=event.mod&&typeof event.mod==='object'?{...event.mod,rev:Number(event.mod.rev)||0}:null;
      if(scope==='room')G.claimRoom(place).catch(()=>{});
    } else if(scope==='room' && !occupantsOf(place).includes(host)) return;   //  a host we cannot see is not one we can join
    if(scope==='huddle'){
      huddleHandoff={host,at:Date.now()};
      moderation?.enter(null);
      if(host===our){hostHuddle(h.members,'handed');return;}
      huddle={...huddle,host,place:huddlePlace(host),state:'transitioning'};
      selectCall(huddlePlace(host),host,{preserve:true});changed();return;
    }
    handoffs.set(place,host);
    moderation?.enter(null);
    selectCall(place,host);changed();
  }
}
export const occupantsOf=room=>[...(rooms.live.get(room)?.occupants??[])];
export const hostOf=room=>rooms.live.get(room)?.host??null;
export const hostName=room=>{const h=hostOf(room);return h?displayName(h):null;};
/* Connected to the call server, but nobody else in the call. From one browser
 * "they are on their way" and "they joined a different call" look the same, so
 * after twenty seconds it is written down, with what we believed, for whoever
 * reads the diagnostics. */
let aloneTimer=null;
function watchAlone(){
  if(!(rooms.voice==='connected' && !rooms.others)){clearTimeout(aloneTimer);aloneTimer=null;huddleRecovery=null;return;}
  if(aloneTimer)return;
  aloneTimer=setTimeout(()=>{
    aloneTimer=null;
    if(rooms.voice!=='connected' || rooms.others)return;
    diagnostic('call-alone',{place:controller?.current?.place??0,host:rooms.host??'',
      count:huddle?.members.length??occupantsOf(rooms.here).length,
      context:huddle?`${huddle.session}/${huddle.rev}`:''});
    /* A huddle of one on the SFU asks its authority what the current session is.
     * The reply repairs a stale host/place without inventing a competing call. */
    if(huddle && huddle.members.length>1){
      if(!huddleRecovery || huddleRecovery.session!==huddle.session)
        huddleRecovery={session:huddle.session,tries:0};
      if(huddleRecovery.tries<3){
        huddleRecovery.tries++;
        if(huddle.host===our)sendHuddle('call-huddle-roster',huddle);
        else G.sendPresence(huddle.host,{kind:'call-huddle-sync',host:huddle.host,place:huddle.place,
          session:huddle.session,epoch:huddle.epoch,rev:huddle.rev}).catch(()=>{});
        /* A third synchronized-but-empty result is worth one clean retry of the
         * same target. Earlier attempts never disturb a working socket. */
        if(huddleRecovery.tries===3)controller?.retry();
        watchAlone();
      }
    }
  },20000);
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
export function closeTab(){noteCall?.leave();mates?.leave();controller?.close();clearHandoff();clearTimeout(huddleTimer);huddleTimer=null;huddlePending=null;clearTimeout(stageTimer);stageTimer=null;huddle=null;rooms.here=COMMONS;rooms.host=null;intent.mic=intent.cam=intent.screen=false;releaseMedia();stopPreview();stopDisplay();}

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
function startDisplay(){
  if(display)return Promise.resolve(display);
  if(displaying)return displaying;
  const task=navigator.mediaDevices.getDisplayMedia({video:true}).then(stream=>{
    /* Asked again while this one was in flight, or switched off while the
     * browser was still asking: do not leave a capture running unwatched. */
    if(displaying!==task || !intent.screen){stream.getTracks().forEach(t=>t.stop());return null;}
    displaying=null;
    display={stream};
    rooms.localStreams.set('screen',stream);
    for(const t of stream.getTracks())t.addEventListener?.('ended',()=>{
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
  if(rooms.mutedByAdmin)return;
  for(const kind of ['mic','cam','screen'])if(intent[kind] && !published[kind])
    publish(kind,GET[kind],LABEL[kind]).catch(e=>{rooms.error=String(e.message??e);changed();});
}

function publish(kind,get,label) {
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
  try { id = await sfu.publish(stream, label); } catch(e) {media.cleanup();throw e;}
  if(epoch !== captureEpoch || !intent[kind]) {sfu.unpublish(id);media.cleanup();return;}
  published[kind] = { id, stream, cleanup:media.cleanup };
  /* The call's own copy dying -- a renegotiation gone wrong -- is not the end
   * of the share: drop the publication and let restoreIntent make another. */
  if(kind==='screen')for(const track of stream.getTracks())track.addEventListener?.('ended',()=>{
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
  /* An admin's mute locks all three until it is lifted. */
  if(rooms.mutedByAdmin && !intent[kind])return;
  intent[kind]=!intent[kind];
  rooms[`${kind}On`]=intent[kind];
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
  return [...new Set([our,...others,...here,...guests])];
}

/* The call we are in, for the moderation rules. */
const callNow=()=>{const c=controller?.current;return c?{place:c.place,host:c.host,gen:c.grant?.gen??0}:null;};

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
    rooms.mutedByAdmin=noteCallMuted(note,our);
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
let booted=null;   //  the call incarnation we were removed from
function applyModeration(record,call){
  const muted=isMuted(record,call,our);
  const wasMuted=rooms.mutedByAdmin;
  rooms.mutedByAdmin=muted;
  if(muted && !wasMuted){
    intent.mic=intent.cam=intent.screen=false;
    for(const kind of ['mic','cam','screen'])unpublish(kind);
    stopPreview();stopDisplay();
    rooms.micOn=rooms.camOn=rooms.screenOn=false;
    diagnostic('call-mod-applied',{place:call?.place??0,reason:'muted'});
  }
  const bootedNow=isBooted(record,call,our);
  rooms.bootedByAdmin=bootedNow;
  if(bootedNow && call){
    if(!booted || booted.place!==call.place || booted.host!==call.host || booted.gen!==call.gen){
      booted={...call};
      diagnostic('call-mod-applied',{place:call.place,reason:'booted'});
      releaseMedia();controller?.select(null);
    }
  } else if(booted && call && booted.place===call.place && booted.host===call.host && booted.gen===call.gen){
    /* Allowed back in, without having to walk out and in again. */
    booted=null;
    diagnostic('call-mod-applied',{place:call.place,reason:'unbooted'});
    selectCall(call.place,call.host);
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
  for(const {ship} of rooms.remoteStreams.values()){
    if(!ship)continue;
    const hide=note?(noteCallMuted(note,ship)||noteCallBooted(note,ship)):!mayPlay(record,call,ship);
    if(hide)blocked.add(ship);
  }
  sfu.setSilenced?.(blocked);
  traceRoomAudio('moderation');
  for(const [id,r] of [...rooms.remoteStreams])if(blocked.has(r.ship))rooms.remoteStreams.delete(id);
  for(const ship of blocked)rooms.streams.delete(ship);
  rooms.blocked=[...blocked];
}

/* Ask for something. The host does it; everyone else asks the host, and the
 * host's answer is the snapshot everybody takes. */
export function moderate(target,op){
  const note=noteCall?.note();
  if(note){
    /* Ask Noltbook. Its host ship decides, enforces on the call server, and
     * tells everybody -- including the people who joined from Noltbook. */
    if(!rooms.role)return false;
    noteModerate(note,target,op).catch(()=>{});
    return true;
  }
  const call=moderation?.call();
  if(!call)return false;
  const before=moderation.record();
  const ok=moderation.request(target,op);
  /* Server-side enforcement, from the host only: Galene is told to stop
   * accepting that participant's media, or to drop them. Our own copy of the
   * record is what the button reads; this is what makes it true for everyone,
   * including a client that ignores us. */
  if(ok && call.host===our)enforceOnServer(before,moderation.record(),call);
  return ok;
}
function enforceOnServer(before,after,call){
  if(!after || before===after)return;
  const was=(k)=>new Set(before?.[k]??[]);
  const now=(k)=>new Set(after[k]??[]);
  for(const who of now('muted'))if(!was('muted').has(who))G.muteInCall(call.place,who).catch(()=>{});
  for(const who of was('muted'))if(!now('muted').has(who))G.unmuteInCall(call.place,who).catch(()=>{});
  for(const who of now('booted'))if(!was('booted').has(who))G.evictFromCall(call.place,who).catch(()=>{});
}
export const modRecord=()=>moderation?.record()??null;
export const modCall=()=>moderation?.call()??null;
export const myRole=()=>rooms.role;
export const canModerate=()=>!!rooms.role;
/* Admins may act on anyone in the call but the host and themselves; an
 * ordinary admin may not act on another admin. */
export function mayActOn(ship){
  const note=noteCall?.note();
  if(note){
    if(!rooms.role || ship===our || ship===noteCreator(note))return false;
    const theirs=noteCallRole(note,ship);
    return !(theirs && rooms.role!=='host');
  }
  const call=moderation?.call();
  if(!call || !rooms.role || ship===our || ship===call.host)return false;
  const theirs=roleOf(moderation.record(),call,ship);
  return !(theirs && rooms.role!=='host');
}
export const roleFor=(ship)=>{
  const note=noteCall?.note();
  return note?noteCallRole(note,ship):roleOf(moderation?.record()??null,moderation?.call()??null,ship);
};
export const mutedShip=(ship)=>{
  const note=noteCall?.note();
  return note?noteCallMuted(note,ship):isMuted(moderation?.record()??null,moderation?.call()??null,ship);
};
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
    if(!ship || ship===our || !mayPlay(record,call,ship))continue;
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

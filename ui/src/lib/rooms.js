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
import { displayName, visiblePeers } from 'lib/noltbook';
import { SfuSession } from 'lib/sfu';
import { regionAt, COMMONS } from 'world/places';
import { clusterPeers, agreedMembers, electHost, huddleKey, huddlePlace } from 'lib/huddle';
import { micConstraints, camConstraints, refreshDevices } from 'lib/devices';

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
  /* Hosting being handed over: the offer we made, and one made to us. */
  hostAsk: null,
  hostOffer: null,
  /* Other ships actually in the call with us, as the call server reports. */
  others: 0,
};
if (typeof window !== 'undefined') window.rooms = rooms;

let sfu=null, controller=null, huddle=null, lastPeers=new Map();
/* Movement-session grants arrive on the same /call-access path as call grants.
 * They belong to the movement relay, never to a call, so they are handed over
 * before the call controller can see them. */
let movementResult=null;
export const setMovementResultHandler=fn=>{movementResult=fn;};
/* Whether positions are good enough to decide calls on, supplied by the
 * movement layer. The defaults keep this module usable on its own. */
let positionGate={ready:()=>true,reliable:()=>true};
export const setPositionGate=gate=>{positionGate={...positionGate,...gate};};
/* Where each peer was last seen inside a room, for admission grace. */
const recentRoom=new Map();
const ROOM_GRACE_MS=5000;
/* The host's view of a guest can lag the guest's own. Admit to a ROOM call if
 * we see them inside, saw them inside moments ago, or cannot yet trust our view
 * of where they are -- a visible pal claiming to be in a room they could simply
 * walk into is not something to refuse on stale data. Huddles stay strict:
 * their call is identified by membership, so a mismatch is a different call. */
function inRoomForAdmission(who,place){
  const p=lastPeers.get(who);
  if(p && regionAt(p.spot.x,p.spot.y)===place)return true;
  const r=recentRoom.get(who);
  if(r && r.room===place && Date.now()-r.at<ROOM_GRACE_MS)return true;
  return !positionGate.reliable(who);
}
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
  sfu=new SfuSession({our,
    onStream:(ship,stream,meta={})=>{if(ship && ship!==our && visiblePeers().includes(ship)){
      rooms.remoteStreams.set(meta.id??stream.id,{ship,stream,label:meta.label??'camera'});selectRemoteCamera(ship);changed();
    }},
    onStreamRemoved:removeRemoteStream,
    onPeerLeft:ship=>{for(const [id,r] of rooms.remoteStreams)if(r.ship===ship)rooms.remoteStreams.delete(id);rooms.streams.delete(ship);changed();},
    onStatus:(status,why)=>controller?.status(status,why),
    onUsers:()=>{const n=sfu?.others().size??0;if(n!==rooms.others){rooms.others=n;changed();}watchAlone();},
  });
  controller=new CallController({our,sfu,trace:diagnostic,
    transport:{send:G.sendPresence,operation:G.callOperation},
    known:who=>visiblePeers().includes(who),
    accepts:(who,place)=>visiblePeers().includes(who) && (place>=1000
      ? huddle?.place===place && huddle.members.includes(who)
      : rooms.here===place && inRoomForAdmission(who,place)),
    changed:(phase,error)=>{
      rooms.voice=phase;rooms.error=error;watchAlone();
      if(phase==='connected'){restoreIntent();rooms.timings={...rooms.timings,connected:performance.now()};}
      changed();
    },
  });
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
function selectCall(place,host) {
  if(controller?.current?.place===place && controller.current.host===host)return;
  releaseMedia();rooms.host=host;
  rooms.timings={requested:performance.now(),role:host===our?'host':'guest'};
  controller?.select({place,host});
}
export function receiveCallEvent(who,event){
  if(HANDOFF.has(event?.kind)){receiveHandoff(who,event);return;}
  controller?.receive(who,event);
}
export function recoverCall(){controller?.restored();}
export function retryCall(){controller?.retry();}
export const currentHuddle=()=>huddle;

export function updateHuddle(self,peers) {
  if(rooms.here!==COMMONS)return;
  /* Never START a call from positions we cannot trust. Right after startup the
   * movement relay is not carrying positions yet and each browser's picture of
   * the other is seconds old: two browsers pick different huddles, and neither
   * ever admits the other. Wait for positions, then decide. A huddle that
   * already exists keeps its members, so a relay hiccup never hangs one up. */
  if(!huddle && !positionGate.ready())return;
  const near={[our]:{x:self.x,y:self.y}},hosts={};
  for(const [who,p] of peers)if(regionAt(p.spot.x,p.spot.y)===COMMONS && (positionGate.reliable(who) || huddle?.members.includes(who))){near[who]=p.spot;hosts[who]=p.host??null;}
  /* Membership agreed with what the people near us say they are in; see
   * agreedMembers in lib/huddle. */
  const together=agreedMembers(our,near,hosts,huddle?.members??[],huddle?.host??null);
  const mine=clusterPeers(near,together).find(c=>c.includes(our));
  if(!mine){if(huddle){diagnostic('huddle',{reason:'ended',place:huddle.place,host:huddle.host,count:0});huddle=null;rooms.host=null;releaseMedia();controller?.select(null);changed();}return;}
  const key=huddleKey(mine);
  if(huddle?.key===key)return;
  // Presence determines the same elected host on both ships. Timeouts never
  // create a competing host while that participant remains in the huddle.
  const before=huddle;
  huddle={key,members:mine,host:electHost(mine),place:huddlePlace(mine)};
  diagnostic('huddle',{reason:before?'changed':'formed',place:huddle.place,host:huddle.host,count:mine.length,
    detail:together.size>(before?.members.length??0)?'agreed':'distance'});
  selectCall(huddle.place,huddle.host);changed();
}
function roomHost(room) {
  const occupants=[our,...[...lastPeers].filter(([,p])=>regionAt(p.spot.x,p.spot.y)===room).map(([s])=>s)].sort();
  /* A room handed to someone stays theirs while they are in it. */
  const handed=handoffs.get(room);
  if(handed && occupants.includes(handed))return handed;
  if(handed)handoffs.delete(room);
  const announced=[...lastPeers.values()].filter(p=>regionAt(p.spot.x,p.spot.y)===room).map(p=>p.host).filter(h=>occupants.includes(h));
  if(rooms.here===room && occupants.includes(rooms.host))announced.push(rooms.host);
  return announced.sort()[0]??occupants[0];
}
export function refresh(peers) {
  lastPeers=peers;
  const live=new Map();
  const t=Date.now();
  for(const [s,r] of recentRoom)if(t-r.at>60000)recentRoom.delete(s);
  for(const [who,p] of peers){const room=regionAt(p.spot.x,p.spot.y);if(room===COMMONS)continue;
    recentRoom.set(who,{room,at:t});
    const r=live.get(room)??{host:null,occupants:new Set()};r.occupants.add(who);if(p.host)r.host=p.host;live.set(room,r);}
  if(rooms.here!==COMMONS){const host=roomHost(rooms.here),r=live.get(rooms.here)??{host,occupants:new Set()};r.occupants.add(our);r.host=host;live.set(rooms.here,r);
    /* The room's host is only chosen once positions are trustworthy; see
     * updateHuddle for why. main.js re-runs this when that changes. */
    if(host!==rooms.host && positionGate.ready())selectCall(rooms.here,host);}
  const waiting=rooms.here!==COMMONS && rooms.host===null && !positionGate.ready();
  if(waiting!==rooms.waiting){rooms.waiting=waiting;changed();}
  const same=live.size===rooms.live.size && [...live].every(([id,r])=>{const old=rooms.live.get(id);return old && old.host===r.host && old.occupants.size===r.occupants.size && [...r.occupants].every(s=>old.occupants.has(s));});
  rooms.live=live;if(!same)changed();
}
export function enterRoom(room) {
  if(room===rooms.here)return;
  if(room===COMMONS){leaveRoom();return;}
  if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
  huddle=null;rooms.here=room;rooms.host=null;clearHandoff();
  const host=roomHost(room);if(host===our)G.claimRoom(room).catch(()=>{});
  if(positionGate.ready())selectCall(room,host);
  else {releaseMedia();controller?.select(null);rooms.waiting=true;}   //  never stay in the call we walked out of
  changed();
}
export function leaveRoom() {
  if(rooms.here!==COMMONS && rooms.host===our)G.releaseRoom(rooms.here).catch(()=>{});
  clearHandoff();
  rooms.here=COMMONS;rooms.host=null;rooms.waiting=false;releaseMedia();controller?.select(null);changed();
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
const HANDOFF_MS=30000;
const handoffs=new Map();   //  room -> the host it was handed to
const isRoom=place=>Number.isSafeInteger(place) && place>COMMONS && place<1000;
function clearHandoff(){handoffs.clear();rooms.hostAsk=null;rooms.hostOffer=null;}
function expireHandoffLater(){
  setTimeout(()=>{
    const t=Date.now();let moved=false;
    if(rooms.hostAsk && t>=rooms.hostAsk.until){rooms.hostAsk=null;moved=true;}
    if(rooms.hostOffer && t>=rooms.hostOffer.until){rooms.hostOffer=null;moved=true;}
    if(moved)changed();
  },HANDOFF_MS+100);
}
const tellHandoff=(who,kind,place,id,extra={})=>Promise.resolve(G.sendPresence(who,{kind,place,attempt:id,...extra})).catch(()=>{});
export const canHandOff=()=>isRoom(rooms.here) && rooms.host===our && positionGate.ready();
export function offerHost(ship){
  const place=rooms.here;
  if(!canHandOff() || ship===our || !occupantsOf(place).includes(ship) || !visiblePeers().includes(ship))return false;
  const id=Date.now()*1000+Math.floor(Math.random()*1000);
  rooms.hostAsk={to:ship,place,id,until:Date.now()+HANDOFF_MS};
  tellHandoff(ship,'call-host-offer',place,id);
  expireHandoffLater();changed();
  return true;
}
export function answerHostOffer(accept){
  const offer=rooms.hostOffer;
  if(!offer || offer.accepted)return;
  const current=Date.now()<offer.until && rooms.here===offer.place && rooms.host===offer.from;
  if(!accept || !current){
    rooms.hostOffer=null;tellHandoff(offer.from,'call-host-decline',offer.place,offer.id);changed();return;
  }
  /* Nothing changes here until the host confirms: it may have moved on. */
  rooms.hostOffer={...offer,accepted:true};
  tellHandoff(offer.from,'call-host-accept',offer.place,offer.id);changed();
}
function receiveHandoff(who,event){
  const {kind,place,attempt:id}=event;
  if(!isRoom(place) || !Number.isSafeInteger(id) || who===our)return;
  if(kind==='call-host-offer'){
    if(rooms.here!==place || rooms.host!==who || !visiblePeers().includes(who)){tellHandoff(who,'call-host-decline',place,id);return;}
    rooms.hostOffer={from:who,place,id,until:Date.now()+HANDOFF_MS};
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
    if(Date.now()>=ask.until || rooms.here!==place || rooms.host!==our || !occupantsOf(place).includes(who)){
      tellHandoff(who,'call-host-decline',place,id);changed();return;
    }
    handoffs.set(place,who);
    for(const s of occupantsOf(place))if(s!==our)tellHandoff(s,'call-host-moved',place,id,{host:who});
    G.releaseRoom(place).catch(()=>{});
    controller?.hosted.delete(place);   //  our broker's room is no longer the call
    selectCall(place,who);changed();return;
  }
  if(kind==='call-host-moved'){
    const host=event.host;
    /* Only the host we follow can say hosting moved, and never to itself. */
    if(typeof host!=='string' || rooms.here!==place || rooms.host!==who || host===who)return;
    if(host===our){
      const offer=rooms.hostOffer;
      if(!offer?.accepted || offer.from!==who || offer.id!==id || offer.place!==place)return;   //  we never agreed
      rooms.hostOffer=null;
      G.claimRoom(place).catch(()=>{});
    } else if(!occupantsOf(place).includes(host)) return;   //  a host we cannot see is not one we can join
    handoffs.set(place,host);
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
  if(!(rooms.voice==='connected' && !rooms.others)){clearTimeout(aloneTimer);aloneTimer=null;return;}
  if(aloneTimer)return;
  aloneTimer=setTimeout(()=>{
    aloneTimer=null;
    if(rooms.voice!=='connected' || rooms.others)return;
    diagnostic('call-alone',{place:controller?.current?.place??0,host:rooms.host??'',
      count:huddle?.members.length??occupantsOf(rooms.here).length,context:huddle?.key??''});
  },20000);
}
function releaseMedia() {
  captureEpoch++;
  for(const kind of ['mic','cam','screen']){
    const p=published[kind];if(!p)continue;
    try{sfu?.unpublish(p.id);}catch{}
    p.cleanup?.();
    // The camera preview is not the call's to stop: leaving a call keeps it on.
    if(p.stream!==preview?.stream)for(const t of p.stream.getTracks())t.stop();
    published[kind]=null;
  }
  rooms.micOn=intent.mic;rooms.camOn=intent.cam;rooms.screenOn=false;
  rooms.streams.clear();rooms.remoteStreams.clear();
  for(const k of [...rooms.localStreams.keys()])if(!(k==='cam' && preview))rooms.localStreams.delete(k);
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
export function closeTab(){controller?.close();clearHandoff();huddle=null;rooms.here=COMMONS;rooms.host=null;intent.mic=intent.cam=false;releaseMedia();stopPreview();}

/* The world never opens a microphone or camera on its own: each of these is an
 * explicit act, and each can be undone without leaving the room. */
const published = { mic: null, cam: null, screen: null };
const acquiring = {};
let captureEpoch = 0;

/* User intent survives every room/huddle transition. Screen sharing still
 * requires its own explicit browser gesture. No preferences survive a reload. */
const intent = {mic:false,cam:false};

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

function restoreIntent() {
  for(const kind of ['mic','cam'])if(intent[kind] && !published[kind]) {
    const get=kind==='mic'?()=>navigator.mediaDevices.getUserMedia(micConstraints()):cameraForCall;
    publish(kind,get,'camera').catch(e=>{rooms.error=String(e.message??e);changed();});
  }
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
  const media = kind === 'mic' ? await processMicrophone(raw) : {stream:raw,cleanup:()=>{if(raw!==preview?.stream)raw.getTracks().forEach(t=>t.stop());}};
  const stream = media.stream;
  if(epoch !== captureEpoch || (kind!=="screen" && !intent[kind])) {media.cleanup();return;}
  let id;
  try { id = await sfu.publish(stream, label); } catch(e) {media.cleanup();throw e;}
  if(epoch !== captureEpoch || (kind!=="screen" && !intent[kind])) {sfu.unpublish(id);media.cleanup();return;}
  published[kind] = { id, stream, cleanup:media.cleanup };
  if(kind==='screen')for(const track of stream.getTracks())track.addEventListener?.('ended',()=>{if(published.screen?.id===id)unpublish('screen');},{once:true});
  if (kind === 'screen') rooms.localStreams.set(kind, stream);   //  the camera's own view is the preview
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
  if (!(kind === 'cam' && preview)) rooms.localStreams.delete(kind);
  rooms[`${kind}On`] = kind==='screen'?false:intent[kind];
  changed();
}

async function toggleMedia(kind) {
  intent[kind]=!intent[kind];
  rooms[`${kind}On`]=intent[kind];
  if(!intent[kind]){unpublish(kind);if(kind==='cam')stopPreview();}
  else{
    if(kind==='cam')startPreview().catch(()=>{});   //  seen at once, call or not
    if(rooms.voice==='connected')restoreIntent();
  }
  changed();
}
export const toggleMic = () => toggleMedia('mic');
export const toggleCam = () => toggleMedia('cam');

export const toggleScreen = async () => rooms.screenOn
  ? unpublish('screen')
  : publish('screen', () => navigator.mediaDevices.getDisplayMedia({ video: true }), 'screen');

/* Proximity volume, applied per stream from how far away someone is standing. */
export function setPositions(self, peers) {
  if (!sfu) return;
  /* Inside a room, membership IS the boundary: people sitting around the same
   * table went silent five tiles apart because the commons' attenuation was
   * still applied to them. */
  if (rooms.here !== COMMONS) return sfu.setFlatGain(1, new Set([...peers].filter(([,p])=>regionAt(p.spot.x,p.spot.y)===rooms.here).map(([ship])=>ship)));
  const near = {};
  for (const [ship, p] of peers) near[ship] = { x: p.spot.x, y: p.spot.y };
  sfu.setPositions({ x: self.x, y: self.y }, near);
}

import { diagnostic, setMovementDiagnostics, milestone } from 'lib/diagnostics';
import { createPresence } from 'lib/presence';
import { createRoomEvents } from 'lib/room-events';
import { createMovement } from 'lib/movement';
/* Boot.
 *
 * The world comes up first and stays up. Noltbook is wired in beside it, so a
 * Noltbook that is missing or slow leaves Glurff walkable rather than broken.
 */
import { initApi, our, closeChannel } from 'lib/api';
import { createTabGuard } from 'lib/tab';
import { initNoltbook, nb, COMMONS_NOTE, visiblePeers, displayName, onChange, setDial, updateActiveCount, holdHistory, releaseHistory, inGlurff, primeSocial, setExtraVisible } from 'lib/noltbook';
import * as G from 'lib/glurff';
import { Game } from 'world/game';
import { COMMONS, roomById, regionAt, isChattyRoom, GAME_ROOM } from 'world/places';
import { Builder } from 'ui/builder';
import { Hud } from 'ui/hud';
import { Rail } from 'ui/rail';
import { CallPanels } from 'ui/callpanels';
import { ProfileCard } from 'ui/profile';
import { Dms } from 'ui/dms';
import { Me } from 'ui/me';
import { Members } from 'ui/members';
import * as R from 'lib/rooms';
import { DEFAULT_LOOK, DIRS } from 'world/parts';

const state = {
  look: DEFAULT_LOOK,
  rev: 0,
  peers: new Map(),   //  ship -> {spot, rev, look, at}
  /* Which room we are standing in, or 0 for the commons. Everyone is always in
   * the same world; this is a region, not a place. */
  room: COMMONS,
};
window.glurff = state;   // debug handle
window.__game = null;
window.__huddle = () => R.currentHuddle();
window.__huddleTick = () => R.updateHuddle(game.self, state.peers);

initApi();

/* ONE LIVE TAB PER BROWSER, the newest one -- see lib/tab.js. An older tab left
 * open holds a relay connection and a presence session nobody is watching, which
 * is what put a second, silent copy of a ship in the world and pushed everyone
 * who could see them onto the slow ship-to-ship path. */
const TAB_KEY = 'glurff-live/' + our;
let liveTab = true, ticker = null;
const tabGuard = createTabGuard({
  locks: globalThis.navigator?.locks ?? null,
  storage: (() => { try { return window.localStorage; } catch { return null; } })(),
  id: crypto.randomUUID(),
  name: TAB_KEY,
  onSuperseded: (reason) => standDown(reason),
});
window.addEventListener('storage', (e) => { if (e.key === TAB_KEY) tabGuard.heard(e.newValue); });
window.addEventListener('glurff-exit', () => tabGuard.close());
tabGuard.claim();

/* A newer tab has taken over. Leave exactly as closing the tab does -- presence
 * says goodbye, the relay closes, a call hangs up, our "In Glurff" mark is
 * cleared -- then give the channel back and offer to take over again. */
function standDown(reason) {
  if (!liveTab) return;
  liveTab = false;
  diagnostic('tab-superseded', { reason });
  window.dispatchEvent(new Event('glurff-exit'));
  clearInterval(ticker); ticker = null;
  try { game.app?.ticker?.stop(); } catch {}
  /* Those goodbyes are pokes: let them leave before the channel goes. */
  setTimeout(closeChannel, 2000);
  const el = document.createElement('div');
  el.className = 'takeover';
  el.innerHTML = '<div><p>Glurff is open in another tab.</p><button type="button">Use here</button></div>';
  el.querySelector('button').onclick = () => location.reload();
  document.body.appendChild(el);
}

/* Created once presence exists. Referenced by callbacks that cannot fire before
 * the world has booted, hence a plain binding rather than a const. */
let movement = null;
/* Chat history waits for presence: at startup every request competes for a
 * handful of connections to the ship, and discovery decides whether anyone can
 * see anyone. Released on the first answer, at once when there is nobody to
 * ask, and after ten seconds whatever happens -- chat must never stay empty
 * because Noltbook or a pal is slow. Live posts are never held. */
holdHistory();
setTimeout(releaseHistory, 10000);

const sendPosition = throttle(reportPosition, 1000 / G.MOVE_HZ);
let reported = { dir: null, moving: null };
const game = new Game(document.getElementById('stage'), {
  onMove: (self) => {
    /* Starting, stopping and turning go out at once. Everything between them is
     * the ordinary rate: a stop that waits for the next tick is seen as sliding
     * past where you stopped. */
    const change = self.dir !== reported.dir || self.moving !== reported.moving;
    reported = { dir: self.dir, moving: self.moving };
    if (change) reportPosition(self, false, true); else sendPosition(self);
  },
  /* Rooms are regions of the one world, so this is a change of context rather
   * than a change of scene: the chat channel follows you, and the call for
   * that room is joined or left. Nothing loads. */
  onRoomChange: (room, from) => {
    diagnostic('room-enter',{place:room,hidden:document.hidden});
    state.room = room;
    events.clear();
    R.enterRoom(room);
    /* The zoom is yours: walking through a door used to take it away from you. */
    hud.setRoom(room);
    reportPosition(game.self, true);
  },
});

const events = createRoomEvents({our,room:()=>state.room,peers:()=>[...state.peers].filter(([,p])=>regionAt(p.spot.x,p.spot.y)===state.room).map(([ship])=>ship),send:G.sendRoomEvent,
  rooms:isChattyRoom,gameRoom:GAME_ROOM});
const hudRoot = document.getElementById('hud');
const hud = new Hud(hudRoot, { events });
const railRoot = document.createElement('div');
railRoot.id = 'rail';
document.body.appendChild(railRoot);
const stripRoot = document.createElement('div');
stripRoot.id = 'strip';
document.body.appendChild(stripRoot);
const rail = new Rail(railRoot, stripRoot);
/* ADMIN, REC and the recording notice. Outside the rail's markup on purpose:
 * the rail replaces its own innerHTML several times a second. */
const panelRoot = document.createElement('div');
document.body.appendChild(panelRoot);
/* Who the ADMIN panel lists is who is in the CALL -- the call server's own
 * report and the room's guest list -- not who happens to be standing near us. */
new CallPanels(panelRoot, { members: () => R.callMembers() });
/* The recorder draws the call's own tiles; the rail owns them. */
R.setCallTiles(() => rail.recordableTiles());

/* THE TOP OF THE SCREEN, in three places. Left: search, and who is here with
 * you. Middle: how far your reach goes. Right: you -- your picture and your
 * name, the way Noltbook has it, and clicking it opens your own profile.
 *
 * The profile card opens over everything. It is wired to messages both ways,
 * so a DM button on a card opens the conversation and the card can be reached
 * back from inside it. */
const topLeft = document.createElement('div');
topLeft.id = 'top-left';
document.body.appendChild(topLeft);
const topMid = document.createElement('div');
topMid.id = 'top-mid';
document.body.appendChild(topMid);
const topRight = document.createElement('div');
topRight.id = 'top-right';
document.body.appendChild(topRight);

const dmRoot = document.createElement('div');
topLeft.appendChild(dmRoot);
const cardRoot = document.createElement('div');
document.body.appendChild(cardRoot);
const card = new ProfileCard(cardRoot, {
  onOpenDm: (ship) => dms.openWith(ship),
  /* Your character is in your own profile; everyone else's is whatever the
   * world is drawing for them. */
  look: (ship) => ship === our ? state.look : state.peers.get(ship)?.look ?? null,
  onEditCharacter: () => builder.toggle(),
});
const dms = new Dms(dmRoot, { onShowProfile: (ship) => card.open(ship) });
const me = new Me(topRight, { onOpen: (ship) => card.open(ship), look: () => state.look });

/* Who is here with you -- the room you are in, or the commons -- and who hosts
 * it. The same people the world draws. */
const membersRoot = document.createElement('div');
topLeft.appendChild(membersRoot);
const members = new Members(membersRoot, {
  here: () => state.room,
  people: () => [our, ...[...state.peers].filter(([, p]) => regionAt(p.spot.x, p.spot.y) === state.room).map(([ship]) => ship)],
  onShowProfile: (ship) => card.open(ship),
});

/* Double-click somebody to see who they are. Single click is left alone: the
 * world is walked with the keyboard, and a stray click should do nothing. */
game.mount.addEventListener('dblclick', (e) => {
  if (game.panned) return;   //  that was a look-around, not a click on somebody
  const ship = game.characterAt(e.clientX, e.clientY);
  if (ship) card.open(ship);
});

const builderRoot = document.createElement('div');
document.body.appendChild(builderRoot);
window.__builder = null;   // debug handle
const builder = new Builder(builderRoot, {
  onChange: (look) => {
    state.look = look;
    me.setLook(look);
    /* The editor is reachable before the world has finished coming up, and
     * dressing a sprite that does not exist yet throws. The panel's own
     * preview is what the person is looking at either way. */
    if (game.selfSprite) game.dressCharacter(game.selfSprite, look);
  },
  onDone: (look) => G.dress(look),
});
window.__builder = builder;

let proximityAt = -Infinity;
function reportPosition(self, force = false, urgent = false) {
  /* Positions go over the movement relay, straight from this browser. Urbit
   * carries only the slow fallback for viewers not on the relay yet -- never the
   * full movement stream. `force` marks a state change, such as walking into
   * a room, that fallback viewers should hear about at once. */
  movement?.moved({ x: self.x, y: self.y, dir: self.dir, moving: !!self.moving,
                    host: R.rooms.host ?? null }, force, urgent);
  /* Proximity: who is close enough to talk to, and how loud they are. Four
   * times a second is plenty for volume and huddles; positions themselves go
   * out more often than this. */
  const t = performance.now();
  if (!force && t - proximityAt < 250) return;
  proximityAt = t;
  R.updateHuddle(self, state.peers);
  R.setPositions(self, state.peers);
}

function throttle(fn,ms) {
  let last=-Infinity,timer=null,latest=null;
  const flush=()=>{timer=null;last=performance.now();const args=latest;latest=null;if(args)fn(...args);};
  return (...args)=>{
    latest=args;
    const remaining=ms-(performance.now()-last);
    if(remaining<=0){clearTimeout(timer);flush();}
    else if(!timer)timer=setTimeout(flush,remaining);
  };
}

/* The slingshot is gone. Attacks will come from the weapon art instead, which
 * is drawn for the bare bodies rather than for clothing -- see the report. */
let worldReady = false;
/* The world's subscriptions are open: presence can run before the artwork is in. */
let watching = false;
let pendingPeers = null;
let presencePeers = new Map();
const appliedPresence = new Map();
/* Everyone we may draw: the people presence reaches, and the people a room lets
 * us see (lib/roommates). Where both know somebody, presence wins. */
const allPeers = (fromPresence = presencePeers) => new Map([...R.roomPeers(), ...fromPresence]);
function applyPresence() {
  if (pendingPeers) { presencePeers = pendingPeers; pendingPeers = null; }
  const peers = allPeers();
  nb.discovered=Object.fromEntries([...presencePeers].map(([ship,p])=>[ship,{hops:p.path.length-1,at:p.at}]));
  for(const ship of state.peers.keys())if(!peers.has(ship))dropPeer(ship,'presence-removed');
  for(const ship of appliedPresence.keys())if(!peers.has(ship))appliedPresence.delete(ship);
  for(const [ship,p] of peers) {
    const old=appliedPresence.get(ship);
    if(!old || !state.peers.has(ship) || old.rev!==p.rev || old.host!==p.host || old.spot.x!==p.spot.x || old.spot.y!==p.spot.y || old.spot.dir!==p.spot.dir)
      onWorldFact('peer-here',{...p,who:ship},true);
    appliedPresence.set(ship,p);
  }
  reconcilePeers();
}
/* What we are right now, as presence and rooms both send it. */
const here = () => ({stamp:Date.now(),spot:{place:COMMONS,x:Math.round(game.self.x*G.SUB),y:Math.round(game.self.y*G.SUB),dir:game.self.dir},rev:state.rev,host:R.rooms.host??null,mv:movement?.announce()??null});
const presence = createPresence({
  our, session:crypto.randomUUID(),
  social:()=>({pals:nb.pals,dial:nb.dial}),
  /* The room list we are on rides our presence answer, so somebody who arrives
   * after a room filled up still learns who is in it. */
  snapshot:()=>({...here(),room:R.roomSummary()}),
  send:G.sendPresence,
  /* Only pals in Glurff are asked, once, when they arrive; see lib/presence. */
  targeted:true,
  trace:(type,d)=>{diagnostic(type,d);if(type==='presence-first' || (type==='presence-discover' && !d.count))releaseHistory();},
  changed: peers => {
    pendingPeers=peers;
    /* The room lists the people we can see are on. */
    R.heardRooms(peers);
    /* Peers are drawn into the world, so they wait for it to be built; the
     * newest roster is applied then (see boot). */
    if(worldReady)applyPresence();
    /* Each visible peer's movement-session claim rides its presence snapshot;
     * the movement layer converges on one session from these. */
    movement?.presence(allPeers(peers));
  },
});
setExtraVisible(() => [...R.roomPeers().keys()]);
R.setRoomContext({ here, watchers: () => presence.viewers() });
R.onRoommates((why) => {
  /* Our own list changed: what rides our presence answer changed with it. */
  if (['list', 'hosting', 'left', 'following'].includes(why)) presence.publish();
  if (worldReady) applyPresence();
  movement?.presence(allPeers(pendingPeers ?? presencePeers));
});
movement = createMovement({
  our,
  agent: { claim: G.claimMovement, release: G.releaseMovement, open: G.openMovement, knock: G.knockMovement },
  /* Positions go to everyone who may see us: presence's viewers, and our room
   * audience. The slow path reaches each the way they reach us. */
  presence: {
    viewers: () => { const out = presence.viewers(); for (const s of R.roomAudience()) out.add(s); return out; },
    publishTo: (ships) => { G.asFallback(() => presence.publishTo(ships)); R.publishRoom(ships); },
  },
  /* state.peers holds exactly the people presence lets us see; reconcilePeers
   * removes anyone who stops being visible. The relay adds nobody. */
  visible: (ship) => state.peers.has(ship),
  apply: applyRelayPosition,
  /* Noltbook says these people are in here with us. Their movement session is
   * worth a few seconds' wait before starting one of our own beside it. */
  expected: () => [...inGlurff()],
  trace: diagnostic,
});
window.__movement = movement;
/* Debug handle, like __game and __movement: the call layer as this tab sees
 * it. Nothing here can forge authority -- moderation is judged on the HOST's
 * ship, against the ship a request actually came from. */
window.__calls = R;
setMovementDiagnostics(() => movement.stats());
let announcedHost = null;
R.onRooms(() => {
  if (!watching || announcedHost === R.rooms.host) return;
  announcedHost = R.rooms.host;
  movement.moved({ ...game.self, host: announcedHost }, true);
});

/* A position that arrived over the movement relay. */
function applyRelayPosition(ship, spot, meta) {
  const peer = state.peers.get(ship);
  if (!peer) return;
  /* Both timestamps come from the SAME sender's clock, so they compare soundly:
   * an older presence snapshot can never drag an avatar back behind a newer
   * relay position, and a late relay packet cannot undo a newer snapshot. */
  if (!(meta.t > (peer.motionT ?? -Infinity))) return;
  peer.motionT = meta.t;
  peer.spot = { place: COMMONS, x: spot.x, y: spot.y, dir: spot.dir };
  peer.host = meta.host;
  game.upsertPeer(ship, peer.spot, peer.look, displayName(ship), meta.t,
                  { vx: meta.vx, vy: meta.vy, moving: meta.moving });
  scheduleWorld();
}
/* Room occupancy, huddles and proximity volume all follow from positions but
 * are not cheap. Coalesce them instead of recomputing per packet -- on a timer,
 * not an animation frame, so a background tab keeps its calls correct. */
let worldTimer = null;
function scheduleWorld() {
  if (worldTimer) return;
  worldTimer = setTimeout(() => {
    worldTimer = null;
    R.refresh(state.peers);
    R.updateHuddle(game.self, state.peers);
    R.setPositions(game.self, state.peers);
  }, 150);
}
function dropPeer(ship,reason='visibility') {
  diagnostic('peer-removed',{who:ship,reason,hidden:document.hidden});
  const p=state.peers.get(ship);
  if(p)R.clearHost(ship,regionAt(p.spot.x,p.spot.y));
  state.peers.delete(ship);game.dropPeer(ship);R.rooms.streams.delete(ship);
}
function reconcilePeers() {
  const allowed = new Set(visiblePeers());
  for(const ship of state.peers.keys())if(!allowed.has(ship))dropPeer(ship);
  for(const ship of R.rooms.streams.keys())if(!state.peers.has(ship))R.rooms.streams.delete(ship);
  if(presenceStarted)updateActiveCount(state.peers.size+1);
  R.refresh(state.peers);
  R.updateHuddle(game.self,state.peers);
  R.setPositions(game.self,state.peers);
}
let presenceStarted=false;
function socialReady() {
  if(!watching || !nb.palsReady || !nb.dialReady)return;
  if(!presenceStarted){
    presenceStarted=true;milestone('presence-started');presence.start();movement?.start();
    /* Our own "In Glurff" now: it is what tells pals to ask for us. */
    updateActiveCount(state.peers.size+1);
  }
  else presence.update();
}
/* Calls wait for positions the movement layer can vouch for (see rooms.js).
 * When that changes and nobody moves, nothing else re-evaluates the room or
 * huddle, so look once a second and recompute only on a change. */
let positionSignature='';
/* Presence sends only changes. Our movement-session claim is part of what it
 * sends, so a change there -- a new session, the relay going live -- goes out. */
let claimSignature='';
ticker=setInterval(()=>{
  presence.tick();
  R.tickRoom();
  /* Introduce the people who can see us to our room-mates; see lib/roommates. */
  if(presenceStarted)R.introduceRoom(presence.viewers());
  if(presenceStarted && movement) {
    const mv=movement.announce();
    const next=mv?`${mv.host}/${mv.term}/${mv.live}`:'';
    if(next!==claimSignature){claimSignature=next;presence.publish();R.publishRoom();}
  }
  members.paint();   //  people come and go without a room change
  if(!movement)return;
  let trusted=0;for(const ship of state.peers.keys())if(movement.reliable(ship))trusted++;
  const next=movement.ready()+'/'+trusted;
  if(next!==positionSignature){positionSignature=next;scheduleWorld();}
},1000);
/* Closing the tab stops our relay connection but deliberately does NOT release
 * a movement room we host: our ship keeps admitting the people still in it. */
window.addEventListener('glurff-exit',()=>{R.closeTab();movement?.stop('exit');presence.stop();});
window.addEventListener('glurff-reconnect',()=>{if(presenceStarted){presence.start();movement?.restored();}});
window.addEventListener('glurff-restored',()=>{R.recoverCall();if(presenceStarted){presence.start(true);movement?.restored();}});
window.addEventListener('online',()=>{if(presenceStarted){presence.start(true);movement?.restored();}});
window.addEventListener('visibilitychange',()=>{if(!document.hidden && presenceStarted){presence.start();movement?.restored();}});

/* REACH: how many hops out you can be seen and can see. It is Noltbook's dial
 * -- the same setting, the same poke -- said in the word it means here: a
 * reach of two is two hops of the pal graph away. */
const reach = document.createElement('label');
reach.className = 'reach';
reach.innerHTML = 'Reach <select aria-label="How far your reach goes" title="How many hops out you can see and be seen"><option value="0">0</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select><span role="status"></span>';
topMid.appendChild(reach);
const reachSelect = reach.querySelector('select');
onChange(() => { reachSelect.value = String(nb.dial); }, c => c.field === 'dial');
reachSelect.onchange = async () => {
  reachSelect.disabled = true;
  try { await setDial(reachSelect.value); reach.querySelector('span').textContent=''; }
  catch { reachSelect.value=String(nb.dial); reach.querySelector('span').textContent='Could not change reach'; }
  finally { reachSelect.disabled=false; }
};


function onWorldFact(name, p, fromPresence=false) {
  if(name==='presence-event') {
    try {const event=JSON.parse(p.body);if(event.kind?.startsWith('call-')){R.receiveCallEvent(p.who,event);}else if(event.kind?.startsWith('room-')){R.receiveRoomEvent(p.who,event);}else presence.receive(p.who,event);}catch(e){console.warn('Invalid presence event');}
    return;
  }
  // Old, unscoped movement/departure packets cannot override tab leases.
  if((name==='peer-here' || name==='peer-gone') && !fromPresence)return;
  if (p.who && !visiblePeers().includes(p.who)) return;
  switch (name) {
    case 'room-event':
      try { events.receive(p.who,p.place,JSON.parse(p.body)); } catch {}
      break;
    case 'peer-here': {
      const reported = { place: p.spot.place, x: p.spot.x / G.SUB, y: p.spot.y / G.SUB, dir: p.spot.dir };
      const prev = state.peers.get(p.who);
      /* Presence is the slow path now. If the relay already delivered a newer
       * position from this sender, keep it -- both carry the sender's own clock.
       * Membership, avatar version and room host still update either way. */
      const stamp = Number.isFinite(p.stamp) ? p.stamp : -Infinity;
      const newer = !prev || !Number.isFinite(prev.motionT) || stamp > prev.motionT;
      const spot = newer ? reported : prev.spot;
      const entry = { spot, rev: p.rev, look: prev?.look ?? null, at: Date.now(),
                      host: newer ? (p.host || null) : prev.host,
                      motionT: newer ? stamp : prev.motionT };
      state.peers.set(p.who, entry);
      if (!prev) milestone('visible:' + p.who, { who: p.who });
      /* One world, so everyone visible is drawn -- including people inside
       * rooms, seen from the commons. */
      game.upsertPeer(p.who, spot, entry.look, displayName(p.who), newer ? p.stamp : prev.motionT);
      /* Their character arrives on request, not on every beat -- it is far
       * bigger than a position. Ask once, when the revision moves. */
      if (!prev || prev.rev !== p.rev) G.fetchLook(p.who);
      break;
    }
    case 'peer-gone':
      state.peers.delete(p.who);
      game.dropPeer(p.who);
      reconcilePeers();
      break;
    case 'peer-look': {
      const e = state.peers.get(p.who);
      if (!e) break;
      e.look = p.look;
      e.rev = p.rev;
      game.upsertPeer(p.who, e.spot, p.look, displayName(p.who));
      break;
    }
    case 'our-look':
      if (p.look && Object.keys(p.look).length) {
        state.look = p.look;
        state.rev = p.rev;
        builder.setLook(p.look);
        me.setLook(p.look);
        if (game.selfSprite) game.dressCharacter(game.selfSprite, p.look);
        presence.publish();
        R.publishRoom();
      }
      break;
    case 'peer-hosting':
      /* Somebody is holding a room. Without this both people walking into an
       * empty room each claim it, mint their own Galene room, and hear
       * nothing -- they are in the same place but not the same call. */
      R.noteHost(p.who, p.place, p.mode);
      break;
    case 'peer-unhosting':
      R.clearHost(p.who, p.place);
      break;
    case 'knocked':
      /* Someone is asking to be let into a room we hold. */
      R.answerKnock(p.who, p.place);
      break;
    case 'refused':
      console.warn('refused entry to room', p.place, p.why);
      break;
    default:
      break;
  }
}

(async function boot() {
  window.__game = game;
  game.ourShip = our;
  /* Startup runs side by side, not in a line. Presence needs only the world's
   * subscriptions and Noltbook's pals and dial. It used to wait for every sprite
   * to download, then for the subscriptions, and only then ask Noltbook -- so
   * nobody could see you until all of the artwork had arrived. Peers found while
   * the artwork loads are drawn as soon as the world is built. */
  onChange((c) => { milestone(c.field + '-ready'); socialReady(); if (worldReady) reconcilePeers(); }, c => ['pals', 'dial'].includes(c.field));
  /* Noltbook's list of pals in Glurff: arrivals are asked, leavers dropped. */
  onChange(() => { milestone('glurff-list'); presence.present(inGlurff()); }, c => c.field === 'active' && c.noteId === COMMONS_NOTE);
  /* Last time's pal and in-Glurff lists, so the first hello does not wait for
   * Noltbook. Replaced by the real lists the moment they arrive. */
  if (primeSocial()) milestone('social-primed');
  /* Noltbook beside the world, never in front of it. */
  const social = initNoltbook()
    .then(async () => {
      await hud.setRoom(COMMONS);
      /* Install the commons note only when Noltbook says it is genuinely
       * absent -- its receiver REPLACES the note and clears its messages.
       * Rooms install theirs the same way, the first time somebody walks in. */
    })
    .catch((e) => console.error('Noltbook unavailable; social features are off', e));
  await game.start();
  const art = game.load();
  R.setMovementResultHandler((name, p) => movement?.result(name, p) ?? false);
  /* Calls are decided on positions; do not start one on positions the movement
   * layer cannot vouch for yet. */
  R.setPositionGate({ ready: () => movement?.ready() ?? true, reliable: (ship) => movement?.reliable(ship) ?? true });
  await Promise.all([G.watchWorld(onWorldFact), R.initRooms()]);
  watching = true;
  milestone('world-subscribed');
  movement.moved({ ...game.self, host: R.rooms.host ?? null });
  socialReady();

  await art;
  game.self.look = state.look;
  game.build();
  game.setZoom(3);
  /* Names come from Noltbook profiles, which arrive after the world does --
   * so re-apply them whenever the store moves rather than only at boot, or
   * everyone is stuck showing the @p they had before their profile landed. */
  const refreshNames = () => {
    game.nameCharacter(game.selfSprite, displayName(our));
    for (const [ship, p] of game.peers) game.nameCharacter(p.ch, displayName(ship));
  };
  refreshNames();
  onChange(refreshNames, c => c.field === 'profiles');
  worldReady = true;
  milestone('world-ready');
  /* Everyone presence found while the artwork loaded. */
  applyPresence();
  await social;
})();

import { diagnostic, setMovementDiagnostics, milestone } from 'lib/diagnostics';
import { createMemberPresence } from 'lib/member-presence';
import { WORLD_ID, WORLD_HOST } from 'lib/world-config';
import { createRoomEvents } from 'lib/room-events';
import { createMovement } from 'lib/movement';
import { createBow } from 'lib/bow';
import { createPlayerState } from 'lib/player-state';
import { palStatus } from 'lib/noltbook';
import { createWaves, createTitleFlash, WAVE_NOTICE_MS } from 'lib/waves';
import { createClockSettings, anchor as clockAnchor, clockTime } from 'lib/clocks';
import { IDLE_MS } from 'world/bubbles';
import { esc } from 'ui/html';
import { sceneCharacterScale, sceneTile, solidAt as mapSolid } from 'world/places';
/* Artwork loads alongside the official note. Connecting waits for membership. */
import { initApi, our, closeChannel } from 'lib/api';
import { watchNoltbookDependency } from 'lib/dependency';
import { createTabGuard } from 'lib/tab';
import { createSessionLease, newerMotion } from 'lib/session-lease';
import { createReachability } from 'lib/reachability';
import { createInsideLease } from 'lib/inside-lease';
import { createReliable } from 'lib/reliable';
import { initNoltbook, nb, COMMONS_NOTE, visiblePeers, displayName, onChange, holdHistory, releaseHistory, worldJoined, worldMember, worldMembers, setWorldPresence, stopWorld, updateActiveCount, stopActiveStatus, requestProfile, askToJoinNote, joinAsked, joinRequests, answerJoinRequest, noteFacts } from 'lib/noltbook';
import * as G from 'lib/glurff';
import { Game, startZoom } from 'world/game';
import { TouchControls, watchTouch, watchLayout, touching } from 'ui/touch-controls';
import { COMMONS, roomById, regionAt, isChattyRoom, GAME_ROOM } from 'world/places';
import { Builder } from 'ui/builder';
import { Hud } from 'ui/hud';
import { Rail } from 'ui/rail';
import { CallPanels } from 'ui/callpanels';
import { ProfileCard } from 'ui/profile';
import { Dms } from 'ui/dms';
import { Contacts } from 'ui/contacts';
import { Me } from 'ui/me';
import { Members } from 'ui/members';
import { MediaSurfaces } from 'ui/media-surfaces';
import { ask } from 'ui/ask';
import { Stage } from 'ui/stage';
import { Sites } from 'ui/sites';
import { showNoltbookDependency } from 'ui/dependency';
import { showWorldMembership } from 'ui/world-membership';
import { HOTSPOTS, spotApp, spotsFor } from 'world/hotspots';
import { AppPanel } from 'ui/app-panel';
import * as R from 'lib/rooms';
import { DEFAULT_LOOK, DIRS, setSpriteLabEnabled, spriteLabEnabled } from 'world/parts';

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
let playerStore = null, mediaUI = null;

initApi();
/* Played by touch? Then the phone's controls and layout (ui/touch-controls). */
watchTouch();

/* Urbit desks cannot declare runtime desk dependencies. Docket is the source
 * of truth for installed apps, so offer Noltbook from its official publisher
 * when it is absent. The modal is intentionally not dismissible: Noltbook is
 * required for Glurff's identity, rooms, chat and calls. */
const noltbookDependency = watchNoltbookDependency();
const closeDependencyPrompt = showNoltbookDependency({
  watch: noltbookDependency,
  isAvailable: () => nb.ready,
  onAvailable: (fn) => onChange(fn, (change) => change.field === 'notes'),
});
const closeMembershipPrompt = showWorldMembership();
window.addEventListener('glurff-exit', () => {
  closeDependencyPrompt();
  closeMembershipPrompt();
  noltbookDependency.close();
});

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
/* ONE LIVE GLURFF PER SHIP -- across browsers and devices, which the tab guard
 * cannot see. Held by our agent; see lib/session-lease. Started once /world is
 * watched, so the agent's answer has somewhere to arrive. */
const sessionLease = createSessionLease({
  tab: R.seatTab(),
  send: G.session,
  trace: diagnostic,
  onLost: (reason) => standDown(reason),
});
window.addEventListener('glurff-exit', () => sessionLease.stop());
/* Per-ship reachability: who hears us, who we only hear. See lib/reachability. */
const reach = createReachability({ trace: diagnostic });
R.setReachability(reach);
window.glurffReachability = () => reach.stats();

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
  el.innerHTML = reason === 'another-session'
    ? '<div><p>Glurff is open on another device or browser.</p><button type="button">Use here</button></div>'
    : '<div><p>Glurff is open in another tab.</p><button type="button">Use here</button></div>';
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
let reported = { dir: null, moving: null, scene: null };
let doorPrompt = null;

/* Give Noltbook's remote-note answer a brief chance to supply the group's name
 * and description. Admission remains blocked while this is happening; if the
 * answer is slow, the question still appears with a plain fallback. */
function waitForDoorFacts(place, ms = 1500, freshHost = null) {
  const present = R.roomGate(place);
  if (present.facts && !freshHost) return Promise.resolve(present);
  return new Promise((resolve) => {
    let off = () => {};
    const finish = () => { clearTimeout(timer); off(); resolve(R.roomGate(place)); };
    const timer = setTimeout(finish, ms);
    off = onChange((change) => {
      const gate = R.roomGate(place);
      const refreshed = change.field === 'remoteNotes' &&
        (!freshHost || change.ship === freshHost);
      if (!gate.blocked || gate.visibility === 'secret' ||
          (gate.facts && (!freshHost || refreshed)) || refreshed) finish();
    }, (c) => c.field === 'notes' || c.field === 'remoteNotes');
  });
}

async function offerRoomDoor(place) {
  let gate = R.roomGate(place);
  if (!gate.blocked || gate.visibility === 'secret' || !gate.note || joinAsked(gate.note)) return;
  const key = `${place}/${gate.note}`;
  if (doorPrompt === key) return;
  doorPrompt = key;
  try {
    /* Refresh even when an earlier profile lookup left partial facts behind:
     * the current answer is what carries the group's description. Start the
     * listener first so a fast same-ship answer cannot pass between the two. */
    const freshHost = gate.host ?? null;
    const facts = waitForDoorFacts(place, 1500, freshHost);
    void R.learnLease(place, freshHost, true);
    gate = await facts;
    /* We may have walked away, been admitted, or watched the note turn secret
     * while its description was arriving. */
    if (game.doorRoom !== place || !gate.blocked || gate.visibility === 'secret' ||
        !gate.note || joinAsked(gate.note)) return;
    const publicNote = gate.visibility === 'public';
    const title = gate.facts?.name ?? 'this group';
    const room = roomById(place)?.name ?? 'This room';
    const detail = gate.facts?.headline ??
      `${room} is linked to a ${publicNote ? 'public' : 'private'} Noltbook group.`;
    const yes = publicNote ? 'JOIN' : 'REQUEST JOIN';
    const go = await ask(publicNote ? `Join ${title}?` : `Request to join ${title}?`, {
      yes, no: 'NOT NOW', detail,
    });
    if (!go) return;
    /* Recheck at the click: access may have changed while the question sat on
     * screen. Noltbook remains the authority and confirms membership before
     * the collision gate opens. */
    gate = R.roomGate(place);
    if (!gate.blocked || !gate.note || gate.visibility === 'secret') return;
    await askToJoinNote(gate.note, gate.host ?? gate.facts?.creator);
  } catch (error) {
    console.warn('could not ask to join leased room', error);
  } finally {
    doorPrompt = null;
  }
}

/* PRIVATE NOTE ADMISSION. Noltbook sends these facts to the note's host and
 * admins. When that note is actually attached to a Glurff room, surface the
 * same decision here; the approve/deny action still goes back to Noltbook. */
let joinPrompt = null, joinPromptRetry = null;
const dismissedJoinRequests = new Set();
function joinRequestRoom(noteId) {
  if (R.rooms.lease?.note === noteId) return R.rooms.lease.place;
  if (R.leaseNote(R.rooms.here) === noteId) return R.rooms.here;
  return null;
}
async function offerJoinRequest() {
  const requests = joinRequests();
  const live = new Set(requests.map((r) => `${r.noteId}/${r.ship}`));
  for (const key of dismissedJoinRequests) if (!live.has(key)) dismissedJoinRequests.delete(key);
  if (joinPrompt) return;
  if (document.querySelector('.ask-overlay')) {
    if (!joinPromptRetry) joinPromptRetry = setTimeout(() => {
      joinPromptRetry = null; void offerJoinRequest();
    }, 250);
    return;
  }
  const request = requests.find((r) => r?.ship !== our && joinRequestRoom(r.noteId) != null &&
    !dismissedJoinRequests.has(`${r.noteId}/${r.ship}`));
  if (!request) return;
  const key = `${request.noteId}/${request.ship}`;
  const place = joinRequestRoom(request.noteId);
  const note = nb.notes[request.noteId];
  const title = note?.name ?? request.noteName ?? request.noteId;
  const room = roomById(place)?.name ?? 'this room';
  joinPrompt = key;
  try {
    const answer = await ask(`${displayName(request.ship)} wants to join ${title}.`, {
      yes: 'LET IN', no: 'DECLINE', dismiss: null,
      detail: note?.headline ?? `${title} is linked to ${room}.`,
    });
    if (answer === null) dismissedJoinRequests.add(key);
    else await answerJoinRequest(request.noteId, request.ship, answer);
  } catch (error) {
    dismissedJoinRequests.add(key);
    console.warn('could not answer Noltbook join request', error);
  } finally {
    joinPrompt = null;
    queueMicrotask(() => void offerJoinRequest());
  }
}
onChange(() => void offerJoinRequest(), (c) => c.field === 'joinRequests' || c.field === 'notes');
R.onRooms(() => void offerJoinRequest());

/* LEASED WHILE YOU WERE INSIDE -- or removed from the note while you were.
 * The decision tree is lib/inside-lease; this wires it to the world. */
function insideLeaseHere() {
  const place = R.rooms.here;
  if (!(place > COMMONS && place <= 15) || R.rooms.lease?.place === place) return null;
  const lease = R.leaseAt(place);
  if (!lease?.note && !lease?.vis) return null;
  if (lease.note && nb.notes[lease.note]) return null;             //  a member
  const host = R.leaseHolder(place) ?? R.rooms.host ?? null;
  return { place, note: lease.note ?? null, vis: lease.vis ?? 'private', host };
}
const insideLease = createInsideLease({
  lease: insideLeaseHere,
  toldPrivate: (place) => R.rooms.privateRoom?.place === place,
  joinAsked,
  learn: (l) => { void R.learnLease(l.place, l.host, true); },
  ask: async (l, { timeout, signal }) => {
    await new Promise((r) => setTimeout(r, 600));        //  the group's name, if it is quick
    if (signal?.aborted) return null;
    const publicNote = l.vis === 'public';
    const title = noteFacts(l.host, l.note)?.name ?? 'this group';
    const room = roomById(l.place)?.name ?? 'This room';
    return ask(publicNote ? `Join ${title}?` : `Request to join ${title}?`, {
      yes: publicNote ? 'JOIN' : 'REQUEST JOIN', no: 'LEAVE ROOM',
      detail: `${room} was just linked to a ${publicNote ? 'public' : 'private'} Noltbook group. ` +
        (publicNote ? 'Join it to stay.' : 'Ask to join and wait here for the host, or leave the room.'),
      timeout, signal,
    });
  },
  requestJoin: (l) => askToJoinNote(l.note, l.host),
  askOwner: (l) => { if (l.host) Promise.resolve(G.leaseAsk(l.host, l.place)).catch(() => {}); },
  stepOutside: (l, reason) => {
    game.moveOutside();
    const room = roomById(l.place)?.name ?? 'the room';
    showNotice(reason === 'secret' ? `${room} is now private. You've been moved back to the spawn.`
      : reason === 'declined' ? `The host didn't let you into ${room}. You've been moved back to the spawn.`
      : `You left ${room} and are back at the spawn. Walk up to its door to join.`);
  },
  trace: diagnostic,
});
const checkInsideLease = () => insideLease.check();
R.onRooms(() => void checkInsideLease());
R.onRoommates(() => void checkInsideLease());
onChange(() => void checkInsideLease(), (c) => ['notes', 'joinStatus', 'remoteNotes'].includes(c.field));
/* A short line at the top of the screen, gone by itself. */
const notice = document.createElement('div');
notice.className = 'toast'; notice.setAttribute('role', 'status'); notice.hidden = true;
document.body.appendChild(notice);
let noticeTimer = null;
function showNotice(text) {
  notice.textContent = text; notice.hidden = false;
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
}
/* A WAVE for us: who, and a way to look at them. It waits for us if the tab is
 * in the background -- the hand over their head too -- rather than coming and
 * going unseen. See lib/waves. */
const waveNotice = document.createElement('div');
waveNotice.className = 'wave-toast'; waveNotice.setAttribute('role', 'status'); waveNotice.hidden = true;
document.body.appendChild(waveNotice);
let waveTimer = null;
const unseenWaves = new Set();
const titleFlash = createTitleFlash();
function hideWaveLater() {
  clearTimeout(waveTimer);
  waveTimer = setTimeout(() => { waveNotice.hidden = true; waveTimer = null; }, WAVE_NOTICE_MS);
}
function showWave(who) {
  const name = displayName(who);
  /* On the stage the world is out of sight: the notice alone, which shows
   * even with Glurff's interface hidden (see ui/stage). */
  waveNotice.innerHTML = `<span>👋 <b>${esc(name)}</b> waved at you</span>${stage.active ? '' : '<button type="button">Show me</button>'}`;
  const showMe = waveNotice.querySelector('button');
  if (showMe) showMe.onclick = () => { game.lookAt(who); waveNotice.hidden = true; };
  waveNotice.hidden = false;
  if (document.hidden) {
    clearTimeout(waveTimer); waveTimer = null;
    unseenWaves.add(who);
    titleFlash.flash(`👋 ${name} waved · Glurff`);
  } else { game.showWave(who); hideWaveLater(); }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  for (const who of unseenWaves) game.showWave(who);
  unseenWaves.clear();
  if (!waveNotice.hidden && waveTimer === null) hideWaveLater();
});

/* CLOCKS IN THE SKY: our settings, kept by our agent (see lib/clocks). The
 * sky follows every change at once; the agent is told a moment after the last. */
const clocks = createClockSettings({ save: (text) => G.savePrefs(text) });
clocks.on((s) => game.setClocks(s.clocks));
/* ARRANGING: the clocks come in front of the map to be dragged about, until
 * Done (or Escape). */
const arrangeBar = document.createElement('div');
arrangeBar.className = 'arrange-bar'; arrangeBar.hidden = true;
arrangeBar.innerHTML = '<span>Drag your clocks where you want them</span><button type="button">Done</button>';
document.body.appendChild(arrangeBar);
function arrangeClocks(on) {
  game.arrangeClocks(on);
  arrangeBar.hidden = !on;
}
arrangeBar.querySelector('button').onclick = () => arrangeClocks(false);
/* HOVER A CLOCK to read it: the time there, the day, and where. Follows the
 * pointer, and ticks while it is up. */
const clockTip = document.createElement('div');
clockTip.className = 'clock-tip'; clockTip.hidden = true; clockTip.setAttribute('role', 'tooltip');
document.body.appendChild(clockTip);
let tipFor = null, tipTimer = null;
function paintClockTip() {
  /* The planet as it is drawn, so the reading always matches what is seen. */
  const c = game.clockOf(tipFor);
  if (!c) { hideClockTip(); return; }
  const t = clockTime(Date.now(), c.zone);
  clockTip.innerHTML = `<div><b>${esc(t.time)}</b> <span class="dim">${esc(t.day)}</span></div>` +
    `<div class="dim">${esc(t.place)}${t.offset ? ` · ${esc(t.offset)}` : ''}</div>`;
}
function hideClockTip() {
  tipFor = null; clockTip.hidden = true;
  clearInterval(tipTimer); tipTimer = null;
}
function showClockTip(id, x, y) {
  if (!id) { if (tipFor) hideClockTip(); return; }
  if (id !== tipFor) {
    tipFor = id; paintClockTip();
    clearInterval(tipTimer); tipTimer = setInterval(paintClockTip, 1000);
  }
  clockTip.hidden = false;
  const w = clockTip.offsetWidth, h = clockTip.offsetHeight;
  clockTip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x + 16))}px`;
  clockTip.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, y + 16))}px`;
}
/* A finger cannot hover: a tap on a clock shows its reading for a moment. */
const CLOCK_TIP_TAP_MS = 4000;
let tipFlash = null;
function flashClockTip(id, x, y) {
  showClockTip(id, x, y);
  clearTimeout(tipFlash); tipFlash = setTimeout(hideClockTip, CLOCK_TIP_TAP_MS);
}
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && game.arranging()) arrangeClocks(false); });

const game = new Game(document.getElementById('stage'), {
  onEmote: scene => {
    void Promise.resolve(sendWorldAction({kind:'emote',scene,t0:Date.now()})).catch(()=>{});
  },
  onMove: (self) => {
    /* Starting, stopping and turning go out at once. Everything between them is
     * the ordinary rate: a stop that waits for the next tick is seen as sliding
     * past where you stopped. */
    const change = self.dir !== reported.dir || self.moving !== reported.moving || self.scene !== reported.scene;
    reported = { dir: self.dir, moving: self.moving, scene: self.scene };
    /* A walking position still queued in the throttle would go out AFTER the
     * stop and start them walking again -- on the spot, since it is where they
     * already were. The change is newer than anything queued: drop it. */
    if (change) { sendPosition.cancel(); reportPosition(self, false, true); } else sendPosition(self);
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
    presence.publish(); // Room context must travel even when movement uses the relay.
  },
  /* A room leased to somebody's secret note is shut: the one place in the
   * world where you cannot simply walk in. */
  isClosed: (room) => R.roomClosed(room),
  isBlocked: (room) => R.roomBlocked(room),
  onRoomDoor: (room) => offerRoomDoor(room),
  onClockHover: (id, x, y) => showClockTip(id, x, y),
  /* "1": our weapon out, or away -- if we have one. */
  onArm: () => toggleArmed(),
  /* A TAP on the world, on a phone (see lib/touch): what a double-click does
   * with a mouse -- or, with our weapon out, an attack there. */
  onTap: (x, y) => {
    if (game.arranging()) return;
    if (game.armed) { game.fireAt(x, y); return; }
    const ship = game.characterAt(x, y);
    if (ship) { card.open(ship); return; }
    const clock = game.skyClockAt(x, y);
    if (clock) { flashClockTip(clock.id, x, y); return; }
    hideClockTip();
    game.activateHotspot(x, y);
  },
  /* A clock dragged somewhere new: kept from the nearest corner. */
  onClockMoved: (id, x, y, w, h) => clocks.update((s) => {
    const c = s.clocks.find((k) => k.id === id);
    if (c) c.at = clockAnchor(x, y, w, h);
    return s;
  }),
  onSceneChange: (scene, from) => {
    diagnostic('scene-enter', { scene, from, hidden: document.hidden });
    /* A scene doorway changes the social room too. This leaves the old call,
     * joins the new room's call and swaps its temporary chat at the same moment
     * as the painting changes. */
    if (state.room !== game.room) {
      diagnostic('room-enter', { place: game.room, hidden: document.hidden });
      state.room = game.room;
      events.clear();
      R.enterRoom(game.room);
      hud.setRoom(game.room);
    }
    /* Force the new scene out at once so peers hide us on the old painting and
     * draw us on the new one without waiting for the next walking update. */
    reported = { dir: game.self.dir, moving: false, scene };
    reportPosition(game.self, true, true);
    presence.publish();
    members.paint();
  },
});

/* THE STAGE (ui/stage): an app, a website or a movie screen can take the
 * whole screen, with Glurff's interface over it. While one does, our character
 * says what we are doing (lib/sites activityText), and we are never "asleep":
 * our keys and pointer are in the game, where this page cannot see them. */
let activity = null;
const stage = new Stage({ game, touch: () => touching(), onActivity: (text) => {
  activity = text;
  game.setActivity(our, text);
  lastInput = Date.now();
  if (asleep) checkAsleep();
  diagnostic('stage', { reason: text ? 'on' : 'off', detail: text ?? '' });
  if (presenceStarted) presence.publish();
} });

// Ephemeral world effects use Glurff's authenticated envelope, not a claimed
// sender inside the JSON body. No changes to Noltbook or movement traffic.
function sendWorldAction(event) {
  const audience = [...new Set([...presence.viewers(),...state.peers.keys(),...R.roomAudience()])]
    .filter(who => who !== our && palStatus(who) !== 'blocked');
  return G.sendWorldEffect(audience,event);
}
/* A weapon we could take out: equipment is on, and our character holds one. */
const weaponReady = () => !!(builder.equipmentReady && state.look?.weapon?.part);
/* What we hold changed: a weapon that is gone cannot stay out, and the
 * phone's sword button comes and goes with it. */
function weaponsChanged() {
  if (game.armed && !weaponReady()) game.setArmed(false);
  touchControls?.paint();
}
/* Out, or away: "1" on a keyboard, the sword button on a phone. */
let armedHint = false;
function toggleArmed() {
  if (!game.armed && !weaponReady()) { showNotice('No weapon yet: choose one in your character'); return; }
  game.setArmed(!game.armed);
  diagnostic('weapon', { reason: game.armed ? 'armed' : 'put-away' });
  if (presenceStarted) presence.publish();
  touchControls?.paint();
  if (game.armed && touching() && !armedHint) { armedHint = true; showNotice('Weapon out: tap where you want to attack'); }
}
const bow = createBow({
  our,
  /* Only a weapon we have OUT can be used; see "1" above. */
  self: () => game.selfSprite && ({...game.self,
    weapon: builder.equipmentReady && game.armed ? game.selfSprite.look.weapon?.part : null,
    locked: game.selfSprite.animation.locked(performance.now()),
  }),
  visible: who => state.peers.has(who),
  blocked: who => palStatus(who) === 'blocked',
  solid: mapSolid,
  hitBox: scene => {const half=2*sceneCharacterScale(scene)/sceneTile(scene);return {x:half,y:half};},
  send: sendWorldAction,
  onShot: (ship,shot) => game.react(ship,'attack',shot.scene,shot.weapon),
  onHit: (ship,shot) => game.react(ship,'die',shot.scene),
});
game.bow = bow;

const events = createRoomEvents({our,room:()=>state.room,peers:()=>[...state.peers].filter(([ship,p])=>
  R.roomOf(ship,p.spot,p.chatPlace)===state.room).map(([ship])=>ship),send:G.sendRoomEvent,
  rooms:isChattyRoom,gameRoom:GAME_ROOM,trace:diagnostic});
const hudRoot = document.getElementById('hud');
const hud = new Hud(hudRoot, { events });
const railRoot = document.createElement('div');
railRoot.id = 'rail';
document.body.appendChild(railRoot);
const stripRoot = document.createElement('div');
stripRoot.id = 'strip';
document.body.appendChild(stripRoot);
const rail = new Rail(railRoot, stripRoot);
/* The phone layout stacks things on the call bar, and lifts the chat above
 * the on-screen keyboard: both measured here (ui/touch-controls). */
watchLayout(railRoot);
/* Who has their microphone off: from their presence. */
R.setPeerMicOff((ship) => state.peers.get(ship)?.micOff === true);
/* ADMIN, REC and the recording notice. Outside the rail's markup on purpose:
 * the rail replaces its own innerHTML several times a second. */
const panelRoot = document.createElement('div');
document.body.appendChild(panelRoot);
/* Who the ADMIN panel lists is who is in the CALL -- the call server's own
 * report and the room's guest list -- not who happens to be standing near us. */
new CallPanels(panelRoot, { members: () => R.callMembers() });
/* The recorder draws the call's own tiles; the rail owns them. */
R.setCallTiles(() => rail.recordableTiles());
/* Members of a note a room is leased to see each other in the world. */

/* THE TOP OF THE SCREEN, in three places. Left: contacts, search, and who is here with
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

const contactsRoot = document.createElement('div');
topLeft.appendChild(contactsRoot);
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
  /* In the world with us, and since when they have been idle (their clock). */
  presenceOf: (ship) => ship === our ? null : state.peers.has(ship)
    ? { inWorld: true, idleSince: state.peers.get(ship).idle ?? null } : { inWorld: false, idleSince: null },
  onWave: (ship) => waves.wave(ship),
  /* Our clocks, edited with our profile; see lib/clocks. */
  clocks,
  onArrangeClocks: () => arrangeClocks(true),
});
const dms = new Dms(dmRoot, { onShowProfile: (ship) => card.open(ship) });
new Contacts(contactsRoot, { onShowProfile: (ship) => card.open(ship) });
const me = new Me(topRight, { onOpen: (ship) => card.open(ship), look: () => state.look });

/* Who is here with you -- the room you are in, or the commons -- and who hosts
 * it. The same people the world draws. */
const membersRoot = document.createElement('div');
topLeft.appendChild(membersRoot);
const members = new Members(membersRoot, {
  here: () => state.room,
  /* IN A ROOM, the list is the call's list: you are on it if you are in the
   * call, and not if you are not. In the COMMONS there is no room call, so it
   * stays what it has always been -- the people standing around you, who are
   * exactly who a proximity huddle would form from. */
  people: () => (state.room === COMMONS
    ? [our, ...[...state.peers].filter(([ship, p]) =>
        R.roomOf(ship, p.spot, p.chatPlace) === COMMONS).map(([ship]) => ship)]
    : [our, ...R.callPeers()]),
  onShowProfile: (ship) => card.open(ship),
});
/* THE MAGNIFYING GLASS, after the room button: this world's games, or any
 * website, on our stage (ui/sites). */
const sitesRoot = document.createElement('div');
topLeft.appendChild(sitesRoot);
const sites = new Sites(sitesRoot, { games: () => worldGames(), settings: clocks, ask,
  openWeb: (site) => appPanel.openWeb(site) });
window.__sites = sites;   // debug handle

/* Double-click somebody to see who they are. Single click is left alone: the
 * world is walked with the keyboard, and a stray click should do nothing. */
game.mount.addEventListener('dblclick', (e) => {
  if (game.panned) return;   //  that was a look-around, not a click on somebody
  if (game.touchedRecently()) return;   //  a double-tap: the tap already did it
  const ship = game.characterAt(e.clientX, e.clientY);
  if (ship) { card.open(ship); return; }
  /* A clock out in the sky: arrange them, straight from there. */
  if (!game.arranging() && game.skyClockAt(e.clientX, e.clientY)) { arrangeClocks(true); return; }
  game.activateHotspot(e.clientX, e.clientY);
});

/* The phone's controls; made just below, once the character editor is. */
let touchControls = null;
const builderRoot = document.createElement('div');
document.body.appendChild(builderRoot);
window.__builder = null;   // debug handle
const builder = new Builder(builderRoot, {
  onChange: (look) => {
    state.look = look;
    game.self.look = look;
    me.setLook(look);
    /* The editor is reachable before the world has finished coming up, and
     * dressing a sprite that does not exist yet throws. The panel's own
     * preview is what the person is looking at either way. */
    if (game.selfSprite) game.dressCharacter(game.selfSprite, look);
    weaponsChanged();
  },
  onDone: (look) => G.dress(look),
});
window.__builder = builder;
/* ON A PHONE: a joystick to walk, and the sword button when there is a sword. */
const touchRoot = document.createElement('div');
document.body.appendChild(touchRoot);
touchControls = new TouchControls(touchRoot, { game, onArm: () => toggleArmed(), weaponReady });

let proximityAt = -Infinity;
function reportPosition(self, force = false, urgent = false) {
  /* Positions go over the movement relay, straight from this browser. Urbit
   * carries only the slow fallback for viewers not on the relay yet -- never the
   * full movement stream. `force` marks a state change, such as walking into
   * a room, that fallback viewers should hear about at once. */
  /* WHICH PAINTING WE ARE ON travels with the position, because the position
   * means nothing without it: the same x,y is a different place on each map.
   * Left out, every relayed position said `main`, so two people standing
   * together in Vatican City were each drawn onto the other's Game Room --
   * hidden by the scene filter, put in a main-map region rather than the
   * Vatican's, and so never in the same room or the same call. */
  movement?.moved({ x: self.x, y: self.y, dir: self.dir, moving: !!self.moving,
                    scene: self.scene, host: R.rooms.host ?? null }, force, urgent);
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
  const call=(...args)=>{
    latest=args;
    const remaining=ms-(performance.now()-last);
    if(remaining<=0){clearTimeout(timer);flush();}
    else if(!timer)timer=setTimeout(flush,remaining);
  };
  /* Drop what is queued: something newer has already been sent another way. */
  call.cancel=()=>{clearTimeout(timer);timer=null;latest=null;last=performance.now();};
  return call;
}

/* The slingshot is gone. Attacks will come from the weapon art instead, which
 * is drawn for the bare bodies rather than for clothing -- see the report. */
let worldReady = false;
/* ASLEEP after IDLE_MS with no key, pointer or touch -- but never in a call,
 * where people often sit perfectly still. Everybody sees a "zzz…" over our
 * head, and it goes the moment we touch anything. See world/bubbles. */
let lastInput = Date.now(), asleep = false;
const inCall = () => ['connected', 'retrying', 'requesting'].includes(R.rooms.voice) ||
  R.inNoteCall() || !!R.currentHuddle();
function checkAsleep() {
  const next = Date.now() - lastInput >= IDLE_MS && !inCall() && !stage.active;
  if (next === asleep) return;
  asleep = next;
  game.setAsleep(our, asleep);
  if (presenceStarted) presence.publish();
}
for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'])
  window.addEventListener(type, () => { lastInput = Date.now(); if (asleep) checkAsleep(); }, { passive: true, capture: true });
/* The world's subscriptions are open: presence can run before the artwork is in. */
let watching = false;
let pendingPeers = null;
let presencePeers = new Map();
const appliedPresence = new Map();
/* Direct live member presence is the sole source of avatars. Room/call lists
 * coordinate rooms but never introduce someone into the world. */
const allPeers = (fromPresence = presencePeers) => new Map([...fromPresence].filter(([ship]) => worldMember(ship)));
function applyPresence() {
  if (pendingPeers) { presencePeers = pendingPeers; pendingPeers = null; }
  const peers = allPeers();
  setWorldPresence(peers.keys());
  for(const ship of state.peers.keys())if(!peers.has(ship))dropPeer(ship,'presence-removed');
  for(const ship of appliedPresence.keys())if(!peers.has(ship))appliedPresence.delete(ship);
  for(const [ship,p] of peers) {
    globalThis.__players?.store.adopt(ship,p.players);
    const old=appliedPresence.get(ship);
    if(!old || !state.peers.has(ship) || old.rev!==p.rev || old.host!==p.host || old.chatPlace!==p.chatPlace ||
      old.huddle?.session!==p.huddle?.session || old.huddle?.rev!==p.huddle?.rev ||
      old.spot.x!==p.spot.x || old.spot.y!==p.spot.y || old.spot.dir!==p.spot.dir || old.spot.scene!==p.spot.scene ||
      old.idle!==p.idle || old.micOff!==p.micOff || old.sheathed!==p.sheathed || old.activity!==p.activity)
      onWorldFact('peer-here',{...p,who:ship},true);
    appliedPresence.set(ship,p);
  }
  reconcilePeers();
}
/* What we are right now, as presence and rooms both send it. */
const here = () => ({stamp:Date.now(),...(asleep?{idle:lastInput}:{}),
  /* What we are doing on the stage, for the bubble over our head. */
  ...(activity?{activity}:{}),
  /* In a call with our microphone off: our stream stays in the call, silent,
   * so the others are told rather than left to guess. See lib/rooms. */
  ...(inCall()&&!R.rooms.micOn?{micOff:true}:{}),
  /* A weapon we hold but have put away is not drawn for the others either. */
  ...(state.look?.weapon?.part&&!game.armed?{sheathed:true}:{}),chatPlace:state.room,spot:{place:COMMONS,x:Math.round(game.self.x*G.SUB),y:Math.round(game.self.y*G.SUB),dir:game.self.dir,scene:game.scene},rev:state.rev,host:R.rooms.host??null,
  huddle:R.huddleSummary(),mv:movement?.announce()??null,players:globalThis.__players?.store.snapshot()??[]});
const presence = createMemberPresence({
  our, session:crypto.randomUUID(),
  sessionGen: () => sessionLease.gen(),
  members: worldMembers,
  blocked: ship => palStatus(ship) === 'blocked',
  /* The room list we are on rides our presence answer, so somebody who arrives
   * after a room filled up still learns who is in it. */
  snapshot:()=>({...here(),room:R.roomSummary()}),
  /* A query expects an answer; see lib/reachability. */
  send:(to,p)=>{if(p?.kind==='query')reach.asked(to);return G.sendPresence(to,p);},
  onRelay:(ship)=>movement?.onRelay(ship)??false,
  /* Noltbook's own record of who is in Glurff right now, kept by the world
   * note's host. Discovery over Ames asks only these. */
  likelyLive:()=>{const rows=nb.active?.[COMMONS_NOTE];if(!Array.isArray(rows)||!rows.length)return null;
    return new Set(rows.map(r=>r?.setBy).filter(s=>typeof s==='string'));},
  answered:(who)=>reach.answered(who),
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
playerStore = createPlayerState({
  our,
  send: async event => { await sendWorldAction(event); presence.publish(); },
  changed: (surface,player,local) => { mediaUI?.stateChanged(surface,player); if(!local)presence.publish(); },
});
mediaUI = new MediaSurfaces({ game, strip:stripRoot, store:playerStore, our, stage });
/* A spot either plays shared media (the jukebox, the screens) or opens an app
 * the player runs on their own ship (see ui/app-panel). */
const appRoot = document.createElement('div');
document.body.appendChild(appRoot);
const appPanel = new AppPanel(appRoot, { trace: diagnostic, world: WORLD_ID, stage });
window.__appPanel = appPanel;   // debug handle
/* The spots as the world's host has set them (see world/hotspots): until the
 * host's list arrives -- or if it never does -- each opens what the map gives
 * it, and a spot with nothing set is no spot at all. */
/* An app from a spot opens on the stage; a website from a spot asks once,
 * then does too (ui/sites); the screens and the jukebox play in the world. */
let spotSet = {}, spotWebs = {};
const showSpots = () => game.setHotspots(spotsFor(HOTSPOTS, spotSet, spotWebs, location.origin).map(h => ({ ...h,
  onActivate: () => h.web ? sites.visit(h.web.url, h.web.title)
    : h.app ? appPanel.open(spotApp(h.app, WORLD_HOST), { stage: true }) : mediaUI.activate(h.id) })));
showSpots();
/* This world's games, for the magnifying glass. */
const worldGames = () => game.hotspots.filter((h) => h.app || h.web).map((h) => ({ id: h.id, kind: h.web ? 'web' : 'app',
  title: h.web?.title ?? h.app.title ?? h.app.desk, open: () => h.onActivate(h) }));
window.__players = { store:playerStore, ui:mediaUI };
R.setRoomContext({ here, watchers: () => presence.viewers() });
R.onRoommates((why) => {
  /* Our own list changed: what rides our presence answer changed with it. */
  if (['list', 'hosting', 'left', 'following'].includes(why)) presence.publish();
  if (worldReady) applyPresence();
  movement?.presence(allPeers(pendingPeers ?? presencePeers));
});
movement = createMovement({
  our,
  generation: () => sessionLease.gen(),
  agent: { claim: G.claimMovement, release: G.releaseMovement, open: G.openMovement, knock: G.knockMovement },
  /* Direct presence authorizes the movement audience. There is no slow path:
   * positions go over the relay or not at all. */
  presence: {
    viewers: () => presence.viewers(),
    publishTo: () => {},
  },
  /* state.peers holds exactly the people presence lets us see; reconcilePeers
   * removes anyone who stops being visible. The relay adds nobody. */
  visible: (ship) => state.peers.has(ship),
  apply: applyRelayPosition,
  /* Installed but offline members must never delay a movement session. */
  expected: () => [...presence.peers().keys()],
  trace: diagnostic,
  onControl: (who, body) => onControl(who, body),
  onRelayRoster: (ships, left) => { presence.relayRoster([...ships], left); for (const s of left) reliable.forget(s); },
  /* Everybody's movement goes through the world host's relay room first. */
  world: WORLD_HOST,
});
window.__movement = movement;
/* THE WORLD'S LIVE CHANNEL is the movement relay. Presence, call coordination,
 * room lists, room chat and world effects go over it to whoever is on it; see
 * sendPresence in lib/glurff. */
/* Receipts, retries and repeat-dropping for what calls and presence depend
 * on; see lib/reliable. */
const reliable = createReliable({ send: (ship, body) => movement.control(ship, body), trace: diagnostic });
window.glurffReliable = () => reliable.stats();
G.setLiveChannel({ has: (ship) => movement.onRelay(ship), send: (ship, body) => reliable.send(ship, body) });
/* Waves go over that channel, with a receipt; see lib/waves. */
const waves = createWaves({
  send: (ship, body) => G.sendPresence(ship, body),
  may: (ship) => ship !== our && state.peers.has(ship) && palStatus(ship) !== 'blocked',
  onWaved: (who) => showWave(who),
});
/* Debug handle, like __game and __movement: the call layer as this tab sees
 * it. Nothing here can forge authority -- moderation is judged on the HOST's
 * ship, against the ship a request actually came from. */
window.__calls = R;
setMovementDiagnostics(() => movement.stats());
let announcedHost = null;
let announcedHuddle = '';
R.onRooms(() => {
  if (!watching) return;
  const summary=R.huddleSummary();
  const huddleKey=summary?`${summary.session}/${summary.rev}`:'';
  if(announcedHost!==R.rooms.host){announcedHost=R.rooms.host;movement.moved({ ...game.self, host: announcedHost }, true);}
  /* Roster changes are rare and need to reach a newly arriving browser even
   * when nobody moves. Presence is a durable second route beside the direct
   * host notification. */
  if(huddleKey!==announcedHuddle){announcedHuddle=huddleKey;presence.publish();}
});

/* A position that arrived over the movement relay. */
/* Returns whether the position was ACCEPTED. The movement layer records a
 * peer's motion only for accepted packets; see onPosition in lib/movement. */
function applyRelayPosition(ship, spot, meta) {
  const peer = state.peers.get(ship);
  if (!peer) return false;
  /* Ordered by the sender's SESSION first -- the generation its agent issued,
   * one clock per ship -- and only within one session by the sender's own
   * clock. Comparing timestamps alone let a second device whose clock ran
   * behind the first be ignored until the peer was forgotten. Within one
   * session an older presence snapshot still cannot drag an avatar back behind
   * a newer relay position, nor a late relay packet undo a newer snapshot. */
  if (!newerMotion(meta.gen, meta.t, peer)) return false;
  peer.motionG = meta.gen ?? 0;
  peer.motionT = meta.t;
  peer.spot = { place: COMMONS, x: spot.x, y: spot.y, dir: spot.dir, scene: spot.scene };
  peer.host = meta.host;
  game.upsertPeer(ship, peer.spot, peer.look, displayName(ship), meta.t,
                  { vx: meta.vx, vy: meta.vy, moving: meta.moving });
  scheduleWorld();
  return true;
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
  if(p)R.clearHost(ship,R.roomOf(ship,p.spot,p.chatPlace));
  R.forgetPeerRoom(ship);
  state.peers.delete(ship);game.dropPeer(ship);R.rooms.streams.delete(ship);
}
function reconcilePeers() {
  const allowed = new Set(visiblePeers());
  for(const ship of state.peers.keys())if(!allowed.has(ship))dropPeer(ship);
  for(const ship of R.rooms.streams.keys())if(!state.peers.has(ship))R.rooms.streams.delete(ship);
  R.refresh(state.peers);
  R.updateHuddle(game.self,state.peers);
  R.setPositions(game.self,state.peers);
  if(presenceStarted)void updateActiveCount(state.peers.size+1);
}
let presenceStarted=false;
/* Our microphone going off or on in a call is news for the people in it. */
let micSaid=false;
R.onRooms(()=>{const off=inCall()&&!R.rooms.micOn;if(off!==micSaid){micSaid=off;if(presenceStarted)presence.publish();}});
function socialReady() {
  if(!watching || !liveTab)return;
  if(!worldJoined()) {
    void stopActiveStatus();
    if(presenceStarted) {
      presenceStarted=false;
      presence.stop();
      movement?.stop('membership');
      setWorldPresence([]);
      if(worldReady)applyPresence();
    }
    return;
  }
  if(!presenceStarted){
    presenceStarted=true;milestone('presence-started');presence.start();movement?.start();
    releaseHistory();
    if(worldReady)R.enterRoom(game.room);
  }
  else presence.update();
  void updateActiveCount(state.peers.size+1);
}
/* Calls wait for positions the movement layer can vouch for (see rooms.js).
 * When that changes and nobody moves, nothing else re-evaluates the room or
 * huddle, so look once a second and recompute only on a change. */
let positionSignature='';
/* Presence sends only changes. Our movement-session claim is part of what it
 * sends, so a change there -- a new session, the relay going live -- goes out. */
let claimSignature='';
/* RECONNECTING, SAID OUT LOUD. With no slow path, a dropped relay means
 * nobody moves and nothing live arrives until it is back -- which must read as
 * "reconnecting", not as everybody standing still. Shown only once the relay
 * has been up, or after the first few seconds, so startup is not a warning. */
const netPill = document.createElement('div');
netPill.className = 'net-pill'; netPill.setAttribute('role', 'status'); netPill.hidden = true;
document.body.appendChild(netPill);
const bootAt = Date.now();
let relayWasLive = false;
function paintConnectivity() {
  const channel = window.api?.connectionDiagnostics?.();
  const relayLive = !!movement?.relayLive?.();
  if (relayLive) relayWasLive = true;
  const text = channel?.rebuilding ? 'Reconnecting to your ship…'
    : !relayLive && (relayWasLive || Date.now() - bootAt > 10000) && presenceStarted ? 'Reconnecting to the world…'
    : '';
  if (netPill.textContent !== text) netPill.textContent = text;
  netPill.hidden = !text;
}
ticker=setInterval(()=>{
  checkAsleep();
  presence.tick();
  reach.check();
  paintConnectivity();
  if(insideLease.active())void checkInsideLease();      //  the waits have deadlines
  if(presenceStarted)void updateActiveCount(state.peers.size+1);
  R.tickRoom();
  if(presenceStarted && movement) {
    const mv=movement.announce();
    const next=mv?`${mv.host}/${mv.term}/${mv.live}`:'';
    /* A new session is news for EVERYBODY who can see us, not only the people
     * already on our relay: they are the ones who need to find it. */
    if(next!==claimSignature){claimSignature=next;presence.publishAll();R.publishRoom();}
  }
  members.paint();   //  people come and go without a room change
  if(!movement)return;
  let trusted=0;for(const ship of state.peers.keys())if(movement.reliable(ship))trusted++;
    const next=movement.ready()+'/'+trusted;
  if(next!==positionSignature){positionSignature=next;scheduleWorld();}
},1000);
/* Closing the tab stops our relay connection but deliberately does NOT release
 * a movement room we host: our ship keeps admitting the people still in it. */
window.addEventListener('glurff-exit',()=>{presence.stop();R.closeTab();movement?.stop('exit');stopWorld();});
window.addEventListener('glurff-reconnect',()=>{if(presenceStarted){presence.start();movement?.restored();}});
window.addEventListener('glurff-restored',()=>{R.recoverCall();if(presenceStarted){presence.start(true);movement?.restored();}});
window.addEventListener('online',()=>{if(presenceStarted){presence.start(true);movement?.restored();}});
window.addEventListener('visibilitychange',()=>{if(!document.hidden && presenceStarted){presence.start();movement?.restored();}});

/* A message over the relay from a ship that is here: handled exactly as the
 * same message arriving over Ames would be, through the same checks. */
function onControl(who, body) {
  if (!worldMember(who) || palStatus(who) === 'blocked' || body?.world !== WORLD_ID) return;
  /* A receipt, or a repeat of something already handled. */
  if (reliable.receive(who, body)) return;
  if (body.kind === 'room-chat') {
    if (body.event?.world === WORLD_ID && Number.isSafeInteger(body.place))
      onWorldFact('room-event', { who, place: body.place, body: JSON.stringify(body.event) });
    return;
  }
  onWorldFact('presence-event', { who, body: JSON.stringify(body) });
}
function onWorldFact(name, p, fromPresence=false) {
  if(name==='presence-event') {
    if(!worldMember(p.who))return;
    reach.heard(p.who);
    try {const event=JSON.parse(p.body);if(event.world!==WORLD_ID)return;
    if(['arrow','arrow-hit','strike','strike-hit'].includes(event.kind)){if(spriteLabEnabled())bow.receive(p.who,event);}else if(event.kind==='emote'){
      if(state.peers.has(p.who) && palStatus(p.who)!=='blocked' &&
         ['main','vatican'].includes(event.scene) && Number.isFinite(event.t0) &&
         Math.abs(Date.now()-event.t0)<5000) game.react(p.who,'emote',event.scene);
    }else if(event.kind==='wave'){waves.receive(p.who);
    }else if(event.kind?.startsWith('call-')){R.receiveCallEvent(p.who,event);}else if(event.kind?.startsWith('room-')){R.receiveRoomEvent(p.who,event);}else if(event.kind?.startsWith('player-')){
      if(state.peers.has(p.who) && palStatus(p.who)!=='blocked')globalThis.__players?.store.receive(p.who,event);
    }else presence.receive(p.who,event);}catch(e){console.warn('Invalid presence event');}
    return;
  }
  // Old, unscoped movement/departure packets cannot override tab leases.
  if((name==='peer-here' || name==='peer-gone') && !fromPresence)return;
  /* "No lease" arrives as null -- see mar/glurff-update -- and has to reach
   * its case below. Reading `who` off it first threw, and the page never
   * learned the lease was gone. Nothing else is meant to be null. */
  if (p == null && name !== 'our-lease') return;
  if (p?.who && !visiblePeers().includes(p.who)) return;
  switch (name) {
    case 'room-event':
      try { const event=JSON.parse(p.body);if(event.world===WORLD_ID)events.receive(p.who,p.place,event); } catch {}
      break;
    case 'peer-here': {
      const reported = { place: p.spot.place, x: p.spot.x / G.SUB, y: p.spot.y / G.SUB,
                         dir: p.spot.dir, scene: p.spot.scene ?? 'main' };
      const prev = state.peers.get(p.who);
      /* Presence is the slow path now. If the relay already delivered a newer
       * position from this sender, keep it -- both carry the sender's own clock.
       * Membership, avatar version and room host still update either way. */
      const stamp = Number.isFinite(p.stamp) ? p.stamp : -Infinity;
      const newer = !prev || !Number.isFinite(prev.motionT) || newerMotion(p.sgen, stamp, prev);
      const spot = newer ? reported : prev.spot;
      const entry = { spot, rev: p.rev, look: prev?.look ?? null, at: Date.now(),
                      chatPlace: p.chatPlace,
                      idle: Number.isFinite(p.idle) ? p.idle : null,
                      micOff: p.micOff === true,
                      sheathed: p.sheathed === true,
                      activity: typeof p.activity === 'string' && p.activity ? p.activity.slice(0, 64) : null,
                      host: newer ? (p.host || null) : prev.host,
                      huddle: p.huddle ?? null,
                      motionT: newer ? stamp : prev.motionT,
                      motionG: newer ? (p.sgen ?? 0) : (prev.motionG ?? 0) };
      state.peers.set(p.who, entry);
      globalThis.__players?.store.adopt(p.who,p.players);
      if (!prev) milestone('visible:' + p.who, { who: p.who });
      /* One world, so everyone visible is drawn -- including people inside
       * rooms, seen from the commons. */
      game.upsertPeer(p.who, spot, entry.look, displayName(p.who), newer ? p.stamp : prev.motionT);
      game.setAsleep(p.who, entry.idle !== null);
      if ((prev?.micOff ?? false) !== entry.micOff) R.roomsChanged();
      game.setSheathed(p.who, entry.sheathed);
      game.setActivity(p.who, entry.activity);
      /* Their character arrives on request, not on every beat -- it is far
       * bigger than a position. Ask once, when the revision moves. */
      if (!prev || prev.rev !== p.rev) G.fetchLook(p.who);
      if (!prev && !nb.profiles[p.who]) requestProfile(p.who).catch(() => {});
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
    /* Our settings, from our agent: see lib/clocks. */
    case 'our-prefs':
      clocks.load(typeof p === 'string' ? p : '');
      break;
    case 'our-look':
      setSpriteLabEnabled(p.spriteLab === true);
      builder.setEquipmentReady(p.equipment === true);
      if (p.look && Object.keys(p.look).length) {
        state.look = p.look;
        game.self.look = p.look;
        state.rev = p.rev;
        builder.setLook(p.look);
        me.setLook(p.look);
        if (game.selfSprite) game.dressCharacter(game.selfSprite, p.look);
        presence.publish();
        R.publishRoom();
      }
      weaponsChanged();
      break;
    /* The room we hold for one of our notes. It outlives the tab, so this
     * arrives at startup as well as when it changes. */
    case 'our-lease':
      R.setLease(p ?? null);
      hud.setRoom(state.room);
      break;
    /* The lease owner's agent telling us which generation our seat joined, so
     * our renewals and our leave name the lease we are actually in. */
    case 'seat-ok':
      R.seatAdmitted(p?.place ?? 0, p?.gen ?? 0);
      break;
    /* Which browser session is this ship's live one. See lib/session-lease. */
    case 'session':
      sessionLease.heard(p);
      break;
    /* The owner of a room we were in has given it back. Their browser may be
     * closed, so this is the only thing that can tell us. */
    case 'lease-gone':
      R.leaseGone(p?.who ?? null, p?.place ?? 0, p?.gen ?? 0);
      hud.setRoom(state.room);
      break;
    /* HOST-SHIP ADMISSION: our agent could not decide a knock alone, turned
     * one of ours away on a host's behalf, or let somebody back in by itself. */
    case 'call-knocked':
      R.receiveKnocked(p?.who, p?.place, p?.attempt, p?.mode);
      break;
    case 'call-refused':
      R.receiveShipRefusal(p?.who, p?.place, p?.attempt, p?.why);
      break;
    case 'admitted':
      R.admittedByShip(p?.who, p?.place);
      break;
    /* THE DOOR: a lease owner's ship told us which note their room is, or that
     * it is private to a note we are not in. */
    case 'lease-info':
      R.leaseInfo(p?.who, p?.place, p?.note, p?.vis, p?.gen ?? 0);
      hud.setRoom(state.room);
      break;
    case 'lease-private':
      R.leasePrivate(p?.who, p?.place);
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
  /* Membership and artwork load together. Pals are read only for blocks and
   * social features; changing friendship or gossip reach cannot cut a call. */
  onChange((c) => { milestone(c.field + '-ready'); socialReady(); if (worldReady) reconcilePeers(); }, c => ['world', 'pals'].includes(c.field));
  const social = initNoltbook()
    .then(async () => {
      await hud.setRoom(COMMONS);
    })
    .catch((e) => console.error('Noltbook unavailable; social features are off', e));
  await game.start();
  const art = game.load();
  R.setMovementResultHandler((name, p) => movement?.result(name, p) ?? false);
  /* Calls are decided on positions; do not start one on positions the movement
   * layer cannot vouch for yet. */
  R.setPositionGate({ ready: () => movement?.ready() ?? true,
    roster: () => movement?.rosterReady?.() ?? movement?.ready() ?? true,
    reliable: (ship) => movement?.reliable(ship) ?? true,
    confidence: (ship) => movement?.confidence(ship) ?? 'live-stationary' });
  await Promise.all([G.watchWorld(onWorldFact), R.initRooms()]);
  watching = true;
  /* Which app each spot opens, from the world's host -- and again whenever
   * the host changes one. */
  void Promise.resolve(G.watchSpots(WORLD_HOST, (name, set) => {
    if (name === 'spots') spotSet = set ?? {}; else spotWebs = set ?? {};
    diagnostic('spots', { reason: name, count: Object.keys(set ?? {}).length });
    showSpots();
  })).catch(() => {});
  sessionLease.start();
  milestone('world-subscribed');
  movement.moved({ ...game.self, host: R.rooms.host ?? null });
  socialReady();

  await art;
  game.self.look = state.look;
  game.build();
  game.setZoom(startZoom(innerWidth, innerHeight));
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
  /* Every visit starts with our weapon put away: a stray click never attacks. */
  game.setArmed(false);
  touchControls.paint();
  /* Our clocks, if our settings came in before the sky was there. */
  game.setClocks(clocks.get().clocks);
  milestone('world-ready');
  /* Everyone presence found while the artwork loaded. */
  applyPresence();
  await social;
})();

import { versioned } from '../lib/build.js';
/* The world, drawn.
 *
 * PixiJS, nearest-neighbour, integer zoom steps so pixels stay square. The
 * renderer owns your position once you are walking; presence reads it and
 * reports outward, and nothing writes it back -- writing it back fights the
 * player for control and drags them a tile at a time.
 */
import { MotionBuffer } from 'lib/motion';
import { Space, SPACE_COLOR } from './space.js';
import { bubbleText, WAVE_MS } from './bubbles.js';
import { projectileTexture, TIP } from './projectiles.js';
import { nearestDir } from '../lib/bow.js';
import { pinchZoom, spreadOf, isTap, TAP_SLOP_PX, TOUCH_PAN_SPEED } from '../lib/touch.js';
import { Application, Container, Graphics, Sprite, Text, Texture, Rectangle, BaseTexture, SCALE_MODES, Assets } from 'pixi.js';
import { FRAME, FEET, HEAD, completeLook, allTextures, characterLayers, characterTop,
  equipmentOf, wholeFrame, animationFrames, artUrl, EQUIPMENT } from 'world/parts';
import { CharacterAnimation } from './animation.js';
import { buildWorld, regionAt, SPAWN, COMMONS, GAME_ROOM, MAIN_SCENE, VATICAN_SCENE, TILE,
  VATICAN_SPAWN, MAP_IMAGE, OVER_IMAGE, VATICAN_IMAGE, VATICAN_OVER_IMAGE,
  ROOMS, normalScene, sceneTile, sceneCharacterScale, sceneNameSize, sceneWalkSpeed, sceneImages, solidAt as mapSolid,
  vaticanExitAt, sceneInfo } from 'world/places';
import { SecretRoomQuest, MAIN_RETURN } from 'world/secret-room';
import { hotspotAt as findHotspot } from 'world/hotspots';

BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

/* How far above the feet a name sits, as a fraction of the character's own
 * height. The art leaves empty rows above the head, so hanging the label off
 * the top of the frame left it floating a whole character clear of the person
 * it names. The boxed label needs a little more clearance than bare text. */
const NAME_HEIGHT = 0.74;
/* Let labels breathe with the map, but only inside a restrained screen-space
 * range. This keeps the far view readable without making names dwarf people,
 * and prevents the closest views from turning them into banners. */
const NAMEPLATE_MIN_SCREEN_SIZE = 12;
const NAMEPLATE_MAX_SCREEN_SIZE = 22;
const NAMEPLATE_SCREEN_GAP = 2;

/* How close to a room you may not enter before it offers to let you in, and
 * how far away you must get before it offers again. Two tiles and three, the
 * same gap huddles use to stop somebody on an edge flickering in and out. */
const NEAR_DOOR = 2, LEAVE_DOOR = 3;
/* Where to look for one: around the feet, at a third of a tile apart. Sixteen
 * points covers a doorway from any approach without scanning the map. */
const DOOR_LOOK = (() => {
  const out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (const r of [1, 2, 3]) out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
})();

/* One texture per part frame, cut out of its slot's sheet and kept: a walking
 * character asks for the same handful of frames over and over. */
const frames = new Map();
const loading = new Map();
function frameTexture(f) {
  const base = Assets.cache.has(f.url) ? Assets.cache.get(f.url)?.baseTexture : null;
  if (!base?.valid) {
    if (!loading.has(f.url)) loading.set(f.url, Assets.load(f.url).catch(() => null));
    return null;
  }
  const id = `${f.url}|${f.x},${f.y},${f.w},${f.h}`;
  let t = frames.get(id);
  if (!t) {
    t = new Texture(base, new Rectangle(f.x, f.y, f.w, f.h));
    frames.set(id, t);
  }
  return t;
}
const RUN_MULT = 1.8;
const DOUBLE_TAP_MS = 280;
const FRAME_MS = 200;       //  Minifantasy walk timing
/* How far the world moves for a drag of the mouse. Above one, so crossing the
 * building is one pull rather than several. */
const PAN_SPEED = 2.5;
/* Half steps are allowed at the bottom end so the whole world can be seen at
 * once. 0.5 still maps 2x2 source pixels to one, so it stays crisp; anything
 * non-power-of-two would not. */
export const ZOOMS = [0.5, 1, 2, 3, 4, 5];
/* A phone sees a few tiles at the desktop's zoom: it starts a step further out. */
export const startZoom = (width, height) => (Math.min(width, height) < 600 ? 2 : 3);
/* Frames a new room must hold before anything is told you are in it. Doorways
 * are one step wide and a step lands on them. */
const ROOM_SETTLE = 6;

export class Game {
  constructor(mount, { onMove, onRoomChange, onSceneChange, onEmote, isClosed, isBlocked, onRoomDoor, onClockMoved, onClockHover, onArm, onTap } = {}) {
    /* The "1" key: take our weapon out, or put it away. */
    this.onArm = onArm ?? (() => {});
    this.armed = false;
    /* A finger tapped the world here: (clientX, clientY). See lib/touch. */
    this.onTap = onTap ?? (() => {});
    /* The on-screen joystick's say, {x, y, run} or null; see ui/touch-controls. */
    this.stick = null;
    /* Fingers on the world, by pointer: {x, y, at}. */
    this.touches = new Map();
    this.tap = null; this.gesture = null; this.touchAt = -Infinity;
    /* The pointer is over a clock in the sky, or no longer is: (id | null, x, y). */
    this.onClockHover = onClockHover ?? (() => {});
    /* A clock in the sky was dragged somewhere new: (id, x, y, width, height). */
    this.onClockMoved = onClockMoved ?? (() => {});
    /* Is this room shut to us? A room leased to somebody's secret note is. */
    this.isClosed = isClosed ?? (() => false);
    /* Public/private note rooms are visible but stop non-members at the door;
     * secret rooms are both blocked and visually closed. */
    this.isBlocked = isBlocked ?? this.isClosed;
    this.onRoomDoor = onRoomDoor ?? (() => {});
    this.doorRoom = null;
    this.mount = mount;
    this.onMove = onMove ?? (() => {});
    /* Fires when you walk into or out of a room. There is no loading and no
     * place switch -- the room is part of the same world. */
    this.onRoomChange = onRoomChange ?? (() => {});
    this.onSceneChange = onSceneChange ?? (() => {});
    this.onEmote = onEmote ?? (() => {});
    this.zoom = 3;
    this.keys = new Set();
    this.peers = new Map();   //  ship -> {sprite, spot, look}
    this.world = null;
    this.scene = MAIN_SCENE;
    this.tile = sceneTile(this.scene);
    this.characterScale = sceneCharacterScale(this.scene);
    this.room = COMMONS;
    this.settling = null; this.settled = 0;
    this.self = { x: SPAWN.x, y: SPAWN.y, dir: 'down', moving: false, frame: 0,
                  look: null, scene: MAIN_SCENE };
    this.secretRoom = new SecretRoomQuest(GAME_ROOM);
    this.exitWasInside = false;
    this.lastFrame = 0;
    /* Double-tapping a direction runs, the way it does in every game that has
     * ever had a run button. */
    this.lastTap = { key: null, at: 0 };
    this.running = false;
    this.ourShip = null;
    /* Looking around without walking: left-drag moves the view, and your next
     * step brings it back to you. */
    this.pan = { x: 0, y: 0 };
    this.panning = null;
    this.panned = false;
    this.hotspots = [];
    this.hoveredHotspot = null;
  }

  async start() {
    this.app = new Application({
      background: SPACE_COLOR,
      resizeTo: this.mount,
      antialias: false,
      autoDensity: true,
      resolution: 1,
    });
    this.mount.appendChild(this.app.view);

    /* Outer space, behind everything: what used to be flat black past the
     * edges of the maps. See world/space. */
    this.space = new Space();
    this.app.stage.addChild(this.space.node);
    this.camera = new Container();
    this.ground = new Container();
    this.actors = new Container();   //  depth-sorted, so people walk behind things
    this.actors.sortableChildren = true;
    /* The obscure layer of the painting: doorways and anything else people pass
     * behind, drawn over everybody. */
    this.above = new Container();
    this.camera.addChild(this.ground, this.actors, this.above);
    this.app.stage.addChild(this.camera);
    /* The clocks come in front of the map while they are being arranged. */
    this.app.stage.addChild(this.space.front);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('focusin', (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) {
        this.keys.clear();
        this.running = false;
      }
    });
    /* Drag to look around: hold the left button and pull the world. It travels
     * further than the cursor does, so a room away is a short drag rather than
     * three. A click that does not move is not a drag, so double-clicking
     * somebody still opens them. */
    this.mount.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      /* Arranging the clocks: a press on one picks it up instead. */
      if (this.space?.arranging) {
        const p = this.screenPoint(e), hit = this.space.clockAt(p.x, p.y);
        if (hit) { this.clockDrag = { id: hit.id, dx: hit.dx, dy: hit.dy }; this.mount.style.cursor = 'grabbing'; return; }
      }
      this.panning = { x: e.clientX, y: e.clientY };
      this.panned = false;
      this.pressed = true;
    });
    window.addEventListener('mousemove', (e) => {
      if (this.clockDrag) {
        const p = this.screenPoint(e);
        this.space.drag(this.clockDrag.id, p.x - this.clockDrag.dx, p.y - this.clockDrag.dy);
        this.onClockHover(null);
        return;
      }
      if (!this.panning) { this.hoverHotspot(e.clientX, e.clientY); this.hoverClock(e); return; }
      this.onClockHover(null);
      const dx = e.clientX - this.panning.x, dy = e.clientY - this.panning.y;
      if(!this.panning.anchored)this.anchorPanToCamera();
      if (Math.abs(dx) + Math.abs(dy) > 3) { this.panned = true; this.mount.style.cursor = 'grabbing'; }
      this.panning = { x: e.clientX, y: e.clientY, anchored:true };
      this.pan.x -= (dx * PAN_SPEED) / this.zoom;
      this.pan.y -= (dy * PAN_SPEED) / this.zoom;
      this.centreCamera();
    });
    const release = () => {
      if (this.clockDrag && this.clockDrag.touch === undefined) this.dropClock();
      this.panning = null; this.pressed = false; this.mount.style.cursor = this.restCursor();
    };
    /* ARMED, a click -- a press and release that did not drag -- attacks toward
     * the pointer. Dragging still looks around. */
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !this.pressed || this.panned || !this.armed || this.space?.arranging) return;
      this.fireAt(e.clientX, e.clientY);
    }, true);
    window.addEventListener('mouseup', (e) => { if (e.button === 0) release(); });
    window.addEventListener('blur', release);
    this.mount.addEventListener('mouseleave', () => { this.showHotspot(null); this.onClockHover(null); });
    window.addEventListener('blur', () => {this.keys.clear();this.running=false;});
    /* TOUCH (see lib/touch). One finger taps -- or, arranging, carries a clock;
     * two drag the world about and pinch to zoom. The browser's own panning and
     * zooming are off over the world (touch-action), and so are the mouse
     * events it would make up from a touch: the handlers above are the mouse's. */
    const finger = (e) => ({ x: e.clientX, y: e.clientY, at: performance.now() });
    this.mount.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      e.preventDefault();
      this.touchAt = performance.now();
      /* Touching the world puts the keyboard away. */
      const typing = document.activeElement;
      if (typing?.closest?.('input, textarea, select, [contenteditable]')) typing.blur();
      try { this.mount.setPointerCapture(e.pointerId); } catch {}
      this.touches.set(e.pointerId, finger(e));
      if (this.touches.size === 1) {
        this.panned = false;
        if (this.space?.arranging) {
          const p = this.screenPoint(e), hit = this.space.clockAt(p.x, p.y);
          if (hit) { this.clockDrag = { id: hit.id, dx: hit.dx, dy: hit.dy, touch: e.pointerId }; return; }
        }
        this.tap = { id: e.pointerId, ...finger(e) };
        /* The spot under the finger lifts, as it does under a mouse. */
        if (!this.armed) this.showHotspot(this.hotspotAt(e.clientX, e.clientY));
        return;
      }
      /* Another finger: not a tap any more, a look around. */
      this.tap = null; this.showHotspot(null);
      this.startGesture();
    });
    this.mount.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
      this.touches.set(e.pointerId, finger(e));
      if (this.clockDrag?.touch === e.pointerId) {
        const p = this.screenPoint(e);
        this.space.drag(this.clockDrag.id, p.x - this.clockDrag.dx, p.y - this.clockDrag.dy);
        return;
      }
      if (this.tap?.id === e.pointerId && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > TAP_SLOP_PX) {
        this.tap = null; this.showHotspot(null);
      }
      if (!this.gesture || this.touches.size < 2) return;
      const s = spreadOf(this.touches.values());
      const z = pinchZoom(this.gesture.zoom, this.gesture.spread, s.spread, ZOOMS);
      if (z !== this.zoom) this.setZoom(z);
      this.pan.x -= ((s.x - this.gesture.x) * TOUCH_PAN_SPEED) / this.zoom;
      this.pan.y -= ((s.y - this.gesture.y) * TOUCH_PAN_SPEED) / this.zoom;
      this.gesture.x = s.x; this.gesture.y = s.y;
      this.panned = true;
      this.centreCamera();
    });
    const lift = (e) => {
      if (e.pointerType !== 'touch' || !this.touches.has(e.pointerId)) return;
      this.touches.delete(e.pointerId);
      this.touchAt = performance.now();
      if (this.clockDrag?.touch === e.pointerId) { this.dropClock(); return; }
      const tap = this.tap;
      if (tap?.id === e.pointerId) {
        this.tap = null; this.showHotspot(null);
        if (e.type === 'pointerup' && isTap(tap, finger(e))) this.onTap(e.clientX, e.clientY);
      }
      /* Down to one finger: it does nothing more until it lifts. */
      if (this.touches.size >= 2) this.startGesture(); else this.gesture = null;
    };
    this.mount.addEventListener('pointerup', lift);
    this.mount.addEventListener('pointercancel', lift);
    /* A finger held still is not asking for the browser's menu. */
    this.mount.addEventListener('contextmenu', (e) => { if (this.touches.size || this.touchedRecently()) e.preventDefault(); });
    /* Wheel to zoom, which is what everyone reaches for first. */
    this.mount.addEventListener('wheel', (e) => {
      e.preventDefault();
      const i = ZOOMS.indexOf(this.zoom);
      this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]);
    }, { passive: false });
    this.app.ticker.add(() => this.tick());
  }

  onKey(e, down) {
    const modal = down && [...document.querySelectorAll('.builder, dialog[open], [role="dialog"]')]
      .some(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (down && (modal ||
      e.target?.closest?.('input, textarea, select, [contenteditable]') ||
      (e.key === ' ' && e.target?.closest?.('button, a')) ||
      e.ctrlKey || e.metaKey || e.altKey)) {this.keys.clear();return;}
    const k = e.key.toLowerCase();
    if (k === ' ') {
      if (down && !e.repeat) this.bow?.fire();
      e.preventDefault();
    }
    if (k === 'b' && down && !e.repeat) {
      this.emote();
      e.preventDefault();
    }
    /* "1": our weapon out, or away. Only the key on the main row -- the number
     * pad's 1 is left alone. */
    if (e.code === 'Digit1' && down && !e.repeat) {
      this.onArm();
      e.preventDefault();
    }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      if (down && !this.keys.has(k)) {
        const now = performance.now();
        this.running = this.lastTap.key === k && now - this.lastTap.at < DOUBLE_TAP_MS;
        this.lastTap = { key: k, at: now };
      }
      down ? this.keys.add(k) : this.keys.delete(k);
      if (!down && this.keys.size === 0) this.running = false;
      e.preventDefault();
    }
    if (down && (k === '=' || k === '+' || k === '-')) {
      const i = ZOOMS.indexOf(this.zoom);
      this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (k === '-' ? -1 : 1)))]);
    }
  }

  /* Two or more fingers down: measure from here. Again whenever one comes or
   * goes, so the world does not jump. */
  startGesture() {
    const s = spreadOf(this.touches.values());
    this.anchorPanToCamera();
    this.gesture = { x: s.x, y: s.y, spread: s.spread, zoom: this.zoom };
  }
  /* A touch a moment ago: the browser's own double-tap may still turn up as a
   * double-click, and must not open somebody a second time. */
  touchedRecently() { return performance.now() - this.touchAt < 800; }
  /* The joystick: which way, and whether running; null to stop. */
  setStick(walk) { this.stick = walk ? { x: walk.x, y: walk.y, run: !!walk.run } : null; }
  /* A clock carried by mouse or finger, put down: kept where it landed. */
  dropClock() {
    if (!this.clockDrag) return;
    this.clockDrag = null;
    const d = this.space.drop();
    if (d) this.onClockMoved(d.id, d.x, d.y, this.space.size.w, this.space.size.h);
  }

  setZoom(z) {
    /* Snap to the allowed steps rather than accepting any scale: arbitrary
     * fractions on pixel art give unevenly sized pixels, which reads as blur. */
    const i = ZOOMS.reduce((best, v, idx) =>
      Math.abs(v - z) < Math.abs(ZOOMS[best] - z) ? idx : best, 0);
    this.zoom = ZOOMS[i];
    this.camera.scale.set(this.zoom);
    if (this.selfSprite) this.positionNameplate(this.selfSprite);
    for (const p of this.peers.values()) this.positionNameplate(p.ch);
  }

  /* ------------------------------------------------------------ textures */

  async load() {
    /* The world you start in is ready before walking begins. The SECRET
     * scene's painting -- about 370 KB nobody needs at startup -- follows in
     * the background, and is normally in long before anybody finds the way
     * in; if not, the scene fills in as it arrives rather than blocking. */
    const maps = [MAP_IMAGE, OVER_IMAGE], later = [VATICAN_IMAGE, VATICAN_OVER_IMAGE];
    await Assets.load([...maps.map(versioned), ...allTextures()]);
    this.mapTextures = new Map(maps.map(url => [url, Texture.from(versioned(url))]));
    this.laterMaps = Assets.load(later.map(versioned)).then(() => {
      for (const url of later) if (!this.mapTextures.has(url)) this.mapTextures.set(url, Texture.from(versioned(url)));
    }, () => {});
  }

  /* A scene's painting, loaded or loading. */
  sceneTexture(url) {
    let t = this.mapTextures.get(url);
    if (!t) { t = Texture.from(versioned(url)); this.mapTextures.set(url, t); }
    return t;
  }

  /* -------------------------------------------------------------- places */

  build() {
    const wd = buildWorld(this.scene);
    this.world = wd;
    this.ground.removeChildren();
    this.actors.removeChildren();
    this.above.removeChildren();

    const images = sceneImages(this.scene);
    this.painting = new Sprite(this.sceneTexture(images.image));
    this.painting.position.set(0, 0);
    this.ground.addChild(this.painting);
    this.hotspotLayer = new Container();
    this.ground.addChild(this.hotspotLayer);
    this.overPainting = new Sprite(this.sceneTexture(images.over));
    this.overPainting.position.set(0, 0);
    this.above.addChild(this.overPainting);
    /* Rooms shut to us are covered over rather than merely un-walkable: an
     * invisible wall is a bug, a closed room is a fact. */
    this.covers = new Container();
    this.above.addChild(this.covers);
    /* A fresh, empty layer: forget what was drawn on the old one, or the cache
     * below says "already covered" and nothing is ever drawn again. */
    this.coveredRooms = null;
    this.coversAt = -Infinity;
    this.paintCovers();

    this.selfSprite = this.makeCharacter(this.self.look, null, this.scene);
    this.actors.addChild(this.selfSprite.node);
    return wd;
  }

  /* Swap the painted scene. The callback also moves the player between the
   * Game Room and Vatican City's social rooms. */
  setScene(scene, destination) {
    const next = normalScene(scene);
    const previous = this.scene;
    this.scene = next;
    this.self.scene = next;
    this.tile = sceneTile(next);
    this.characterScale = sceneCharacterScale(next);
    this.world = buildWorld(next);
    const images = sceneImages(next);
    this.painting.texture = this.sceneTexture(images.image);
    this.overPainting.texture = this.sceneTexture(images.over);
    this.self.x = destination.x;
    this.self.y = destination.y;
    this.self.dir = destination.dir ?? this.self.dir;
    this.self.moving = false;
    this.self.frame = 0;
    this.selfSprite.animation = new CharacterAnimation();
    this.selfSprite.follow = null;
    this.bow?.clear();
    this.pan = { x: 0, y: 0 };
    this.settling = null;
    this.settled = 0;
    this.room = regionAt(this.self.x, this.self.y, next, this.room);
    this.exitWasInside = next === VATICAN_SCENE && vaticanExitAt(this.self.x, this.self.y);
    this.secretRoom.reset();
    this.showHotspot(null);
    this.scaleCharacter(this.selfSprite, this.characterScale, sceneNameSize(next));
    this.placeCharacter(this.selfSprite, this.self.x, this.self.y, next);
    for (const p of this.peers.values()) {
      p.ch.node.visible = (p.scene === next);
      this.placeCharacter(p.ch, p.render.x, p.render.y, p.scene);
    }
    this.poseCharacter(this.selfSprite, this.self.dir, 0);
    this.centreCamera();
    this.onSceneChange(next, previous);
  }

  /* ---------------------------------------------------------- characters */

  makeCharacter(look, name = null, scene = MAIN_SCENE) {
    const node = new Container();
    node.visible = scene === this.scene;
    const layers = {}, body = new Container(), companion = new Sprite(Texture.EMPTY);
    node.addChild(body);
    /* The name rides above the head, in the world rather than in the HUD, so
     * you can tell who is who at a glance. It is the Noltbook display name
     * where one is set -- the raw @p is only a fallback. */
    const nameplate = new Container(), labelBackground = new Graphics();
    const label = new Text(name ?? '', {
      /* A compact fantasy-display face suits the painted world without turning
       * the nameplate into UI chrome. The fallbacks retain its sturdy shape. */
      fontFamily: 'Copperplate, "Copperplate Gothic Light", "Trebuchet MS", sans-serif',
      fontWeight: 'bold',
      letterSpacing: 0.3,
      fontSize: sceneNameSize(scene),
      fill: 0xfff6dc,
    });
    label.anchor.set(0.5, 1);
    label.resolution = 2;
    nameplate.addChild(labelBackground, label);
    node.addChild(nameplate);

    const ch = { node, body, companion, layers, nameplate, labelBackground, label,
      look: completeLook(look), dir: 'down', frame: 0,
      animation: new CharacterAnimation(), follow: null };
    this.actors.addChild(companion);
    this.scaleCharacter(ch, sceneCharacterScale(scene), sceneNameSize(scene));
    this.dressCharacter(ch, ch.look);
    return ch;
  }

  scaleCharacter(ch, scale, nameSize = null) {
    ch.scale = scale;
    for (const layer of Object.values(ch.layers)) layer.scale.set(scale);
    if (nameSize && ch.label.style.fontSize !== nameSize) ch.label.style.fontSize = nameSize;
    this.positionNameplate(ch);
    this.refreshNameplate(ch);
  }

  positionNameplate(ch) {
    const natural = Number(ch.label.style.fontSize) * this.zoom;
    const compensated = Math.max(NAMEPLATE_MIN_SCREEN_SIZE,
      Math.min(NAMEPLATE_MAX_SCREEN_SIZE, natural));
    ch.nameplate.scale.set(compensated / natural);
    ch.nameplate.position.set(0,
      -characterTop(ch.look) * ch.scale * NAME_HEIGHT - NAMEPLATE_SCREEN_GAP / this.zoom);
  }

  nameCharacter(ch, name) {
    if (ch.label && ch.label.text !== name) {
      ch.label.text = name ?? '';
      this.refreshNameplate(ch);
    }
  }

  refreshNameplate(ch) {
    const visible = Boolean(ch.label.text);
    ch.nameplate.visible = visible;
    if (!visible) return;
    const padX = 4, padY = 1;
    ch.labelBackground.clear()
      .beginFill(0x17141f, 0.82)
      .drawRoundedRect(-ch.label.width / 2 - padX, -ch.label.height - padY,
        ch.label.width + padX * 2, ch.label.height + padY * 2, 2)
      .endFill();
  }

  dressCharacter(ch, look) {
    ch.look = completeLook(look);
    this.poseCharacter(ch, ch.dir, ch.frame);
  }

  poseCharacter(ch, dir, frame, animation = 'walk', progress = 0, cycle = frame) {
    ch.dir = dir;
    ch.frame = frame;
    ch.mode = animation;
    // Off-scene peers do not download art until they can actually be seen.
    if (!ch.node.visible) return;
    /* NOTHING CHANGED, NOTHING TO DO. This ran for every character on every
     * frame -- rebuilding the layer list, re-attaching every sprite (which
     * makes Pixi remove it, re-insert it and recompute its transform) and
     * moving the nameplate -- when a standing character changes frame about
     * five times a second. The pose is remembered once every layer's art has
     * arrived, and a frame that would draw the same pose is skipped. A fall
     * rotates with its progress, so that counts as part of the pose. */
    const key = `${dir}|${frame}|${animation}|${cycle}|${ch.scale}|${ch.sheathed ? 1 : 0}` +
      (animation === 'die' ? `|${Math.round(progress * 32)}` : '');
    if (key === ch.posedKey && ch.look === ch.posedLook) return;
    /* A weapon put away is not drawn. */
    const worn = ch.sheathed && ch.look?.weapon ? { ...ch.look, weapon: undefined } : ch.look;
    const frames = characterLayers(worn, dir, frame, animation, cycle);
    const order = frames.map((f) => f.key).join(',');
    /* Layers are re-stacked only when WHICH layers are drawn changes -- a new
     * outfit, a weapon drawn, a mount -- not on every step. */
    const restack = order !== ch.layerOrder || ch.look !== ch.posedLook;
    for (const layer of Object.values(ch.layers)) layer.visible = false;
    let complete = true;
    for (const f of frames) {
      let layer = ch.layers[f.key];
      if (!layer) { layer = ch.layers[f.key] = new Sprite(Texture.EMPTY); ch.body.addChild(layer); }
      // Reinsert in the shared compositor's order (mount ALWAYS in front).
      if (restack) ch.body.addChild(layer);
      const texture = frameTexture(f);
      layer.visible = true;
      if (texture) layer.texture = texture; else complete = false;
      layer.anchor.set(.5, f.feet / f.h);
      layer.position.set((f.dx ?? 0)*ch.scale, (f.dy ?? 0)*ch.scale);
      layer.scale.set(ch.scale*(f.flip ? -1 : 1), ch.scale);
      layer.tint = f.tint ?? 0xffffff;
    }
    ch.layerOrder = order;
    const premade = equipmentOf('premade', ch.look.premade?.part);
    // Some creatures have no fall strip. Give them the same visible, reversible
    // reaction with their OWN art rather than substituting a human body.
    ch.body.rotation = animation === 'die' && premade && !premade.animations.die
      ? Math.sin(progress*Math.PI)*Math.PI/2 : 0;
    /* Art still downloading: draw it again next frame until it is all here. */
    ch.posedKey = complete ? key : null;
    ch.posedLook = ch.look;
    /* The nameplate sits over the top of the character: it moves when the
     * zoom, the size or the outfit does, not on every step. */
    const plate = `${this.zoom}|${ch.scale}|${ch.label?.style?.fontSize}`;
    if (restack || plate !== ch.plateKey) { ch.plateKey = plate; this.positionNameplate(ch); }
  }

  animateCharacter(ch, dir, moving, time) {
    const pose = ch.animation.pose(time, moving, {
      walk: animationFrames(ch.look, 'walk'), idle: animationFrames(ch.look, 'idle'),
    });
    this.poseCharacter(ch, dir, pose.frame, pose.animation, pose.progress, pose.cycle);
  }

  emote() {
    if (!this.selfSprite || this.self.moving || this.keys.size || this.stick) return false;
    const now = performance.now();
    const frames = animationFrames(this.selfSprite.look, 'idle');
    if (!this.selfSprite.animation.emote(now, frames)) return false;
    this.onEmote(this.scene);
    return true;
  }

  react(ship, kind, scene, weaponKey = null) {
    const peer = this.peers.get(ship);
    const ch = ship === this.ourShip ? this.selfSprite : peer?.ch;
    if (!ch || (ship === this.ourShip ? this.scene : peer.scene) !== scene) return;
    if (kind === 'attack') {
      const weapon = equipmentOf('weapon',weaponKey ?? ch.look.weapon?.part);
      ch.animation.attack(performance.now(),Math.max(1,...Object.values(weapon?.layers ?? {}).map(l=>l.frames)));
    }
    else if (kind === 'emote') ch.animation.emote(performance.now(), animationFrames(ch.look, 'idle'));
    else ch.animation.hit(performance.now(), 12);
  }

  followCharacter(ch, x, y, scene, time, dt) {
    const item = equipmentOf('companion', ch.look.companion?.part);
    ch.companion.visible = !!item && ch.node.visible;
    if (!ch.companion.visible) return;
    const tile = sceneTile(scene), scale = sceneCharacterScale(scene);
    const distance = 12*scale/tile;
    if (!ch.follow || ch.follow.scene !== scene || Math.hypot(ch.follow.x-x,ch.follow.y-y)>distance*8)
      ch.follow = {x:x-distance,y,scene,dir:ch.dir};
    const f = ch.follow, dx=x-f.x, dy=y-f.y, d=Math.hypot(dx,dy);
    const moving = d>distance;
    if (moving) {
      const step = (d-distance)*(1-Math.exp(-dt*8));
      f.x += dx/d*step; f.y += dy/d*step;
      f.dir = Math.abs(dx)>Math.abs(dy) ? (dx<0?'left':'right') : (dy<0?'up':'down');
    }
    const frame = wholeFrame(item, f.dir, Math.floor(time/200), moving?'walk':'idle');
    if (ch.companionKey !== item.key) {ch.companion.texture=Texture.EMPTY;ch.companionKey=item.key;}
    const texture = frameTexture(frame);
    if (texture) ch.companion.texture = texture;
    ch.companion.anchor.set(.5, frame.feet/frame.h);
    ch.companion.scale.set(scale*(frame.flip?-1:1), scale);
    ch.companion.position.set(f.x*tile, f.y*tile);
    ch.companion.zIndex = Math.round(f.y*tile);
  }

  drawArrows(shots, time) {
    this.arrows ??= new Map();
    const live = new Set();
    for (const shot of shots) {
      if (shot.scene !== this.scene) continue;
      live.add(shot.key);
      let sprite = this.arrows.get(shot.key);
      if (!sprite) {
        /* Our own drawing, turned to wherever it is going; see world/projectiles. */
        sprite = new Sprite(projectileTexture(shot.weapon));
        const tip = TIP[shot.weapon === 'slingshot' ? 'stone' : 'arrow'];
        sprite.anchor.set(tip.x, tip.y);
        this.arrows.set(shot.key,sprite); this.actors.addChild(sprite);
      }
      const [vx, vy] = shot.vec ?? {up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[shot.dir];
      sprite.rotation = Math.atan2(vy, vx);
      sprite.scale.set(this.characterScale, this.characterScale);
      sprite.position.set(shot.point.x*this.tile,
        (shot.point.y-sceneInfo(this.scene).collisionOffsetY)*this.tile);
      sprite.zIndex = Math.round(shot.point.y*this.tile);
    }
    for (const [key,sprite] of this.arrows) if (!live.has(key)) {sprite.destroy();this.arrows.delete(key);}
  }

  /* A character stands ON its position: x and y are where the feet are. */
  placeCharacter(ch, x, y, scene = this.scene) {
    const tile = sceneTile(scene);
    ch.node.position.set(x * tile, y * tile);
    ch.node.zIndex = Math.round(y * tile);
  }

  /* ------------------------------------------------------------- peers */

  /* `motion` is whatever the sender told us about how they are moving --
   * velocity in tiles per second and whether they are walking at all. Absent
   * from the slow path and from older builds, and then worked out from the
   * positions themselves. */
  upsertPeer(ship, spot, look, name, stamp, motion = {}) {
    spot = { ...spot, scene: normalScene(spot.scene) };
    let p = this.peers.get(ship);
    if (!p) {
      /* Build once and PATCH afterwards. Rebuilding a peer every update tears
       * down their sprites, and texture work never survives it. */
      const peerScene = spot.scene;
      p = { ch: this.makeCharacter(look, name ?? ship, peerScene), spot,
            scene: peerScene, render:{x:spot.x,y:spot.y},
            motion:new MotionBuffer(spot,performance.now(),stamp,
              {solid:(x,y)=>mapSolid(x,y,peerScene)}) };
      this.actors.addChild(p.ch.node);
      this.peers.set(ship, p);
    }
    if (look && p.lastLook!==look) {this.dressCharacter(p.ch, look);p.lastLook=look;}
    if (name) this.nameCharacter(p.ch, name);
    if (p.scene !== spot.scene) {
      p.scene = spot.scene;
      p.render = { x: spot.x, y: spot.y };
      p.motion = new MotionBuffer(spot, performance.now(), stamp,
        { solid: (x, y) => mapSolid(x, y, spot.scene) });
      p.ch.animation = new CharacterAnimation();
      this.scaleCharacter(p.ch, sceneCharacterScale(spot.scene), sceneNameSize(spot.scene));
    } else if(p.spot.x!==spot.x || p.spot.y!==spot.y || p.spot.dir!==spot.dir ||
              /* THE STOP. When somebody lets go of the keys their last packet
               * is where they already were, facing the way they already
               * faced -- and it used to be dropped here as "no change", so
               * their legs went on walking on the spot. */
              (motion.moving===false && p.motion.walking())) {
      p.motion.push(spot,performance.now(),stamp,motion);
    }
    p.spot = spot;
    p.ch.node.visible = p.scene === this.scene;
    this.placeCharacter(p.ch,p.render.x,p.render.y,p.scene);
  }

  /* Who is under a screen point.
   *
   * Hit-tested against positions rather than through Pixi's interaction
   * system: the sprites are layered part-by-part and depth-sorted every frame,
   * so making each of them individually interactive would cost more and pick
   * whichever limb happened to be on top. A character stands in a one-tile
   * footprint and reaches CHAR_H upward from it, which is all this needs.
   *
   * Nearest first, so overlapping characters resolve to the one in front. */
  characterAt(clientX, clientY) {
    if (!this.app?.view) return null;
    const rect = this.app.view.getBoundingClientRect();
    const z = this.zoom;
    const wx = (clientX - rect.left - this.camera.position.x) / z;
    const wy = (clientY - rect.top - this.camera.position.y) / z;
    const boxed = (spot) => {
      const scale = sceneCharacterScale(spot.scene);
      const cx = spot.x * this.tile, base = spot.y * this.tile;
      return Math.abs(wx - cx) <= (FRAME * scale) / 6 &&
        wy <= base && wy >= base - (FEET - HEAD) * scale;
    };
    const hits = [];
    for (const [ship, p] of this.peers) if (p.spot && p.scene === this.scene && boxed(p.spot)) hits.push([ship, p.spot.y]);
    if (boxed(this.self)) hits.push([this.ourShip, this.self.y]);
    if (!hits.length) return null;
    hits.sort((a, b) => b[1] - a[1]);
    return hits[0][0];
  }

  /* ---------------------------------------------------------- hotspots */

  setHotspots(hotspots) {
    this.hotspots = (hotspots ?? []).filter(h => h && h.id && h.scene && h.rect);
    this.showHotspot(null);
  }

  worldPixelAt(clientX, clientY) {
    if (!this.app?.view || !this.camera) return null;
    const r = this.app.view.getBoundingClientRect();
    return this.camera.toLocal({ x: clientX - r.left, y: clientY - r.top });
  }

  hotspotAt(clientX, clientY) {
    return findHotspot(this.hotspots, this.scene, this.worldPixelAt(clientX, clientY));
  }

  hoverHotspot(clientX, clientY) {
    if (this.panning) return this.showHotspot(null);
    this.showHotspot(this.hotspotAt(clientX, clientY));
  }

  showHotspot(hotspot) {
    const id = hotspot?.id ?? null;
    if (this.hoveredHotspot === id) return;
    this.hoveredHotspot = id;
    this.hotspotLayer?.removeChildren().forEach(child => child.destroy());
    if (!hotspot || !this.painting?.texture?.baseTexture || hotspot.scene !== this.scene) {
      if (this.mount) this.mount.style.cursor = this.restCursor();
      return;
    }
    const r = hotspot.rect;
    const texture = new Texture(this.painting.texture.baseTexture, new Rectangle(r.x, r.y, r.w, r.h));
    const sprite = new Sprite(texture);
    sprite.anchor.set(.5);
    sprite.position.set(r.x + r.w / 2, r.y + r.h / 2);
    sprite.scale.set(1.14);
    this.hotspotLayer.addChild(sprite);
    this.mount.style.cursor = 'pointer';
  }

  activateHotspot(clientX, clientY) {
    const hotspot = this.hotspotAt(clientX, clientY);
    if (!hotspot) return false;
    hotspot.onActivate?.(hotspot);
    return true;
  }

  /* A wet character: tinted cool and blue for a moment, then shaken off. */
  soak(ship) {
    const ch = ship === this.ourShip ? this.selfSprite : this.peers.get(ship)?.ch;
    if (!ch) return;
    const layers = Object.values(ch.layers);
    for (const l of layers) l.tint = 0x88bbff;
    clearTimeout(ch.dryTimer);
    ch.dryTimer = setTimeout(() => this.poseCharacter(ch, ch.dir, ch.frame), 1800);
  }

  /* ------------------------------------------------ weapons */

  /* Out or away. Away, it is not drawn in our hand and clicks do what they
   * always did; out, the pointer is a crosshair and a click attacks. */
  setArmed(on) {
    this.armed = !!on;
    if (this.selfSprite) { this.selfSprite.sheathed = !this.armed; this.selfSprite.posedKey = null; this.poseCharacter(this.selfSprite, this.selfSprite.dir, this.selfSprite.frame); }
    this.mount.style.cursor = this.restCursor();
  }
  /* Somebody else's weapon put away (their presence says so) or out. */
  setSheathed(ship, sheathed) {
    const ch = this.peers.get(ship)?.ch;
    if (!ch || !!ch.sheathed === !!sheathed) return;
    ch.sheathed = !!sheathed; ch.posedKey = null;
  }
  restCursor() { return this.armed ? 'crosshair' : ''; }

  /* Attack toward a page point: turn to face the nearest way, tell everybody,
   * and let the weapon fly exactly there (a swing goes the nearest way). */
  fireAt(clientX, clientY) {
    if (!this.bow || !this.selfSprite || !this.world) return false;
    const r = this.mount.getBoundingClientRect();
    const p = this.camera.toLocal({ x: clientX - r.left, y: clientY - r.top });
    /* A shot's point is drawn raised by the scene's collision offset; aim so
     * that it passes under the pointer. */
    const target = { x: p.x / this.tile, y: p.y / this.tile + sceneInfo(this.scene).collisionOffsetY };
    const dx = target.x - this.self.x, dy = target.y - this.self.y;
    if (Math.hypot(dx, dy) < 1e-3) return false;
    const dir = nearestDir(dx, dy);
    if (dir !== this.self.dir && !this.self.moving) {
      this.self.dir = dir;
      this.onMove({ ...this.self });
    }
    return this.bow.fire(target);
  }

  /* ------------------------------------------------ clocks in the sky */

  /* Our clocks, from our settings; see lib/clocks and world/space. */
  setClocks(clocks) { this.space?.setClocks(clocks); }
  /* Bring the clocks forward to be dragged about, or put them back. */
  arrangeClocks(on) {
    this.space?.arrange(on);
    if (!on) this.clockDrag = null;
    this.mount.style.cursor = this.restCursor();
  }
  arranging() { return !!this.space?.arranging; }
  /* The settings a clock in the sky is drawn from. */
  clockOf(id) { return this.space?.planets.get(id)?.clock ?? null; }
  /* Which clock the pointer is over: one out in the sky, or -- while they are
   * being arranged, in front of the map -- any. Only over the canvas itself. */
  hoverClock(e) {
    if (!this.space || !this.mount.contains(e.target)) { this.onClockHover(null); return; }
    const hit = this.space.arranging
      ? (() => { const p = this.screenPoint(e); return this.space.clockAt(p.x, p.y); })()
      : this.skyClockAt(e.clientX, e.clientY);
    this.onClockHover(hit?.id ?? null, e.clientX, e.clientY);
  }

  /* A clock out in the sky -- not behind the map -- under this page point. */
  skyClockAt(clientX, clientY) {
    if (!this.space || !this.world) return null;
    const p = this.screenPoint({ clientX, clientY });
    return this.space.skyClockAt(p.x, p.y, this.camera.position.x, this.camera.position.y, this.world, this.zoom);
  }
  /* A mouse event's point on the canvas. */
  screenPoint(e) {
    const r = this.mount.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* ------------------------------------------------ sleep and waves */

  characterOf(ship) {
    return ship === this.ourShip ? this.selfSprite : this.peers.get(ship)?.ch ?? null;
  }

  /* Somebody idle has a little "zzz…" bubble over their name; see world/bubbles. */
  setAsleep(ship, asleep) {
    const ch = this.characterOf(ship);
    if (!ch || !!ch.asleep === !!asleep) return;
    ch.asleep = !!asleep;
    this.paintBubble(ch, performance.now());
  }

  /* Somebody waved at us: a hand over their head, for us alone, for a moment. */
  showWave(ship) {
    const ch = this.characterOf(ship);
    if (!ch) return false;
    ch.waveUntil = performance.now() + WAVE_MS;
    this.paintBubble(ch, performance.now());
    return true;
  }

  /* Point the camera at somebody, the way a look around does. Our own next
   * step brings it back. */
  lookAt(ship) {
    const p = this.peers.get(ship);
    if (!p || p.scene !== this.scene || !this.selfSprite || !p.render) return false;
    this.pan = { x: (p.render.x - this.self.x) * this.tile, y: (p.render.y - this.self.y) * this.tile };
    this.centreCamera();
    return true;
  }

  /* The bubble rides on the nameplate, so it is sized for the screen the way
   * the name is. Built on first use; redrawn only when its words change. */
  paintBubble(ch, time) {
    if (ch.waveUntil && time >= ch.waveUntil) ch.waveUntil = 0;
    const text = bubbleText(ch, time);
    if (text === (ch.bubbleText ?? null)) return;
    ch.bubbleText = text;
    if (!text) { if (ch.bubble) ch.bubble.visible = false; return; }
    if (!ch.bubble) {
      const bubble = new Container(), back = new Graphics();
      const words = new Text('', { fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        fontWeight: 'bold', fontSize: 11, fill: 0x17141f });
      words.anchor.set(0.5, 1);
      words.resolution = 2;
      bubble.addChild(back, words);
      ch.nameplate.addChild(bubble);
      Object.assign(ch, { bubble, bubbleBack: back, bubbleWords: words });
    }
    const size = Math.round(Number(ch.label.style.fontSize) * 0.9);
    if (ch.bubbleWords.style.fontSize !== size) ch.bubbleWords.style.fontSize = size;
    ch.bubbleWords.text = text;
    /* A cream bubble with a little tail, just above the name. */
    const w = Math.max(ch.bubbleWords.width + 8, 16), h = ch.bubbleWords.height + 2, tail = 3;
    const bottom = -ch.label.height - 3 - tail;
    ch.bubbleWords.position.set(0, bottom - 1);
    ch.bubbleBack.clear()
      .beginFill(0xfff6dc, 0.95)
      .drawRoundedRect(-w / 2, bottom - h, w, h, 4)
      .moveTo(-3, bottom).lineTo(1, bottom).lineTo(-4, bottom + tail).closePath()
      .endFill();
    ch.bubble.visible = true;
  }

  dropPeer(ship) {
    const p = this.peers.get(ship);
    if (!p) return;
    p.ch.node.destroy({ children: true });
    p.ch.companion.destroy();
    this.peers.delete(ship);
  }

  worldPoint(clientX,clientY) {
    const r=this.mount.getBoundingClientRect();
    const p=this.camera.toLocal({x:clientX-r.left,y:clientY-r.top});
    return {x:p.x/this.tile-.5,y:p.y/this.tile-1};
  }
  projectile(from,to,onLand) {
    const dot=new Sprite(Texture.WHITE);dot.tint=0xe8cf86;dot.width=dot.height=3;dot.anchor.set(.5);dot.zIndex=10000;
    this.actors.addChild(dot);
    const began=performance.now();
    const tick=()=>{
      const t=Math.min(1,(performance.now()-began)/450);
      dot.position.set((from.x+(to.x-from.x)*t+.5)*this.tile,
        (from.y+(to.y-from.y)*t+1)*this.tile-Math.sin(t*Math.PI)*22-6);
      if(t===1){this.app.ticker.remove(tick);dot.destroy();onLand?.();}
    };
    this.app.ticker.add(tick);
  }

  /* -------------------------------------------------------- walking */

  /* The drawn walls, a quarter of a tile at a time; see world/places.
   *
   * PLUS the rooms you may not enter. Secret rooms are covered; public and
   * private note rooms remain visible but hold non-members at the doorway. */
  solidAt(x, y) {
    if (!this.world) return true;
    if (mapSolid(x, y, this.scene)) return true;
    return this.blocked(regionAt(x, y, this.scene));
  }

  /* Which rooms are shut to us. Supplied by the world, which knows about
   * leases; the renderer only asks. */
  closed(room) { return room !== this.room && this.isClosed(room); }
  blocked(room) { return room !== this.room && this.isBlocked(room); }

  /* Which social-room gate, if any, occupies an otherwise walkable point. A
   * painted wall is not a doorway and must not open a question. */
  /* THE DOOR OF A ROOM YOU MAY NOT JUST WALK INTO.
   *
   * This used to fire only when a step was actually refused, which made it
   * both hard to trigger -- you had to push into the one cell of floor beyond
   * the gate, at the right angle -- and jumpy, because a single frame of not
   * touching cleared it and the next touch asked again.
   *
   * It is a PROXIMITY now, with the join/leave gap this codebase uses
   * everywhere else: step inside NEAR to be asked, and get clear of LEAVE
   * before it will ask again. Walking along the outside of a wall no longer
   * pesters you, and walking up to the doorway no longer misses. */
  doorNear(x, y) {
    if (!this.world) return null;
    /* Forty-eight points around you, every frame, gave the same answer frame
     * after frame while you stood still. Asked again when you move, when the
     * room or scene changes, and otherwise four times a second -- often enough
     * to notice a door opening under you. */
    const t = performance.now(), memo = this.doorMemo;
    if (memo && memo.x === x && memo.y === y && memo.room === this.room && memo.scene === this.scene &&
        memo.door === this.doorRoom && t - memo.at < 250) return memo.value;
    const value = this.lookForDoor(x, y);
    this.doorMemo = { x, y, room: this.room, scene: this.scene, door: this.doorRoom, at: t, value };
    return value;
  }

  lookForDoor(x, y) {
    const reach = this.doorRoom === null ? NEAR_DOOR : LEAVE_DOOR;
    let best = null, bestDistance = Infinity;
    for (const [dx, dy] of DOOR_LOOK) {
      const d = Math.hypot(dx, dy);
      if (d > reach || d >= bestDistance) continue;
      const px = x + (dx / (d || 1)) * Math.min(d, reach);
      const py = y + (dy / (d || 1)) * Math.min(d, reach);
      if (mapSolid(px, py, this.scene)) continue;
      const room = regionAt(px, py, this.scene);
      if (room === this.room || !this.blocked(room)) continue;
      best = room; bestDistance = d;
    }
    return best;
  }

  /* BACK TO SPAWN. Somebody standing in a room they may no longer be in -- it
   * was leased to, or they were removed from, a note they are not part of --
   * is put back at the world's spawn point, in the open commons. (Looking for
   * the nearest floor outside the room used to land on the room's own
   * threshold, which counts as still being inside it: they never left.)
   * Their own client does it; Noltbook refuses them the call either way. */
  moveOutside() {
    if (!this.world || !this.selfSprite || this.scene !== MAIN_SCENE) return false;
    this.self.x = SPAWN.x; this.self.y = SPAWN.y; this.self.dir = 'down';
    this.self.moving = false; this.self.frame = 0;
    this.keys.clear(); this.running = false; this.stick = null;
    this.pan = { x: 0, y: 0 };
    this.onMove({ ...this.self });
    return true;
  }

  /* Draw over the rooms we may not enter. Cheap and re-run only when the set
   * changes, which is when somebody takes or gives back a secret lease. */
  paintCovers() {
    if (!this.covers || this.scene !== MAIN_SCENE) return;
    /* Which rooms are shut changes when a lease does, not sixty times a
     * second: looked at four times a second. */
    const t = performance.now();
    if (t - (this.coversAt ?? -Infinity) < 250) return;
    this.coversAt = t;
    const mainRooms = ROOMS.filter((r) => r.scene === MAIN_SCENE);
    /* Evaluate access once. Discovery can update while this frame is being
     * painted; asking twice used to cache "room 3 is covered" after the
     * second pass had drawn nothing. */
    const closedRooms = mainRooms.filter((r) => this.closed(r.id));
    const shut = closedRooms.map((r) => r.id).join(',');
    if (shut === this.coveredRooms) return;
    this.coveredRooms = shut;
    this.covers.removeChildren();
    for (const r of closedRooms) {
      const cover = new Sprite(Texture.WHITE);
      /* SOLID. A room you are meant to learn nothing about should give up
       * nothing: at 92% the painting still showed through, so you could read
       * the furniture of a room that is supposed to be shut. */
      cover.tint = 0x05060a;
      cover.alpha = 1;
      cover.x = r.x * TILE; cover.y = r.y * TILE;
      cover.width = r.w * TILE; cover.height = r.h * TILE;
      this.covers.addChild(cover);
    }
  }

  tick() {
    if (!this.world || !this.selfSprite) return;
    const dt = Math.min(this.app.ticker.deltaMS / 1000,0.1);
    const time=performance.now();
    for(const p of this.peers.values()) {
      const point=p.motion.at(time);
      const distance=Math.hypot(point.x-p.render.x,point.y-p.render.y);
      p.render={x:point.x,y:point.y};
      this.placeCharacter(p.ch,p.render.x,p.render.y,p.scene);
      /* Walk the legs while they are walking, even during a lull between their
       * messages -- standing still with a foot up is what a dropped packet used
       * to look like. */
      const walking=point.moving??(distance>.001);
      this.animateCharacter(p.ch,point.dir??p.spot.dir,walking||distance>.001,time);
      this.followCharacter(p.ch,p.render.x,p.render.y,p.scene,time,dt);
      if(p.ch.asleep||p.ch.waveUntil)this.paintBubble(p.ch,time);
    }
    if(this.selfSprite.asleep||this.selfSprite.waveUntil)this.paintBubble(this.selfSprite,time);

    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;
    /* No keys: the joystick, if a thumb is on it -- any angle, and pushed to
     * the rim, running. */
    let run = this.running;
    if (!dx && !dy && this.stick) { dx = this.stick.x; dy = this.stick.y; run = this.stick.run; }

    if(time<(this.stunnedUntil??0) || this.selfSprite.animation.locked(time))dx=dy=0;
    const wasMoving=this.self.moving;
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const len = Math.hypot(dx, dy) || 1;
      const step = (sceneWalkSpeed(this.scene) * (run ? RUN_MULT : 1) * dt) / len;
      /* Axis at a time, so sliding along a wall works instead of sticking. */
      const nx = this.self.x + dx * step;
      if (!this.solidAt(nx, this.self.y)) this.self.x = nx;
      const ny = this.self.y + dy * step;
      if (!this.solidAt(this.self.x, ny)) this.self.y = ny;
      this.self.dir = Math.abs(dx) > Math.abs(dy)
        ? (dx < 0 ? 'left' : 'right')
        : (dy < 0 ? 'up' : 'down');
      const now = performance.now();
      if (now - this.lastFrame > FRAME_MS) {
        this.self.frame = (this.self.frame + 1) % 4;
        this.lastFrame = now;
      }
    } else if (this.self.frame !== 0) {
      this.self.frame = 0;
    }
    /* Standing still beside a door counts: you may have walked up to it and
     * stopped to read the sign. */
    const near = this.doorNear(this.self.x, this.self.y);
    if (near !== null) {
      if (this.doorRoom !== near) {
        this.doorRoom = near;
        this.onRoomDoor(near);
      }
    } else if (this.doorRoom !== null) {
      this.doorRoom = null;
    }
    this.self.moving = moving;
    /* Walking brings the view back to you. */
    if (moving && (this.pan.x || this.pan.y)) this.pan = { x: 0, y: 0 };

    this.drawArrows(this.bow?.tick() ?? [], time);
    this.animateCharacter(this.selfSprite, this.self.dir, moving, time);
    this.followCharacter(this.selfSprite,this.self.x,this.self.y,this.scene,time,dt);
    this.paintCovers();
    this.placeCharacter(this.selfSprite, this.self.x, this.self.y, this.scene);
    this.centreCamera();

    if (moving || wasMoving) this.onMove({ ...this.self });

    const rawRoom = regionAt(this.self.x, this.self.y, this.scene, this.room);
    if (this.scene === MAIN_SCENE && this.secretRoom.update({
      scene: this.scene, room: rawRoom, x: this.self.x, y: this.self.y,
    }, time)) {
      this.setScene(VATICAN_SCENE, VATICAN_SPAWN);
      return;
    }
    const inExit = this.scene === VATICAN_SCENE && vaticanExitAt(this.self.x, this.self.y);
    if (inExit && !this.exitWasInside) {
      this.setScene(MAIN_SCENE, MAIN_RETURN);
      return;
    }
    this.exitWasInside = inExit;

    /* Rooms are regions of the same map, so entering one is just noticing that
     * you are standing inside it.
     *
     * A doorway is one step wide, and a step lands ON it: standing in one, a
     * tremble of a pixel used to change room, change the chat under it and
     * change it back -- the flash people saw walking into the amphitheatre. So
     * a new room has to still be the room a few frames later before anything
     * is told about it. Your own position is not being corrected here; only
     * what the rest of the world is told is held back. */
    const room = rawRoom;
    if (room !== this.room && room !== this.settling) { this.settling = room; this.settled = 0; }
    if (room === this.room) { this.settling = null; this.settled = 0; }
    else if (++this.settled >= ROOM_SETTLE) {
      const from = this.room;
      this.room = room;
      this.settling = null; this.settled = 0;
      this.onRoomChange(room, from);
    }
  }

  centreCamera() {
    const vw = this.app.renderer.width, vh = this.app.renderer.height;
    const z = this.zoom;
    const charHeight = (FEET - HEAD) * this.characterScale;
    let cx = this.self.x * this.tile + this.pan.x,
      cy = this.self.y * this.tile - charHeight / 2 + this.pan.y;
    /* Clamp so the camera never shows outside the world, unless the place is
     * smaller than the viewport, in which case centre it. */
    const halfW = vw / (2 * z), halfH = vh / (2 * z);
    if(this.pan.x||this.pan.y||this.panned){
      /* Looking around may pull a painted edge past the viewport instead of
       * stopping the instant it touches it. Keeping the map centre within its
       * own bounds still leaves half a viewport visible, so it cannot be lost. */
      cx=Math.max(0,Math.min(this.world.px,cx));
      cy=Math.max(0,Math.min(this.world.py,cy));
    }else{
      cx = this.world.px <= vw / z ? this.world.px / 2 : Math.max(halfW, Math.min(this.world.px - halfW, cx));
      cy = this.world.py <= vh / z ? this.world.py / 2 : Math.max(halfH, Math.min(this.world.py - halfH, cy));
    }
    this.camera.scale.set(z);
    this.camera.position.set(Math.round(vw / 2 - cx * z), Math.round(vh / 2 - cy * z));
    this.space?.update(vw, vh, this.camera.position.x, this.camera.position.y, performance.now(), this.world, z);
  }

  anchorPanToCamera() {
    if(!this.camera||!this.app?.renderer)return;
    const z=this.zoom,vw=this.app.renderer.width,vh=this.app.renderer.height;
    const charHeight=(FEET-HEAD)*this.characterScale;
    const baseX=this.self.x*this.tile,baseY=this.self.y*this.tile-charHeight/2;
    this.pan.x=(vw/2-this.camera.position.x)/z-baseX;
    this.pan.y=(vh/2-this.camera.position.y)/z-baseY;
  }

}

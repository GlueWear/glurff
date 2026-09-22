import { versioned } from '../lib/build.js';
/* The world, drawn.
 *
 * PixiJS, nearest-neighbour, integer zoom steps so pixels stay square. The
 * renderer owns your position once you are walking; presence reads it and
 * reports outward, and nothing writes it back -- writing it back fights the
 * player for control and drags them a tile at a time.
 */
import { MotionBuffer } from 'lib/motion';
import { Application, Container, Sprite, Text, Texture, Rectangle, BaseTexture, SCALE_MODES, Assets } from 'pixi.js';
import { FRAME, FEET, HEAD, completeLook, allTextures, characterLayers, characterTop,
  equipmentOf, wholeFrame, animationFrames, artUrl, EQUIPMENT } from 'world/parts';
import { CharacterAnimation } from './animation.js';
import { buildWorld, regionAt, SPAWN, COMMONS, GAME_ROOM, MAIN_SCENE, VATICAN_SCENE, TILE,
  VATICAN_SPAWN, MAP_IMAGE, OVER_IMAGE, VATICAN_IMAGE, VATICAN_OVER_IMAGE,
  ROOMS, normalScene, sceneTile, sceneCharacterScale, sceneNameSize, sceneWalkSpeed, sceneImages, solidAt as mapSolid,
  vaticanExitAt, sceneInfo } from 'world/places';
import { SecretRoomQuest, MAIN_RETURN } from 'world/secret-room';

BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

/* How far above the feet a name sits, as a fraction of the character's own
 * height. The art leaves empty rows above the head, so hanging the label off
 * the top of the frame left it floating a whole character clear of the person
 * it names. Half way up puts it on the head, where it belongs. */
const NAME_HEIGHT = 0.5;

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
/* Frames a new room must hold before anything is told you are in it. Doorways
 * are one step wide and a step lands on them. */
const ROOM_SETTLE = 6;

export class Game {
  constructor(mount, { onMove, onRoomChange, onSceneChange, onEmote, isClosed, isBlocked, onRoomDoor } = {}) {
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
    /* Looking around without walking: right-drag moves the view, and your next
     * step brings it back to you. */
    this.pan = { x: 0, y: 0 };
    this.panning = null;
    this.panned = false;
  }

  async start() {
    this.app = new Application({
      background: 0x141820,
      resizeTo: this.mount,
      antialias: false,
      autoDensity: true,
      resolution: 1,
    });
    this.mount.appendChild(this.app.view);

    this.camera = new Container();
    this.ground = new Container();
    this.actors = new Container();   //  depth-sorted, so people walk behind things
    this.actors.sortableChildren = true;
    /* The obscure layer of the painting: doorways and anything else people pass
     * behind, drawn over everybody. */
    this.above = new Container();
    this.camera.addChild(this.ground, this.actors, this.above);
    this.app.stage.addChild(this.camera);

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
      this.panning = { x: e.clientX, y: e.clientY };
      this.panned = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.panning) return;
      const dx = e.clientX - this.panning.x, dy = e.clientY - this.panning.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { this.panned = true; this.mount.style.cursor = 'grabbing'; }
      this.panning = { x: e.clientX, y: e.clientY };
      this.pan.x -= (dx * PAN_SPEED) / this.zoom;
      this.pan.y -= (dy * PAN_SPEED) / this.zoom;
      this.centreCamera();
    });
    const release = () => { this.panning = null; this.mount.style.cursor = ''; };
    window.addEventListener('mouseup', (e) => { if (e.button === 0) release(); });
    window.addEventListener('blur', release);
    window.addEventListener('blur', () => {this.keys.clear();this.running=false;});
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

  setZoom(z) {
    /* Snap to the allowed steps rather than accepting any scale: arbitrary
     * fractions on pixel art give unevenly sized pixels, which reads as blur. */
    const i = ZOOMS.reduce((best, v, idx) =>
      Math.abs(v - z) < Math.abs(ZOOMS[best] - z) ? idx : best, 0);
    this.zoom = ZOOMS[i];
    this.camera.scale.set(this.zoom);
  }

  /* ------------------------------------------------------------ textures */

  async load() {
    /* Both paintings are ready before walking begins, so discovering the
     * secret room is a transition rather than a loading screen. */
    const maps = [MAP_IMAGE, OVER_IMAGE, VATICAN_IMAGE, VATICAN_OVER_IMAGE];
    await Assets.load([...maps.map(versioned), ...allTextures()]);
    this.mapTextures = new Map(maps.map(url => [url, Texture.from(versioned(url))]));
  }

  /* -------------------------------------------------------------- places */

  build() {
    const wd = buildWorld(this.scene);
    this.world = wd;
    this.ground.removeChildren();
    this.actors.removeChildren();
    this.above.removeChildren();

    const images = sceneImages(this.scene);
    this.painting = new Sprite(this.mapTextures.get(images.image));
    this.painting.position.set(0, 0);
    this.ground.addChild(this.painting);
    this.overPainting = new Sprite(this.mapTextures.get(images.over));
    this.overPainting.position.set(0, 0);
    this.above.addChild(this.overPainting);
    /* Rooms shut to us are covered over rather than merely un-walkable: an
     * invisible wall is a bug, a closed room is a fact. */
    this.covers = new Container();
    this.above.addChild(this.covers);
    /* A fresh, empty layer: forget what was drawn on the old one, or the cache
     * below says "already covered" and nothing is ever drawn again. */
    this.coveredRooms = null;
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
    this.painting.texture = this.mapTextures.get(images.image);
    this.overPainting.texture = this.mapTextures.get(images.over);
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
    const label = new Text(name ?? '', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: sceneNameSize(scene),
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
    });
    label.anchor.set(0.5, 1);
    label.resolution = 2;
    node.addChild(label);

    const ch = { node, body, companion, layers, label, look: completeLook(look), dir: 'down', frame: 0,
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
    ch.label.position.set(0, -characterTop(ch.look) * scale * NAME_HEIGHT);
  }

  nameCharacter(ch, name) {
    if (ch.label && ch.label.text !== name) ch.label.text = name ?? '';
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
    for (const layer of Object.values(ch.layers)) layer.visible = false;
    for (const f of characterLayers(ch.look, dir, frame, animation, cycle)) {
      let layer = ch.layers[f.key];
      if (!layer) { layer = ch.layers[f.key] = new Sprite(Texture.EMPTY); ch.body.addChild(layer); }
      // Reinsert in the shared compositor's order (mount ALWAYS in front).
      ch.body.addChild(layer);
      const texture = frameTexture(f);
      layer.visible = true;
      if (texture) layer.texture = texture;
      layer.anchor.set(.5, f.feet / f.h);
      layer.position.set((f.dx ?? 0)*ch.scale, (f.dy ?? 0)*ch.scale);
      layer.scale.set(ch.scale*(f.flip ? -1 : 1), ch.scale);
      layer.tint = f.tint ?? 0xffffff;
    }
    const premade = equipmentOf('premade', ch.look.premade?.part);
    // Some creatures have no fall strip. Give them the same visible, reversible
    // reaction with their OWN art rather than substituting a human body.
    ch.body.rotation = animation === 'die' && premade && !premade.animations.die
      ? Math.sin(progress*Math.PI)*Math.PI/2 : 0;
    ch.label.y = -characterTop(ch.look)*ch.scale*NAME_HEIGHT;
  }

  animateCharacter(ch, dir, moving, time) {
    const pose = ch.animation.pose(time, moving, {
      walk: animationFrames(ch.look, 'walk'), idle: animationFrames(ch.look, 'idle'),
    });
    this.poseCharacter(ch, dir, pose.frame, pose.animation, pose.progress, pose.cycle);
  }

  emote() {
    if (!this.selfSprite || this.self.moving || this.keys.size) return false;
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
      if (!sprite) { sprite = new Sprite(Texture.EMPTY); sprite.anchor.set(.5); this.arrows.set(shot.key,sprite); this.actors.addChild(sprite); }
      const row = {down:0,left:1,right:1,up:2}[shot.dir];
      const projectile=shot.weapon==='slingshot' ? EQUIPMENT.slingStone : EQUIPMENT.arrow;
      const texture = frameTexture({url:artUrl(projectile.sheet),
        x:(Math.floor(time/100)%projectile.frames)*32,y:row*32,w:32,h:32});
      if (texture) sprite.texture = texture;
      sprite.scale.set(this.characterScale*(shot.dir==='right'?-1:1),this.characterScale);
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
    } else if(p.spot.x!==spot.x || p.spot.y!==spot.y || p.spot.dir!==spot.dir) {
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

  /* A wet character: tinted cool and blue for a moment, then shaken off. */
  soak(ship) {
    const ch = ship === this.ourShip ? this.selfSprite : this.peers.get(ship)?.ch;
    if (!ch) return;
    const layers = Object.values(ch.layers);
    for (const l of layers) l.tint = 0x88bbff;
    clearTimeout(ch.dryTimer);
    ch.dryTimer = setTimeout(() => this.poseCharacter(ch, ch.dir, ch.frame), 1800);
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

  /* Draw over the rooms we may not enter. Cheap and re-run only when the set
   * changes, which is when somebody takes or gives back a secret lease. */
  paintCovers() {
    if (!this.covers || this.scene !== MAIN_SCENE) return;
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
    }

    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;

    if(time<(this.stunnedUntil??0) || this.selfSprite.animation.locked(time))dx=dy=0;
    const wasMoving=this.self.moving;
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const len = Math.hypot(dx, dy) || 1;
      const step = (sceneWalkSpeed(this.scene) * (this.running ? RUN_MULT : 1) * dt) / len;
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
    cx = this.world.px <= vw / z ? this.world.px / 2 : Math.max(halfW, Math.min(this.world.px - halfW, cx));
    cy = this.world.py <= vh / z ? this.world.py / 2 : Math.max(halfH, Math.min(this.world.py - halfH, cy));
    this.camera.scale.set(z);
    this.camera.position.set(Math.round(vw / 2 - cx * z), Math.round(vh / 2 - cy * z));
  }

}

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
import { TILE, FRAME, SCALE, FEET, HEAD, CHAR_H, SLOTS, frameOf, completeLook, allTextures } from 'world/parts';
import { buildWorld, regionAt, roomById, SPAWN, COMMONS, solidAt as mapSolid, MAP_IMAGE, OVER_IMAGE } from 'world/places';

BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

/* One texture per part frame, cut out of its slot's sheet and kept: a walking
 * character asks for the same handful of frames over and over. */
const frames = new Map();
function frameTexture(f) {
  const id = `${f.url}|${f.x},${f.y}`;
  let t = frames.get(id);
  if (!t) {
    t = new Texture(Texture.from(f.url).baseTexture, new Rectangle(f.x, f.y, f.w, f.h));
    frames.set(id, t);
  }
  return t;
}
const WALK_SPEED = 4.4;     //  tiles per second
const RUN_MULT = 1.8;
const DOUBLE_TAP_MS = 280;
const FRAME_MS = 140;       //  walk cycle
/* How far the world moves for a drag of the mouse. Above one, so crossing the
 * building is one pull rather than several. */
const PAN_SPEED = 2.5;
/* Half steps are allowed at the bottom end so the whole world can be seen at
 * once. 0.5 still maps 2x2 source pixels to one, so it stays crisp; anything
 * non-power-of-two would not. */
export const ZOOMS = [0.5, 1, 2, 3, 4];
/* Frames a new room must hold before anything is told you are in it. Doorways
 * are one step wide and a step lands on them. */
const ROOM_SETTLE = 6;

export class Game {
  constructor(mount, { onMove, onRoomChange } = {}) {
    this.mount = mount;
    this.onMove = onMove ?? (() => {});
    /* Fires when you walk into or out of a room. There is no loading and no
     * place switch -- the room is part of the same world. */
    this.onRoomChange = onRoomChange ?? (() => {});
    this.zoom = 3;
    this.keys = new Set();
    this.peers = new Map();   //  ship -> {sprite, spot, look}
    this.world = null;
    this.room = COMMONS;
    this.settling = null; this.settled = 0;
    this.self = { x: SPAWN.x, y: SPAWN.y, dir: 'down', moving: false, frame: 0, look: null };
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
    /* Wheel to zoom, which is what everyone reaches for first. */
    this.mount.addEventListener('wheel', (e) => {
      e.preventDefault();
      const i = ZOOMS.indexOf(this.zoom);
      this.setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)))]);
    }, { passive: false });
    this.app.ticker.add(() => this.tick());
  }

  onKey(e, down) {
    if (down && (document.querySelector('.builder') || (e.target && /input|textarea|select/i.test(e.target.tagName)))) {this.keys.clear();return;}
    const k = e.key.toLowerCase();
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
    /* The world is one painting, with a second one drawn over people. Every
     * character texture comes up front, so nothing pops in mid-walk. */
    await Assets.load([versioned(MAP_IMAGE), versioned(OVER_IMAGE), ...allTextures()]);
    this.mapTexture = Texture.from(versioned(MAP_IMAGE));
    this.overTexture = Texture.from(versioned(OVER_IMAGE));
  }

  /* -------------------------------------------------------------- places */

  build() {
    const wd = buildWorld();
    this.world = wd;
    this.ground.removeChildren();
    this.actors.removeChildren();
    this.above.removeChildren();

    const painting = new Sprite(this.mapTexture);
    painting.position.set(0, 0);
    this.ground.addChild(painting);
    const over = new Sprite(this.overTexture);
    over.position.set(0, 0);
    this.above.addChild(over);

    this.selfSprite = this.makeCharacter(this.self.look);
    this.actors.addChild(this.selfSprite.node);
    return wd;
  }

  /* ---------------------------------------------------------- characters */

  makeCharacter(look, name = null) {
    const node = new Container();
    const layers = {};
    for (const slot of SLOTS) {
      const s = new Sprite(Texture.EMPTY);
      /* Anchored at the FEET, so a character stands on its position instead of
       * floating above it, and drawn at four times. */
      s.anchor.set(0.5, FEET / FRAME);
      s.scale.set(SCALE);
      node.addChild(s);
      layers[slot] = s;
    }
    /* The name rides above the head, in the world rather than in the HUD, so
     * you can tell who is who at a glance. It is the Noltbook display name
     * where one is set -- the raw @p is only a fallback. */
    const label = new Text(name ?? '', {
      fontFamily: 'ui-monospace, monospace',
      fontSize: 9,
      fill: 0xffffff,
      stroke: 0x000000,
      strokeThickness: 3,
    });
    label.anchor.set(0.5, 1);
    label.position.set(0, -CHAR_H - 2);
    label.resolution = 2;
    node.addChild(label);

    const ch = { node, layers, label, look: completeLook(look), dir: 'down', frame: 0 };
    this.dressCharacter(ch, ch.look);
    return ch;
  }

  nameCharacter(ch, name) {
    if (ch.label && ch.label.text !== name) ch.label.text = name ?? '';
  }

  dressCharacter(ch, look) {
    ch.look = completeLook(look);
    this.poseCharacter(ch, ch.dir, ch.frame);
  }

  poseCharacter(ch, dir, frame) {
    ch.dir = dir;
    ch.frame = frame;
    for (const slot of SLOTS) {
      const piece = ch.look[slot];
      const layer = ch.layers[slot];
      const f = piece ? frameOf(slot, piece.part, dir, frame) : null;
      if (!f) { layer.texture = Texture.EMPTY; continue; }
      layer.texture = frameTexture(f);
      layer.tint = piece.tint ?? 0xffffff;
    }
  }

  /* A character stands ON its position: x and y are where the feet are. */
  placeCharacter(ch, x, y) {
    ch.node.position.set(x * TILE, y * TILE);
    ch.node.zIndex = Math.round(y * TILE);
  }

  /* ------------------------------------------------------------- peers */

  /* `motion` is whatever the sender told us about how they are moving --
   * velocity in tiles per second and whether they are walking at all. Absent
   * from the slow path and from older builds, and then worked out from the
   * positions themselves. */
  upsertPeer(ship, spot, look, name, stamp, motion = {}) {
    let p = this.peers.get(ship);
    if (!p) {
      /* Build once and PATCH afterwards. Rebuilding a peer every update tears
       * down their sprites, and texture work never survives it. */
      p = { ch: this.makeCharacter(look, name ?? ship), spot, render:{x:spot.x,y:spot.y},
            motion:new MotionBuffer(spot,performance.now(),stamp,{solid:(x,y)=>this.solidAt(x,y)}) };
      this.actors.addChild(p.ch.node);
      this.peers.set(ship, p);
    }
    if (look && p.lastLook!==look) {this.dressCharacter(p.ch, look);p.lastLook=look;}
    if (name) this.nameCharacter(p.ch, name);
    if(p.spot.x!==spot.x || p.spot.y!==spot.y || p.spot.dir!==spot.dir)p.motion.push(spot,performance.now(),stamp,motion);
    p.spot = spot;
    this.placeCharacter(p.ch,p.render.x,p.render.y);
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
      const cx = spot.x * TILE, base = spot.y * TILE;
      return Math.abs(wx - cx) <= (FRAME * SCALE) / 6 && wy <= base && wy >= base - CHAR_H;
    };
    const hits = [];
    for (const [ship, p] of this.peers) if (p.spot && boxed(p.spot)) hits.push([ship, p.spot.y]);
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
    this.peers.delete(ship);
  }

  worldPoint(clientX,clientY) {
    const r=this.mount.getBoundingClientRect();
    const p=this.camera.toLocal({x:clientX-r.left,y:clientY-r.top});
    return {x:p.x/TILE-.5,y:p.y/TILE-1};
  }
  projectile(from,to,onLand) {
    const dot=new Sprite(Texture.WHITE);dot.tint=0xe8cf86;dot.width=dot.height=3;dot.anchor.set(.5);dot.zIndex=10000;
    this.actors.addChild(dot);
    const began=performance.now();
    const tick=()=>{
      const t=Math.min(1,(performance.now()-began)/450);
      dot.position.set((from.x+(to.x-from.x)*t+.5)*TILE,(from.y+(to.y-from.y)*t+1)*TILE-Math.sin(t*Math.PI)*22-6);
      if(t===1){this.app.ticker.remove(tick);dot.destroy();onLand?.();}
    };
    this.app.ticker.add(tick);
  }

  /* -------------------------------------------------------- walking */

  /* The drawn walls, a quarter of a tile at a time; see world/places. */
  solidAt(x, y) {
    return this.world ? mapSolid(x, y) : true;
  }

  tick() {
    if (!this.world || !this.selfSprite) return;
    const dt = Math.min(this.app.ticker.deltaMS / 1000,0.1);
    const time=performance.now();
    for(const p of this.peers.values()) {
      const point=p.motion.at(time);
      const distance=Math.hypot(point.x-p.render.x,point.y-p.render.y);
      p.render={x:point.x,y:point.y};
      this.placeCharacter(p.ch,p.render.x,p.render.y);
      /* Walk the legs while they are walking, even during a lull between their
       * messages -- standing still with a foot up is what a dropped packet used
       * to look like. */
      const walking=point.moving??(distance>.001);
      this.poseCharacter(p.ch,point.dir??p.spot.dir,walking||distance>.001?Math.floor(time/FRAME_MS)%4:0);
    }

    let dx = 0, dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += 1;

    if(time<(this.stunnedUntil??0))dx=dy=0;
    const wasMoving=this.self.moving;
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const len = Math.hypot(dx, dy) || 1;
      const step = (WALK_SPEED * (this.running ? RUN_MULT : 1) * dt) / len;
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
    this.self.moving = moving;
    /* Walking brings the view back to you. */
    if (moving && (this.pan.x || this.pan.y)) this.pan = { x: 0, y: 0 };

    this.poseCharacter(this.selfSprite, this.self.dir, this.self.frame);
    this.placeCharacter(this.selfSprite, this.self.x, this.self.y);
    this.centreCamera();

    if (moving || wasMoving) this.onMove({ ...this.self });

    /* Rooms are regions of the same map, so entering one is just noticing that
     * you are standing inside it.
     *
     * A doorway is one step wide, and a step lands ON it: standing in one, a
     * tremble of a pixel used to change room, change the chat under it and
     * change it back -- the flash people saw walking into the amphitheatre. So
     * a new room has to still be the room a few frames later before anything
     * is told about it. Your own position is not being corrected here; only
     * what the rest of the world is told is held back. */
    const room = regionAt(this.self.x, this.self.y);
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
    let cx = this.self.x * TILE + this.pan.x, cy = this.self.y * TILE - CHAR_H / 2 + this.pan.y;
    /* Clamp so the camera never shows outside the world, unless the place is
     * smaller than the viewport, in which case centre it. */
    const halfW = vw / (2 * z), halfH = vh / (2 * z);
    cx = this.world.px <= vw / z ? this.world.px / 2 : Math.max(halfW, Math.min(this.world.px - halfW, cx));
    cy = this.world.py <= vh / z ? this.world.py / 2 : Math.max(halfH, Math.min(this.world.py - halfH, cy));
    this.camera.scale.set(z);
    this.camera.position.set(Math.round(vw / 2 - cx * z), Math.round(vh / 2 - cy * z));
  }

}

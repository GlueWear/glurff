import { versioned } from '../lib/build.js';
/* The world, drawn.
 *
 * PixiJS, nearest-neighbour, integer zoom steps so pixels stay square. The
 * renderer owns your position once you are walking; presence reads it and
 * reports outward, and nothing writes it back -- writing it back fights the
 * player for control and drags them a tile at a time.
 */
import { MotionBuffer } from 'lib/motion';
import { Application, Container, Sprite, Text, Texture, BaseTexture, SCALE_MODES, Assets } from 'pixi.js';
import { TILE, CHAR_H, DIRS, SLOTS, flipped, partTexture, completeLook, facingAway, allTextures } from 'world/parts';
import { buildWorld, regionAt, roomById, SPAWN, COMMONS, PROP_SIZE } from 'world/places';

BaseTexture.defaultOptions.scaleMode = SCALE_MODES.NEAREST;

const SPR = (n) => versioned(`/apps/glurff/sprites/${n}.png`);
const WALK_SPEED = 4.4;     //  tiles per second
const RUN_MULT = 1.8;
const DOUBLE_TAP_MS = 280;
const FRAME_MS = 140;       //  walk cycle
/* Half steps are allowed at the bottom end so the whole world can be seen at
 * once. 0.5 still maps 2x2 source pixels to one, so it stays crisp; anything
 * non-power-of-two would not. */
export const ZOOMS = [0.5, 1, 2, 3, 4];

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
    this.self = { x: SPAWN.x, y: SPAWN.y, dir: 'down', moving: false, frame: 0, look: null };
    this.lastFrame = 0;
    /* Double-tapping a direction runs, the way it does in every game that has
     * ever had a run button. */
    this.lastTap = { key: null, at: 0 };
    this.running = false;
    this.ourShip = null;
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
    this.camera.addChild(this.ground, this.actors);
    this.app.stage.addChild(this.camera);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('focusin', (e) => {
      if (e.target.closest?.('input, textarea, select, [contenteditable]')) {
        this.keys.clear();
        this.running = false;
      }
    });
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
    const names = [
      'grass', 'cobble', 'cobble-red', 'floor', 'floor-stone',
      'table', 'stool', 'barrel', 'crate', 'crate-long', 'stone', 'stone-small',
      'tree', 'shrub', 'flowers-red', 'sign', 'house', 'portal', 'gate-00',
      'tunnel', 'tunnel-big',
    ];
    const urls = names.map(SPR);
    urls.push(versioned('/apps/glurff/sprites/walls/wall-stone/wall-stone-00.png'));
    urls.push(versioned('/apps/glurff/sprites/walls/wall-stone-small/wall-stone-small-00.png'));
    /* Every character texture up front, so nothing pops in mid-walk. */
    await Assets.load([...urls, ...allTextures()]);
    this.tex = (n) => Texture.from(SPR(n));
    this.wall = Texture.from(versioned('/apps/glurff/sprites/walls/wall-stone/wall-stone-00.png'));
    this.wallSmall = Texture.from(versioned('/apps/glurff/sprites/walls/wall-stone-small/wall-stone-small-00.png'));
  }

  /* -------------------------------------------------------------- places */

  build() {
    const wd = buildWorld();
    this.world = wd;
    this.ground.removeChildren();
    this.actors.removeChildren();

    for (let y = 0; y < wd.h; y++) {
      for (let x = 0; x < wd.w; x++) {
        const s = new Sprite(this.tex(wd.tiles[y][x]));
        s.position.set(x * TILE, y * TILE);
        s.tint = wd.tints[y][x];
        this.ground.addChild(s);
      }
    }
    for (const p of wd.props) {
      const t = p.t === 'wall-stone' ? this.wall
        : p.t === 'wall-stone-small' ? this.wallSmall
        : this.tex(p.t);
      const s = new Sprite(t);
      const size = PROP_SIZE[p.t] ?? 1;
      /* Anchor tall props at their base so they overlap the tile behind. */
      s.position.set(p.x * TILE, (p.y - (size - 1)) * TILE);
      s.tint = p.tint ?? 0xffffff;
      s.zIndex = (p.y + 1) * TILE;
      this.actors.addChild(s);
    }
    if (wd.screen) {
      const s = new Sprite(Texture.WHITE);
      s.width = wd.screen.w * TILE;
      s.height = wd.screen.h * TILE;
      s.position.set(wd.screen.x * TILE, wd.screen.y * TILE);
      s.tint = 0x0a0a10;
      s.zIndex = wd.screen.y * TILE;
      this.actors.addChild(s);
    }

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
      s.anchor.set(0.5, 1);
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
    label.position.set(0, -CHAR_H + 2);
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
      if (!piece) { layer.texture = Texture.EMPTY; continue; }
      const url = partTexture(slot, piece.part, dir, frame);
      if (!url) { layer.texture = Texture.EMPTY; continue; }
      layer.texture = Texture.from(url);
      layer.tint = piece.tint ?? 0xffffff;
      /* Left is the side sprite mirrored, so nothing is ever drawn facing
       * left -- the art has no left-facing variation. */
      layer.scale.x = flipped(dir) ? -1 : 1;
    }
  }

  placeCharacter(ch, x, y) {
    ch.node.position.set(x * TILE + TILE / 2, y * TILE + TILE);
    ch.node.zIndex = (y + 1) * TILE + 1;
  }

  /* ------------------------------------------------------------- peers */

  upsertPeer(ship, spot, look, name, stamp) {
    let p = this.peers.get(ship);
    if (!p) {
      /* Build once and PATCH afterwards. Rebuilding a peer every update tears
       * down their sprites, and texture work never survives it. */
      p = { ch: this.makeCharacter(look, name ?? ship), spot, render:{x:spot.x,y:spot.y}, motion:new MotionBuffer(spot,performance.now(),stamp) };
      this.actors.addChild(p.ch.node);
      this.peers.set(ship, p);
    }
    if (look && p.lastLook!==look) {this.dressCharacter(p.ch, look);p.lastLook=look;}
    if (name) this.nameCharacter(p.ch, name);
    if(p.spot.x!==spot.x || p.spot.y!==spot.y || p.spot.dir!==spot.dir)p.motion.push(spot,performance.now(),stamp);
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
      const cx = spot.x * TILE + TILE / 2, base = spot.y * TILE + TILE;
      return Math.abs(wx - cx) <= TILE / 2 && wy <= base && wy >= base - CHAR_H;
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

  solidAt(x, y) {
    const b = this.world;
    if (!b) return true;
    const tx = Math.round(x), ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= b.w || ty >= b.h) return true;
    return b.solid[ty][tx];
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
      this.poseCharacter(p.ch,point.dir??p.spot.dir,distance>.001?Math.floor(time/FRAME_MS)%3:0);
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
        this.self.frame = (this.self.frame + 1) % 3;
        this.lastFrame = now;
      }
    } else if (this.self.frame !== 0) {
      this.self.frame = 0;
    }
    this.self.moving = moving;

    this.poseCharacter(this.selfSprite, this.self.dir, this.self.frame);
    this.placeCharacter(this.selfSprite, this.self.x, this.self.y);
    this.centreCamera();

    if (moving || wasMoving) this.onMove({ ...this.self });

    /* Rooms are regions of the same map, so entering one is just noticing that
     * you are standing inside it. */
    const room = regionAt(this.self.x, this.self.y);
    if (room !== this.room) {
      const from = this.room;
      this.room = room;
      this.onRoomChange(room, from);
    }
  }

  centreCamera() {
    const vw = this.app.renderer.width, vh = this.app.renderer.height;
    const z = this.zoom;
    let cx = this.self.x * TILE + TILE / 2, cy = this.self.y * TILE + TILE / 2;
    /* Clamp so the camera never shows outside the world, unless the place is
     * smaller than the viewport, in which case centre it. */
    const halfW = vw / (2 * z), halfH = vh / (2 * z);
    cx = this.world.px <= vw / z ? this.world.px / 2 : Math.max(halfW, Math.min(this.world.px - halfW, cx));
    cy = this.world.py <= vh / z ? this.world.py / 2 : Math.max(halfH, Math.min(this.world.py - halfH, cy));
    this.camera.scale.set(z);
    this.camera.position.set(Math.round(vw / 2 - cx * z), Math.round(vh / 2 - cy * z));
  }

  /* A short zoom punch when moving between places, so a door feels like going
   * somewhere rather than a hard cut. */
  async transition(fn) {
    const from = this.zoom;
    for (let i = 0; i < 6; i++) {
      this.camera.alpha = 1 - i / 6;
      await new Promise((r) => requestAnimationFrame(r));
    }
    fn();
    for (let i = 0; i < 6; i++) {
      this.camera.alpha = i / 6;
      await new Promise((r) => requestAnimationFrame(r));
    }
    this.camera.alpha = 1;
    this.setZoom(from);
  }
}

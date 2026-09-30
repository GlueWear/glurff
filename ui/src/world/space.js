/* SPACE. The painted worlds float in it.
 *
 * Everything past a map's edge used to be flat black, which is most of the
 * screen when you zoom out. It is outer space now, monotone throughout:
 *
 *   STARS   chunky pixel stars in three layers, drawn in screen space BEHIND
 *           the camera and nudged by it at a fraction of its speed, so the
 *           maps seem to drift over a far-off sky. One layer breathes -- a
 *           step in brightness every few seconds, barely there.
 *   CLOCKS  small worlds made of letters -- G L U R F F unless we say
 *           otherwise -- turning very slowly, each a twelve-hour clock. A SUN
 *           (the hour hand, in the planet's day colour) and a silver MOON (the
 *           minute hand) share one dotted ring, well clear of the letters; the
 *           moon passes in front of the sun when the hands meet, a little
 *           eclipse. Day colours from six to six, night greys otherwise, fading
 *           at dawn and dusk. Ours sits in the top-right by default; we can add
 *           more, in other time zones, and move and size them. See lib/clocks
 *           for the settings and times.
 *
 * Built for cost: each star layer is one tiling sprite over a small generated
 * texture and a frame only moves their offsets; the planet is drawn into a
 * small canvas a few times a second, and not at all while the map covers it.
 */
import { Container, Graphics, Sprite, Texture, TilingSprite, SCALE_MODES } from 'pixi.js';
import { zoneTime, hands, dayness, palette, place, defaults, NIGHT } from '../lib/clocks.js';

export const SPACE_COLOR = 0x05060a;
/* The stars' breath: a step every few seconds, barely there. */
const TWINKLE_STEP_MS = 4500;
const TWINKLE = [1, 0.88, 0.78, 0.88];
/* Monotone: white to cool grey, brightness only. */
const PALETTE = ['#ffffff', '#e4e7ed', '#c6cbd4', '#a4abb7'];

/* Deterministic, so the sky is the same every visit. */
function random(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* One square tile of stars. `cross` draws some as little plus shapes: the
 * classic 8-bit bright star. */
function starTile({ size, count, seed, cross = 0, dim = 0.3 }) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  const r = random(seed);
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(r() * (size - 2)), y = 1 + Math.floor(r() * (size - 2));
    g.fillStyle = PALETTE[Math.floor(r() * PALETTE.length)];
    const alpha = dim + r() * (1 - dim);
    g.globalAlpha = alpha;
    g.fillRect(x, y, 1, 1);
    if (r() < cross) {
      g.globalAlpha = alpha * 0.55;
      g.fillRect(x - 1, y, 1, 1); g.fillRect(x + 1, y, 1, 1);
      g.fillRect(x, y - 1, 1, 1); g.fillRect(x, y + 1, 1, 1);
    }
  }
  const texture = Texture.from(canvas);
  texture.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  return texture;
}

/* ------------------------------------------------------------ the planets */

export const WORD = 'GLURFF';
/* How the planet moves, all very slowly. */
export const SPIN_MS = 240000;        //  one turn of its surface
export const SWEEP_EVERY_MS = 45000;  //  how often the sweep crosses its face
export const SWEEP_MS = 9000;         //  how long one crossing takes
export const REDRAW_MS = 250;         //  a new drawing four times a second is plenty
/* Sizes at 100%. The planet is 12% bigger than it was (152 -> 170). The sun
 * and the moon go round ONE ring, CLEARANCE pixels outside the letters: the
 * hands are told apart by how they look, not how far out they are. */
export const PLANET_SIZE = 170;
export const FONT_SIZE = 11.6;
export const CLEARANCE = 26;
export const ORBIT = Math.round(0.46 * PLANET_SIZE + CLEARANCE);
const SUN = 9;                        //  the sun's drawing is 2 * SUN + 1 pixels across
const MOON = 5;
/* The silver moon and the dial's marks keep their own colours, whatever the
 * planet's: the minute hand has to stand apart from it. */
export const MOON_TINT = 0xffffff;
export const TICK_TINT = 0x9aa0aa;
/* Everything a planet takes up, from its centre, at 100%. */
export const OUTER = ORBIT + SUN;

/* Where a hand points, as an offset from the centre: clockwise from the top. */
export const handAt = (angle, radius) => ({ x: radius * Math.sin(angle), y: -radius * Math.cos(angle) });

/* Light from the sun's side of the planet, and a little from in front, so a
 * little more than half the face is lit. A unit vector; y points down. */
export function lightFrom(angle) {
  const lx = Math.sin(angle), ly = -Math.cos(angle), lz = 0.45, l = Math.hypot(lx, ly, lz);
  return [lx / l, ly / l, lz / l];
}

/* Small pixel bodies. The sun is drawn white so a tint can give it the
 * planet's colour: a round core and eight short rays. The moon is silver of
 * its own, a little shaded toward one edge so it reads as round. */
function bodyTexture(radius, rays) {
  const size = 2 * radius + 1, c = radius;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  for (let y = -c; y <= c; y++) for (let x = -c; x <= c; x++) {
    const d = Math.hypot(x, y);
    const ray = rays && (x === 0 || y === 0 || Math.abs(x) === Math.abs(y)) && d >= 6 && d <= 8.5;
    const core = d <= (rays ? 4.5 : radius - 0.3);
    if (!core && !ray) continue;
    g.fillStyle = rays ? (core ? '#ffffff' : '#d8dbe0')
      : (Math.hypot(x + 1.5, y + 1.5) > radius - 0.5 ? '#aeb4be' : d > radius - 1.4 ? '#d3d8df' : '#eef1f5');
    g.fillRect(x + c, y + c, 1, 1);
  }
  const texture = Texture.from(canvas);
  texture.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  return texture;
}
let sunTexture = null, moonTexture = null;
const tintOf = (hex) => parseInt(hex.slice(1), 16);

/* A sphere of letters. The surface is cut into bands of latitude, spaced so
 * each holds an even share of the sphere; each band is a ring of letters
 * turning about the axis at its own slightly different pace. A letter is drawn
 * where its point on the sphere would appear, only if it faces us, in a shade
 * chosen by how squarely it faces the light -- darker toward the rim, so the
 * disc reads as round. Our own implementation of a well-known technique. */
export class LetterPlanet {
  /* Drawn at the size it is shown, so the letters are sharp. */
  constructor({ size = PLANET_SIZE, fontSize = FONT_SIZE, word = WORD, seed = 11 } = {}) {
    this.size = size; this.fontSize = fontSize; this.word = word || WORD;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.radius = 0.46 * size; this.cx = size / 2; this.cy = size / 2;
    const r = random(seed), rows = Math.max(3, Math.floor((2 * this.radius) / (1.18 * fontSize)) - 1);
    this.bands = Array.from({ length: rows }, (_, i) => ({
      theta: Math.acos(1 - ((i + 0.5) / rows) * 2),         //  equal-area latitudes
      offset: Math.floor(r() * this.word.length),
      pace: 0.75 + r() * 0.5,                              //  bands turn at their own speeds
    }));
    this.texture = Texture.from(this.canvas);
    this.drawnAt = -Infinity;
    this.colors = NIGHT;
  }

  shade(light, sweep) {
    const G = this.colors;
    if (sweep || light > 0.82) return G[0];
    return light > 0.6 ? G[1] : light > 0.38 ? G[2] : light > 0.18 ? G[3] : light > 0.07 ? G[4] : G[5];
  }

  /* Draw it as it is at time `t` (ms), lit from `light` (see lightFrom). */
  draw(t, [lx, ly, lz] = lightFrom(0)) {
    const g = this.ctx, word = this.word, n = word.length;
    g.clearRect(0, 0, this.size, this.size);
    g.font = `700 ${this.fontSize}px ui-monospace, 'SF Mono', Menlo, Consolas, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const turn = (t / SPIN_MS) * Math.PI * 2;
    /* The sweep: a vertical band that crosses the face now and then. */
    const since = t % SWEEP_EVERY_MS;
    const sweepX = since < SWEEP_MS ? -1.3 + (since / SWEEP_MS) * 2.6 : null;
    const step = 0.62 * this.fontSize;
    for (let b = 0; b < this.bands.length; b++) {
      const band = this.bands[b];
      const sinT = Math.sin(band.theta), cosT = Math.cos(band.theta);
      const ringR = this.radius * sinT;
      if (ringR < step) continue;
      const y = this.cy - this.radius * cosT;
      const count = Math.max(4, Math.floor((2 * Math.PI * ringR) / step));
      const spin = turn * band.pace;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + spin;
        const facing = Math.cos(angle);
        if (facing <= 0.05) continue;                        //  the far side
        const side = Math.sin(angle);
        const x = this.cx + ringR * side;
        /* The surface normal at this letter, and how squarely it meets the light. */
        const nx = sinT * side, ny = -cosT, nz = sinT * facing;
        let light = nx * lx + ny * ly + nz * lz;
        light = Math.max(0, light) * (0.35 + 0.65 * Math.pow(facing, 0.45));
        const k = (((i + band.offset) % n) + n) % n;
        let letter = word[k], swept = false;
        if (sweepX !== null && n > 1) {
          const d = Math.abs((x - this.cx) / this.radius - sweepX);
          if (d < 0.14) { letter = word[(k + 1 + ((7 * b + 3 * i) % (n - 1))) % n]; swept = d < 0.05; }
        }
        g.fillStyle = this.shade(light, swept);
        g.fillText(letter, x, y);
      }
    }
    this.texture.baseTexture.update();
  }

  /* Redraw only as often as the slow motion needs. */
  tick(t, light, colors = this.colors) {
    if (t - this.drawnAt < REDRAW_MS) return;
    this.drawnAt = t;
    this.colors = colors;
    this.draw(t, light);
  }

  destroy() { this.texture.destroy(true); }
}

/* ONE CLOCK: a letter planet, the moon's dotted track, the moon and the sun,
 * for one entry of our settings (see lib/clocks). */
export class ClockPlanet {
  constructor(clock) {
    sunTexture ??= bodyTexture(SUN, true);
    moonTexture ??= bodyTexture(MOON, false);
    this.node = new Container();
    this.ring = new Graphics();          //  shown while arranging
    this.ticks = new Graphics();
    this.planet = new Sprite(Texture.EMPTY);
    this.planet.anchor.set(0.5);
    this.moon = new Sprite(moonTexture); this.moon.anchor.set(0.5);
    this.sun = new Sprite(sunTexture); this.sun.anchor.set(0.5);
    /* The moon after the sun: in front of it, so when the hands meet it
     * passes across the sun -- a little eclipse. */
    this.moon.tint = MOON_TINT;
    this.node.addChild(this.ring, this.ticks, this.planet, this.sun, this.moon);
    this.letters = null;
    this.timeAt = -Infinity;
    this.centre = { x: 0, y: 0 };
    this.configure(clock);
  }

  get scale() { return this.clock.size; }
  get outer() { return OUTER * this.scale; }

  /* New settings for this clock: letters and size rebuild the drawing. */
  configure(clock) {
    const was = this.clock;
    this.clock = clock;
    if (!this.letters || was.label !== clock.label || was.size !== clock.size) {
      this.letters?.destroy();
      this.letters = new LetterPlanet({ size: Math.round(PLANET_SIZE * clock.size),
        fontSize: FONT_SIZE * clock.size, word: clock.label });
      this.planet.texture = this.letters.texture;
      this.drawTicks();
    }
    /* A new time zone or day colour: redrawn at once, not at the next tick. */
    if (was?.zone !== clock.zone || was?.hue !== clock.hue) { this.timeAt = -Infinity; if (this.letters) this.letters.drawnAt = -Infinity; }
  }

  /* Twelve marks on the ring, bigger at 12, 3, 6 and 9. */
  drawTicks() {
    const s = this.scale, r = ORBIT * s;
    this.ticks.clear();
    for (let i = 0; i < 12; i++) {
      const p = handAt((i / 12) * Math.PI * 2, r), big = i % 3 === 0;
      this.ticks.beginFill(0xffffff, big ? 0.55 : 0.3).drawCircle(p.x, p.y, (big ? 1.6 : 1) * Math.max(1, s)).endFill();
    }
    this.ring.clear().lineStyle(1, 0x7fd6c3, 0.8).drawCircle(0, 0, this.outer + 4);
    this.ring.visible = false;
  }

  /* Where it is on a `w` x `h` screen: dragged, or from its settings. */
  locate(w, h, dragged = null) {
    this.centre = dragged ?? place(this.clock.at, w, h, this.outer);
    this.node.position.set(Math.round(this.centre.x), Math.round(this.centre.y));
    return this.centre;
  }

  /* The time on it, a few times a second: hands, colours and light. */
  tick(time, now, draw = true) {
    if (time - this.timeAt >= REDRAW_MS) {
      this.timeAt = time;
      const t = zoneTime(now, this.clock.zone);
      this.hands = hands(t);
      this.day = dayness(t);
      this.colors = palette(this.day, this.clock.hue);
      const s = this.scale;
      const sun = handAt(this.hands.hour, ORBIT * s), moon = handAt(this.hands.minute, ORBIT * s);
      this.sun.position.set(Math.round(sun.x), Math.round(sun.y));
      this.moon.position.set(Math.round(moon.x), Math.round(moon.y));
      /* The sun takes the planet's colour; the moon and the marks keep theirs. */
      this.sun.tint = tintOf(this.colors[0]);
      this.ticks.tint = TICK_TINT;
    }
    if (draw) this.letters.tick(time, lightFrom(this.hands.hour), this.colors);
  }

  destroy() { this.letters?.destroy(); this.node.destroy({ children: true }); }
}

export class Space {
  /* `clock` is the wall clock the planets read. */
  constructor({ clock = Date.now } = {}) {
    this.clock = clock;
    this.node = new Container();
    /* Far, middle, and a sparse near layer that breathes. `drift` is how much
     * of the camera's movement each one follows; `scale` is its pixel size. */
    this.layers = [
      { tile: { size: 160, count: 100, seed: 7, dim: 0.25 }, drift: 0.06, scale: 2 },
      { tile: { size: 224, count: 38, seed: 19, cross: 0.3, dim: 0.45 }, drift: 0.12, scale: 3 },
      { tile: { size: 256, count: 12, seed: 41, cross: 0.9, dim: 0.7 }, drift: 0.2, scale: 4, twinkle: true },
    ].map((l) => {
      const sprite = new TilingSprite(starTile(l.tile), 1, 1);
      sprite.tileScale.set(l.scale);
      this.node.addChild(sprite);
      return { ...l, sprite };
    });
    this.step = -1;
    /* The planets are in the sky with the stars, behind the map. While they
     * are being arranged they come to the FRONT, above the map, so one can be
     * picked up wherever it is; the game puts `front` above its camera. */
    this.sky = new Container();
    this.node.addChild(this.sky);
    this.front = new Container();
    this.planets = new Map();            //  id -> ClockPlanet, in settings order
    this.arranging = false;
    this.dragging = null;                //  {id, x, y}
    this.size = { w: 1, h: 1 };
    /* Our planet, until our settings arrive. */
    this.setClocks(defaults().clocks);
  }

  /* Our clocks, from our settings (see lib/clocks). */
  setClocks(clocks = []) {
    const wanted = new Set(clocks.map((c) => c.id));
    for (const [id, p] of this.planets) if (!wanted.has(id)) { p.destroy(); this.planets.delete(id); }
    const next = new Map();
    for (const c of clocks) {
      const p = this.planets.get(c.id) ?? new ClockPlanet(c);
      p.configure(c);
      (this.arranging ? this.front : this.sky).addChild(p.node);
      p.ring.visible = this.arranging;
      next.set(c.id, p);
    }
    this.planets = next;
  }

  /* Arranging: the planets come forward, ringed, to be dragged about. */
  arrange(on) {
    this.arranging = !!on;
    for (const p of this.planets.values()) {
      (this.arranging ? this.front : this.sky).addChild(p.node);
      p.ring.visible = this.arranging;
    }
    if (!on) this.dragging = null;
  }

  /* The planet at a screen point that is SKY -- not covered by the map at
   * `zoom` with the camera at `cameraX`/`cameraY` -- if any. */
  skyClockAt(x, y, cameraX, cameraY, world, zoom) {
    if (world && x >= cameraX && x <= cameraX + world.px * zoom &&
        y >= cameraY && y <= cameraY + world.py * zoom) return null;
    return this.clockAt(x, y);
  }

  /* The planet at a screen point, if any. */
  clockAt(x, y) {
    let best = null;
    for (const [id, p] of this.planets) {
      const d = Math.hypot(x - p.centre.x, y - p.centre.y);
      if (d <= p.outer && (!best || d < best.d)) best = { id, d, dx: x - p.centre.x, dy: y - p.centre.y };
    }
    return best;
  }
  drag(id, x, y) { if (this.planets.has(id)) this.dragging = { id, x, y }; }
  drop() { const d = this.dragging; this.dragging = null; return d; }

  /* True when the map, at `zoom` with the camera at `cameraX`/`cameraY`,
   * hides the whole of a planet. */
  covered(p, cameraX, cameraY, world, zoom) {
    if (!world || this.arranging) return false;
    const r = p.outer, { x, y } = p.centre;
    return cameraX <= x - r && cameraY <= y - r &&
      cameraX + world.px * zoom >= x + r && cameraY + world.py * zoom >= y + r;
  }

  /* Cover the screen and follow the camera. Called once a frame; costs a few
   * assignments, plus small drawings a few times a second for the planets that
   * can be seen. `world` is the current map's size in pixels. */
  update(width, height, cameraX, cameraY, time, world = null, zoom = 1) {
    this.size = { w: width, h: height };
    for (const l of this.layers) {
      const s = l.sprite;
      if (s.width !== width) s.width = width;
      if (s.height !== height) s.height = height;
      s.tilePosition.set(Math.round(cameraX * l.drift), Math.round(cameraY * l.drift));
    }
    const step = Math.floor(time / TWINKLE_STEP_MS) % TWINKLE.length;
    if (step !== this.step) {
      this.step = step;
      for (const l of this.layers) if (l.twinkle) l.sprite.alpha = TWINKLE[step];
    }
    const now = this.clock();
    for (const [id, p] of this.planets) {
      p.locate(width, height, this.dragging?.id === id ? this.dragging : null);
      /* Zoomed in, the map usually covers the sky: no drawing then. */
      p.tick(time, now, !this.covered(p, cameraX, cameraY, world, zoom));
    }
  }
}

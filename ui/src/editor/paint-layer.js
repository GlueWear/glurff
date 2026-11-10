/* THE PAINTING LAYER'S PIXELS (2026-11-08): what the owner paints over a map
 * image, at the painting's own size (world/world-doc paintDims), held as the
 * tiles the document keeps it in -- only where something is painted, so a
 * big map with a little painting holds a little.
 *
 * A stroke covers each pixel once, however often the brush passes over it:
 * paint at half opacity stays at half until the next stroke. Hard edges (the
 * default) paint whole pixels, as the game's art is drawn; soft ones smooth
 * a stroke's rim. The eraser takes paint away, never the map image. */
import { PAINT_TILE as T } from '../world/world-doc.js';
import { turnedBounds } from '../world/turned.js';

export const tileKey = (c, r) => `${c},${r}`;
export const keyTile = (key) => key.split(',').map(Number);

/* ---------------------------------------------------------------- colour */

export const hexToRgb = (hex) => { const n = parseInt(String(hex).slice(1, 7), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgbToHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
export const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
/* Hue 0-360, saturation and value 0-1. */
export function hsvToRgb(h, s, v) {
  const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}
export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

/* ---------------------------------------------------------------- pixels */

/* A colour `rgb` laid over pixel i of RGBA bytes `d` at strength t (0-1). */
export function blendInto(d, i, rgb, t) {
  const da = d[i + 3] / 255, oa = t + da * (1 - t);
  if (oa <= 0) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; return; }
  for (let ch = 0; ch < 3; ch++) d[i + ch] = Math.round((rgb[ch] * t + d[i + ch] * da * (1 - t)) / oa);
  d[i + 3] = Math.round(oa * 255);
}
/* How much more of a stroke a pixel takes, at opacity `alpha`, going from
 * coverage `prev` to `cov`: what makes it end where one pass would have. */
export const topUp = (alpha, prev, cov) => (alpha * prev >= 1 ? 0 : (alpha * (cov - prev)) / (1 - alpha * prev));

const dist2Seg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
};

/* THE SAME COLOUR, FROM A POINT: every pixel of `data` (RGBA, w x h) joined
 * to (x, y) whose colour is within `tolerance` (0-255, each channel) of that
 * point's. {region: 1 per pixel, box: [x0, y0, x1, y1)} or null. */
export function floodRegion(data, w, h, x, y, tolerance) {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  const at = (y * w + x) * 4, c0 = [data[at], data[at + 1], data[at + 2], data[at + 3]];
  const same = (p) => { const i = p * 4;
    return Math.abs(data[i] - c0[0]) <= tolerance && Math.abs(data[i + 1] - c0[1]) <= tolerance &&
      Math.abs(data[i + 2] - c0[2]) <= tolerance && Math.abs(data[i + 3] - c0[3]) <= tolerance; };
  const region = new Uint8Array(w * h), stack = [x, y];
  let x0 = x, y0 = y, x1 = x + 1, y1 = y + 1;
  while (stack.length) {
    const sy = stack.pop(), sx = stack.pop(), row = sy * w;
    if (region[row + sx]) continue;
    let l = sx, r = sx;
    while (l > 0 && !region[row + l - 1] && same(row + l - 1)) l--;
    while (r < w - 1 && !region[row + r + 1] && same(row + r + 1)) r++;
    for (let i = l; i <= r; i++) region[row + i] = 1;
    if (l < x0) x0 = l; if (r + 1 > x1) x1 = r + 1; if (sy < y0) y0 = sy; if (sy + 1 > y1) y1 = sy + 1;
    for (const ny of [sy - 1, sy + 1]) {
      if (ny < 0 || ny >= h) continue;
      let open = false;
      for (let i = l; i <= r; i++) {
        const p = ny * w + i, go = !region[p] && same(p);
        if (go && !open) stack.push(i, ny);
        open = go;
      }
    }
  }
  return { region, box: [x0, y0, x1, y1] };
}

/* ---------------------------------------------------------------- buffer */

export class PaintBuffer {
  /* `w` x `h` pixels laid over the map's [0, 0, size]. */
  constructor(w, h, size, doc = globalThis.document) {
    this.w = w; this.h = h; this.size = [...size]; this.doc = doc;
    this.tiles = new Map();       //  key -> {canvas, ctx}
    this.shown = new Map();       //  key -> the asset each tile shows now
    this.loading = new Map();     //  key -> the asset on its way to it
    this.mask = null; this.stroke = null;
    /* The tiles as one picture, for drawing: tiles drawn one by one show
     * their seams when smoothed. Made again where they change. */
    this.view = null; this.stale = new Set(); this.allStale = true;
  }
  get cols() { return Math.ceil(this.w / T); }
  get rows() { return Math.ceil(this.h / T); }
  /* Map pixels to the painting's, and back. */
  get kx() { return this.w / this.size[0]; }
  get ky() { return this.h / this.size[1]; }
  toPaint(x, y) { return [x * this.kx, y * this.ky]; }
  /* Every tile is here: nothing still on its way that a stroke could cover. */
  get ready() { return this.loading.size === 0; }

  tile(c, r, make = false) {
    const key = tileKey(c, r);
    let t = this.tiles.get(key);
    if (!t && make) {
      const canvas = this.doc.createElement('canvas'); canvas.width = canvas.height = T;
      t = { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
      this.tiles.set(key, t);
    }
    return t ?? null;
  }
  /* The keys of the tiles a box of painting pixels [x0, y0, x1, y1) touches. */
  tilesIn([x0, y0, x1, y1]) {
    const out = [];
    const c0 = Math.max(0, Math.floor(x0 / T)), c1 = Math.min(this.cols - 1, Math.floor((x1 - 1) / T));
    const r0 = Math.max(0, Math.floor(y0 / T)), r1 = Math.min(this.rows - 1, Math.floor((y1 - 1) / T));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(tileKey(c, r));
    return out;
  }
  /* Each pixel of a box, tile by tile: fn(data, i, x, y) on its RGBA bytes,
   * true if it changed one. */
  each(box, fn) {
    const x0 = Math.max(0, Math.floor(box[0])), y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(this.w, Math.ceil(box[2])), y1 = Math.min(this.h, Math.ceil(box[3]));
    if (x1 <= x0 || y1 <= y0) return [];
    const touched = [];
    for (const key of this.tilesIn([x0, y0, x1, y1])) {
      const [c, r] = keyTile(key), ox = c * T, oy = r * T;
      const lx = Math.max(x0, ox) - ox, ly = Math.max(y0, oy) - oy;
      const lw = Math.min(x1, ox + T) - ox - lx, lh = Math.min(y1, oy + T) - oy - ly;
      const t = this.tile(c, r, true), img = t.ctx.getImageData(lx, ly, lw, lh), d = img.data;
      let any = false;
      for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) if (fn(d, (y * lw + x) * 4, ox + lx + x, oy + ly + y)) any = true;
      if (any) { t.ctx.putImageData(img, lx, ly); touched.push(key); this.stale.add(key); }
    }
    return touched;
  }

  /* ------------------------------------------------------------ strokes */

  /* {rgb, alpha, erase, hard} */
  begin(style) {
    if (!this.mask || this.mask.length !== this.w * this.h) this.mask = new Uint8Array(this.w * this.h);
    this.stroke = { ...style, box: null, touched: new Set() };
  }
  /* What `coverage(x, y)` (0-1, at a pixel's middle) says, over a box. */
  cover(box, coverage) {
    const s = this.stroke; if (!s) return;
    const touched = this.each(box, (d, i, x, y) => {
      const cov = coverage(x + 0.5, y + 0.5); if (cov <= 0) return false;
      const mi = y * this.w + x, prev = this.mask[mi] / 255;
      if (cov <= prev) return false;
      this.mask[mi] = Math.round(cov * 255);
      const t = topUp(s.alpha, prev, cov); if (t <= 0) return false;
      if (s.erase) d[i + 3] = Math.round(d[i + 3] * (1 - t));
      else blendInto(d, i, s.rgb, t);
      return true;
    });
    if (!touched.length) return;
    for (const k of touched) s.touched.add(k);
    const b = [Math.max(0, Math.floor(box[0])), Math.max(0, Math.floor(box[1])), Math.min(this.w, Math.ceil(box[2])), Math.min(this.h, Math.ceil(box[3]))];
    s.box = s.box ? [Math.min(s.box[0], b[0]), Math.min(s.box[1], b[1]), Math.max(s.box[2], b[2]), Math.max(s.box[3], b[3])] : b;
  }
  /* A brush from (ax, ay) to (bx, by), `r` painting pixels round. */
  segment(ax, ay, bx, by, r) {
    const R = Math.max(r, 0.5), hard = this.stroke?.hard;
    const box = [Math.min(ax, bx) - R - 1, Math.min(ay, by) - R - 1, Math.max(ax, bx) + R + 1, Math.max(ay, by) + R + 1];
    this.cover(box, (x, y) => {
      const dd = dist2Seg(x, y, ax, ay, bx, by);
      if (hard) return dd <= R * R ? 1 : 0;
      return Math.max(0, Math.min(1, R + 0.5 - Math.sqrt(dd)));
    });
  }
  rect(x, y, w, h) {
    const hard = this.stroke?.hard;
    this.cover([x - 1, y - 1, x + w + 1, y + h + 1], (px, py) => {
      const inside = Math.min(px - x, x + w - px, py - y, y + h - py);
      return hard ? (inside >= 0 ? 1 : 0) : Math.max(0, Math.min(1, inside + 0.5));
    });
  }
  ellipse(cx, cy, rx, ry) {
    const hard = this.stroke?.hard;
    if (rx <= 0 || ry <= 0) return;
    this.cover([cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1], (px, py) => {
      const q = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
      return hard ? (q <= 1 ? 1 : 0) : Math.max(0, Math.min(1, (1 - Math.sqrt(q)) * Math.min(rx, ry) + 0.5));
    });
  }
  /* Where `seen` (what the map shows, as RGBA at this painting's size) is
   * one colour with (x, y), painted over. */
  fill(seen, x, y, tolerance) {
    const f = floodRegion(seen, this.w, this.h, Math.floor(x), Math.floor(y), tolerance);
    if (!f) return;
    this.cover(f.box, (px, py) => f.region[Math.floor(py) * this.w + Math.floor(px)]);
  }
  /* The stroke done: the tiles it touched. */
  end() {
    const s = this.stroke; this.stroke = null;
    if (!s?.box) return [];
    const [x0, y0, x1, y1] = s.box;
    for (let y = y0; y < y1; y++) this.mask.fill(0, y * this.w + x0, y * this.w + x1);
    return [...s.touched];
  }

  /* --------------------------------------------------- pieces and tiles */

  /* Painting taken away from a box (the map image stays). */
  clear([x, y, w, h]) {
    const out = [];
    for (const key of this.tilesIn([x, y, x + w, y + h])) {
      const t = this.tiles.get(key); if (!t) continue;
      const [c, r] = keyTile(key);
      t.ctx.clearRect(x - c * T, y - r * T, w, h);
      out.push(key); this.stale.add(key);
    }
    return out;
  }
  /* A picture laid onto the painting at [x, y, w, h], flipped side to side
   * if asked; `smooth` false keeps its pixels hard when scaled. */
  stamp(source, [x, y, w, h], { flip = false, smooth = false, turn = 0 } = {}) {
    /* Turned about its middle (2026-11-10): the tiles under it as turned. */
    const [x0, y0, x1, y1] = turn ? turnedBounds([x, y, w, h], turn) : [x, y, x + w, y + h];
    const out = this.tilesIn([Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)]);
    for (const key of out) {
      const [c, r] = keyTile(key), t = this.tile(c, r, true), g = t.ctx;
      g.save();
      g.translate(-c * T, -r * T);
      g.beginPath(); g.rect(0, 0, this.w, this.h); g.clip();
      g.imageSmoothingEnabled = smooth;
      g.translate(x + w / 2, y + h / 2);
      if (turn) g.rotate((turn * Math.PI) / 180);
      if (flip) g.scale(-1, 1);
      g.drawImage(source, -w / 2, -h / 2, w, h);
      g.restore();
      this.stale.add(key);
    }
    return out;
  }
  /* A tile's pixels as they are now, in a canvas of its own, and whether
   * anything is painted there. */
  snapshot(key) {
    const t = this.tiles.get(key);
    const canvas = this.doc.createElement('canvas'); canvas.width = canvas.height = T;
    if (!t) return { canvas, empty: true };
    const data = t.ctx.getImageData(0, 0, T, T);
    canvas.getContext('2d').putImageData(data, 0, 0);
    let empty = true;
    for (let i = 3; i < data.data.length; i += 4) if (data.data[i]) { empty = false; break; }
    if (empty) this.tiles.delete(key);
    return { canvas, empty };
  }
  /* A tile as the document has it. */
  put(key, image) {
    const [c, r] = keyTile(key), t = this.tile(c, r, true);
    t.ctx.clearRect(0, 0, T, T);
    t.ctx.drawImage(image, 0, 0);
    this.stale.add(key);
  }
  drop(key) { this.tiles.delete(key); this.stale.add(key); }
  /* Drawn into `ctx`, whose units are this painting's pixels. */
  draw(ctx) {
    if (!this.view) { this.view = this.doc.createElement('canvas'); this.view.width = this.w; this.view.height = this.h; this.allStale = true; }
    const g = this.view.getContext('2d');
    if (this.allStale) {
      g.clearRect(0, 0, this.w, this.h);
      for (const [key, t] of this.tiles) { const [c, r] = keyTile(key); g.drawImage(t.canvas, c * T, r * T); }
    } else for (const key of this.stale) {
      const [c, r] = keyTile(key), t = this.tiles.get(key);
      g.clearRect(c * T, r * T, T, T);
      if (t) g.drawImage(t.canvas, c * T, r * T);
    }
    this.allStale = false; this.stale.clear();
    ctx.drawImage(this.view, 0, 0);
  }
  /* All of it as one canvas: for copying, filling and resizing. */
  whole() {
    const c = this.doc.createElement('canvas'); c.width = this.w; c.height = this.h;
    this.draw(c.getContext('2d'));
    return c;
  }
  /* The same painting laid over a map of another size (it was resized): at
   * `w` x `h` over [0, 0, size], where it was. */
  rebased(w, h, size) {
    const next = new PaintBuffer(w, h, size, this.doc);
    if (!this.tiles.size) return next;
    const old = this.whole();
    next.stamp(old, [0, 0, this.size[0] * next.kx, this.size[1] * next.ky], { smooth: false });
    return next;
  }
}

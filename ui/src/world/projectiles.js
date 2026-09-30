/* WHAT FLIES: our own pixel drawings of an arrow and a slingshot stone.
 *
 * The flying arrow used to be a frame from the character art, drawn in only
 * the four directions a character faces. Free aim sends it at any angle, so it
 * is drawn here instead -- pointing right, turned to wherever it is going -- a
 * wooden shaft, a steel head and pale fletching, with a faint trail behind.
 * The stone is small, grey and shaded, with a trail of its own.
 *
 * Drawn once each, at one pixel per pixel; the game scales them the way it
 * scales characters, and keeps them sharp (nearest-pixel).
 */
import { Texture, SCALE_MODES } from 'pixi.js';

/* An arrow 11 long plus a short trail, pointing right: slim, so it sits well
 * beside a character. Each row is a string: one character per pixel, '.' for
 * nothing. */
export const ARROW_ROWS = [
  '.t..rf.....h..',
  'tttnwfsssssHHh',
  '.t..rf.....h..',
];
export const STONE_ROWS = [
  '.......lgg.',
  'tttt..lggdd',
  '.ttttlggddd',
  'tttt..gdddk',
  '.......ddk.',
];
const COLORS = {
  t: 'rgba(255,255,255,0.18)',   //  the trail
  r: '#c0443a',                  //  a red band on the fletching
  f: '#e8e2d0',                  //  fletching
  w: '#d8d2c0',                  //  fletching, nearer the shaft
  n: '#4a3622',                  //  the nock
  s: '#a0703f',                  //  the shaft
  h: '#9aa4b0',                  //  the head, in shadow
  H: '#e6ebf0',                  //  the head, lit
  l: '#d9dde3',                  //  stone, lit
  g: '#9aa0a8',                  //  stone
  d: '#6b7078',                  //  stone, in shadow
  k: '#474b52',                  //  stone, darkest
};

function draw(rows) {
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length; canvas.height = rows.length;
  const g = canvas.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    g.fillStyle = COLORS[c]; g.fillRect(x, y, 1, 1);
  }));
  const texture = Texture.from(canvas);
  texture.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  return texture;
}

const made = {};
/* The drawing for a weapon's shot: the stone for a slingshot, else the arrow. */
export function projectileTexture(weapon) {
  const kind = weapon === 'slingshot' ? 'stone' : 'arrow';
  return (made[kind] ??= draw(kind === 'stone' ? STONE_ROWS : ARROW_ROWS));
}
/* Where the shot's point is on the drawing, as an anchor: its tip, so the
 * point in the world is where the head is. */
export const TIP = { arrow: { x: 13.5 / 14, y: 0.5 }, stone: { x: 8 / 11, y: 0.5 } };

/* WHAT FLIES: our own pixel drawings of an arrow, a stone and a spell.
 *
 * The flying arrow used to be a frame from the character art, drawn in only
 * the four directions a character faces. Free aim sends it at any angle, so it
 * is drawn here instead, pointing right and turned to wherever it is going.
 * Since 2026-10-12 all three are plain: the arrow a short thin line, pale at
 * the head; a stone a little grey circle; a spell a little circle in its
 * caster's colour, pale at the heart. No trails.
 *
 * Drawn once each, at one pixel per pixel; the game scales them the way it
 * scales characters, and keeps them sharp (nearest-pixel).
 */
import { Texture, SCALE_MODES } from 'pixi.js';

/* An arrow: a line six pixels long, pointing right. Each row is a string:
 * one character per pixel, '.' for nothing. */
export const ARROW_ROWS = [
  'aaaaaH',
];
/* A stone: a little circle, lit from above. */
export const STONE_ROWS = [
  '.lg.',
  'lggd',
  'gggd',
  '.dd.',
];
/* A spell: a little circle in its caster's colour (m), pale at the heart (c). */
export const SPELL_ROWS = [
  '.mm.',
  'mccm',
  'mccm',
  '.mm.',
];
export const COLORS = {
  a: '#cdb48c',                  //  the arrow: pale wood, to show on any floor
  H: '#eef1f4',                  //  its head
  l: '#d9dde3',                  //  stone, lit
  g: '#9aa0a8',                  //  stone
  d: '#6b7078',                  //  stone, in shadow
};

/* The spell's colours, from its caster's. */
export function spellPalette(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const pale = (v) => Math.round(v + (255 - v) * 0.65);
  return { m: hex, c: `rgb(${pale(r)},${pale(g)},${pale(b)})` };
}

function draw(rows, colors = COLORS) {
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length; canvas.height = rows.length;
  const g = canvas.getContext('2d');
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c === '.') return;
    g.fillStyle = colors[c]; g.fillRect(x, y, 1, 1);
  }));
  const texture = Texture.from(canvas);
  texture.baseTexture.scaleMode = SCALE_MODES.NEAREST;
  return texture;
}

const made = {};
/* What a weapon's shot looks like: a stone for a slingshot, an orb for a
 * spell, else an arrow. */
export const shotKind = (weapon) => (weapon === 'slingshot' ? 'stone' : weapon === 'spell' ? 'spell' : 'arrow');
/* The drawing for a weapon's shot; a spell's in `colour` (#rrggbb). */
export function projectileTexture(weapon, colour = '#b48cff') {
  const kind = shotKind(weapon);
  if (kind === 'spell') return (made[`spell${colour}`] ??= draw(SPELL_ROWS, spellPalette(colour)));
  return (made[kind] ??= draw(kind === 'stone' ? STONE_ROWS : ARROW_ROWS));
}
/* Where the shot's point is on the drawing, as an anchor: its tip, so the
 * point in the world is where the head is. */
export const TIP = { arrow: { x: 5.5 / 6, y: 0.5 }, stone: { x: 0.5, y: 0.5 }, spell: { x: 0.5, y: 0.5 } };

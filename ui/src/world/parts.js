import { versioned } from '../lib/build.js';
import data from 'world/character-data';
/* Characters, assembled from Minifantasy's layered NPC art (Krishna Palacio).
 *
 * Every part is drawn on the same grid -- four directions down, four walk
 * frames across, each frame 32x32 -- so any body wears any clothes and any hat
 * sits on any hair. tools/build_characters.py packs them one sheet per slot;
 * character-data.js says which part is where.
 *
 * A person is about seven pixels tall in the art, which is tiny against the
 * painted map, so characters are drawn at four times: about the height of a
 * chair, which is what a person should be.
 */
export const TILE = 32;                    //  painted pixels per tile
export const FRAME = data.frame;           //  one drawn frame, 32x32
export const BLOCK = data.block;           //  one part: every direction and frame
export const SCALE = 4;                    //  drawn at four times
/* Where the feet are inside the frame, so a character stands on its position
 * rather than floating above it. */
export const FEET = 20;
export const HEAD = 8;                     //  the top of the head, for the name
export const CHAR_W = FRAME * SCALE;
export const CHAR_H = (FEET - HEAD) * SCALE;

/* The renderer's vocabulary. Presence speaks the same words, deliberately: a
 * mismatch between the two yields an undefined sprite key, which draws as
 * nothing -- a name gliding around with nobody under it. */
export const DIRS = ['down', 'right', 'up', 'left'];
/* THE ART FACES DIAGONALLY, not along the compass: the four rows are drawn
 * front-right, front-left, back-right and back-left. Walking right must
 * therefore use a FRONT row -- pointing the back row that way is what made
 * somebody walking right look like they were walking backwards.
 *
 * Four drawings and four directions, so one drawing is used twice: standing and
 * walking right both use the front-right one. */
const ROW = { down: 0, right: 0, left: 1, up: 2 };
/* Every direction is drawn, so nothing is ever mirrored. */
export const flipped = () => false;
export const facingAway = (dir) => dir === 'up';

/* Slots, drawn back to front: trousers before the top so a shirt covers the
 * waistband, hair before the hat so a hat sits on it. */
export const SLOTS = ['body', 'bottom', 'shoes', 'top', 'gloves', 'shoulders', 'beard', 'hair', 'hat'];
export const CATALOG = data.slots;
/* The art is coloured, not greyscale: the colours come from the part you pick,
 * so nothing here is tinted. */
export const TINTABLE = new Set();

const index = {};
for (const [slot, meta] of Object.entries(CATALOG)) {
  index[slot] = new Map(meta.variants.map((v, i) => [v.key, i]));
}

export const sheetUrl = (slot) => versioned(`/apps/glurff/characters/${slot}.png`);

/* Where one part's frame sits on its slot's sheet. An empty part -- "wear
 * nothing here" -- is null, and draws nothing. */
export function frameOf(slot, part, dir, frame) {
  const meta = CATALOG[slot];
  if (!meta || !part) return null;
  const at = index[slot].get(part);
  if (at === undefined) return null;
  const bx = (at % meta.cols) * BLOCK, by = Math.floor(at / meta.cols) * BLOCK;
  return {
    url: sheetUrl(slot),
    x: bx + (frame % data.frames) * FRAME,
    y: by + (ROW[dir] ?? 0) * FRAME,
    w: FRAME, h: FRAME,
  };
}

/* One sheet per slot, all of them loaded up front: nine files for every
 * character anybody can wear. */
export function allTextures() {
  return SLOTS.map(sheetUrl);
}

/* The parts of a slot, grouped the way the art is: a style, then its colours. */
export function groupsOf(slot) {
  const out = new Map();
  for (const v of CATALOG[slot]?.variants ?? []) {
    if (!out.has(v.group)) out.set(v.group, []);
    out.get(v.group).push(v);
  }
  return out;
}
export const variantOf = (slot, part) =>
  CATALOG[slot]?.variants[index[slot]?.get(part) ?? -1] ?? null;

/* A sensible starting character, so a new player is never a floating head. */
export const DEFAULT_LOOK = {
  body: { part: 'human-paleskin', tint: null },
  bottom: { part: 'trousers-blue', tint: null },
  shoes: { part: 'shoes-black', tint: null },
  top: { part: 'shirt-white', tint: null },
  gloves: { part: '', tint: null },
  shoulders: { part: '', tint: null },
  beard: { part: '', tint: null },
  hair: { part: 'short-brown', tint: null },
  hat: { part: '', tint: null },
};

/* Fill in anything a peer's look is missing, so a partial spec still renders a
 * whole person rather than a body with holes. Parts we do not have art for are
 * dropped rather than drawn as nothing in the middle of somebody. */
export const completeLook = (look) => {
  const out = { ...DEFAULT_LOOK };
  for (const slot of SLOTS) {
    const piece = look?.[slot];
    if (!piece) continue;
    if (piece.part && !index[slot]?.has(piece.part)) continue;
    out[slot] = { part: piece.part ?? '', tint: piece.tint ?? null };
  }
  return out;
};

/* Kept for the older callers: parts are whole sprites now, not a path. */
export function partTexture(slot, part, dir, frame) {
  const f = frameOf(slot, part, dir, frame);
  return f ? f.url : null;
}

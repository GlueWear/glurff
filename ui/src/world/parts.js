import { versioned } from '../lib/build.js';
import data from './character-data.js';
import adventure from './adventure-data.js';
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
export const EXTRAS = ['weapon', 'mount', 'companion'];
export const EQUIPMENT = adventure;
export const artUrl = (path) => versioned(`/apps/glurff/characters/${path}`);
const equipment = Object.fromEntries([...EXTRAS, 'premade'].map(slot =>
  [slot, new Map(adventure[slot].map(v => [v.key, v]))]));
/* Unfinished whole-character/equipment art is installed but dark by default.
 * The owner enables it from Dojo on development ships. Keeping this gate in
 * the compositor means old saved selections remain intact without appearing
 * or acting for ordinary users. */
let spriteLab = false;
export const setSpriteLabEnabled = enabled => { spriteLab = enabled === true; };
export const spriteLabEnabled = () => spriteLab;
export const equipmentOf = (slot, key) => spriteLab ? equipment[slot]?.get(key) ?? null : null;
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
export function frameOf(slot, part, dir, frame, animation = 'walk') {
  const meta = CATALOG[slot];
  if (!meta || !part) return null;
  const at = index[slot].get(part);
  if (at === undefined) return null;
  const variant = meta.variants[at];
  const clip = variant.animations?.[animation];
  if (animation !== 'walk' && clip) return {
    url: artUrl(variant.sheet), x: (frame % clip.frames) * FRAME,
    y: clip.y + (clip.rows === 1 ? 0 : ROW[dir] ?? 0) * FRAME,
    w: FRAME, h: FRAME,
  };
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
    if ((slot === 'body' && !piece.part) || (piece.part && !index[slot]?.has(piece.part))) continue;
    out[slot] = { part: piece.part ?? '', tint: piece.tint ?? null };
  }
  for (const slot of [...EXTRAS, 'premade']) {
    const piece = look?.[slot];
    if (piece?.part && equipment[slot].has(piece.part)) out[slot] = { part: piece.part, tint: null };
  }
  return out;
};

/* Whole sprites retain their own frame size and count. Some companions only
 * have front/back rows; the side view shares and mirrors the same drawing. */
export function wholeFrame(item, dir = 'down', frame = 0, animation = 'walk') {
  if (!item) return null;
  const clip = item.animations[animation] ?? item.animations.walk ?? item.animations.idle;
  const row = clip.rows === 1 ? 0 : clip.rows === 2 ? (dir === 'up' ? 1 : 0)
    : Math.min(clip.rows - 1, ROW[dir] ?? 0);
  return { url: artUrl(item.sheet), x: (frame % clip.frames) * item.frame,
    y: clip.y + row * item.frame, w: item.frame, h: item.frame,
    flip: clip.rows === 2 && dir === 'left', feet: item.feet };
}

export function animationFrames(look, animation) {
  const item = equipmentOf('premade', look?.premade?.part);
  if (item) return item.animations[animation]?.frames ?? (animation === 'die' ? 12 : 4);
  return {walk: 4, idle: 16, dmg: 4, die: 12, attack: 8}[animation] ?? 4;
}

export function weaponOffset(key, dir, frame) {
  return equipmentOf('weapon', key)?.walkOffsets[dir]?.[frame % 4] ?? [0, 0];
}

/* Shared by Pixi and the canvas preview: the dressed body never changes to
 * a bare attack/rider body. Layer order remains the same in every direction. */
export function characterLayers(look, dir = 'down', frame = 0, animation = 'walk', cycle = frame) {
  const out = [], premade = equipmentOf('premade', look?.premade?.part);
  const mount = equipmentOf('mount', look?.mount?.part);
  const weapon = equipmentOf('weapon', look?.weapon?.part);
  const falling = animation === 'die' || animation === 'dmg';
  const riderY = mount && !falling ? mount.riderY : 0;
  const bodyAnimation = animation === 'attack' ? 'walk' : animation;
  const bodyFrame = animation === 'attack' ? 0 : frame;
  const weaponLayer = layer => {
    if (!weapon || falling || !weapon.layers[layer]) return;
    const meta = weapon.layers[layer];
    const [dx, dy] = animation === 'walk' ? weaponOffset(weapon.key, dir, frame) : [0,0];
    out.push({key: `weapon-${layer}`, url: artUrl(meta.sheet),
      x: (animation === 'attack' ? Math.min(frame, meta.frames-1) : 0)*FRAME,
      y: Math.min(meta.rows-1, ROW[dir] ?? 0)*FRAME, w: FRAME, h: FRAME,
      feet: FEET, dx, dy: riderY+dy});
  };
  weaponLayer('back');
  if (premade) {
    // All victims recover in the same 2.4 seconds. Source creatures can have
    // 4–40 death frames, so traverse the WHOLE fall across our twelve steps.
    const poseFrame = animation === 'die' && premade.animations.die
      ? Math.round(Math.min(11,frame)*(premade.animations.die.frames-1)/11) : bodyFrame;
    out.push({key: 'premade', ...wholeFrame(premade, dir, poseFrame, bodyAnimation), dy: riderY});
  }
  else for (const slot of SLOTS) {
    const f = frameOf(slot, look?.[slot]?.part, dir, bodyFrame, bodyAnimation);
    if (f) out.push({key: slot, ...f, feet: FEET, dy: riderY, tint: look[slot]?.tint});
  }
  weaponLayer('front');
  if (mount && !falling) out.push({key:'mount', ...wholeFrame(mount, dir,
    animation === 'attack' ? 0 : cycle, animation === 'walk' ? 'walk' : 'idle')});
  return out;
}

export function characterTop(look) {
  const premade = equipmentOf('premade', look?.premade?.part);
  const mount = equipmentOf('mount', look?.mount?.part);
  return (premade ? premade.feet-premade.bounds[1] : FEET-HEAD) - (mount?.riderY ?? 0);
}

/* Kept for the older callers: parts are whole sprites now, not a path. */
export function partTexture(slot, part, dir, frame) {
  const f = frameOf(slot, part, dir, frame);
  return f ? f.url : null;
}

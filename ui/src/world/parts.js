import { versioned } from '../lib/build.js';
import data from './character-data.js';
import adventure from './adventure-data.js';
import { HIDDEN, NAMES, COMPANIONS, SPELLS, SPELL_DEFAULT } from './roster.js';
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
/* Some weapon sheets go by the compass instead: right, left, down, up. */
const COMPASS = { right: 0, left: 1, down: 2, up: 3 };
/* Every direction is drawn, so nothing is ever mirrored. */
export const flipped = () => false;
export const facingAway = (dir) => dir === 'up';

/* Slots, drawn back to front: trousers before the top so a shirt covers the
 * waistband, hair before the hat so a hat sits on it. */
export const SLOTS = ['body', 'bottom', 'shoes', 'top', 'gloves', 'shoulders', 'beard', 'hair', 'hat'];
export const EXTRAS = ['weapon', 'mount', 'companion'];
/* ADJUSTMENTS to the generated art, kept here so they survive the art being
 * rebuilt (tools/build_adventures.py):
 *   name      what the list calls it
 *   hidden    not offered any more; anybody already wearing it still renders
 *   as        drawn as another item instead (the Waraxe looked like the
 *             Longsword, and neither like its name: one Scythe now)
 *   riderBack how many art pixels the rider sits further back from the head
 *   under     the mount is drawn beneath its rider (a carpet), not over them
 *   compass   the weapon's rows go right, left, down, up -- the thrust, swing
 *             and ranged sheets -- not the way the bodies' do (see ROW)
 *   behind    the whole weapon is drawn behind its holder */
const ADJUST = {
  weapon: { longsword: { name: 'Scythe' }, waraxe: { hidden: true, as: 'longsword' },
    spear: { compass: true, behind: true }, pitchfork: { compass: true, behind: true },
    flail: { compass: true }, whip: { compass: true }, bow: { compass: true }, slingshot: { compass: true } },
  mount: {
    'mounts-new-mounts-war-horse-war-horse-goldenarmour': { hidden: true },
    'mounts-new-mounts-war-horse-war-horse-silverarmour': { hidden: true },
    'mounts-new-mounts-canoe-canoe': { hidden: true },
    'mounts-new-mounts-unicorn-unicorn': { riderBack: 2 },
    'mounts-new-mounts-war-horse-war-horse-stallion': { riderBack: 2 },
    'mounts-new-mounts-bicycle-bicycle': { riderBack: 3 },
    'mounts-new-mounts-magic-carpet-magic-carpet': { under: true },
  },
};
/* The ready-made characters, as chosen one by one (world/roster): some no
 * longer offered, some renamed, and a few offered as companions instead. */
ADJUST.premade = {};
const mark = (key, change) => { ADJUST.premade[key] = { ...ADJUST.premade[key], ...change }; };
HIDDEN.forEach((key) => mark(key, { hidden: true }));
Object.entries(NAMES).forEach(([key, name]) => mark(key, { name }));
Object.keys(COMPANIONS).forEach((key) => mark(key, { hidden: true }));
const adjusted = (slot, item) => ({ ...item, ...(ADJUST[slot]?.[item.key] ?? {}) });
export const EQUIPMENT = Object.fromEntries(Object.entries(adventure).map(([slot, value]) =>
  [slot, Array.isArray(value) ? value.map((item) => adjusted(slot, item)) : value]));
/* A companion that was a ready-made character: its walk, nothing else. */
for (const [key, name] of Object.entries(COMPANIONS)) {
  const from = adventure.premade.find((item) => item.key === key);
  if (!from) continue;
  const { attack, shot, release, thumb, hidden, animations, ...walker } = from;
  const { attack: swing, ...moves } = animations;
  EQUIPMENT.companion.push({ ...walker, animations: moves, name, group: 'Ready-made' });
}
/* What a list offers: everything not hidden. */
export const choicesOf = (slot) => (EQUIPMENT[slot] ?? []).filter((item) => !item.hidden);
export const artUrl = (path) => versioned(`/apps/glurff/characters/${path}`);
const equipment = Object.fromEntries([...EXTRAS, 'premade'].map(slot =>
  [slot, new Map(EQUIPMENT[slot].map(v => [v.key, v]))]));
/* SEEN BY EVERYONE (2026-10-12). Weapons, mounts, companions and ready-made
 * characters are drawn for every player, whoever wears them. CHOOSING them is
 * what a player unlocks (lib/unlock) -- the editor's gate (ui/builder
 * equipmentReady), not the compositor's. */
export const equipmentOf = (slot, key) => equipment[slot]?.get(key) ?? null;
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
    if (piece?.part && equipment[slot].has(piece.part))
      out[slot] = { part: equipment[slot].get(piece.part).as ?? piece.part, tint: null };
  }
  /* A ready-made character that fights with its own attack holds nothing else. */
  if (equipment.premade.get(out.premade?.part)?.animations?.attack) delete out.weapon;
  return out;
};

/* THE WEAPON THE GAME'S RULES USE: one from the list, or -- for a ready-made
 * character with its own attack -- a bow's rules if it shoots, a sword's if
 * it strikes. null: nothing to fight with. */
export function ownAttack(look) {
  const premade = equipmentOf('premade', look?.premade?.part);
  if (!premade?.animations?.attack) return null;
  return premade.attack === 'ranged' ? SHOT_RULES[premade.shot] ?? 'bow' : 'sword';
}
/* What a shooter's shot is, as the game's rules know it: an arrow flies like
 * a bow's, a stone like a slingshot's, a spell its own way (lib/bow). */
const SHOT_RULES = { arrow: 'bow', stone: 'slingshot', spell: 'spell' };
/* HOW FAR A COMPANION KEEPS from us, in art pixels: room for its widest
 * side (the drawing need not sit in the middle of its frame) and a gap, and
 * never closer than the little ones always were. A Warg is longer than a
 * bulldog. */
export function companionReach(item) {
  if (!item?.bounds) return 12;
  const middle = item.frame / 2;
  return Math.max(12, Math.max(middle - item.bounds[0], item.bounds[2] - middle) + 6);
}
/* The colour of a caster's spell (world/projectiles). */
export const spellColour = (look) => SPELLS[look?.premade?.part] ?? SPELL_DEFAULT;
export const fightingWeapon = (look) => ownAttack(look) ?? equipmentOf('weapon', look?.weapon?.part)?.key ?? null;
/* When a shot leaves, after the attack begins: the frame the arrow or stone
 * leaves the hand (frame 5 of the bow and slingshot's 8), or for a ready-made
 * character the frame its art lets go on (tools/build_adventures), else
 * three fifths of the way through its own attack. ms. */
export function releaseMs(look) {
  const premade = equipmentOf('premade', look?.premade?.part);
  if (premade?.animations?.attack) return (premade.release ?? Math.round(premade.animations.attack.frames * 0.6)) * 100;
  return ['bow', 'slingshot'].includes(look?.weapon?.part) ? 500 : 0;
}

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
/* The rider, moved back from a mount's head. The art faces diagonally (see
 * ROW): the front-right and back-right drawings face right, so back is left;
 * the front-left drawing faces left, so back is right. */
const riderBackX = (mount, dir) => (mount?.riderBack ? (ROW[dir] === 1 ? 1 : -1) * mount.riderBack : 0);

export function characterLayers(look, dir = 'down', frame = 0, animation = 'walk', cycle = frame) {
  const out = [], premade = equipmentOf('premade', look?.premade?.part);
  const mount = equipmentOf('mount', look?.mount?.part);
  const weapon = equipmentOf('weapon', look?.weapon?.part);
  const falling = animation === 'die' || animation === 'dmg';
  const riderY = mount && !falling ? mount.riderY : 0;
  const riderX = mount && !falling ? riderBackX(mount, dir) : 0;
  /* A ready-made character with its own attack plays it; anybody else holds
   * still while their weapon does the moving. */
  const ownAttack = animation === 'attack' && !!premade?.animations?.attack;
  const bodyAnimation = animation === 'attack' && !ownAttack ? 'walk' : animation;
  const bodyFrame = animation === 'attack' && !ownAttack ? 0 : frame;
  const mountLayer = () => {
    if (mount && !falling) out.push({key:'mount', ...wholeFrame(mount, dir,
      animation === 'attack' ? 0 : cycle, animation === 'walk' ? 'walk' : 'idle')});
  };
  const weaponLayer = layer => {
    if (!weapon || falling || !weapon.layers[layer]) return;
    const meta = weapon.layers[layer];
    const [dx, dy] = animation === 'walk' ? weaponOffset(weapon.key, dir, frame) : [0,0];
    out.push({key: `weapon-${layer}`, url: artUrl(meta.sheet),
      x: (animation === 'attack' ? Math.min(frame, meta.frames-1) : 0)*FRAME,
      y: Math.min(meta.rows-1, (weapon.compass ? COMPASS : ROW)[dir] ?? 0)*FRAME, w: FRAME, h: FRAME,
      feet: FEET, dx: riderX+dx, dy: riderY+dy});
  };
  /* A carpet goes beneath its rider; everything else is drawn over them. */
  if (mount?.under) mountLayer();
  weaponLayer('back');
  if (weapon?.behind) weaponLayer('front');
  if (premade) {
    // All victims recover in the same 2.4 seconds. Source creatures can have
    // 4–40 death frames, so traverse the WHOLE fall across our twelve steps.
    const poseFrame = animation === 'die' && premade.animations.die
      ? Math.round(Math.min(11,frame)*(premade.animations.die.frames-1)/11) : bodyFrame;
    out.push({key: 'premade', ...wholeFrame(premade, dir, poseFrame, bodyAnimation), dx: riderX, dy: riderY});
  }
  else for (const slot of SLOTS) {
    const f = frameOf(slot, look?.[slot]?.part, dir, bodyFrame, bodyAnimation);
    if (f) out.push({key: slot, ...f, feet: FEET, dx: riderX, dy: riderY, tint: look[slot]?.tint});
  }
  if (!weapon?.behind) weaponLayer('front');
  if (!mount?.under) mountLayer();
  return out;
}

export function characterTop(look) {
  const premade = equipmentOf('premade', look?.premade?.part);
  const mount = equipmentOf('mount', look?.mount?.part);
  return (premade ? premade.feet-premade.bounds[1] : FEET-HEAD) - (mount?.riderY ?? 0);
}
/* WHAT A SHOT CAN HIT, in art pixels: the body as drawn -- how tall from the
 * feet (a mount lifts its rider), and half how wide. A built character is
 * about eight pixels across; a ready-made one is as wide as its drawing. */
export function bodyBox(look) {
  const premade = equipmentOf('premade', look?.premade?.part);
  const half = premade ? Math.max(3, (premade.bounds[2] - premade.bounds[0]) / 2) : 4;
  return { half, tall: characterTop(look) };
}
/* HOW HIGH A NAME SITS above the feet, in art pixels. A ready-made character
 * is measured exactly, so its name goes NAME_ABOVE of its height above the
 * top of the drawing; a built character's art has room above the head, so
 * its name sits at `dollShare` of the frame (game.js tunes it). A mount
 * raises either by however much it lifts its rider. */
export const NAME_ABOVE = 0.1;
export function nameHeight(look, dollShare = 0.74) {
  const premade = equipmentOf('premade', look?.premade?.part);
  const lift = -(equipmentOf('mount', look?.mount?.part)?.riderY ?? 0);
  if (premade) return (premade.feet - premade.bounds[1]) * (1 + NAME_ABOVE) + lift;
  return (FEET - HEAD) * dollShare + lift;
}

/* Kept for the older callers: parts are whole sprites now, not a path. */
export function partTexture(slot, part, dir, frame) {
  const f = frameOf(slot, part, dir, frame);
  return f ? f.url : null;
}

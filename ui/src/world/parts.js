import { versioned } from '../lib/build.js';
/* Characters, assembled from Turf's garb sprites (MIT, John Hyde).
 *
 * Naming is `<part>-<variation>-<frame>.png`, with the variation being the
 * DIRECTION and the frame being the walk cycle. Body, hair and clothing have
 * three variations (front, side, back); face parts have two, because there is
 * no face to see from behind. Only body and clothing animate.
 *
 * Left is the side sprite mirrored in code, so nothing is drawn facing left.
 */
export const TILE = 32;
export const CHAR_W = 32;
export const CHAR_H = 34;

/* The renderer's vocabulary. Presence speaks the same words, deliberately: a
 * mismatch between the two yields an undefined sprite key, which draws as
 * nothing -- a name gliding around with nobody under it. */
export const DIRS = ['down', 'right', 'up', 'left'];

/* Direction -> sprite variation. Left reuses the side sprite and flips. */
const VARIATION = { down: 0, right: 1, up: 2, left: 1 };
export const flipped = (dir) => dir === 'left';

/* Slots, drawn back to front. Bottom before top so a shirt covers a waistband;
 * hair last so a fringe falls over the face. */
export const SLOTS = ['body', 'bottom', 'top', 'brows', 'eyes', 'mouth', 'hair'];

/* Which slots the builder may tint. Turf's clothing art is coloured rather than
 * greyscale, so a tint shifts a hue instead of setting one from neutral --
 * good enough for variety, and the palette below is chosen to suit it. */
export const TINTABLE = new Set(['body', 'hair', 'top', 'bottom']);

/* Parts that exist in the art, by slot.
 *
 * The naming is `<part>-<variation>-<frame>`, so `body-0-0` is the body part in
 * variation 0 at frame 0 -- NOT a part called "body-0". That distinction
 * matters: Turf ships one body, one hairstyle, one shirt and two leg options,
 * each in three directions. Variety therefore comes from tint and from the face
 * parts, of which there are plenty.
 */
/* An EMPTY STRING in a parts list means "wear nothing in this slot".
 *
 * Empty rather than null, and that is not cosmetic: `part` is an @ta on the
 * wire, and the mark drops any slot whose part is not a JSON string. A null
 * would therefore be dropped in transit, and completeLook would fill the slot
 * back in from the default -- bald on your own screen, hair everywhere else.
 *
 * Hair has one style and only one: hair-brown-0/1/2 are the three DIRECTIONS
 * of a single style, not three styles. Bald is the only other option that
 * exists without new art; colour is where the variety actually comes from,
 * which is why hair is tintable. */
export const CATALOG = {
  body: { parts: ['body'], vars: 3, frames: 3 },
  hair: { parts: ['hair-brown', ''], vars: 3, frames: 1 },
  brows: { parts: ['brows', 'brows-arch', 'brows-bushy', 'brows-uni', 'brows-vulcan'], vars: 2, frames: 1 },
  eyes: {
    parts: ['eyes-almond', 'eyes-big-blue', 'eyes-big-brown', 'eyes-big-green',
            'eyes-cute', 'eyes-small', 'eyes-tall'],
    vars: 2, frames: 1,
  },
  mouth: {
    parts: ['mouth', 'mouth-frown', 'mouth-small', 'mouth-small-open',
            'mouth-small-red', 'mouth-smile', 'mouth-smile-big', 'mouth-smirk'],
    vars: 2, frames: 1,
  },
  top: { parts: ['tshirt-white'], vars: 3, frames: 3 },
  bottom: { parts: ['pants-blue', 'skirt-red'], vars: 3, frames: 3 },
};

/* Skin is tinted rather than swapped, since there is only one body sheet. */
export const SKIN = [0xf2d3b3, 0xe8c39a, 0xd2a172, 0xb07a4e, 0x8a5a38, 0x5e3a24];

/* A curated palette. Arbitrary hues applied independently to every slot make
 * characters look like a colour test rather than people, so the builder offers
 * these and nothing else. */
export const PALETTE = [
  0xffffff, 0xe8d5b7, 0xd98c8c, 0xc25b5b, 0x8c4a4a,
  0xe0b24a, 0xa8c26a, 0x5f9e6a, 0x4a8c8c, 0x5b7fc2,
  0x6a5bc2, 0x9e5bc2, 0xc25b9e, 0x8a8a96, 0x4a4a56, 0x222228,
];

/* Face parts vanish when facing away. */
const FACE = new Set(['brows', 'eyes', 'mouth']);
export const facingAway = (dir) => dir === 'up';

const url = (name) => versioned(`/apps/glurff/sprites/garb/${name}.png`);

/* Resolve one slot to a sprite path, clamping the variation and frame to what
 * that part actually has. A part with one frame ignores the walk cycle. */
export function partTexture(slot, part, dir, frame) {
  const meta = CATALOG[slot];
  if (!meta) return null;
  /* An empty slot. Without this the name is built anyway and asks for
   * `-0.png`, which 404s and draws nothing -- the same picture, by accident,
   * plus a failed request every frame. */
  if (!part) return null;
  if (FACE.has(slot) && facingAway(dir)) return null;
  const v = Math.min(VARIATION[dir] ?? 0, meta.vars - 1);
  const f = meta.frames > 1 ? frame % meta.frames : null;
  return url(f === null ? `${part}-${v}` : `${part}-${v}-${f}`);
}

/* Every texture the atlas must load, so nothing pops in mid-walk. */
export function allTextures() {
  const out = new Set();
  for (const [slot, meta] of Object.entries(CATALOG)) {
    for (const part of meta.parts) {
      if (!part) continue;
      for (let v = 0; v < meta.vars; v++) {
        if (meta.frames > 1) {
          for (let f = 0; f < meta.frames; f++) out.add(url(`${part}-${v}-${f}`));
        } else {
          out.add(url(`${part}-${v}`));
        }
      }
    }
  }
  return [...out];
}

/* A sensible starting character, so a new player is never a floating head. */
export const DEFAULT_LOOK = {
  body: { part: 'body', tint: 0xf2d3b3 },
  hair: { part: 'hair-brown', tint: 0x4a3a2a },
  brows: { part: 'brows', tint: null },
  eyes: { part: 'eyes-cute', tint: null },
  mouth: { part: 'mouth-smile', tint: null },
  top: { part: 'tshirt-white', tint: 0x5b7fc2 },
  bottom: { part: 'pants-blue', tint: 0x3a4a72 },
};

/* Fill in anything a peer's look is missing, so a partial spec still renders a
 * whole person rather than a body with holes. */
export const completeLook = (look) => ({ ...DEFAULT_LOOK, ...(look ?? {}) });

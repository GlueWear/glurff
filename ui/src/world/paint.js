/* Drawing a character onto a 2D canvas.
 *
 * The world draws people in Pixi; the builder cannot, because a second WebGL
 * context is a real cost and browsers cap how many a page may hold. This paints
 * the same character with the same rules -- same slot order, same bottom-centre
 * anchor, same mirrored-left, same multiply tint -- so what the editor shows is
 * what walks out of it.
 *
 * If this and world/game.js ever disagree, the editor is lying to the person
 * using it, which is worse than not having a preview at all.
 */
import { SLOTS, CHAR_W, CHAR_H, partTexture, flipped } from 'world/parts';

/* Images, kept across repaints. The builder redraws several times a second and
 * re-fetching a sprite per frame would flicker even from cache. */
const images = new Map();

function image(url, onLoad) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    images.set(url, img);
  }
  if (!img.complete && onLoad) img.addEventListener('load', onLoad, { once: true });
  return img;
}

/* Pixi's `tint` is a multiply, and the alpha has to survive it -- filling the
 * sprite's box would paint the transparent corners too. Multiply for the
 * colour, then `destination-in` to cut it back to the sprite's own shape. */
function tinted(img, tint) {
  if (!tint || tint === 0xffffff) return img;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = '#' + tint.toString(16).padStart(6, '0');
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(img, 0, 0);
  return c;
}

export function paintCharacter(canvas, look, dir, frame, scale = 4, onLoad = null) {
  const ctx = canvas.getContext('2d');
  canvas.width = CHAR_W * scale;
  canvas.height = CHAR_H * scale;
  ctx.imageSmoothingEnabled = false;   //  pixel art; anything else is mud
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  /* Origin at the feet, centred -- Pixi's anchor(0.5, 1). */
  ctx.translate(CHAR_W / 2, CHAR_H);
  if (flipped(dir)) ctx.scale(-1, 1);

  for (const slot of SLOTS) {
    const piece = look[slot];
    if (!piece) continue;
    const url = partTexture(slot, piece.part, dir, frame);
    if (!url) continue;
    const img = image(url, onLoad);
    if (!img.complete || !img.naturalWidth) continue;
    ctx.drawImage(tinted(img, piece.tint), -img.naturalWidth / 2, -img.naturalHeight);
  }
  ctx.restore();
}

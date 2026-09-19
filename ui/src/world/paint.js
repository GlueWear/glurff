import { SLOTS, frameOf, completeLook } from 'world/parts';
/* One character, drawn onto a canvas.
 *
 * The builder's preview uses this rather than the world's renderer: the panel
 * sits dead centre and the camera keeps you dead centre, so the only thing you
 * could not see while editing was yourself.
 *
 * Sheets arrive over the network on first open. Anything not loaded yet simply
 * is not drawn, and `onLoad` repaints when it lands.
 */
const sheets = new Map();
function sheet(url, onLoad) {
  let img = sheets.get(url);
  if (!img) {
    img = new Image();
    img.src = url;
    if (onLoad) img.addEventListener('load', onLoad, { once: true });
    sheets.set(url, img);
  }
  return img;
}

/* A person is a small thing in the middle of a 32x32 frame, most of which is
 * empty: drawing the whole frame is what made the preview tiny and off-centre.
 * This is the part of the frame a person can actually occupy, hat to feet. */
const CROP = { x: 8, y: 5, w: 16, h: 16 };

export function paintCharacter(canvas, look, dir, frame, scale = 4, onLoad = null) {
  const size = CROP.w * scale;
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);
  const worn = completeLook(look);
  for (const slot of SLOTS) {
    const f = frameOf(slot, worn[slot]?.part, dir, frame);
    if (!f) continue;
    const img = sheet(f.url, onLoad);
    if (!img.complete || !img.naturalWidth) continue;
    ctx.drawImage(img, f.x + CROP.x, f.y + CROP.y, CROP.w, CROP.h, 0, 0, size, size);
  }
}

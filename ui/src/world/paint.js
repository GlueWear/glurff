import { characterLayers, completeLook, equipmentOf, wholeFrame } from 'world/parts';
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
    sheets.set(url, img);
  }
  if (onLoad && !img.complete) img.addEventListener('load', onLoad, { once: true });
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
  const layers = characterLayers(worn, dir, frame);
  const companion = equipmentOf('companion', worn.companion?.part);
  if (companion) layers.push({...wholeFrame(companion, dir, 0),dx:14,dy:2});
  const equipped = ['premade','mount','weapon','companion'].some(slot => worn[slot]);
  // Keep the familiar close-up for dolls. Whole creatures/equipment share a
  // fitted viewport; a giant's head and a mount's feet must both stay visible.
  const box = equipped ? layers.reduce((b,f) => [
    Math.min(b[0],-f.w/2+(f.dx??0)),Math.min(b[1],-f.feet+(f.dy??0)),
    Math.max(b[2],f.w/2+(f.dx??0)),Math.max(b[3],f.h-f.feet+(f.dy??0)),
  ],[0,0,0,0]) : [-8,-15,8,1];
  const factor = size/Math.max(box[2]-box[0],box[3]-box[1]);
  const cx = (box[0]+box[2])/2, cy=(box[1]+box[3])/2;
  for (const f of layers) {
    const img = sheet(f.url, onLoad);
    if (!img.complete || !img.naturalWidth) continue;
    ctx.save();
    ctx.translate(size/2+((f.dx??0)-cx)*factor,size/2+((f.dy??0)-cy)*factor);
    ctx.scale(f.flip ? -factor : factor,factor);
    ctx.drawImage(img,f.x,f.y,f.w,f.h,-f.w/2,-f.feet,f.w,f.h);
    ctx.restore();
  }
}

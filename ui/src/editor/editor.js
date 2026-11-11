/* THE MAP EDITOR (2026-11-05, simplified the same day).
 *
 * Opened on the host ship itself, with editing turned on by its operator
 * (app/glurff.hoon, `operate`): every save, upload and publish goes through
 * the host's API, which refuses anybody else whatever this page does.
 *
 * One canvas and one toolbar. You choose what you are drawing -- Walls,
 * Foreground, Areas, Items, Doors or Pictures, each its own colour, all shown
 * -- and draw it with the same tools: brush, eraser, line, rectangle,
 * circle and fill. Walls and foreground are only where they are drawn.
 * Areas, items and doors also need a few words: a card opens when one is
 * drawn, and again when it is tapped with Select. Every gesture is a tap or
 * a drag, so a finger works as well as a mouse. The draft saves itself.
 */
import './editor.css';
import * as host from './host-api.js';
import { validate, rasterize, compile, covers, bounds, QUIET, worldChat, LIMITS, SIGN_SIZES, signFontSize, NPC_MAX, COLLECT_TEXT, SOUND_MAX, PAINT_TILE, paintDims } from '../world/world-doc.js';
import { completeLook, choicesOf, CATALOG, groupsOf, SLOTS, DEFAULT_LOOK } from '../world/parts.js';
import { paintWearing } from '../world/paint.js';
import { paintSign, SIGN_COLOUR } from '../world/sign-art.js';
import { fontsReady } from '../ui/fonts.js';
import { History, newMap, emptyWorld, withAssets, nextAreaNum, freshId, idsOf, findMap,
  moveOp, scaleOp, tidyOp, scaleFor, characterHeight, coarsest, slug } from './project.js';
import { preparePainting, prepareItem, loadImage, iconOf, seconds, megabytes, IMAGE_TYPES } from './images.js';
import { noteIconUrl } from '../lib/note-link.js';
import { pack, unpack, retarget, bindingsOf, hashesOf, sha256 } from './package.js';
import { PaintBuffer, tileKey, keyTile, hexToRgb, rgbToHex } from './paint-layer.js';
import { colourWheel } from './colour-wheel.js';
import { normalTurn, imageShape, turnedCorners, turnedSides, turnHandle, turnedBounds, turnBy, resizeCorner, resizeSide, inside as insideTurned } from '../world/turned.js';

/* ------------------------------------------------------------------ what */

const LAYERS = {
  walls: { label: 'Walls', rgb: [235, 64, 52], field: 'walk' },
  front: { label: 'Foreground', rgb: [64, 150, 255], field: 'front' },
  areas: { label: 'Areas', rgb: [165, 105, 245], field: 'zones' },
  items: { label: 'Items', rgb: [255, 196, 61] },
  doors: { label: 'Doors', rgb: [70, 220, 140] },
  pictures: { label: 'Pictures', rgb: [255, 136, 0] },
  paint: { label: 'Draw', rgb: [236, 72, 153] },
};
const PAINTED = ['walls', 'front', 'areas'];
/* Where a rectangle or circle is drawn as its outline; everywhere else it is
 * the place itself, solid. */
const OUTLINED = ['walls', 'front'];
const TOOLS = [
  ['hand', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v6"/><path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2l-3.3-4a1.5 1.5 0 0 1 2.2-2L8 14"/></svg>', 'Hand: move the map around (H)'], ['select', '➚', 'Select: tap anything drawn to move, resize or change it (V)'],
  ['brush', '✎', 'Brush (B)'], ['eraser', '⌫', 'Eraser: erases what you are drawing (E)'],
  ['line', '╱', 'Line: tap where it starts, tap where it ends (L)'], ['rect', '▢', 'Rectangle: drag (R)'],
  ['circle', '◯', 'Circle: drag (C)'], ['fill', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 11l7-7 8 8-7 7z"/><path d="M4 11h15"/><path d="M20 14c0 0 2 2.6 2 4a2 2 0 0 1-4 0c0-1.4 2-4 2-4z" fill="currentColor"/></svg>', 'Fill: tap inside lines to fill there (F)'],
  ['pick', '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4.5l5.5 5.5"/><path d="M16.5 2.6a2.2 2.2 0 0 1 3.1 3.1L16.6 8.7 15.3 7.4z"/><path d="M15.5 8.5l-9.5 9.5-3 1 1-3 9.5-9.5"/></svg>', 'Eyedropper: tap the map to take its colour (I)'],
];
/* PICTURES (2026-11-07) are a layer of their own: only there are they
 * chosen, moved and resized, so drawing walls over one never picks it up. A
 * picture is not drawn, so its layer has only the hand and Select. */
/* THE PAINTING LAYER (2026-11-08) has every drawing tool, and the
 * eyedropper, which only it has. */
const PAINT_TOOLS = ['hand', 'select', 'brush', 'eraser', 'line', 'rect', 'circle', 'fill', 'pick'];
const toolOk = (tool, layer) => (layer === 'pictures' ? ['hand', 'select'].includes(tool)
  : layer === 'paint' ? PAINT_TOOLS.includes(tool)
  : tool !== 'pick' && !(tool === 'fill' && !PAINTED.includes(layer)));

const S = {
  home: null, doc: null, rev: 0, dirty: false, version: 0, saving: false, sending: 0,
  mapId: null, layer: 'walls', tool: 'brush', size: 8, areaId: null,
  sel: null, card: null, view: { ox: 0, oy: 0, z: 1 }, drawing: null, drag: null,
  spaceDown: false, cursor: null, problems: [], message: null, walkBox: null,
  /* Painting: its colour, opacity, brush, edges, shapes and fill; what is
   * selected, copied and being put down; and whether it is hidden here. */
  paintColour: '#ffffff', paintAlpha: 1, paintSize: 6, paintHard: true, paintFilled: false, fillTolerance: 12,
  paintSel: null, clip: null, floating: null, paintDrag: null, hidePaint: false, paintBusy: 0, pickBack: null,
  recent: (() => { try { const r = JSON.parse(localStorage.getItem('glurff-editor-colours') ?? '[]'); return Array.isArray(r) ? r.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 10) : []; } catch { return []; } })(),
};
const history = new History();
const known = new Map();      //  hash -> {mime, size, w, h}
const pictures = new Map();   //  hash -> {img}
const pointers = new Map();   //  fingers and the mouse on the canvas
let body = null;              //  the sample character's frame
let notes = null;             //  this ship's notes, for areas that are one

const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return e;
}
const map = () => findMap(S.doc, S.mapId);
const mapIndex = () => S.doc.maps.findIndex((m) => m.id === S.mapId);
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
/* Every area is the areas' purple; where two meet, a darker line. */
const areaColour = (num, a = 1) => rgba(LAYERS.areas.rgb, a);

/* EVERY CHANGE goes through here: undo keeps what was, and the draft saves
 * itself a moment after the last one. */
function change(fn, { record = true } = {}) {
  if (record) history.record(S.doc);
  fn(S.doc, map());
  touched();
}
let saveTimer = null, checkTimer = null;
function touched() {
  S.version++; S.dirty = true;
  clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 2500);
  clearTimeout(checkTimer); checkTimer = setTimeout(() => { S.problems = validate(withAssets(S.doc, known)); renderTop(); }, 300);
  paint(); renderTop(); renderTools(); renderCard(); renderCta();
}

/* --------------------------------------------------------- doors, items */

/* A DOOR is somewhere people appear (an arrival) -- and, if it leads
 * anywhere, the way through it (an item of the same id). Its drawn shape is
 * kept on the arrival; people appear in the middle of it. */
const doorShape = (m, a) => a.shape ?? m.items.find((it) => it.id === a.id)?.shape ?? (() => {
  const s = characterHeight(m);
  return { t: 'rect', x: a.x - s / 3, y: a.y - s * 0.75, w: (s * 2) / 3, h: s };
})();
const wayOf = (m, id) => m.items.find((it) => it.id === id && ['portal', 'travel'].includes(it.do?.kind)) ?? null;
const isWay = (m, it) => m.arrivals.some((a) => a.id === it.id);
const isImage = (it) => !!it.image && it.do?.kind === 'none' && !it.shape;
const itemsOf = (m) => m.items.filter((it) => !isWay(m, it) && !isImage(it) && it.shape);
const imagesOf = (m) => m.items.filter(isImage);
const centre = (op) => { const b = bounds(op); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
function placeDoor(m, a, shape) {
  a.shape = tidyOp(shape);
  [a.x, a.y] = centre(shape).map(Math.round);
  const way = wayOf(m, a.id);
  if (way) way.shape = a.shape;
}
const allDoors = () => S.doc.maps.flatMap((m, i) => m.arrivals.map((a) => ({ id: a.id, name: a.name ?? a.id, map: m, index: i })));

/* ---------------------------------------------------------------- shell */

const root = $('#editor');
let canvas, ctx, stage;

async function boot() {
  const opening = el('div', {}, 'Opening the editor…');
  root.replaceChildren(el('div', { class: 'gate' }, opening));
  const t0 = Date.now(), tick = setInterval(() => {
    const s = secondsSince(t0);
    if (s >= SLOW_S) opening.textContent = `Opening the editor… Your ship has not answered for ${s} seconds; it may be busy, and usually catches up.`;
  }, 1000);
  let opened;
  try {
    opened = await host.openProject();
    /* EVERYBODY BUILDS (2026-11-10): opening the editor makes this ship a
     * host, editing on, with no Dojo -- and nothing anywhere else until it
     * is first published, when its note is made (`makeNote`). */
    if (!opened.home.hosting || !opened.home.edit) { await host.start(); opened = await host.openProject(); }
  }
  catch (e) { return gate('The editor could not open.', `${String(e.message ?? e).replace(/^./, (c) => c.toUpperCase())}.`, '', true); }
  finally { clearInterval(tick); }
  S.home = opened.home;
  if (!S.home.hosting || !S.home.edit) return gate('The editor could not open.', 'Your ship did not start your Glurff.', '', true);
  S.doc = opened.doc ?? blankWorld();
  S.rev = opened.rev;
  void loadNote(!opened.doc).then(() => { if (location.hash === '#glurff') glurffPanel(); });
  const older = givesMainAreas(S.doc), screens = screensBack(S.doc);
  for (const [hash, a] of Object.entries(S.doc.assets ?? {})) known.set(hash, a);
  savedTiles = tilesOf(S.doc);
  S.mapId = S.doc.maps[0]?.id ?? null;
  loadImage('/apps/glurff/characters/body.png').then((img) => { body = img; paint(); }, () => {});
  shell(); fit();
  S.problems = validate(withAssets(S.doc, known));
  renderAll();
  if (older) { touched(); say('Map 1 now has an area that is the world\'s chat: move it or grow it where you want it.'); }
  else if (screens) { touched(); say('A video screen had stayed where its item was first put; it is back on its item.'); }
  else if (!opened.doc) { touched(); say('A blank map in space. Add a map image, or draw on it as it is.'); }
  void introOnce();
}
/* THE FIRST TIME THE EDITOR OPENS (2026-11-08): how it works, in four
 * steps, once per ship -- remembered in our own settings, which keep keys
 * they do not know (lib/clocks normalize), so another browser does not show
 * it again. Settings that cannot be read show nothing: better than showing
 * it every time. ⋯ → How it works brings it back. */
async function introOnce() {
  let prefs = null;
  try { const r = await fetch('/~/scry/glurff/prefs.json', { credentials: 'include' }); if (r.ok) prefs = JSON.parse((await r.json()) || '{}'); } catch {}
  if (!prefs || typeof prefs !== 'object' || prefs.editorIntro) return;
  showIntro();
  poke('glurff', 'glurff-action', { op: 'prefs', text: JSON.stringify({ ...prefs, editorIntro: 1 }), peers: [] }).catch(() => {});
}
function showIntro() {
  const m = map(), blank = !!m && !m.image;
  const step = (n, title, words) => el('li', {}, el('strong', {}, title), ' ', words);
  const dlg = el('dialog', { class: 'intro' }, el('h3', {}, 'Making your Glurff'),
    el('ol', {},
      step(1, 'Your map starts as empty space.', 'Give it a map image: a picture of your place, seen from above. Or stay in space and build on the stars.'),
      step(2, 'Set how tall people are,', 'from the map\'s tab, so they fit the image.'),
      step(3, 'Draw on top of it:', 'walls where people cannot walk, foreground for what they walk behind, areas for rooms and their chats, doors, items and pictures.'),
      step(4, 'It saves as you go.', 'Playtest to walk it yourself, and Publish when it is ready. Nobody can visit until you do.')),
    el('details', {}, el('summary', {}, 'Where to get a map image'),
      el('p', { class: 'note' }, 'Any picture seen from above works, about 1,000 to 4,000 pixels across, with room for people around 40 to 60 pixels tall.'),
      el('p', { class: 'note' }, 'Draw one in any drawing or pixel-art app, make one with an AI image generator, or use a map or tileset you have the rights to.'),
      el('p', { class: 'note' }, 'Visitors download the image, so only use one you are allowed to share.')),
    el('div', { class: 'actions' },
      blank ? el('button', { onclick: () => { dlg.close(); stayInSpace(map()); } }, 'Stay in space for now') : null,
      blank ? el('button', { class: 'primary', onclick: () => { dlg.close(); changePicture(map()); } }, 'Add map image…')
        : el('button', { class: 'primary', onclick: () => dlg.close() }, 'Got it')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
/* A NEW GLURFF (2026-11-08): one map in space, ready to draw on -- where
 * people arrive, and the world's chat round it. Saved as its draft at once;
 * nobody can visit until it is published. */
function blankWorld() {
  const doc = emptyWorld(`${host.ourShip()}'s Glurff`), m = newMap(doc, { name: 'Map 1' });
  furnish(m, doc);
  doc.maps.push(m); doc.world.entry = m.spawn;
  return doc;
}
/* What a new map starts with: a door round where people arrive and, on the
 * world's first map, the world's chat. */
function furnish(m, doc = S.doc) {
  const a = m.arrivals[0], s = characterHeight(m), square = { t: 'rect', x: a.x - s, y: a.y - s, w: 2 * s, h: 2 * s };
  a.name = 'Arrival'; placeDoor(m, a, square);
  if (!worldChat(doc)) chatSquare(m, a, doc);
}
/* A world made before areas could be the world's chat gets one, on its first
 * map round where people arrive. */
function givesMainAreas(doc) {
  if (worldChat(doc) || !doc.maps.length) return false;
  const m = doc.maps[0], a = m.arrivals.find((x) => x.id === doc.world.entry) ?? m.arrivals[0];
  chatSquare(m, a ?? { x: m.size[0] / 2, y: m.size[1] / 2 }, doc);
  return true;
}
/* An area that is the world's chat: a square about a tenth of the map. */
function chatSquare(m, at, doc = S.doc) {
  const side = Math.round(Math.sqrt(m.size[0] * m.size[1] / 10));
  const x = Math.max(0, Math.min(m.size[0] - side, Math.round(at.x - side / 2))), y = Math.max(0, Math.min(m.size[1] - side, Math.round(at.y - side / 2)));
  const id = freshId('world-chat', idsOf(doc, 'areas'));
  m.areas.push({ id, num: 0, name: 'The world\'s chat', mode: 'world', call: 'huddle' });
  m.zones.push({ t: 'rect', x, y, w: Math.min(side, m.size[0]), h: Math.min(side, m.size[1]), a: id });
}

function gate(title, detail = '', code = '', again = false) {
  root.replaceChildren(el('div', { class: 'gate' }, el('div', {}, el('h2', {}, title), detail && el('p', {}, detail), code && el('p', {}, el('code', {}, code)),
    again && el('p', {}, el('button', { class: 'primary', onclick: () => boot() }, 'Try again')),
    el('p', {}, el('a', { href: '/apps/glurff/', onclick: (e) => { if (INSIDE) { e.preventDefault(); backToGlurff(); } } }, 'Back to Glurff')))));
}

/* INSIDE GLURFF, on its stage (ui/editor-stage): going back to Glurff closes
 * the editor, rather than opening a second Glurff inside it. On a page of its
 * own, it goes there. */
const INSIDE = (() => { try { return window.parent !== window && !!window.parent.__glurffEditor; } catch { return false; } })();
function backToGlurff(visit = false) {
  if (INSIDE) return window.parent.__glurffEditor.leave({ visit });
  location.href = visit ? `/apps/glurff/?w=${host.ourShip()}` : '/apps/glurff/';
}
/* BEFORE THE EDITOR GOES, for the stage's cross: the last change saved, and
 * what is on its way waited for. Nothing when closing loses nothing; else
 * what it would lose. */
async function flush() {
  const t0 = Date.now();
  while ((S.saving || S.sending || S.paintBusy) && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 250));
  if (S.sending) return 'A picture is still on its way to your ship. Close now and it is not added.';
  if (!S.dirty) return null;
  say('Saving before it closes…', false, true);
  if (await save()) { say(null); return null; }
  return 'Your last changes have not reached your ship yet. Close now and they are lost.';
}

function shell() {
  root.replaceChildren(
    el('header', { class: 'top' }),
    el('nav', { class: 'tools' }),
    stage = el('main', { class: 'stage' }, canvas = el('canvas'), el('div', { class: 'drawing' }), el('div', { class: 'image-cta' }), el('div', { class: 'floating' }),
      el('div', { class: 'zoom' }, el('button', { title: 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'),
        el('button', { title: 'Whole map', onclick: fit }, '⤢'), el('button', { title: 'Zoom in', onclick: () => zoomBy(1.25) }, '+'))));
  ctx = canvas.getContext('2d');
  new ResizeObserver(() => (S.fitted ? fit() : paint())).observe(stage);
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);
  canvas.addEventListener('pointerleave', () => { S.cursor = null; paint(); });
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', (e) => { held.delete(e.key.toLowerCase()); if (e.code === 'Space') { S.spaceDown = false; canvas.style.cursor = ''; } });
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('beforeunload', (e) => { if (S.dirty) { save(); e.preventDefault(); e.returnValue = ''; } });
}
function renderAll() { renderTop(); renderTools(); renderDrawing(); renderCard(); renderCta(); paint(); }

/* ADD MAP IMAGE, where it cannot be missed (2026-11-08): on a map with no
 * image and nothing built on it yet, a card in the middle of the stage; once
 * something is -- or "Stay in space" is chosen, for this map, on this
 * browser -- a button in the corner, out of the way. */
const spaceOk = (() => { try { return new Set(JSON.parse(localStorage.getItem('glurff-editor-space') ?? '[]')); } catch { return new Set(); } })();
function stayInSpace(m) {
  if (!m) return;
  spaceOk.add(m.id);
  try { localStorage.setItem('glurff-editor-space', JSON.stringify([...spaceOk].slice(-50))); } catch {}
  renderCta();
}
const builtOn = (m) => m.walk.length || m.front.length || itemsOf(m).length || imagesOf(m).length || m.areas.length > 1 || !!m.paint;
function renderCta() {
  const box = $('.image-cta'); if (!box) return;
  const m = map();
  if (!m || m.image) return box.replaceChildren();
  const add = () => changePicture(m);
  if (spaceOk.has(m.id) || builtOn(m)) return box.replaceChildren(el('button', { class: 'cta-small', title: 'Give this map a picture of your place, seen from above', onclick: add }, '🖼 Add map image'));
  box.replaceChildren(el('div', { class: 'cta-card' },
    el('strong', {}, 'This map is empty space'),
    el('p', { class: 'note' }, 'Give it a map image: a picture of your place, seen from above. Everything you draw stays where it is.'),
    el('div', { class: 'row' },
      el('button', { onclick: () => stayInSpace(m) }, 'Stay in space'),
      el('button', { class: 'primary', onclick: add }, 'Add map image…'))));
}

/* ------------------------------------------------------------ the top */

function renderTop() {
  const top = $('.top'); if (!top) return;
  const n = S.problems.length;
  top.replaceChildren(
    el('button', { class: 'glurff-id', title: 'This Glurff: its icon, its name and who can come in', onclick: () => glurffPanel() },
      glurffIcon('small'), el('span', { class: 'glurff-id-name' }, S.note?.name ?? 'This Glurff'), ' ▾'),
    el('div', { class: 'tabs' },
      S.doc.maps.map((m, i) => el('button', { class: m.id === S.mapId ? 'on' : '', title: m.name,
        onclick: (e) => (m.id === S.mapId ? mapMenu(e.currentTarget) : chooseMap(m.id)) }, `Map ${i + 1}`, m.id === S.mapId ? ' ▾' : '')),
      S.doc.maps.length < LIMITS.maps && el('button', { title: 'Add a map', onclick: (e) => addMenu(e.currentTarget) }, '+')),
    el('span', { class: 'grow' }),
    el('span', { class: `status ${S.message?.bad ? 'bad' : ''}` }, S.message?.text ?? (S.saving ? 'Saving…' : S.dirty ? 'Not saved yet' : S.rev ? 'Saved' : '')),
    el('button', { disabled: !S.doc.maps.length, onclick: playtest, title: 'Walk it yourself. Nobody sees you.' }, 'Playtest'),
    S.home?.live != null ? el('button', { onclick: unpublish, disabled: S.saving, title: 'Take it down: nobody can come in until you publish again' }, 'Unpublish') : '',
    el('button', { class: 'primary', disabled: !S.doc.maps.length || S.saving, onclick: publish,
      title: n ? 'Some things need fixing first' : 'Give it to visitors' }, n ? `Publish · ${n} to fix` : 'Publish'),
    el('button', { title: 'More', onclick: (e) => moreMenu(e.currentTarget) }, '⋯'));
}
/* A message on the top bar: news goes after a few seconds, a problem stays,
 * and so does what we are busy with until the next message. */
function say(text, bad = false, busy = false) { S.message = text ? { text, bad } : null; renderTop(); clearTimeout(say.t); if (text && !bad && !busy) say.t = setTimeout(() => say(null), 5000); }
/* WAITING ON OUR SHIP, said while we wait (2026-11-07): a busy ship can take
 * a while to answer, and "Sending…" alone looks stuck. The calls themselves
 * give up in the end (host-api WAIT). */
const SLOW_S = 8;
const secondsSince = (t0) => Math.round((Date.now() - t0) / 1000);
async function waiting(text, work) {
  const t0 = Date.now();
  const show = () => { const s = secondsSince(t0); say(s < SLOW_S ? text : `${text} Your ship has not answered for ${s} seconds; it may be busy.`, false, true); };
  show(); const tick = setInterval(show, 1000);
  try { return await work(); } finally { clearInterval(tick); }
}
/* Once the page has drawn: before work that holds it up, like reading a
 * big picture, so what it is doing shows first. */
const drawn = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* THIS GLURFF (2026-11-07): what belongs to the world's Noltbook note
 * rather than to its maps -- its icon, its name and who can come in. All
 * three are Noltbook's own settings for the note, so a change here is a
 * change there and the other way round, and each takes effect at once, not
 * on Publish. The document keeps a copy of the name (for a playtest and a
 * saved file), kept the same as the note's. A new world starts public. */
const ACCESS = {
  public: ['Public', 'Anybody can join.'],
  private: ['Private', 'People ask, and you or an admin let them in.'],
  secret: ['Secret', 'Only people you invite. Nobody else can see it.'],
};
/* For now every Glurff is public (2026-11-08): the others are shown, greyed,
 * "Feature unavailable" (2026-11-10). A world already private or secret can
 * still be made public. */
const ACCESS_SOON = new Set(['private', 'secret']);
const NAME_MAX = 64;
const noteMeta = async () => (await fetch(`/~/scry/noltbook/api/notes/${S.home.note}/meta.json`, { credentials: 'include' })).json();
/* NO NOTE YET (2026-11-10): until its first publish a Glurff is only its
 * draft -- its name is the draft's, its icon waits in this browser, and it
 * will be public. Publish makes its note with all three (`makeNote`). */
const ICON_KEY = 'glurff-editor-icon';
const hasNote = () => !!S.home?.note;
const pendingIcon = () => { try { return localStorage.getItem(ICON_KEY); } catch { return null; } };
async function loadNote(fresh = false) {
  if (!hasNote()) {
    S.note = { name: S.doc?.world.name ?? null, icon: pendingIcon() };
    S.access = 'public';
    return renderTop();
  }
  try {
    const m = await noteMeta();
    S.note = { name: m.name ?? null, icon: noteIconUrl(m, host.ourShip(), S.iconRev) };
    S.access = ACCESS[m.visibility] ? m.visibility : null;
  } catch { S.note = null; S.access = null; }
  const name = S.note?.name?.trim().slice(0, NAME_MAX);
  if (name && S.doc && S.doc.world.name !== name) change((d) => { d.world.name = name; }, { record: false });
  renderTop();
  if (fresh && S.access && S.access !== 'public') { await setAccess('public'); say('New Glurffs are public: anybody can join. Change it under This Glurff.'); }
}
/* What Noltbook was asked takes a moment to show in what it says. */
const settled = () => new Promise((r) => setTimeout(r, 600));
async function setAccess(v) {
  if (v === S.access) return;
  if (!hasNote()) { S.access = v; return renderTop(); }
  try {
    await poke('noltbook', 'noltbook-api', { action: 'set-note-config', data: { noteId: S.home.note, visibility: v } });
    /* Our agent tells everyone watching our card what they may see now. */
    await settled();
    await poke('glurff', 'glurff-action', { op: 'card-again', peers: [] });
    await loadNote();
    say(S.access === v ? `${ACCESS[v][0]}: ${ACCESS[v][1]}` : 'Not changed: Noltbook did not take it.', S.access !== v);
  } catch (e) { say(`Not changed: ${e.message}`, true); }
}
async function setName(value) {
  const name = value.trim().slice(0, NAME_MAX);
  if (!name || name === S.note?.name) return renderTop();
  if (!hasNote()) {
    change((d) => { d.world.name = name; });
    S.note = { ...S.note, name };
    renderTop();
    return say(`It is called ${name}. Its note in Noltbook is made with this name when you first publish.`);
  }
  try {
    await poke('noltbook', 'noltbook-api', { action: 'set-note-config', data: { noteId: S.home.note, name } });
    await settled();
    /* Everybody's card for our world shows its name. */
    await poke('glurff', 'glurff-action', { op: 'card-again', peers: [] });
    await loadNote();
    say(S.note?.name === name ? `It is called ${name} now, here and in Noltbook.` : 'Not renamed: Noltbook did not take it.', S.note?.name !== name);
  } catch (e) { say(`Not renamed: ${e.message}`, true); }
}
/* A new icon: the middle square of any picture, sent to Noltbook as its own
 * page sends one. */
async function changeIcon() {
  const file = await pickFile(); if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) return say('A JPEG, PNG or WebP picture, please.', true);
  try {
    say('Preparing the icon…', false, true); await drawn();
    const blob = await iconOf(file);
    if (!hasNote()) {
      const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
      try { localStorage.setItem(ICON_KEY, url); } catch { return say('The icon could not be kept in this browser.', true); }
      S.note = { ...S.note, icon: url }; renderTop();
      return say('Icon set. It goes to Noltbook with its note when you first publish.');
    }
    await waiting('Sending the icon to your ship…', async () => {
      const { r } = await host.reach(`/apps/noltbook/upload-icon/${encodeURIComponent(S.home.note)}`, { method: 'POST', body: blob }, host.WAIT.save);
      if (!r.ok) throw new Error(`Noltbook answered ${r.status}`);
    });
    S.iconRev = Date.now();
    await loadNote();
    say('Icon changed, here and in Noltbook.');
  } catch (e) { say(`The icon did not change: ${e.message}`, true); }
}
async function removeIcon() {
  if (!hasNote()) {
    try { localStorage.removeItem(ICON_KEY); } catch {}
    S.note = { ...S.note, icon: null }; renderTop();
    return say('Icon removed.');
  }
  try {
    await poke('noltbook', 'noltbook-api', { action: 'set-note-config', data: { noteId: S.home.note, iconUrl: '' } });
    await settled();
    await loadNote();
    say(S.note?.icon ? 'Not removed: Noltbook did not take it.' : 'Icon removed, here and in Noltbook.', !!S.note?.icon);
  } catch (e) { say(`Not removed: ${e.message}`, true); }
}
/* The icon, or the name's first letter where there is none. */
function glurffIcon(size) {
  const letter = el('i', { class: `glurff-icon ${size}` }, (S.note?.name ?? 'G').trim().replace(/^~/, '').charAt(0).toUpperCase());
  if (!S.note?.icon) return letter;
  const img = el('img', { class: `glurff-icon ${size}`, src: S.note.icon, alt: '' });
  img.addEventListener('error', () => img.replaceWith(letter));
  return img;
}
function glurffPanel() {
  const anchor = $('.glurff-id'); if (!anchor) return;
  popover(anchor, [
    el('h3', {}, 'This Glurff'),
    el('div', { class: 'glurff-icon-row' }, glurffIcon('big'),
      el('div', { class: 'glurff-icon-acts' },
        el('button', { onclick: () => { closePopover(); void changeIcon(); } }, S.note?.icon ? 'Change icon…' : 'Add an icon…'),
        S.note?.icon && el('button', { onclick: () => { closePopover(); void removeIcon(); } }, 'Remove'))),
    el('label', { class: 'field' }, el('span', {}, 'Name'),
      el('input', { value: S.note?.name ?? '', maxlength: NAME_MAX, onchange: (e) => void setName(e.target.value),
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } })),
    el('p', { class: 'note' }, 'Who can come in'),
    ...Object.entries(ACCESS).map(([v, [label, says]]) => el('button', { class: `access-choice ${S.access === v ? 'on' : ''}`,
      disabled: ACCESS_SOON.has(v), title: ACCESS_SOON.has(v) ? 'Feature unavailable' : null,
      onclick: () => { closePopover(); void setAccess(v); } },
      el('strong', {}, `${S.access === v ? '✓ ' : ''}${label}`, ACCESS_SOON.has(v) && el('span', { class: 'soon' }, 'Feature unavailable')), el('span', { class: 'note' }, says))),
    el('p', { class: 'note' }, hasNote() ? 'All of this takes effect now, not on Publish, and is the same as the world\'s note in Noltbook.'
      : 'Nothing of it is in Noltbook yet: its note is made, with this icon and name, when you first publish.'),
  ], 'glurff-panel');
}

/* A small menu under a button: rows of [label, action, class] or elements. */
function popover(anchor, rows, cls = '') {
  closePopover();
  const box = el('div', { class: `popover ${cls}` }, rows.filter(Boolean).map((r) => (r instanceof Node ? r : el('button', { onclick: () => { closePopover(); r[1](); }, class: r[2] ?? '' }, r[0]))));
  document.body.append(box);
  const a = anchor.getBoundingClientRect();
  box.style.top = `${Math.min(innerHeight - box.offsetHeight - 8, a.bottom + 6)}px`;
  box.style.left = `${Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, a.left))}px`;
  setTimeout(() => document.addEventListener('pointerdown', closeOutside, true));
}
function closeOutside(e) { if (!e.target.closest('.popover')) closePopover(); }
/* A field being typed in is finished first: an input taken away never says
 * it changed. */
function closePopover() {
  const box = document.querySelector('.popover');
  if (box?.contains(document.activeElement)) document.activeElement.blur();
  box?.remove(); document.removeEventListener('pointerdown', closeOutside, true);
}

function addMenu(anchor) {
  popover(anchor, [
    ['An empty map', addSpaceMap],
    ['A map from an image…', () => addMap()],
  ]);
}
function mapMenu(anchor) {
  const m = map(), height = characterHeight(m);
  const img = m.image && (known.get(m.image.src) ?? S.doc.assets?.[m.image.src]);
  const side = (i) => el('input', { type: 'number', min: MIN_SIDE, max: LIMITS.side, step: 1, value: m.size[i], 'aria-label': i ? 'Height' : 'Width',
    onchange: (e) => resize(m, i, e.target) });
  popover(anchor, [
    el('label', { class: 'field' }, el('span', {}, 'Name, shown to visitors'), el('input', { value: m.name, onchange: (e) => change(() => { m.name = e.target.value.trim() || `Map ${mapIndex() + 1}`; }) })),
    el('label', { class: 'field' }, el('span', {}, `How tall people are here: ${height} px`),
      el('input', { type: 'range', min: 6, max: Math.max(240, height), value: height,
        oninput: (e) => { e.target.previousSibling.textContent = `How tall people are here: ${e.target.value} px`; setScale(+e.target.value, !S.sliding); S.sliding = true; },
        onchange: () => { S.sliding = false; } })),
    el('p', { class: 'note' }, `Each door shows a person this size.${img ? ` Visitors download ${megabytes(img.size)}, about ${seconds(img.size)} s the first time.` : ''}`),
    !m.image && el('div', { class: 'field' }, el('span', {}, 'Its size, in pixels'), el('span', { class: 'size-row' }, side(0), ' × ', side(1))),
    m.image ? ['Change map image…', () => changePicture(m)] : ['Add map image…', () => changePicture(m)],
    m.image && ['Remove map image', () => removePicture(m)],
    m.paint && ['Clear the drawing', () => { change(() => { delete m.paint; }); say('Drawing cleared. Undo brings it back.'); }, 'danger'],
    ['Clear this map…', () => clearMap(m), 'danger'],
    S.doc.maps.length > 1 && ['Delete this map', deleteMap, 'danger'],
  ].filter(Boolean));
}
function moreMenu(anchor) {
  popover(anchor, [
    storageRow(),
    ['History: go back to an earlier version…', showHistory],
    ['Save the whole world as a file…', exportWorld],
    ['Open a world from a file…', () => importWorld()],
    ['Start over with a blank Glurff…', startOver, 'danger'],
    ['How it works', showIntro],
    ['Visit this Glurff', () => backToGlurff(true)],
  ]);
}
/* START OVER (2026-11-08): the draft becomes a blank Glurff -- one map in
 * space -- keeping its name. What visitors are given does not change until
 * the next Publish, and Undo brings the old draft back. */
function startOver() {
  if (!confirm('Start over with a blank Glurff? Every map in this draft goes. Visitors keep what you last published until you publish again, and Undo brings it all back.')) return;
  history.record(S.doc);
  const name = S.doc.world.name;
  S.doc = blankWorld(); S.doc.world.name = name;
  S.mapId = S.doc.maps[0].id; S.sel = null; S.card = null; S.areaId = null; S.drawing = null;
  touched(); fit(); renderAll();
  say('A blank map in space. Undo brings the old one back.');
}

/* ------------------------------------------------------------ toolbar */

function renderTools() {
  const nav = $('.tools'); if (!nav) return;
  if (!toolOk(S.tool, S.layer)) S.tool = S.layer === 'pictures' ? 'select' : 'brush';
  const pictures = S.layer === 'pictures';
  const button = ([t, icon, tip]) => {
    const b = el('button', { class: S.tool === t ? 'on' : '', title: tip, 'aria-label': tip, disabled: !toolOk(t, S.layer), onclick: () => setTool(t) });
    if (icon.startsWith('<svg')) b.innerHTML = icon; else b.textContent = icon;
    return b;
  };
  nav.replaceChildren(
    ...TOOLS.slice(0, 2).map(button),
    el('button', { title: 'Undo (⌘Z)', 'aria-label': 'Undo', disabled: !history.past.length, onclick: undo }, '↶'),
    el('button', { title: 'Redo (⇧⌘Z)', 'aria-label': 'Redo', disabled: !history.future.length, onclick: redo }, '↷'),
    el('hr'),
    ...(pictures ? [el('button', { title: 'Add a picture onto the map', 'aria-label': 'Add a picture', onclick: () => placeImage() }, '🖼')]
      : [...TOOLS.slice(2).filter(([t]) => t !== 'pick' || S.layer === 'paint').map(button),
        el('label', { class: 'size', title: 'How thick brushes, lines and outlines are' }, el('span', {}, S[sizeKey()]),
          el('input', { type: 'range', min: S.layer === 'paint' ? 1 : 2, max: 120, value: S[sizeKey()], 'aria-label': 'Size',
            oninput: (e) => { S[sizeKey()] = +e.target.value; e.target.previousSibling.textContent = e.target.value; paint(); } }))]));
}
/* The painting's brush is its own size, down to a single pixel. */
const sizeKey = () => (S.layer === 'paint' ? 'paintSize' : 'size');
const brushSize = () => S[sizeKey()];
/* Another tool lets go of what was selected. */
function setTool(t) {
  if (S.tool !== t && S.sel) { S.sel = null; S.card = null; renderCard(); }
  if (S.tool !== t) {
    finishStroke();
    if (t !== 'select') { placeFloating(); S.paintSel = null; }
    if (t === 'pick' && S.tool !== 'pick') S.pickBack = S.tool;
  }
  S.tool = t; if (S.drawing?.tool !== t) S.drawing = null; if (canvas) canvas.style.cursor = t === 'pick' ? 'crosshair' : ''; renderTools(); renderDrawing(); paint();
}

/* WHAT YOU ARE DRAWING. */
function renderDrawing() {
  const bar = $('.drawing'); if (!bar) return;
  if (!map()) return bar.replaceChildren();
  const area = map().areas.find((a) => a.id === S.areaId);
  bar.replaceChildren(el('span', { class: 'label' }, 'Drawing'),
    ...Object.entries(LAYERS).map(([k, l]) => el('button', { class: S.layer === k ? 'on' : '',
      onclick: (e) => (k === 'areas' && S.layer === 'areas' ? areaMenu(e.currentTarget) : setLayer(k)) },
      el('i', { style: `background:${k === 'areas' && area ? areaColour(area.num) : rgba(l.rgb, 1)}` }), l.label,
      k === 'areas' && S.layer === 'areas' ? `: ${area?.name ?? 'a new one'} ▾` : '')),
    ...(S.layer === 'paint' ? [paintBar()] : []));
}
function setLayer(k) {
  if (S.layer !== k) { finishStroke(); placeFloating(); S.paintSel = null; }
  S.layer = k; S.sel = null; S.card = null; S.drawing = null; renderTools(); renderDrawing(); renderCard(); paint();
  if (k === 'paint') say('Draw on the map: choose a colour above. The eraser takes away what is drawn, never the map image; Undo takes back a stroke.');
  if (k === 'pictures') say(imagesOf(map() ?? { items: [] }).length ? 'Tap a picture to move it. Its corners resize it in proportion, the dots on its sides stretch it and the round handle turns it.' : 'Add a picture with 🖼.');
}
function areaMenu(anchor) {
  const areas = [...map().areas].sort((x, y) => (y.mode === 'world') - (x.mode === 'world'));
  popover(anchor, [...areas.map((a) => [a.mode === 'world' ? `${a.name} (the world's chat)` : a.name, () => { S.areaId = a.id; renderDrawing(); }]),
    ['+ A new area', () => { S.areaId = null; renderDrawing(); say('A new area begins with what you draw next.'); }]]);
}

/* ------------------------------------------------------------- cards */

/* THE CARD of what is selected: what an area, an item or a door is; for a
 * wall, the foreground or a picture, only Delete. Beside it on a big screen,
 * a sheet along the bottom on a phone. */
function renderCard() {
  const box = $('.floating'); if (!box) return;
  const m = map(), sel = S.sel;
  if (S.walkBox && roamer()?.id !== S.walkBox) S.walkBox = null;
  if (S.walkBox) return box.replaceChildren(walkBoxBar(roamer()));
  if (!m || !sel || S.drag?.move || S.drag?.roaming) return box.replaceChildren();
  let kids = [];
  const row = (...k) => [el('div', { class: 'row' }, ...k)];
  const del = (words = 'Delete') => el('button', { class: 'danger', onclick: removeSelection }, words);
  if (sel.kind === 'op') { if (!m[LAYERS[sel.layer].field]?.[sel.index]) return box.replaceChildren(); kids = row(del()); }
  if (sel.kind === 'area') {
    const a = m.areas.find((x) => x.id === sel.id); if (!a) return box.replaceChildren();
    const last = a.mode === 'world' && S.doc.maps.flatMap((x) => x.areas).filter((x) => x.mode === 'world').length < 2;
    kids = S.card ? areaCard(a) : row(el('button', { onclick: () => { S.card = 'area'; renderCard(); } }, `${a.name}…`), !last && del());
  }
  if (sel.kind === 'image') {
    const it = m.items.find((x) => x.id === sel.id);
    kids = row(el('span', { class: 'note grow' }, 'Corners keep its shape; the side dots stretch it; the round handle turns it (Shift: in steps).'),
      it && normalTurn(it.image.turn) && el('button', { onclick: () => change(() => { const { turn, ...rest } = it.image; it.image = rest; }) }, 'Straighten'), del());
  }
  if (sel.kind === 'item') { const it = m.items.find((x) => x.id === sel.id); if (it) kids = S.card ? itemCard(it) : row(el('button', { onclick: () => { S.card = 'item'; renderCard(); } }, `${it.name}…`), del()); }
  if (sel.kind === 'door') { const a = m.arrivals.find((x) => x.id === sel.id); if (a) kids = S.card ? doorCard(a) : row(el('button', { onclick: () => { S.card = 'door'; renderCard(); } }, `${a.name ?? 'Door'}…`), S.doc.world.entry !== a.id && del()); }
  if (!kids.length) return box.replaceChildren();
  const card = el('div', { class: `card ${S.card ? 'open' : ''}` }, ...kids);
  box.replaceChildren(card);
  placeCard(card);
}
function placeCard(card) {
  if (innerWidth < 700) return;     //  a sheet, by the stylesheet
  let b = selectionBox(); if (!b) return;
  /* Clear of a picture's turn handle. */
  const st = selected();
  if (st?.turned) { const [hx, hy] = turnHandle(st.turned.at, st.turned.turn, (TURN_GAP + 12) / S.view.z); b = [Math.min(b[0], hx), Math.min(b[1], hy), Math.max(b[2], hx), Math.max(b[3], hy)]; }
  /* Beside an NPC's walking box, not over its corners. */
  const r = roamer()?.do.roam;
  if (r) b = [Math.min(b[0], r.x), Math.min(b[1], r.y), Math.max(b[2], r.x + r.w), Math.max(b[3], r.y + r.h)];
  const [x0, y0] = toScreen(b[0], b[1]), [x1, y1] = toScreen(b[2], b[3]);
  const w = card.offsetWidth || 300, h = card.offsetHeight || 60;
  let left = x1 + 14, top = y0;
  if (left + w > stage.clientWidth - 8) left = x0 - w - 14;
  if (left < 8) { left = Math.max(8, Math.min(stage.clientWidth - w - 8, x0)); top = y1 + 14; }
  card.style.left = `${left}px`; card.style.top = `${Math.max(56, Math.min(stage.clientHeight - h - 8, top))}px`;
}
const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
const doneButton = () => el('button', { class: 'primary', onclick: () => { S.card = null; renderCard(); } }, 'Done');
const heading = (words, colour) => el('h3', {}, el('i', { class: 'dot', style: `background:${colour}` }), words);

function areaCard(a) {
  const set = (fn) => change(() => { fn(a); });
  const chats = S.doc.maps.flatMap((m) => m.areas).filter((x) => x.mode === 'world');
  const lastChat = a.mode === 'world' && chats.length < 2;
  const kids = [heading('Area', areaColour(a.num)),
    field('Name', el('input', { value: a.name, onchange: (e) => set((x) => { x.name = e.target.value.trim() || 'Area'; }) })),
    field('Talking here', el('select', { disabled: lastChat, onchange: (e) => set((x) => {
      const was = x.mode; x.mode = e.target.value;
      if (x.mode === 'world') { x.num = 0; delete x.note; delete x.noteHost; delete x.lease; x.call = 'huddle'; return; }
      if (was === 'world') x.num = nextAreaNum(S.doc);
      if (x.mode === 'note') { delete x.call; x.lease = false; x.note ??= ''; } else { delete x.note; delete x.noteHost; x.call = x.mode === 'quiet' ? 'none' : x.call && x.call !== 'huddle' ? x.call : 'room'; }
    }) }, [['world', 'The world\'s chat: where Noltbook shows who is here'], ['room', 'Voice, video and text'], ['note', 'A Noltbook note: its chat, call and members'], ['quiet', 'Nothing: no chat or calls']].map(([v, l]) =>
      el('option', { value: v, selected: a.mode === v }, l)))),
    lastChat && el('p', { class: 'note' }, 'A Glurff needs at least one area that is the world\'s chat: this is the only one.')];
  if (a.mode === 'world') kids.push(field('Calls', el('select', { onchange: (e) => change((d) => { for (const m of d.maps) for (const x of m.areas) if (x.mode === 'world') x.call = e.target.value; }) },
    [['huddle', 'Proximity calls'], ['none', 'No calls']].map(([v, l]) => el('option', { value: v, selected: a.call === v }, l)))), el('p', { class: 'note' }, 'The same everywhere the world\'s chat is.'));
  if (a.mode === 'room') kids.push(field('Calls', el('select', { onchange: (e) => set((x) => { x.call = e.target.value; }) },
    [['room', 'One call for everyone here'], ['huddle', 'Proximity calls'], ['none', 'No calls']].map(([v, l]) => el('option', { value: v, selected: a.call === v }, l)))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!a.lease, onchange: (e) => set((x) => { x.lease = e.target.checked; }) }), 'Leasable: a visitor can make it their Noltbook note for a while'));
  if (a.mode === 'note') {
    if (!notes) loadNotes();
    const chosen = (notes ?? []).find((n) => n.id === a.note);
    kids.push(field('Which note', el('select', { onchange: (e) => set((x) => { const n = notes.find((y) => y.id === e.target.value); if (n) { x.note = n.id; x.noteHost = n.creator; } }) },
      el('option', { value: '' }, notes ? 'choose…' : 'loading…'),
      (notes ?? []).map((n) => el('option', { value: n.id, selected: n.id === a.note }, `${n.name} (${n.visibility ?? 'note'})`)))),
    el('p', { class: 'note' }, 'Its members, chat and call are the note\'s. Being in this Glurff does not let anybody in.'),
    chosen?.visibility === 'secret' && el('p', { class: 'note bad' }, 'A secret note: its id becomes visible to everybody who visits.'));
  }
  kids.push(soundField(a));
  kids.push(el('div', { class: 'row' }, !lastChat && el('button', { class: 'danger', onclick: () => deleteArea(a) }, 'Delete'), el('span', { class: 'grow' }), doneButton()));
  return kids;
}

/* AREA SOUND (2026-11-08): a loop that plays while people are in an area,
 * fetched by visitors once the map is showing, so it never holds it up. */
function soundField(a) {
  const s = a.sound, info = s && (known.get(s.src) ?? S.doc.assets?.[s.src]);
  const set = (fn) => change(() => { fn(a); });
  if (!s) return field('Sound', el('div', { class: 'row' }, el('span', { class: 'grow note' }, 'A loop while people are here: rain, a café, music.'),
    el('button', { onclick: () => addSound(a) }, 'Add sound…')));
  return el('div', { class: 'field' }, el('span', {}, `Sound${info ? ` (${megabytes(info.size)})` : ''}, and how loud`),
    el('div', { class: 'row' },
      el('button', { title: 'Hear it', onclick: (e) => hear(s, e.currentTarget) }, hearing?.src === s.src ? '■' : '▶'),
      el('input', { type: 'range', min: 0, max: 100, value: Math.round((s.volume ?? 0.6) * 100), class: 'grow', 'aria-label': 'How loud',
        onchange: (e) => set((x) => { x.sound = { ...x.sound, volume: +(e.target.value / 100).toFixed(2) }; }) })),
    el('div', { class: 'row' }, el('span', { class: 'grow' }),
      el('button', { onclick: () => addSound(a) }, 'Change…'),
      el('button', { class: 'danger', onclick: () => set((x) => { delete x.sound; }) }, 'Remove')));
}
/* What browsers call a sound's type, as a world keeps it. */
const AUDIO_TYPES = { 'audio/mpeg': 'audio/mpeg', 'audio/mp3': 'audio/mpeg', 'audio/ogg': 'audio/ogg', 'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/mp4', 'audio/m4a': 'audio/mp4', 'audio/webm': 'audio/webm' };
const AUDIO_ENDINGS = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', webm: 'audio/webm' };
async function addSound(a) {
  const file = await pickFile('audio/*,.mp3,.ogg,.m4a'); if (!file) return;
  const mime = AUDIO_TYPES[file.type] ?? AUDIO_ENDINGS[file.name.split('.').pop().toLowerCase()];
  if (!mime) return say('An MP3, OGG or M4A sound, please.', true);
  if (file.size > SOUND_MAX) return say(`That sound is ${megabytes(file.size)}; it can be up to ${megabytes(SOUND_MAX)}. A shorter loop, or a lower quality, fits.`, true);
  try {
    roomFor(file.size);
    const got = await waiting(`Sending the sound to your ship (${megabytes(file.size)})…`, async () => { S.sending++; try { return await host.putAsset(file, mime); } finally { S.sending--; } });
    known.set(got.hash, { mime: got.mime, size: got.size });
    change(() => { a.sound = { src: got.hash, volume: a.sound?.volume ?? 0.6 }; });
    say(`Sound added. Visitors fetch it (${megabytes(got.size)}, about ${seconds(got.size)} s) once the map is showing.`);
  } catch (e) { say(`The sound did not come in: ${e.message}`, true); }
}
let hearing = null;
function hear(s, button) {
  const was = hearing?.src;
  if (hearing) { hearing.audio.pause(); hearing = null; }
  if (was === s.src) { button.textContent = '▶'; return; }
  const audio = new Audio(host.assetUrl(s.src)); audio.volume = s.volume ?? 0.6; audio.loop = true;
  hearing = { src: s.src, audio };
  audio.play().catch(() => say('That sound would not play here.', true));
  button.textContent = '■';
}

const KIND_NAMES = { none: 'Nothing yet', web: 'Opens a website', app: 'Opens an app', text: 'Shows text', video: 'Video screen',
  npc: 'NPC: add a character', collect: 'Collectible' };
const defaultDo = (kind) => ({ web: { kind, url: 'https://' }, app: { kind, desk: '', publisher: 'HOST' }, artifact: { kind, note: '', artifact: '' },
  video: { kind }, text: { kind, text: '' }, links: { kind, links: [] }, npc: { kind, look: randomLook(), dir: 'down', lines: ['Hello!'], talk: '' },
  collect: { kind } }[kind] ?? { kind: 'none' });

/* A CHARACTER'S LOOK (2026-11-08): as somebody's own is chosen (ui/builder
 * randomise) -- different clothes, colours and hair, at random. */
const BARE = { gloves: 0.6, shoulders: 0.7, beard: 0.6, hat: 0.5 };
function randomLook(random = Math.random) {
  const look = { ...DEFAULT_LOOK };
  for (const slot of SLOTS) {
    const meta = CATALOG[slot], groups = [...groupsOf(slot).values()];
    if (!meta || !groups.length) continue;
    if (meta.optional && random() < (BARE[slot] ?? 0.5)) { look[slot] = { part: '', tint: null }; continue; }
    const options = groups[Math.floor(random() * groups.length)];
    look[slot] = { part: options[Math.floor(random() * options.length)].key, tint: null };
  }
  return completeLook(look);
}
/* The character's look, its facing, its wandering, what it says, and what
 * its choices do. */
function npcFields(it, d, set) {
  const look = el('canvas', { class: 'npc-look' });
  const draw = () => paintWearing(look, d.look ?? null, { scale: 5, width: 84, height: 84, pad: 4 }, draw);
  draw();
  const mine = INSIDE ? window.parent.__glurffEditor.look?.() : null;
  /* THE CHARACTER BUILDER (2026-11-08): the one people dress themselves
   * with, opened by Glurff around the editor, for this NPC. */
  const builder = INSIDE ? window.parent.__glurffEditor.editLook : null;
  const setLook = (lk) => set((x) => { x.do = { ...x.do, look: lk }; });
  return [el('div', { class: 'row npc-row' }, look, el('div', { class: 'grow npc-looks' },
      el('button', { class: 'primary', disabled: !builder, title: builder ? 'Choose its clothes, colours, or a ready-made character' : 'Open the editor from Glurff to choose its look',
        onclick: async () => { const lk = await builder(d.look ?? null); if (lk) setLook(completeLook(lk)); } }, 'Change look…'),
      el('button', { disabled: !mine, title: mine ? 'Dress it as your own character is now' : 'Open the editor from Glurff to copy your character',
        onclick: () => setLook(completeLook(mine)) }, 'Copy my character'),
      el('button', { onclick: () => setLook(randomLook()) }, 'Shuffle'),
      !builder && el('select', { 'aria-label': 'A ready-made character', onchange: (e) => e.target.value && setLook(completeLook({ premade: { part: e.target.value } })) },
        el('option', { value: '' }, 'Or a ready-made one…'),
        choicesOf('premade').map((c) => el('option', { value: c.key, selected: d.look?.premade?.part === c.key }, c.name))))),
    field('It faces', el('select', { onchange: (e) => set((x) => { x.do = { ...x.do, dir: e.target.value }; }) },
      ['down', 'up', 'left', 'right'].map((f) => el('option', { value: f, selected: (d.dir ?? 'down') === f }, f)))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!d.wander,
      onchange: (e) => {
        const on = e.target.checked;
        set((x) => {
          if (!on) { const { wander, roam, ...rest } = x.do; x.do = rest; return; }
          x.do = { ...x.do, wander: true, roam: x.do.roam ?? roamAround(map(), x) };
        });
        /* Ticked: straight on to where it walks. */
        if (on) walkBoxStart(it);
      } }), 'Walks around selected area'),
    d.wander && el('div', { class: 'row' }, el('span', { class: 'note grow' }, 'It walks about inside its box on the map, never through walls.'),
      el('button', { onclick: () => walkBoxStart(it) }, 'Set where it walks…')),
    field(`As people come near, it says one of these (a line each, up to ${NPC_MAX.lines})`, el('textarea', { rows: 3, value: (d.lines ?? []).join('\n'),
      onchange: (e) => set((x) => { x.do = { ...x.do, lines: e.target.value.split('\n').map((l) => l.trim().slice(0, NPC_MAX.line)).filter(Boolean).slice(0, NPC_MAX.lines) }; }) })),
    field('When tapped, it says', el('textarea', { rows: 3, maxlength: NPC_MAX.talk, value: d.talk ?? '',
      onchange: (e) => set((x) => { x.do = { ...x.do, talk: e.target.value }; }) })),
    choicesEditor(it, d)];
}
const CHOICE_KINDS = [['portal', 'takes them to a door'], ['web', 'opens a website'], ['app', 'opens an app'], ['text', 'shows some text'], ['travel', 'takes them to another Glurff']];
const choiceDo = (kind) => ({ portal: { kind, to: '' }, web: { kind, url: 'https://' }, app: { kind, desk: '', publisher: 'HOST' }, text: { kind, text: '' }, travel: { kind, host: '' } }[kind]);
function choicesEditor(it, d) {
  const choices = d.choices ?? [];
  const setChoice = (i, fn) => change(() => { const cs = structuredClone(it.do.choices ?? []); fn(cs[i]); it.do = { ...it.do, choices: cs }; });
  /* For the app picker, which sets what it is given: this choice as it is now. */
  const live = (i) => ({ get do() { return it.do.choices[i].do; }, set do(v) { it.do.choices[i].do = v; } });
  const box = el('div', { class: 'choices' }, el('span', { class: 'note' }, `Choices when tapped (up to ${NPC_MAX.choices})`));
  choices.forEach((c, i) => {
    const t = c.do ?? {};
    const target = t.kind === 'portal' ? el('select', { onchange: (e) => setChoice(i, (x) => { x.do = { ...x.do, to: e.target.value }; }) },
        el('option', { value: '' }, 'which door…'), allDoors().map((x) => el('option', { value: x.id, selected: x.id === t.to }, `Map ${x.index + 1}: ${x.name}`)))
      : t.kind === 'web' ? el('input', { value: t.url ?? '', placeholder: 'https://', onchange: (e) => setChoice(i, (x) => { x.do = { ...x.do, url: e.target.value.trim() }; }) })
      : t.kind === 'text' ? el('textarea', { rows: 2, value: t.text ?? '', onchange: (e) => setChoice(i, (x) => { x.do = { ...x.do, text: e.target.value }; }) })
      : t.kind === 'travel' ? el('div', { class: 'row' }, el('span', { class: 'grow' }, t.host ? `To ${t.host}'s Glurff` : 'Whose Glurff?'),
        el('button', { onclick: () => personPicker('Whose Glurff does it lead to?', (ship) => setChoice(i, (x) => { x.do = { ...x.do, host: ship }; })) }, t.host ? 'Change…' : 'Choose…'))
      : el('div', { class: 'row' }, el('span', { class: 'grow' }, t.desk ? `${t.title ?? t.desk}` : 'No app chosen yet.'),
        el('button', { onclick: () => appPicker(live(i)) }, t.desk ? 'Change…' : 'Choose…'));
    box.append(el('div', { class: 'choice' },
      el('div', { class: 'row' }, el('input', { value: c.label ?? '', maxlength: NPC_MAX.label, placeholder: 'Like "Take me to the library"',
        onchange: (e) => setChoice(i, (x) => { x.label = e.target.value.trim() || 'Go'; }) }),
        el('button', { title: 'Remove this choice', onclick: () => change(() => { it.do = { ...it.do, choices: choices.filter((_, j) => j !== i) }; }) }, '×')),
      el('div', { class: 'row' }, el('span', { class: 'note' }, 'It'), el('select', { class: 'grow', onchange: (e) => setChoice(i, (x) => { x.do = choiceDo(e.target.value); }) },
        CHOICE_KINDS.map(([k, l]) => el('option', { value: k, selected: t.kind === k }, l)))),
      target));
  });
  if (choices.length < NPC_MAX.choices) box.append(el('button', { onclick: () => change(() => { it.do = { ...it.do, choices: [...choices, { label: 'Take me somewhere', do: choiceDo('portal') }] }; }) }, '+ A choice'));
  return box;
}
/* A COLLECTIBLE (2026-11-08): its picture, what it says when found, and
 * whether it shows only close by. */
function collectFields(it, d, set) {
  return [el('div', { class: 'row' }, el('span', { class: 'grow note' }, d.picture ? 'Its picture shows inside its shape.' : 'No picture: a spot on the map.'),
      el('button', { onclick: () => collectPicture(it) }, d.picture ? 'Change picture…' : 'Add a picture…'),
      d.picture && el('button', { onclick: () => set((x) => { x.do = { ...x.do }; delete x.do.picture; }) }, 'Remove')),
    field('When found, it says', el('textarea', { rows: 3, maxlength: COLLECT_TEXT, value: d.text ?? '',
      onchange: (e) => set((x) => { x.do = { ...x.do, text: e.target.value }; if (!e.target.value.trim()) delete x.do.text; }) })),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!d.near,
      onchange: (e) => set((x) => { x.do = { ...x.do, near: e.target.checked }; if (!e.target.checked) delete x.do.near; }) }), 'Only shows up when people are close'),
    el('p', { class: 'note' }, 'Everybody can find it, once each. What they have found shows on their profile card.')];
}
async function collectPicture(it) {
  const file = await pickFile(); if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) return say('A JPEG, PNG or WebP image, please.', true);
  try {
    say('Preparing the picture…', false, true); await drawn();
    const p = await prepareItem(file);
    const img = await waiting(`Sending the picture to your ship (${megabytes(p.visitor.blob.size)})…`, () => keep(p.visitor));
    change(() => { it.do = { ...it.do, picture: img }; });
    say('Its picture shows inside its shape: resize the shape to resize it.');
  } catch (e) { say(`The image did not come in: ${e.message}`, true); }
}
function itemCard(it) {
  const d = it.do ?? { kind: 'none' };
  const set = (fn) => change(() => { fn(it); });
  const text = (label, k, attrs = {}) => field(label, el('input', { value: d[k] ?? '', ...attrs, onchange: (e) => set((x) => { x.do = { ...x.do, [k]: e.target.value.trim() }; }) }));
  const kids = [heading('Item', rgba(LAYERS.items.rgb, 1)),
    field('Name', el('input', { value: it.name, onchange: (e) => set((x) => { x.name = e.target.value.trim() || 'Item'; }) })),
    field('When tapped, it', el('select', { onchange: (e) => set((x) => { x.do = defaultDo(e.target.value); }) },
      Object.entries(KIND_NAMES).map(([k, l]) => el('option', { value: k, selected: d.kind === k }, l))))];
  if (d.kind === 'web') kids.push(text('Address', 'url', { placeholder: 'https://' }));
  if (d.kind === 'app') kids.push(el('div', { class: 'row' },
    el('span', { class: 'grow' }, d.desk ? `${d.title ?? d.desk} — from ${d.publisher === 'HOST' ? 'this ship' : d.publisher}` : 'No app chosen yet.'),
    el('button', { onclick: () => appPicker(it) }, d.desk ? 'Change…' : 'Choose…')));
  /* A SIGN (2026-11-07): what it says -- addresses in it can be clicked --
   * and whether anybody in the Glurff can write on it. Then this is only
   * where it starts: what people write is kept on this ship, and the sign in
   * Glurff has "Put back the original" for its host. */
  if (d.kind === 'text') kids.push(field(d.editable ? 'It starts out saying' : 'It says', el('textarea', { rows: 4, value: d.text ?? '', placeholder: d.editable ? 'Nothing: a blank sign to write on' : '',
      onchange: (e) => set((x) => { x.do = { ...x.do, text: e.target.value }; }) })),
    el('p', { class: 'note' }, 'Addresses in it can be clicked.'),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!d.editable,
      onchange: (e) => set((x) => { x.do = { ...x.do, editable: e.target.checked }; if (!e.target.checked) delete x.do.editable; }) }), 'Anybody in this Glurff can write on it'),
    d.editable && el('p', { class: 'note' }, 'What people write is kept on your ship, and stays when you publish again. From the sign in Glurff you can put it back.'),
    /* MADE INTO A SIGN (2026-11-08): its words on the map, inside its shape. */
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!d.sign,
      onchange: (e) => set((x) => { x.do = { ...x.do }; if (e.target.checked) x.do.sign = { size: 'medium', color: SIGN_COLOUR, plaque: true }; else delete x.do.sign; }) }), 'Make into sign'),
    el('p', { class: 'note' }, d.sign ? 'Its words show on the map, inside its shape. Tapping it still opens all of it.' : 'Show its words on the map, not only when it is tapped.'),
    d.sign && el('div', { class: 'row' },
      field('Words', el('select', { onchange: (e) => set((x) => { x.do = { ...x.do, sign: { ...x.do.sign, size: e.target.value } }; }) },
        Object.keys(SIGN_SIZES).map((k) => el('option', { value: k, selected: (d.sign.size ?? 'medium') === k }, k)))),
      field('Colour', el('input', { type: 'color', value: d.sign.color ?? SIGN_COLOUR, onchange: (e) => set((x) => { x.do = { ...x.do, sign: { ...x.do.sign, color: e.target.value } }; }) }))),
    d.sign && el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: d.sign.plaque !== false,
      onchange: (e) => set((x) => { x.do = { ...x.do, sign: { ...x.do.sign, plaque: e.target.checked } }; }) }), 'A plaque behind the words'));
  if (d.kind === 'video') {
    /* A shared screen plays here for everybody in an area -- the one it
     * stands in, unless another is chosen; a personal one is your own. */
    const rooms = map().areas.filter((a) => a.mode !== 'world');
    const b = bounds(it.shape), small = (b[2] - b[0]) < 3 * characterHeight(map());
    kids.push(field('Who watches together', el('select', { onchange: (e) => set((x) => {
      const bb = bounds(x.shape), v = e.target.value;
      if (v === 'personal') { x.do = { kind: 'video', trigger: x.do.trigger }; return; }
      x.do = { kind: 'video', screen: { x: bb[0], y: bb[1], w: bb[2] - bb[0], h: bb[3] - bb[1] }, trigger: x.do.trigger };
      if (v !== 'everyone') x.do.area = v;
    }) }, el('option', { value: 'everyone', selected: !!d.screen && !d.area }, 'Everyone in this Glurff'),
      rooms.map((a) => el('option', { value: a.id, selected: d.screen && d.area === a.id }, `Everyone in ${a.name}`)),
      el('option', { value: 'personal', selected: !d.screen }, 'No screen: each person plays their own (a jukebox)'))),
    el('p', { class: 'note' }, d.screen ? 'Whoever starts a video controls it; everyone it plays for sees the same thing, here on the map.'
      : 'Nothing shows on the map: tapping it opens a player of your own, for music or videos.'),
    d.screen && small && el('p', { class: 'note bad' }, `Small to watch: make it at least ${3 * characterHeight(map())} px wide (three people).`));
  }
  if (d.kind === 'npc') kids.push(...npcFields(it, d, set));
  if (d.kind === 'collect') kids.push(...collectFields(it, d, set));
  if (d.kind !== 'none' && d.kind !== 'npc') kids.push(field(d.kind === 'collect' ? 'It is found when people' : 'It opens when people', el('select', { onchange: (e) => set((x) => { x.do = { ...x.do, trigger: e.target.value }; if (e.target.value === 'click') delete x.do.trigger; }) },
    [['click', 'tap it'], ['walk', 'walk into it']].map(([v, l]) => el('option', { value: v, selected: (d.trigger ?? 'click') === v }, l)))));
  kids.push(el('div', { class: 'row' }, el('button', { class: 'danger', onclick: removeSelection }, 'Delete'), el('span', { class: 'grow' }), doneButton()));
  return kids;
}

function doorCard(a) {
  const m = map(), way = wayOf(m, a.id);
  const leads = way?.do.kind === 'travel' ? 'world' : way ? 'door' : 'none';
  const setWay = (fn) => change(() => {
    const it = wayOf(m, a.id) ?? (() => { const x = { id: a.id, name: a.name ?? 'Door', shape: doorShape(m, a), do: { kind: 'portal', to: '' } }; m.items.push(x); return x; })();
    fn(it);
  });
  const kids = [heading('Door', rgba(LAYERS.doors.rgb, 1)),
    field('Name', el('input', { value: a.name ?? '', onchange: (e) => change(() => { a.name = e.target.value.trim() || 'Door'; const w = wayOf(m, a.id); if (w) w.name = a.name; }) })),
    el('p', { class: 'note' }, 'People can appear here.'),
    field('It leads', el('select', { onchange: (e) => {
      const v = e.target.value;
      if (v === 'none') change(() => { m.items = m.items.filter((it) => !(it.id === a.id && isWay(m, it))); });
      else setWay((it) => { it.do = v === 'world' ? { kind: 'travel', host: '' } : { kind: 'portal', to: '', trigger: 'walk' }; });
    } }, [['none', 'nowhere: people only arrive here'], ['door', 'to another door on this Glurff'], ['world', 'to another Glurff']].map(([v, l]) => el('option', { value: v, selected: leads === v }, l))))];
  if (leads === 'door') kids.push(field('Which door', el('select', { onchange: (e) => setWay((it) => { it.do = { ...it.do, to: e.target.value }; }) },
    el('option', { value: '' }, 'choose…'), allDoors().filter((x) => x.id !== a.id).map((x) => el('option', { value: x.id, selected: x.id === way.do.to }, `Map ${x.index + 1}: ${x.name}`)))),
    field('People go through by', el('select', { onchange: (e) => setWay((it) => { it.do = { ...it.do, trigger: e.target.value }; }) },
      [['walk', 'walking into it'], ['click', 'tapping it']].map(([v, l]) => el('option', { value: v, selected: (way.do.trigger ?? 'click') === v }, l)))));
  if (leads === 'world') kids.push(el('div', { class: 'row' }, el('span', { class: 'grow' }, way.do.host ? `To ${way.do.host}'s Glurff (people tap the door)` : 'Whose Glurff?'),
    el('button', { onclick: () => personPicker('Whose Glurff does it lead to?', (ship) => setWay((it) => { it.do = { ...it.do, host: ship }; })) }, way.do.host ? 'Change…' : 'Choose…')));
  kids.push(field('People face', el('select', { onchange: (e) => change(() => { a.dir = e.target.value; }) }, ['down', 'up', 'left', 'right'].map((f) => el('option', { value: f, selected: (a.dir ?? 'down') === f }, f)))),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: S.doc.world.entry === a.id, disabled: S.doc.world.entry === a.id,
      onchange: () => change((d) => { d.world.entry = a.id; m.spawn = a.id; }) }), 'Visitors start here'),
    S.doc.world.entry === a.id ? el('p', { class: 'note' }, 'Where visitors start: it stays.') : '',
    el('div', { class: 'row' }, S.doc.world.entry !== a.id && el('button', { class: 'danger', onclick: removeSelection }, 'Delete'), el('span', { class: 'grow' }), doneButton()));
  return kids;
}

/* The area under a shape's middle, if any but the main one. */
function areaUnder(shape) {
  const m = map(), [x, y] = centre(shape), cols = Math.ceil(m.size[0] / m.grid);
  const n = compile(m, worldChat(S.doc)).zones[Math.floor(y / m.grid) * cols + Math.floor(x / m.grid)];
  return m.areas.find((a) => a.num === n && a.mode !== 'world')?.id ?? null;
}

/* CHOOSING AN APP: one installed on this ship, or one somebody publishes --
 * found by their Noltbook name or their @p. Seeing somebody's apps makes
 * them an "ally" of this ship's app store, as searching for them in
 * Landscape does. */
async function appPicker(it) {
  const pick = (app) => { change(() => { it.do = { ...it.do, kind: 'app', desk: app.desk, publisher: app.publisher, title: app.title }; }); dlg.close(); };
  const list = (apps, from) => (apps.length ? apps.map((a) => el('button', { class: 'app', onclick: () => pick({ ...a, publisher: from }) }, el('strong', {}, a.title || a.desk), el('span', { class: 'note' }, ` %${a.desk}`)))
    : [el('p', { class: 'note' }, 'No apps found.')]);
  const ours = el('div', { class: 'apps' }, el('p', { class: 'note' }, 'Loading…'));
  const theirs = el('div', { class: 'apps' });
  const search = el('input', { placeholder: 'Somebody else: their Noltbook name or ~ship', oninput: () => { clearTimeout(search.t); search.t = setTimeout(find, 250); } });
  const dlg = el('dialog', { class: 'picker' }, el('h3', {}, 'Choose an app'), el('p', { class: 'note' }, 'On this ship'), ours, field('', search), theirs,
    el('div', { class: 'actions' }, el('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  installedApps().then((apps) => ours.replaceChildren(...list(apps, 'HOST')), () => ours.replaceChildren(el('p', { class: 'note' }, 'Could not read this ship\'s apps.')));
  let people = null;
  async function find() {
    const q = search.value.trim().toLowerCase();
    if (!q) return theirs.replaceChildren();
    const ship = /^~?[a-z]{3}(-?[a-z]{3}){0,7}$/.test(q) ? `~${q.replace(/^~/, '')}` : null;
    people ??= await contacts();
    const hits = people.filter((c) => (c.name ?? '').toLowerCase().includes(q) || c.ship.includes(q)).slice(0, 8);
    if (ship && !hits.some((c) => c.ship === ship)) hits.unshift({ ship, name: null });
    theirs.replaceChildren(...hits.map((c) => el('button', { class: 'app', onclick: () => showApps(c) }, el('strong', {}, c.name || c.ship), c.name ? el('span', { class: 'note' }, ` ${c.ship}`) : '')),
      hits.length ? '' : el('p', { class: 'note' }, 'Nobody by that name among your contacts. Type their ~ship.'));
  }
  async function showApps(c) {
    theirs.replaceChildren(el('p', { class: 'note' }, `Asking ${c.name ?? c.ship}'s ship for its apps…`));
    try { theirs.replaceChildren(el('p', { class: 'note' }, `Apps from ${c.name ?? c.ship}`), ...list(await publishedApps(c.ship), c.ship)); }
    catch (e) { theirs.replaceChildren(el('p', { class: 'note bad' }, e.message)); }
  }
}
const scry = async (app, path) => { const r = await fetch(`/~/scry/${app}${path}.json`, { credentials: 'include' }); if (!r.ok) throw new Error(`${app} said ${r.status}`); return r.json(); };
async function installedApps() {
  const j = await scry('docket', '/charges'), all = j.initial ?? j;
  return Object.entries(all).map(([desk, c]) => ({ desk, title: c.title ?? desk })).sort((a, b) => a.title.localeCompare(b.title));
}
async function contacts() {
  try { return ((await scry('noltbook', '/api/contacts')).contacts ?? []).map((c) => ({ ship: c.ship, name: c.name ?? c.nickname ?? c.displayName ?? null })).filter((c) => c.ship); }
  catch { return []; }
}
async function publishedApps(ship) {
  const treaties = async () => { const j = await scry('treaty', `/treaties/${ship}`); return Object.values(j.ini ?? j).map((x) => ({ desk: x.desk, title: x.title ?? x.desk })); };
  let apps = await treaties().catch(() => []);
  if (apps.length) return apps;
  await poke('treaty', 'ally-update-0', { add: ship });
  for (let i = 0; i < 30 && !apps.length; i++) { await new Promise((r) => setTimeout(r, 700)); apps = await treaties().catch(() => []); }
  if (!apps.length) throw new Error(`${ship} publishes no apps, or did not answer.`);
  return apps;
}
/* CHOOSING SOMEBODY: by their Noltbook name, or their ~ship. */
function personPicker(title, chose) {
  const results = el('div', { class: 'apps' });
  let people = null;
  const search = el('input', { placeholder: 'Their Noltbook name or ~ship', oninput: () => { clearTimeout(search.t); search.t = setTimeout(find, 250); } });
  const dlg = el('dialog', { class: 'picker' }, el('h3', {}, title), field('', search), results, el('div', { class: 'actions' }, el('button', { onclick: () => dlg.close() }, 'Cancel')));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); search.focus();
  async function find() {
    const q = search.value.trim().toLowerCase();
    if (!q) return results.replaceChildren();
    const ship = /^~?[a-z]{3}(-?[a-z]{3}){0,7}$/.test(q) ? `~${q.replace(/^~/, '')}` : null;
    people ??= await contacts();
    const hits = people.filter((c) => (c.name ?? '').toLowerCase().includes(q) || c.ship.includes(q)).slice(0, 8);
    if (ship && !hits.some((c) => c.ship === ship)) hits.unshift({ ship, name: null });
    results.replaceChildren(...hits.map((c) => el('button', { class: 'app', onclick: () => { chose(c.ship); dlg.close(); } }, el('strong', {}, c.name || c.ship), c.name ? el('span', { class: 'note' }, ` ${c.ship}`) : '')),
      hits.length ? '' : el('p', { class: 'note' }, 'Nobody by that name among your contacts. Type their ~ship.'));
  }
}
/* A poke from this page, on a channel of its own, closed at once. */
async function poke(app, mark, json) {
  const url = `/~/channel/editor-${Date.now()}-${Math.random().toString(36).slice(2)}`, ship = host.ourShip().slice(1);
  const put = (body) => fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const r = await put([{ id: 1, action: 'poke', ship, app, mark, json }]);
  if (!r.ok) throw new Error(`the poke was refused (${r.status})`);
  put([{ id: 2, action: 'delete' }]).catch(() => {});
}

/* The notes this ship is in, from its own Noltbook. */
async function loadNotes() {
  if (loadNotes.asked) return; loadNotes.asked = true;
  try { notes = ((await (await fetch('/~/scry/noltbook/api/notes.json', { credentials: 'include' })).json()).notes ?? []).filter((n) => n.type !== 'gossip' && n.id && n.creator); }
  catch { notes = []; }
  renderCard();
}

/* --------------------------------------------------------------- canvas */

const dpr = () => window.devicePixelRatio || 1;
function fit() {
  const m = map(); if (!m || !stage) return;
  const w = stage.clientWidth, h = stage.clientHeight - 56;
  const z = Math.min(w / m.size[0], h / m.size[1]) * 0.95;
  S.view = { z, ox: m.size[0] / 2 - w / 2 / z, oy: m.size[1] / 2 - (h / 2 + 56) / z };
  S.fitted = true;
  paint(); renderCard();
}
function zoomBy(k, cx = stage.clientWidth / 2, cy = stage.clientHeight / 2) {
  const v = S.view, mx = v.ox + cx / v.z, my = v.oy + cy / v.z;
  v.z = Math.max(0.02, Math.min(32, v.z * k)); v.ox = mx - cx / v.z; v.oy = my - cy / v.z;
  S.fitted = false; paint(); renderCard();
}
const toMap = (e) => { const r = canvas.getBoundingClientRect(); return { x: S.view.ox + (e.clientX - r.left) / S.view.z, y: S.view.oy + (e.clientY - r.top) / S.view.z }; };
const toScreen = (x, y) => [(x - S.view.ox) * S.view.z, (y - S.view.oy) * S.view.z];
/* A picture as it is placed: turned about its middle when it is
 * (world/turned, 2026-11-10). */
function drawPlaced(g, pic, img) {
  const t = normalTurn(img.turn), [x, y, w, h] = img.at;
  if (!t) return g.drawImage(pic, x, y, w, h);
  g.save(); g.translate(x + w / 2, y + h / 2); g.rotate((t * Math.PI) / 180); g.drawImage(pic, -w / 2, -h / 2, w, h); g.restore();
}
function picture(hash) {
  let p = pictures.get(hash);
  if (!p) { p = { img: null }; pictures.set(hash, p); loadImage(host.assetUrl(hash)).then((img) => { p.img = img; paint(); }, () => {}); }
  return p.img;
}

/* A painted layer, one pixel a cell, coloured: made again only when the
 * document has changed. */
const overlays = new Map();
function overlay(m, layer) {
  const key = `${m.id}:${layer}`, have = overlays.get(key);
  if (have && have.version === S.version) return have.canvas;
  const cols = Math.ceil(m.size[0] / m.grid), rows = Math.ceil(m.size[1] / m.grid);
  const c = have?.canvas ?? document.createElement('canvas'); c.width = cols; c.height = rows;
  const g = c.getContext('2d'), data = g.createImageData(cols, rows), px = data.data;
  if (layer === 'areas') {
    const zones = compile(m, worldChat(S.doc)).zones, [r, g2, b] = LAYERS.areas.rgb;
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i]; if (z === QUIET) continue;
      const x = i % cols, right = x < cols - 1 ? zones[i + 1] : z, down = i + cols < zones.length ? zones[i + cols] : z;
      const edge = (right !== z && right !== QUIET) || (down !== z && down !== QUIET);
      px.set(edge ? [r * 0.45, g2 * 0.35, b * 0.6, 255] : [r, g2, b, 255], i * 4);
    }
  } else {
    const cells = rasterize(m[LAYERS[layer].field] ?? [], cols, rows, m.grid), [r, gg, b] = LAYERS[layer].rgb;
    for (let i = 0; i < cells.length; i++) if (cells[i]) px.set([r, gg, b, 255], i * 4);
  }
  g.putImageData(data, 0, 0);
  overlays.set(key, { canvas: c, version: S.version });
  return c;
}

let frame = 0;
function paint() { if (!frame) frame = requestAnimationFrame(draw); }
function draw() {
  frame = 0;
  if (!canvas) return;
  const w = stage.clientWidth, h = stage.clientHeight, k = dpr();
  if (canvas.width !== Math.round(w * k) || canvas.height !== Math.round(h * k)) { canvas.width = Math.round(w * k); canvas.height = Math.round(h * k); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const m = map(); if (!m) return emptyStage();
  const v = S.view, px = 1 / v.z;
  ctx.setTransform(k * v.z, 0, 0, k * v.z, -v.ox * k * v.z, -v.oy * k * v.z);
  ctx.imageSmoothingEnabled = v.z < 1;
  /* A map in space: space's own dark, and its edge as the game shows it. */
  ctx.fillStyle = m.image ? '#222' : '#05060a'; ctx.fillRect(0, 0, m.size[0], m.size[1]);
  if (m.image) { const bg = picture(m.image.src); if (bg) ctx.drawImage(bg, 0, 0, m.size[0], m.size[1]); }
  else { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5 * px; ctx.strokeRect(0, 0, m.size[0], m.size[1]); }
  const pb = syncPaint(m);
  if (pb && !S.hidePaint) {
    ctx.save(); ctx.scale(pb.size[0] / pb.w, pb.size[1] / pb.h);
    ctx.imageSmoothingEnabled = (v.z * pb.size[0]) / pb.w < 1;
    pb.draw(ctx); ctx.restore();
  }
  for (const it of m.items) if (it.image) { const p = picture(it.image.src); if (p) drawPlaced(ctx, p, it.image); }
  ctx.imageSmoothingEnabled = false;
  for (const layer of PAINTED) {
    ctx.globalAlpha = layer === S.layer ? 0.55 : S.layer === 'paint' ? 0.1 : 0.32;
    ctx.drawImage(overlay(m, layer), 0, 0, Math.ceil(m.size[0] / m.grid) * m.grid, Math.ceil(m.size[1] / m.grid) * m.grid);
  }
  ctx.globalAlpha = 1;
  labelAreas(m, px);
  for (const it of itemsOf(m)) { drawSign(m, it); drawCollect(it); drawNpc(m, it); shapeOutline(it.shape, rgba(LAYERS.items.rgb, 1), px, true); label(it.name, bounds(it.shape), px, rgba(LAYERS.items.rgb, 1)); }
  for (const a of m.arrivals) drawDoor(m, a, px);
  if (S.layer === 'pictures') for (const it of imagesOf(m)) shapeOutline(imageShape(it.image), rgba(LAYERS.pictures.rgb, 1), px);
  drawRoams(m, px);
  drawSelection(px);
  if (S.layer === 'paint') drawPaintSelection(m, px);
  drawPreview(px);
  if (S.cursor && ['brush', 'eraser', 'line', 'rect', 'circle'].includes(S.tool)) {
    ctx.strokeStyle = S.tool === 'eraser' ? '#fff' : S.layer === 'paint' ? S.paintColour : rgba(LAYERS[S.layer].rgb, 1); ctx.lineWidth = px;
    ctx.beginPath(); ctx.arc(S.cursor.x, S.cursor.y, Math.max(brushSize() / 2, px), 0, Math.PI * 2); ctx.stroke();
  }
}
/* A sign's words, as visitors will see them (world/sign-art): drawn again
 * only when they, its box or the zoom change. */
const signs = new Map();
fontsReady.then(() => { signs.clear(); paint(); });
function drawSign(m, it) {
  const sign = it.do?.kind === 'text' && it.do.sign; if (!sign) return;
  const b = bounds(it.shape), w = b[2] - b[0], h = b[3] - b[1], k = Math.min(4, Math.max(1, S.view.z * dpr()));
  const opts = { w, h, size: signFontSize(m, sign.size), colour: sign.color ?? SIGN_COLOUR, plaque: sign.plaque !== false };
  const key = JSON.stringify([it.do.text ?? '', opts, Math.round(k * 4)]);
  let c = signs.get(it.id);
  if (c?.key !== key) { c = { key, canvas: paintSign(it.do.text ?? '', opts, k) }; signs.set(it.id, c); }
  ctx.drawImage(c.canvas, b[0], b[1], w, h);
}
/* A collectible's picture inside its shape, in proportion, as in Glurff. */
function drawCollect(it) {
  const pic = it.do?.kind === 'collect' && it.do.picture; if (!pic) return;
  const img = picture(pic.src); if (!img) return;
  const b = bounds(it.shape), w = b[2] - b[0], h = b[3] - b[1], k = Math.min(w / pic.w, h / pic.h);
  ctx.drawImage(img, b[0] + (w - pic.w * k) / 2, b[1] + (h - pic.h * k) / 2, pic.w * k, pic.h * k);
}
/* A character where it stands, at the map's size for people. */
const npcArt = new Map();
function drawNpc(m, it) {
  if (it.do?.kind !== 'npc') return;
  const key = JSON.stringify(it.do.look ?? null);
  let art = npcArt.get(it.id);
  if (art?.key !== key) {
    const canvas = document.createElement('canvas'), look = it.do.look ?? null;
    art = { key, canvas }; npcArt.set(it.id, art);
    const draw = () => { paintWearing(canvas, look, { scale: 4, width: 128, height: 128, pad: 0 }, () => { draw(); paint(); }); };
    draw();
  }
  const [cx, cy] = centre(it.shape), side = 32 * m.character.scale, person = characterHeight(m);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(art.canvas, cx - side / 2, cy - person / 2 - side / 2, side, side);
}
function emptyStage() {
  ctx.setTransform(dpr(), 0, 0, dpr(), 0, 0);
  ctx.fillStyle = '#9aa1b5'; ctx.font = '15px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Add a map with +: an empty one, or one from an image.', stage.clientWidth / 2, stage.clientHeight / 2);
  ctx.textAlign = 'start';
}
function label(words, b, px, colour) {
  ctx.save(); ctx.font = `600 ${12 * px}px system-ui`; ctx.lineWidth = 3 * px; ctx.strokeStyle = '#000c'; ctx.fillStyle = colour;
  ctx.strokeText(words, b[0], b[1] - 4 * px); ctx.fillText(words, b[0], b[1] - 4 * px); ctx.restore();
}
function labelAreas(m, px) {
  const zones = compile(m, worldChat(S.doc)).zones, cols = Math.ceil(m.size[0] / m.grid), sums = new Map();
  for (let i = 0; i < zones.length; i++) if (zones[i] !== QUIET) { const s = sums.get(zones[i]) ?? [0, 0, 0]; s[0] += i % cols; s[1] += Math.floor(i / cols); s[2]++; sums.set(zones[i], s); }
  for (const a of m.areas) { const s = sums.get(a.num); if (s) label(a.name, [(s[0] / s[2]) * m.grid, (s[1] / s[2]) * m.grid + 8 * px], px, '#fff'); }
}
function path(op) {
  ctx.beginPath();
  if (op.t === 'rect') ctx.rect(op.x, op.y, op.w, op.h);
  else if (op.t === 'ellipse') ctx.ellipse(op.x, op.y, op.rx, op.ry, 0, 0, Math.PI * 2);
  else if (op.t === 'poly' || op.t === 'line') { ctx.moveTo(op.p[0], op.p[1]); for (let i = 2; i < op.p.length; i += 2) ctx.lineTo(op.p[i], op.p[i + 1]); if (op.t === 'poly') ctx.closePath(); }
  else { const b = bounds(op); ctx.rect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
}
function shapeOutline(op, colour, px, filled = false) {
  if (!op) return;
  ctx.save();
  if (op.t === 'line') { ctx.strokeStyle = colour; ctx.globalAlpha = 0.6; ctx.lineWidth = Math.max(op.r * 2, px); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; path(op); ctx.stroke(); }
  else { if (filled) { ctx.fillStyle = colour; ctx.globalAlpha = 0.2; path(op); ctx.fill(); ctx.globalAlpha = 1; } ctx.strokeStyle = colour; ctx.lineWidth = 2 * px; path(op); ctx.stroke(); }
  ctx.restore();
}
function drawDoor(m, a, px) {
  const shape = doorShape(m, a), way = wayOf(m, a.id), green = rgba(LAYERS.doors.rgb, 1);
  shapeOutline(shape, green, px, true);
  const s = m.character.scale;
  /* A person standing where people appear: a 32-pixel frame whose feet are
   * 20 pixels down (world/parts), at this map's size. */
  if (body) { ctx.imageSmoothingEnabled = false; ctx.drawImage(body, 0, 0, 32, 32, a.x - 16 * s, a.y - 20 * s, 32 * s, 32 * s); }
  const to = way?.do.kind === 'travel' ? ` → ${way.do.host || '?'}` : way ? ` → ${allDoors().find((x) => x.id === way.do.to)?.name ?? '?'}` : '';
  label(`${a.name ?? 'Door'}${to}${S.doc.world.entry === a.id ? ' ★' : ''}`, bounds(shape), px, green);
}

/* What is selected, its box, and the corners that resize it. */
function selected() {
  const m = map(), sel = S.sel; if (!m || !sel) return null;
  if (sel.kind === 'op') { const list = m[LAYERS[sel.layer].field]; const op = list?.[sel.index]; return op && { op, put: (o) => { list[sel.index] = tidyOp(o); } }; }
  if (sel.kind === 'item') {
    const it = m.items.find((x) => x.id === sel.id);
    return it && { op: it.shape, screen: it.do?.screen, roam: it.do?.roam, put: (o, d) => {
      it.shape = tidyOp(o);
      if (d?.screen) it.do.screen = carried(d.screen, bounds(d.op), bounds(it.shape));
      /* An NPC's walking box goes along with it. */
      if (d?.roam && it.do.roam) { const [ax, ay] = centre(d.op), [bx, by] = centre(it.shape); it.do.roam = { ...d.roam, x: Math.round(d.roam.x + bx - ax), y: Math.round(d.roam.y + by - ay) }; }
    } };
  }
  if (sel.kind === 'image') {
    const it = m.items.find((x) => x.id === sel.id);
    return it && { op: { t: 'rect', x: it.image.at[0], y: it.image.at[1], w: it.image.at[2], h: it.image.at[3] }, keepShape: true,
      turned: { at: it.image.at, turn: normalTurn(it.image.turn) },
      put: (o) => { it.image = { ...it.image, at: [o.x, o.y, Math.max(1, o.w), Math.max(1, o.h)].map(Math.round) }; },
      /* Resized or turned: straight again is no turn at all. */
      place: (at, turn) => { const { turn: was, ...rest } = it.image, t = normalTurn(turn); it.image = { ...rest, at: at.map(Math.round), ...(t ? { turn: t } : {}) }; } };
  }
  if (sel.kind === 'door') { const a = m.arrivals.find((x) => x.id === sel.id); return a && { op: doorShape(m, a), put: (o) => placeDoor(m, a, o) }; }
  if (sel.kind === 'area') {
    /* AN AREA IS EVERYTHING DRAWN FOR IT: chosen, moved and resized whole. */
    const ops = m.zones.filter((op) => op.a === sel.id); if (!ops.length) return null;
    const bs = ops.map(bounds), b = [Math.min(...bs.map((x) => x[0])), Math.min(...bs.map((x) => x[1])), Math.max(...bs.map((x) => x[2])), Math.max(...bs.map((x) => x[3]))];
    return { op: { t: 'rect', x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] }, area: true, ops };
  }
  return null;
}
const canResize = (s) => !!s?.op && (s.area ? s.ops.every(resizable) : resizable(s.op));
const selectionBox = () => { const s = selected(); return s?.turned ? turnedBounds(s.turned.at, s.turned.turn) : s?.op ? bounds(s.op) : null; };
const corners = (b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
/* A PICTURE'S HANDLES (2026-11-07): its corners resize it keeping its shape;
 * a dot in the middle of each side -- top, right, bottom, left -- moves that
 * side alone, stretching it. */
const sides = (b) => [[(b[0] + b[2]) / 2, b[1]], [b[2], (b[1] + b[3]) / 2], [(b[0] + b[2]) / 2, b[3]], [b[0], (b[1] + b[3]) / 2]];
function handleAt(p) {
  const s = selected(); if (!canResize(s)) return null;
  if (s.turned) { const h = turnedHandleAt(s.turned, p); return h && { ...h, s }; }
  const b = bounds(s.op), px = 1 / S.view.z, near = ([x, y]) => Math.abs(x - p.x) <= 12 * px && Math.abs(y - p.y) <= 12 * px;
  const corner = corners(b).findIndex(near); if (corner >= 0) return { corner, box: b, s };
  const side = s.keepShape ? sides(b).findIndex(near) : -1; if (side >= 0) return { side, box: b, s };
  return null;
}
const HANDLE_CURSORS = { corner: ['nwse-resize', 'nesw-resize', 'nwse-resize', 'nesw-resize'], side: ['ns-resize', 'ew-resize', 'ns-resize', 'ew-resize'] };
const handleCursor = (h) => (h.turning ? 'grab' : h.corner != null ? HANDLE_CURSORS.corner[h.corner] : HANDLE_CURSORS.side[h.side]);
/* A TURNED BOX'S HANDLES (2026-11-10), a picture's or a piece of drawing
 * being put down: the round one out past its top right corner turns it
 * about its middle; its corners resize it in proportion and the dots on its
 * sides stretch it, as a straight one's do. */
const TURN_GAP = 22;      //  screen pixels from its corner to the turn handle
function turnedHandleAt({ at, turn }, p, px = 1 / S.view.z) {
  const near = ([x, y]) => Math.abs(x - p.x) <= 12 * px && Math.abs(y - p.y) <= 12 * px;
  if (near(turnHandle(at, turn, TURN_GAP * px))) return { turning: true };
  const corner = turnedCorners(at, turn).findIndex(near); if (corner >= 0) return { corner };
  const side = turnedSides(at, turn).findIndex(near); if (side >= 0) return { side };
  return null;
}
function drawTurnedHandles({ at, turn }, px) {
  const cs = turnedCorners(at, turn), [hx, hy] = turnHandle(at, turn, TURN_GAP * px);
  ctx.save();
  ctx.beginPath(); cs.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
  ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 5 * px; ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(cs[1][0], cs[1][1]); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.lineWidth = px; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000';
  for (const [x, y] of cs) { ctx.fillRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); ctx.strokeRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); }
  for (const [x, y] of turnedSides(at, turn)) { ctx.beginPath(); ctx.arc(x, y, 5 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  /* The turn handle: a disc with an arrow going round. */
  ctx.beginPath(); ctx.arc(hx, hy, 9 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const a = Math.PI * 0.55, r = 4.5 * px, ex = hx + r * Math.cos(a), ey = hy + r * Math.sin(a);
  ctx.beginPath(); ctx.arc(hx, hy, r, -Math.PI * 0.95, a); ctx.lineWidth = 1.6 * px; ctx.stroke();
  ctx.beginPath(); ctx.fillStyle = '#000';
  ctx.moveTo(ex - Math.sin(a) * 3 * px, ey + Math.cos(a) * 3 * px);
  ctx.lineTo(ex + Math.cos(a) * 2.6 * px, ey + Math.sin(a) * 2.6 * px);
  ctx.lineTo(ex - Math.cos(a) * 2.6 * px, ey - Math.sin(a) * 2.6 * px);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}
const resizable = (op) => op && (op.t === 'group' ? op.p.every(resizable) : !['bits', 'runs'].includes(op.t));
function drawSelection(px) {
  if (S.walkBox) return;
  const st = selected(); if (st?.turned) return drawTurnedHandles(st.turned, px);
  const b = selectionBox(); if (!b) return;
  ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
  ctx.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); ctx.setLineDash([]);
  const s = selected();
  if (canResize(s)) for (const [x, y] of corners(b)) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.fillRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); ctx.strokeRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); }
  if (canResize(s) && s.keepShape) for (const [x, y] of sides(b)) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, 5 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

/* ------------------------------------------------------- drawing shapes */

/* A shape being drawn, as the operation it will be: on Walls, Foreground and
 * Areas a rectangle or circle is its outline at the brush's size -- fill it
 * to make it solid; for an item or a door, the shape is the place itself. */
function shapeOf(d) {
  if (!d) return null;
  const a = d.start, b = d.cur ?? d.start, r = brushSize() / 2;
  const outline = S.layer === 'paint' ? !S.paintFilled : OUTLINED.includes(S.layer);
  if (d.tool === 'rect') {
    const o = { t: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    return outline ? { t: 'line', r, p: [o.x, o.y, o.x + o.w, o.y, o.x + o.w, o.y + o.h, o.x, o.y + o.h, o.x, o.y] } : o;
  }
  if (d.tool === 'circle') {
    const o = { t: 'ellipse', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 };
    if (!outline) return o;
    const around = Math.PI * (3 * (o.rx + o.ry) - Math.sqrt((3 * o.rx + o.ry) * (o.rx + 3 * o.ry)));
    const n = Math.max(24, Math.min(240, Math.round(around / Math.max(2, r))));
    const p = []; for (let i = 0; i <= n; i++) { const t = (i / n) * Math.PI * 2; p.push(o.x + o.rx * Math.cos(t), o.y + o.ry * Math.sin(t)); }
    return { t: 'line', r, p };
  }
  if (d.tool === 'line') return { t: 'line', r, p: [a.x, a.y, b.x, b.y] };
  if (d.tool === 'brush' || d.tool === 'eraser') return { t: 'line', r, p: d.pts };
  return null;
}
function drawPreview(px) {
  if (S.drawing?.painting) return;
  const d = S.drawing, op = shapeOf(d); if (!op) return;
  const colour = d.tool === 'eraser' ? 'rgba(255,255,255,.85)' : S.layer === 'paint' ? S.paintColour : S.layer === 'areas' ? areaColour(map().areas.find((a) => a.id === S.areaId)?.num ?? nextAreaNum(S.doc) ?? 1) : rgba(LAYERS[S.layer].rgb, 1);
  ctx.save(); ctx.globalAlpha = S.layer === 'paint' ? S.paintAlpha : 0.6;
  if (op.t === 'line') { ctx.strokeStyle = colour; ctx.lineWidth = Math.max(op.r * 2, px); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; path(op); ctx.stroke(); }
  else { ctx.fillStyle = colour; path(op); ctx.fill(); }
  ctx.restore();
}

/* WHERE AN NPC WALKS (2026-11-08): a box on the map, `do.roam`, holding its
 * middle -- dashed on the Items layer, with corners to resize it and an edge
 * to move it while the NPC is selected. */
function roamAround(m, it) {
  const [cx, cy] = centre(it.shape), r = 4 * characterHeight(m);
  const x0 = Math.max(0, cx - r), y0 = Math.max(0, cy - r), x1 = Math.min(m.size[0], cx + r), y1 = Math.min(m.size[1], cy + r);
  return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}
const roamBox = (r) => [r.x, r.y, r.x + r.w, r.y + r.h];
function roamer() {
  const it = S.sel?.kind === 'item' && map()?.items.find((x) => x.id === S.sel.id);
  return it?.do?.kind === 'npc' && it.do.wander && it.do.roam ? it : null;
}
function roamHandleAt(p) {
  const it = roamer(); if (!it) return null;
  const b = roamBox(it.do.roam), near = 12 / S.view.z;
  const corner = corners(b).findIndex(([x, y]) => Math.abs(x - p.x) <= near && Math.abs(y - p.y) <= near);
  if (corner >= 0) return { corner };
  const onEdge = (p.x >= b[0] - near && p.x <= b[2] + near && p.y >= b[1] - near && p.y <= b[3] + near) &&
    (Math.abs(p.x - b[0]) <= near / 2 || Math.abs(p.x - b[2]) <= near / 2 || Math.abs(p.y - b[1]) <= near / 2 || Math.abs(p.y - b[3]) <= near / 2);
  return onEdge ? { corner: null } : null;
}
function dragRoam(p) {
  const d = S.drag, it = roamer(); if (!it) return;
  const m = map(), [cx, cy] = centre(it.shape), least = characterHeight(m);
  if (!d.moved && Math.hypot(p.x - d.from.x, p.y - d.from.y) * S.view.z < 3) return;
  if (!d.moved) { d.moved = true; if (d.lazy) history.record(S.doc); if (!S.walkBox) $('.floating').replaceChildren(); }
  let nb;
  if (d.fresh) nb = [Math.min(d.from.x, p.x), Math.min(d.from.y, p.y), Math.max(d.from.x, p.x), Math.max(d.from.y, p.y)];
  else if (d.corner != null) { const [ax, ay] = corners(d.box)[(d.corner + 2) % 4]; nb = [Math.min(ax, p.x), Math.min(ay, p.y), Math.max(ax, p.x), Math.max(ay, p.y)]; }
  else {
    /* Moved, it keeps its size: as far as it can go still taking in the
     * NPC's middle, and on the map. */
    const [x0, y0, x1, y1] = d.box;
    const dx = Math.min(Math.max(p.x - d.from.x, cx + least / 2 - x1, -x0), cx - least / 2 - x0, m.size[0] - x1);
    const dy = Math.min(Math.max(p.y - d.from.y, cy + least / 2 - y1, -y0), cy - least / 2 - y0, m.size[1] - y1);
    nb = [x0 + dx, y0 + dy, x1 + dx, y1 + dy];
  }
  /* It holds the NPC's middle, is at least a person across, and is on the map. */
  nb = [Math.max(0, Math.min(nb[0], cx - least / 2)), Math.max(0, Math.min(nb[1], cy - least / 2)),
    Math.min(m.size[0], Math.max(nb[2], cx + least / 2)), Math.min(m.size[1], Math.max(nb[3], cy + least / 2))];
  it.do.roam = { x: Math.round(nb[0]), y: Math.round(nb[1]), w: Math.round(nb[2] - nb[0]), h: Math.round(nb[3] - nb[1]) };
  S.version++; S.dirty = true; paint();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 2500);
}
function drawRoams(m, px) {
  for (const it of itemsOf(m)) {
    if (it.do?.kind !== 'npc' || !it.do.wander || !it.do.roam) continue;
    const on = roamer() === it;
    if (!on && S.layer !== 'items') continue;
    const [x0, y0, x1, y1] = roamBox(it.do.roam);
    /* While it is being set, the rest of the map steps back. */
    if (on && S.walkBox) { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.rect(0, 0, m.size[0], m.size[1]); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.fill('evenodd'); ctx.restore(); }
    ctx.save(); ctx.globalAlpha = on ? 1 : 0.45; ctx.strokeStyle = rgba(LAYERS.items.rgb, 1); ctx.lineWidth = (on ? 2 : 1.5) * px;
    ctx.setLineDash([8 * px, 6 * px]); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.setLineDash([]);
    if (on) {
      for (const [x, y] of corners([x0, y0, x1, y1])) { ctx.fillStyle = rgba(LAYERS.items.rgb, 1); ctx.strokeStyle = '#000'; ctx.lineWidth = px; ctx.fillRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); ctx.strokeRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px); }
      label(`${it.name} walks here`, [x0, y0, x1, y1], px, rgba(LAYERS.items.rgb, 1));
    }
    ctx.restore();
  }
}

/* SETTING WHERE AN NPC WALKS (2026-11-10): the map given over to its box
 * alone -- drag anywhere for a new one, a corner to resize it, inside it to
 * move it -- with nothing else to select and no card in the way. Done, or
 * Escape, brings its card back. */
function walkBoxStart(it) {
  if (!it.do?.roam) change(() => { it.do = { ...it.do, wander: true, roam: roamAround(map(), it) }; });
  S.walkBox = it.id; S.card = null; S.drawing = null;
  renderCard(); paint();
}
function walkBoxDone() {
  S.walkBox = null; S.card = S.sel?.kind === 'item' ? 'item' : null;
  if (canvas) canvas.style.cursor = '';
  renderCard(); paint();
}
function walkBoxDown(p) {
  const it = roamer(); if (!it) return walkBoxDone();
  const b = roamBox(it.do.roam), r = roamHandleAt(p), within = p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3];
  S.drag = { roaming: true, lazy: true, from: p, box: b, corner: r?.corner ?? null, fresh: !r && !within };
}
const walkBoxBar = (it) => el('div', { class: 'card walkbox' }, el('div', { class: 'row' },
  el('span', { class: 'note grow' }, `Drag out the box ${it.name} walks in, a corner to resize it, or inside it to move it. It always takes in where ${it.name} stands.`),
  el('button', { class: 'primary', onclick: walkBoxDone }, 'Done')));

/* -------------------------------------------------------------- pointer */

function pointerDown(e) {
  if (!map()) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  closePopover();
  if (pointers.size === 2) { finishStroke(); S.drawing = null; S.paintDrag = null; S.drag = pinchStart(); paint(); return; }
  const p = toMap(e);
  if (S.spaceDown || S.tool === 'hand' || e.button === 1) { S.drag = { pan: true, x: e.clientX, y: e.clientY, ox: S.view.ox, oy: S.view.oy }; return; }
  if (e.button > 0) return;
  if (S.walkBox) return walkBoxDown(p);
  if (S.layer === 'paint' && paintDown(e, p)) return;
  if (S.tool === 'select') return selectAt(p);
  if (S.tool === 'fill') return fillAt(p);
  if (S.tool === 'line') {
    /* Two taps: where it starts, where it ends. Dragging from one end to the
     * other does the same. */
    if (S.drawing?.tool === 'line' && S.drawing.waiting) { S.drawing.cur = p; S.drawing.second = true; return; }
    S.drawing = { tool: 'line', start: p, cur: p, at: { x: e.clientX, y: e.clientY } };
    return paint();
  }
  if (S.tool === 'eraser' && !PAINTED.includes(S.layer)) { S.drawing = { tool: 'eraser', start: p, pts: [p.x, p.y], things: true }; eraseThingsAt(p); return; }
  if (S.tool === 'brush' || S.tool === 'eraser') S.drawing = { tool: S.tool, start: p, pts: [p.x, p.y] };
  else S.drawing = { tool: S.tool, start: p, cur: p };
  paint();
}
function pointerMove(e) {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const p = toMap(e); S.cursor = e.pointerType === 'mouse' ? p : null;
  const d = S.drag;
  if (d?.pinch) return pinchMove();
  if (d?.pan) { S.view.ox = d.ox - (e.clientX - d.x) / S.view.z; S.view.oy = d.oy - (e.clientY - d.y) / S.view.z; S.fitted = false; paint(); renderCard(); return; }
  if (d?.roaming) return dragRoam(p);
  if (d?.move) return dragSelection(p, e);
  if ((S.tool === 'select' || S.walkBox) && e.pointerType === 'mouse' && !S.spaceDown) canvas.style.cursor = cursorAt(p);
  if (S.paintDrag) { dragFloating(p, e); return paint(); }
  if (S.drawing?.painting) { if (pointers.has(e.pointerId)) paintMove(p); return paint(); }
  const dr = S.drawing;
  if (dr && (pointers.has(e.pointerId) || dr.waiting)) {
    dr.cur = p;
    if (dr.things) eraseThingsAt(p);
    else if ((dr.tool === 'brush' || dr.tool === 'eraser') && pointers.has(e.pointerId)) {
      const n = dr.pts.length; if (Math.hypot(p.x - dr.pts[n - 2], p.y - dr.pts[n - 1]) >= Math.max(1, S.size / 4)) dr.pts.push(p.x, p.y);
    }
  }
  paint();
}
/* What the pointer would take hold of, as its cursor shows. */
function cursorAt(p) {
  if (S.walkBox) {
    const r = roamHandleAt(p), b = roamer() && roamBox(roamer().do.roam);
    return r?.corner != null ? HANDLE_CURSORS.corner[r.corner] : r || (b && p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3]) ? 'move' : 'crosshair';
  }
  const f = S.floating;
  if (f) { const h = turnedHandleAt({ at: floatBox(f), turn: f.turn }, p); return h ? handleCursor(h) : ''; }
  const r = roamHandleAt(p); if (r) return r.corner != null ? HANDLE_CURSORS.corner[r.corner] : 'move';
  const h = handleAt(p); return h ? handleCursor(h) : '';
}
function pointerUp(e) {
  pointers.delete(e.pointerId);
  if (S.drag) { if (!S.drag.pinch || pointers.size === 0) { S.drag = null; renderCard(); } return; }
  if (S.paintDrag) { S.paintDrag = null; renderDrawing(); return paint(); }
  const d = S.drawing; if (!d) return;
  if (d.painting) return paintUp(d);
  if (d.things) { S.drawing = null; return paint(); }
  if (d.tool === 'line') {
    const moved = d.at && Math.hypot(e.clientX - d.at.x, e.clientY - d.at.y) > 8;
    if (!d.second && !moved) { d.waiting = true; paint(); return; }
    S.drawing = null;
    return commit(shapeOf({ ...d, cur: toMap(e) }));
  }
  S.drawing = null;
  const op = shapeOf({ ...d, cur: d.cur ?? toMap(e) });
  if (!op) return paint();
  if (d.tool === 'rect' || d.tool === 'circle') { const b = bounds(op); if ((b[2] - b[0]) * S.view.z < 4 && (b[3] - b[1]) * S.view.z < 4) return paint(); }
  commit(op, d.tool === 'eraser');
}

/* A drawn shape into what is being drawn. */
function commit(raw, erasing = false) {
  if (S.layer === 'paint') return paintShape(raw);
  const op = tidyOp(raw), m = map();
  if (S.layer === 'walls' || S.layer === 'front') return change(() => { const f = LAYERS[S.layer].field; m[f] = [...(m[f] ?? []), erasing ? { ...op, v: 0 } : op]; });
  if (S.layer === 'areas') {
    if (erasing) return change(() => { m.zones.push({ ...op, a: null }); });
    const cols = Math.ceil(m.size[0] / m.grid), rows = Math.ceil(m.size[1] / m.grid);
    const cells = rasterize([op], cols, rows, m.grid, () => 1), zones = compile(m, worldChat(S.doc)).zones, overlap = new Map();
    for (let i = 0; i < cells.length; i++) if (cells[i] && zones[i] !== QUIET) overlap.set(zones[i], (overlap.get(zones[i]) ?? 0) + 1);
    /* A stroke can look as if it overlaps the area being drawn and miss it
     * by a cell: one within a cell of it, any way, joins it. */
    const current = m.areas.find((a) => a.id === S.areaId);
    if (current && !overlap.has(current.num)) {
      near: for (let i = 0; i < cells.length; i++) if (cells[i]) {
        const x = i % cols, y = Math.floor(i / cols);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const cx = x + dx, cy = y + dy;
          if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && zones[cy * cols + cx] === current.num) { overlap.set(current.num, 1); break near; }
        }
      }
    }
    return paintArea(op, overlap);
  }
  if (S.layer === 'items') {
    /* Drawn over an item, it becomes part of that item. */
    const over = itemsOf(m).filter((x) => overlaps(x.shape, op));
    const into = over.find((x) => S.sel?.kind === 'item' && S.sel.id === x.id) ?? over.at(-1);
    if (into) {
      change(() => { const was = bounds(into.shape); into.shape = joined(into.shape, op); if (into.do?.screen) into.do.screen = carried(into.do.screen, was, bounds(into.shape)); });
      S.sel = { kind: 'item', id: into.id }; S.card = null; return renderCard();
    }
    const id = freshId('item', idsOf(S.doc, 'items'));
    change(() => { m.items.push({ id, name: `Item ${itemsOf(m).length + 1}`, shape: op, do: { kind: 'none' } }); });
    S.sel = { kind: 'item', id }; S.card = 'item'; return renderCard();
  }
  if (S.layer === 'doors') {
    const over = m.arrivals.filter((a) => overlaps(doorShape(m, a), op));
    const into = over.find((a) => S.sel?.kind === 'door' && S.sel.id === a.id) ?? over.at(-1);
    if (into) { change(() => { placeDoor(m, into, joined(doorShape(m, into), op)); }); S.sel = { kind: 'door', id: into.id }; S.card = null; return renderCard(); }
    const id = freshId(`${m.id}-door`, new Set([...idsOf(S.doc, 'arrivals'), ...idsOf(S.doc, 'items')]));
    change(() => { const a = { id, name: `Door ${m.arrivals.length + 1}`, dir: 'down', x: 0, y: 0 }; placeDoor(m, a, op); m.arrivals.push(a); });
    S.sel = { kind: 'door', id }; S.card = 'door'; return renderCard();
  }
}
/* WHICH AREA WHAT IS DRAWN BELONGS TO: the area it overlaps -- the one you
 * are drawing if it overlaps several, else the most -- or, overlapping none,
 * a new area. Drawn right up against another it stays separate. The main
 * area is joined only while it is the one you are drawing: rooms are drawn on
 * top of it. `overlap` is area number -> cells. */
function areaFor(overlap) {
  const m = map(), byNum = new Map(m.areas.map((a) => [a.num, a])), current = m.areas.find((a) => a.id === S.areaId);
  const others = [...overlap].filter(([n]) => byNum.get(n) && byNum.get(n).mode !== 'world');
  if (others.some(([n]) => n === current?.num)) return current.id;
  if (others.length) return byNum.get(others.sort((x, y) => y[1] - x[1])[0][0]).id;
  if (current?.mode === 'world' && overlap.has(current.num)) return current.id;
  return null;
}
function paintArea(op, overlap) {
  const m = map(), joined = areaFor(overlap);
  if (joined) { S.areaId = joined; renderDrawing(); return change(() => { m.zones.push({ ...op, a: joined }); }); }
  S.areaId = null; ensureArea();
  change(() => { m.zones.push({ ...op, a: S.areaId }); }, { record: false });
  S.sel = { kind: 'area', id: S.areaId }; S.card = 'area'; renderCard();
}
/* Two shapes overlap: judged finer than the map's cells inside the box they
 * share, so a shape that looks drawn over another is. */
function overlaps(a, b) {
  const p = bounds(a), q = bounds(b);
  const x0 = Math.max(p[0], q[0]), y0 = Math.max(p[1], q[1]), x1 = Math.min(p[2], q[2]), y1 = Math.min(p[3], q[3]);
  if (x0 > x1 || y0 > y1) return false;
  const g = Math.max(4, map().grid / 4);
  for (let y = y0 + Math.min(g, y1 - y0) / 2; y <= y1; y += g) for (let x = x0 + Math.min(g, x1 - x0) / 2; x <= x1; x += g) if (covers(a, x, y) && covers(b, x, y)) return true;
  return false;
}
/* A shape with another added: a group of the parts. */
const joined = (a, b) => ({ t: 'group', p: [...(a.t === 'group' ? a.p : [a]), ...(b.t === 'group' ? b.p : [b])] });
/* Drawing on Areas with none chosen begins a new one. */
function ensureArea() {
  const m = map();
  if (S.areaId && m.areas.some((a) => a.id === S.areaId)) return false;
  const num = nextAreaNum(S.doc); if (!num) { say('No more areas can be made.', true); return false; }
  const id = freshId('area', idsOf(S.doc, 'areas'));
  history.record(S.doc);
  m.areas.push({ id, num, name: `Area ${m.areas.filter((a) => a.mode !== 'world').length + 1}`, mode: 'room', call: 'room', lease: false });
  S.areaId = id; renderDrawing();
  return true;
}

/* THE ERASER on items and doors takes away whichever it touches. */
function eraseThingsAt(p) {
  const m = map(), r = S.size / 2;
  const hit = (op) => op && [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].some(([dx, dy]) => covers(op, p.x + dx, p.y + dy));
  if (S.layer === 'items') { const it = itemsOf(m).find((x) => hit(x.shape)); if (it) change(() => { m.items = m.items.filter((x) => x.id !== it.id); }); }
  if (S.layer === 'doors') {
    const a = m.arrivals.find((x) => x.id !== S.doc.world.entry && hit(doorShape(m, x)));
    if (a) change((d) => { m.arrivals = m.arrivals.filter((x) => x.id !== a.id); m.items = m.items.filter((x) => x.id !== a.id); fixDoors(d, m); });
  }
}
/* After a door goes: the map still has somewhere to arrive, the world an entrance. */
function fixDoors(d, m) {
  if (!m.arrivals.some((x) => x.id === m.spawn)) { if (m.arrivals.length) m.spawn = m.arrivals[0].id; else delete m.spawn; }
  if (!d.maps.some((x) => x.arrivals.some((a) => a.id === d.world.entry))) d.world.entry = d.maps[0]?.spawn ?? null;
}

/* FILL: the space you tap, as far as the lines of what you are drawing
 * reach -- inside a circle, a box, or lines that cross into a shape. */
function fillAt(p) {
  const m = map(), cols = Math.ceil(m.size[0] / m.grid), rows = Math.ceil(m.size[1] / m.grid);
  const cx = Math.floor(p.x / m.grid), cy = Math.floor(p.y / m.grid);
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
  const cells = S.layer === 'areas' ? compile(m, worldChat(S.doc)).zones : rasterize(m[LAYERS[S.layer].field] ?? [], cols, rows, m.grid);
  const start = cy * cols + cx, was = cells[start];
  /* Already filled -- but the main area's floor is the ground other areas
   * are filled onto, unless the main area is what is being drawn. */
  const drawingMain = map().areas.find((x) => x.id === S.areaId)?.mode === 'world';
  if (S.layer === 'areas' ? (was !== QUIET && (was !== 0 || drawingMain)) : was === 1) return;
  const seen = new Uint8Array(cells.length), queue = [start]; seen[start] = 1;
  while (queue.length) {
    const i = queue.pop(), x = i % cols;
    for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols]) if (j >= 0 && j < cells.length && !seen[j] && cells[j] === was) { seen[j] = 1; queue.push(j); }
  }
  const r = [];
  for (let i = 0; i < seen.length; i++) if (seen[i]) { if (r.length && r[r.length - 2] + r[r.length - 1] === i) r[r.length - 1]++; else r.push(i, 1); }
  const op = { t: 'runs', x: 0, y: 0, cell: m.grid, cols, r };
  if (S.layer === 'areas') {
    /* The area whose lines are round what was filled is the one it joins. */
    const edge = new Map();
    for (let i = 0; i < seen.length; i++) if (seen[i]) {
      const x = i % cols;
      for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols]) if (j >= 0 && j < cells.length && !seen[j] && cells[j] !== QUIET) edge.set(cells[j], (edge.get(cells[j]) ?? 0) + 1);
    }
    paintArea(op, edge);
  } else change(() => { const f = LAYERS[S.layer].field; m[f] = [...(m[f] ?? []), op]; });
}

/* SELECT: what you tap, among what you are drawing. */
function selectAt(p) {
  const m = map(), px = 1 / S.view.z;
  const r = roamHandleAt(p);
  if (r) { history.record(S.doc); S.drag = { roaming: true, corner: r.corner, from: p, box: roamBox(roamer().do.roam) }; return; }
  const h = handleAt(p);
  if (h) {
    history.record(S.doc);
    S.drag = { move: true, corner: h.corner ?? null, side: h.side ?? null, box: h.box, op: structuredClone(h.s.op), screen: structuredClone(h.s.screen), roam: structuredClone(h.s.roam), parts: areaParts(),
      turning: !!h.turning, turned: h.s.turned && { at: [...h.s.turned.at], turn: h.s.turned.turn }, from: p };
    renderCard(); return;
  }
  const near = (op) => op && (covers(op, p.x, p.y) || (op.t === 'line' && covers({ ...op, r: op.r + 6 * px }, p.x, p.y)));
  let sel = null;
  if (S.layer === 'areas') {
    for (let i = m.zones.length - 1; i >= 0 && !sel; i--) if (m.zones[i].a != null && near(m.zones[i])) sel = { kind: 'area', id: m.zones[i].a };
  } else if (PAINTED.includes(S.layer)) {
    const list = m[LAYERS[S.layer].field] ?? [];
    for (let i = list.length - 1; i >= 0 && !sel; i--) if (list[i].v !== 0 && near(list[i])) sel = { kind: 'op', layer: S.layer, index: i };
  }
  if (!sel && S.layer === 'items') { const it = [...itemsOf(m)].reverse().find((x) => near(x.shape)); if (it) sel = { kind: 'item', id: it.id }; }
  if (!sel && S.layer === 'doors') { const a = [...m.arrivals].reverse().find((x) => near(doorShape(m, x))); if (a) sel = { kind: 'door', id: a.id }; }
  if (!sel && S.layer === 'pictures') { const it = [...imagesOf(m)].reverse().find((x) => near(imageShape(x.image))); if (it) sel = { kind: 'image', id: it.id }; }
  S.sel = sel;
  /* Tapping something that has a card opens it. */
  S.card = sel && ({ item: 'item', door: 'door', area: 'area' }[sel.kind] ?? null);
  if (sel?.kind === 'area') { S.areaId = sel.id; renderDrawing(); }
  if (sel) { const s = selected(); history.record(S.doc); S.drag = { move: true, from: p, op: structuredClone(s.op), screen: structuredClone(s.screen), roam: structuredClone(s.roam), parts: areaParts(), moved: false }; }
  renderCard(); paint();
}
/* What an area being moved is made of, as it was: [index, op]. */
const areaParts = () => (S.sel?.kind === 'area' ? map().zones.map((op, i) => [i, op]).filter(([, op]) => op.a === S.sel.id).map(([i, op]) => [i, structuredClone(op)]) : null);
function dragSelection(p, e) {
  const d = S.drag, s = selected(); if (!s) return;
  if (d.parts) {
    const m = map(), snap = d.parts.some(([, op]) => ['bits', 'runs'].includes(op.t));
    let dx = p.x - d.from?.x, dy = p.y - d.from?.y;
    if (d.corner == null) {
      if (!d.moved && Math.hypot(dx, dy) * S.view.z < 3) return;
      d.moved = true;
      if (snap) { dx = Math.round(dx / m.grid) * m.grid; dy = Math.round(dy / m.grid) * m.grid; }
    }
    const [ax, ay] = d.corner != null ? corners(d.box)[(d.corner + 2) % 4] : [0, 0];
    const nb = d.corner != null && [Math.min(ax, p.x), Math.min(ay, p.y), Math.max(ax, p.x), Math.max(ay, p.y)];
    for (const [i, op] of d.parts) m.zones[i] = tidyOp(d.corner != null ? reshape(op, d.box, nb) : moveOp(op, dx, dy));
  } else if (d.turned && (d.turning || d.corner != null || d.side != null)) {
    /* A picture, turned or straight (world/turned): Shift turns it in steps. */
    const { at, turn } = d.turned;
    if (d.turning) s.place(at, turnBy(at, turn, d.from, p, !!e?.shiftKey));
    else s.place(d.corner != null ? resizeCorner(at, turn, d.corner, p, true) : resizeSide(at, turn, d.side, p), turn);
  } else if (d.side != null) {
    /* One side moves; the one across from it stays. */
    const [x0, y0, x1, y1] = d.box, min = 4;
    const nb = [[x0, Math.min(p.y, y1 - min), x1, y1], [x0, y0, Math.max(p.x, x0 + min), y1], [x0, y0, x1, Math.max(p.y, y0 + min)], [Math.min(p.x, x1 - min), y0, x1, y1]][d.side];
    s.put(reshape(d.op, d.box, nb), d);
  } else if (d.corner != null) {
    const [ax, ay] = corners(d.box)[(d.corner + 2) % 4];
    s.put(reshape(d.op, d.box, s.keepShape ? inProportion(d.box, ax, ay, p) : [Math.min(ax, p.x), Math.min(ay, p.y), Math.max(ax, p.x), Math.max(ay, p.y)]), d);
  } else {
    let dx = p.x - d.from.x, dy = p.y - d.from.y;
    if (!d.moved && Math.hypot(dx, dy) * S.view.z < 3) return;
    d.moved = true;
    if (['bits', 'runs'].includes(d.op.t)) { const g = d.op.cell; dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g; }
    s.put(moveOp(d.op, dx, dy), d);
  }
  if (!d.hidCard) { d.hidCard = true; $('.floating').replaceChildren(); }
  S.version++; S.dirty = true; paint();
  clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 2500);
}
/* A box resized from the corner (ax, ay) toward p, keeping its proportions:
 * as far as the pointer is, along whichever side it has gone further. */
function inProportion(box, ax, ay, p) {
  const w = box[2] - box[0], h = box[3] - box[1];
  const k = Math.max(Math.abs(p.x - ax) / w, Math.abs(p.y - ay) / h, 4 / Math.min(w, h));
  const x = p.x < ax ? ax - w * k : ax, y = p.y < ay ? ay - h * k : ay;
  return [x, y, x + w * k, y + h * k];
}
/* An operation stretched from one box to another; strokes keep their width. */
function reshape(op, from, to) {
  if (op.t === 'group') return { ...op, p: op.p.map((o) => reshape(o, from, to)) };
  const sx = (to[2] - to[0]) / Math.max(1e-6, from[2] - from[0]), sy = (to[3] - to[1]) / Math.max(1e-6, from[3] - from[1]);
  const moved = moveOp(op, -from[0], -from[1]);
  const scaled = op.t === 'line' ? { ...moved, p: moved.p.map((v, i) => v * (i % 2 ? sy : sx)) } : scaleOp(moved, sx, sy);
  return moveOp(scaled, to[0], to[1]);
}
/* A video's screen goes with its item: moved, stretched or drawn onto, the
 * screen keeps its place on it. */
function carried(screen, from, to) {
  const r = reshape({ t: 'rect', ...screen }, from, to);
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
}
/* A screen left behind by an item moved before screens went with it is put
 * back on the item. */
function screensBack(doc) {
  let fixed = 0;
  for (const m of doc.maps) for (const it of m.items) {
    const s = it.do?.kind === 'video' && it.do.screen; if (!s || !it.shape) continue;
    const b = bounds(it.shape);
    if (s.x < b[2] && s.x + s.w > b[0] && s.y < b[3] && s.y + s.h > b[1]) continue;
    it.do.screen = { x: Math.round(b[0]), y: Math.round(b[1]), w: Math.round(b[2] - b[0]), h: Math.round(b[3] - b[1]) };
    fixed++;
  }
  return fixed;
}
function removeSelection() {
  const sel = S.sel, m = map(); if (!sel) return;
  change((d) => {
    if (sel.kind === 'op') m[LAYERS[sel.layer].field].splice(sel.index, 1);
    if (sel.kind === 'area' && !(m.areas.find((x) => x.id === sel.id)?.mode === 'world' && d.maps.flatMap((x) => x.areas).filter((x) => x.mode === 'world').length < 2)) { m.areas = m.areas.filter((x) => x.id !== sel.id); m.zones = m.zones.filter((op) => op.a !== sel.id); if (S.areaId === sel.id) S.areaId = null; }
    if (sel.kind === 'item' || sel.kind === 'image') m.items = m.items.filter((x) => x.id !== sel.id);
    if (sel.kind === 'door' && d.world.entry !== sel.id) { m.arrivals = m.arrivals.filter((x) => x.id !== sel.id); m.items = m.items.filter((x) => x.id !== sel.id); fixDoors(d, m); }
  });
  S.sel = null; S.card = null; renderCard(); paint();
}
function deleteArea(a) {
  change(() => { const m = map(); m.areas = m.areas.filter((x) => x.id !== a.id); m.zones = m.zones.filter((op) => op.a !== a.id); });
  if (S.areaId === a.id) S.areaId = null;
  S.sel = null; S.card = null; renderDrawing(); renderCard();
}

/* Two fingers: pinch to zoom, move together to pan. */
function pinchStart() {
  const [a, b] = [...pointers.values()];
  return { pinch: true, dist: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], view: { ...S.view } };
}
function pinchMove() {
  const d = S.drag, [a, b] = [...pointers.values()]; if (!a || !b) return;
  const r = canvas.getBoundingClientRect(), dist = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
  const z = Math.max(0.02, Math.min(32, d.view.z * dist / Math.max(1, d.dist)));
  const mx = d.view.ox + (d.mid[0] - r.left) / d.view.z, my = d.view.oy + (d.mid[1] - r.top) / d.view.z;
  S.view = { z, ox: mx - (mid[0] - r.left) / z, oy: my - (mid[1] - r.top) / z };
  S.fitted = false; paint();
}
function wheel(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), notch = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && !e.deltaX);
  if (e.ctrlKey || e.metaKey || notch) return zoomBy(Math.exp(-e.deltaY / (notch ? 600 : 150)), e.clientX - r.left, e.clientY - r.top);
  S.view.ox += e.deltaX / S.view.z; S.view.oy += e.deltaY / S.view.z; S.fitted = false; paint(); renderCard();
}
/* KEYS THAT MOVE THE MAP (2026-11-10): W, A, S and D, held, slide it as the
 * hand drags it; + and - zoom as the wheel does, round the pointer when it
 * is on the map. */
const PAN_KEYS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] };
const PAN_SPEED = 700;    //  screen pixels a second
const held = new Set();
let panFrame = 0, panAt = 0;
function holdPan(k) {
  held.add(k);
  if (!panFrame) { panAt = 0; panFrame = requestAnimationFrame(panStep); }
}
function panStep(t) {
  panFrame = 0;
  if (!held.size || !map()) return;
  const dt = panAt ? Math.min(0.05, (t - panAt) / 1000) : 0; panAt = t;
  let dx = 0, dy = 0;
  for (const k of held) { dx += PAN_KEYS[k][0]; dy += PAN_KEYS[k][1]; }
  const n = Math.hypot(dx, dy);
  if (n && dt) {
    S.view.ox += (dx / n) * PAN_SPEED * dt / S.view.z; S.view.oy += (dy / n) * PAN_SPEED * dt / S.view.z;
    S.fitted = false; paint();
    const card = $('.floating .card:not(.walkbox)'); if (card) placeCard(card);
  }
  panFrame = requestAnimationFrame(panStep);
}
function zoomKey(k) {
  if (!map()) return;
  const [x, y] = S.cursor ? toScreen(S.cursor.x, S.cursor.y) : [];
  zoomBy(k, x, y);
}
function keyDown(e) {
  if (e.target.closest?.('input, textarea, select')) return;
  const cmd = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (cmd && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (cmd && k === 's') { e.preventDefault(); return save(); }
  if (cmd && S.layer === 'paint' && ['c', 'x', 'v'].includes(k)) { e.preventDefault(); return k === 'v' ? pastePaint() : copyPaint(k === 'x'); }
  if (cmd || e.altKey) return;
  if (e.code === 'Space') { S.spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (PAN_KEYS[k]) return holdPan(k);
  if (e.key === '+' || e.key === '=') return zoomKey(1.25);
  if (e.key === '-' || e.key === '_') return zoomKey(1 / 1.25);
  if (S.walkBox && e.key === 'Escape') return walkBoxDone();
  if (S.walkBox && (e.key === 'Delete' || e.key === 'Backspace')) return;
  if (e.key === 'Escape' && (S.floating || S.paintSel)) { if (S.floating) cancelFloating(); else { S.paintSel = null; renderDrawing(); paint(); } return; }
  if (e.key === 'Escape') { finishStroke(); S.drawing = null; S.sel = null; S.card = null; renderCard(); return paint(); }
  if (e.key === 'Enter' && S.floating) { e.preventDefault(); return placeFloating(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.layer === 'paint' && S.paintSel && !S.floating) { e.preventDefault(); return deletePaint(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) { e.preventDefault(); return removeSelection(); }
  const tool = { h: 'hand', v: 'select', b: 'brush', e: 'eraser', l: 'line', r: 'rect', c: 'circle', f: 'fill', i: 'pick' }[k];
  if (tool && toolOk(tool, S.layer)) setTool(tool);
}
/* A piece being put down is taken back first; a stroke still being kept
 * is waited for, so Undo takes back that stroke. */
async function undo() {
  if (S.floating) return cancelFloating();
  if (S.paintBusy) await paintQueue;
  const was = history.undo(S.doc); if (was) restore(was);
}
async function redo() { if (S.paintBusy) await paintQueue; const was = history.redo(S.doc); if (was) restore(was); }
function restore(doc) { S.doc = doc; if (!S.walkBox) S.sel = null; S.card = null; if (!map()) S.mapId = S.doc.maps[0]?.id ?? null; if (!map()?.areas.some((a) => a.id === S.areaId)) S.areaId = null; touched(); renderDrawing(); }
function chooseMap(id) {
  if (!id) return;
  finishStroke(); placeFloating(); S.paintSel = null;
  /* Only the open map's painting is held. */
  if (!S.paintBusy) for (const k of [...buffers.keys()]) if (k !== id) buffers.delete(k);
  S.mapId = id; S.sel = null; S.card = null; S.drawing = null; S.areaId = null; fit(); renderAll(); }
function setScale(height, record = true) { const m = map(), s = scaleFor(height); change(() => { Object.assign(m, s, { grid: Math.max(s.grid, coarsest(m.size)) }); }, { record }); }

/* ------------------------------------------------------------- painting */

/* THE PAINTING LAYER (2026-11-08): painted over the map image and under
 * everything else (editor/paint-layer). The open map's painting is held as
 * tiles. A stroke done makes the tiles it touched into PNGs and names them
 * in the document at once, so Undo takes back a stroke; they go to the ship
 * just before the draft that names them is saved. */
const buffers = new Map();        //  map id -> PaintBuffer
const tileBlobs = new Map();      //  hash -> a tile's PNG, made or fetched here
const tileImages = new Map();     //  hash -> a promise of it, decoded
let savedTiles = new Set();       //  the tiles the saved draft names: the ship has them
let paintQueue = Promise.resolve();
const tilesOf = (doc) => new Set(doc.maps.flatMap((m) => (m.paint?.tiles ?? []).map((t) => t.src)));
const paintStyle = (erase = false) => ({ rgb: hexToRgb(S.paintColour), alpha: S.paintAlpha, erase, hard: S.paintHard });

function tileImage(hash) {
  let p = tileImages.get(hash);
  if (!p) {
    p = (async () => {
      let blob = tileBlobs.get(hash);
      if (!blob) {
        const r = await fetch(host.assetUrl(hash), { credentials: 'include' });
        if (!r.ok) throw new Error(`${r.status}`);
        blob = await r.blob(); tileBlobs.set(hash, blob);
      }
      return createImageBitmap(blob);
    })();
    p.catch(() => tileImages.delete(hash));
    tileImages.set(hash, p);
  }
  return p;
}
/* The map's painting as the document has it -- after an Undo, say -- with
 * the tiles that differ fetched. Never in the middle of painting. */
function syncPaint(m) {
  let b = buffers.get(m.id);
  if (S.paintBusy || S.drawing?.painting || S.floating) return b ?? null;
  const p = m.paint;
  if (!p) { if (b) buffers.delete(m.id); return null; }
  if (!b || b.w !== p.w || b.h !== p.h || b.size[0] !== p.size[0] || b.size[1] !== p.size[1]) { b = new PaintBuffer(p.w, p.h, p.size); buffers.set(m.id, b); }
  const want = new Map(p.tiles.map((t) => [tileKey(t.c, t.r), t.src]));
  for (const key of [...b.tiles.keys()]) if (!want.has(key)) { b.drop(key); b.shown.delete(key); }
  for (const [key, src] of want) {
    if (b.shown.get(key) === src || b.loading.get(key) === src) continue;
    b.loading.set(key, src);
    tileImage(src).then((img) => {
      if (b.loading.get(key) !== src) return;
      b.loading.delete(key);
      if (buffers.get(m.id) === b) { b.put(key, img); b.shown.set(key, src); }
      paint();
    }, () => { if (b.loading.get(key) === src) b.loading.delete(key); say('Part of the drawing did not come from your ship.', true); });
  }
  return b;
}
/* The painting to paint on, laid over the map's size now -- or null, said,
 * while some of it is still coming. */
function paintTarget(m) {
  const b = syncPaint(m);
  if (b && !b.ready) { say('The drawing is still coming from your ship: a moment.', true); return null; }
  const { w, h } = paintDims(m.size);
  if (!b) { const fresh = new PaintBuffer(w, h, m.size); buffers.set(m.id, fresh); return fresh; }
  if (b.size[0] === m.size[0] && b.size[1] === m.size[1]) return b;
  /* The map was resized since it was painted: the painting is laid out
   * again over its new size, where it was, and kept whole next time. */
  const next = b.rebased(w, h, m.size); next.relaid = true; buffers.set(m.id, next);
  return next;
}
/* KEEPING WHAT WAS PAINTED: the tiles touched, as they are now, made PNGs
 * in turn and named in the document -- each change once, in order. */
function commitPaint(mapId, b, keys) {
  const relaid = !!b.relaid; b.relaid = false;
  const which = relaid ? [...b.tiles.keys()] : [...new Set(keys)];
  if (!which.length && !relaid) return paint();
  const snaps = which.map((key) => [key, b.snapshot(key)]);
  S.paintBusy++;
  paintQueue = paintQueue.then(async () => {
    const out = [];
    for (const [key, snap] of snaps) {
      if (snap.empty) { out.push([key, null]); continue; }
      const blob = await new Promise((r) => snap.canvas.toBlob(r, 'image/png'));
      const hash = await sha256(new Uint8Array(await blob.arrayBuffer()));
      tileBlobs.set(hash, blob);
      known.set(hash, { mime: 'image/png', size: blob.size, w: PAINT_TILE, h: PAINT_TILE });
      out.push([key, hash]);
    }
    const m = findMap(S.doc, mapId);
    if (m && (m.paint || out.some(([, src]) => src))) change(() => {
      const tiles = new Map(relaid ? [] : (m.paint?.tiles ?? []).map((t) => [tileKey(t.c, t.r), t.src]));
      for (const [key, src] of out) if (src) tiles.set(key, src); else tiles.delete(key);
      if (!tiles.size) { delete m.paint; return; }
      m.paint = { w: b.w, h: b.h, size: [...b.size], tiles: [...tiles].map(([key, src]) => { const [c, r] = keyTile(key); return { c, r, src }; }).sort((x, y) => x.r - y.r || x.c - y.c) };
    });
    if (relaid) b.shown.clear();
    for (const [key, src] of out) if (src) b.shown.set(key, src); else b.shown.delete(key);
  }).catch((e) => say(`The drawing could not be kept: ${e.message}`, true))
    .finally(() => { S.paintBusy--; paint(); });
}
/* The painting's new tiles, to the ship before the draft that names them:
 * those it has not got from a saved draft, and that were made here. */
async function sendPainting(doc) {
  const fresh = [...tilesOf(doc)].filter((h) => !savedTiles.has(h) && tileBlobs.has(h));
  if (!fresh.length) return;
  roomFor(fresh.reduce((n, h) => n + tileBlobs.get(h).size, 0));
  S.sending++;
  try {
    for (const h of fresh) {
      const got = await host.putAsset(tileBlobs.get(h), 'image/png');
      if (got.hash !== h) throw new Error('part of the painting changed on its way');
    }
  } finally { S.sending--; }
}
/* The colour just used, first among the recent ones. */
function rememberColour() {
  S.recent = [S.paintColour, ...S.recent.filter((c) => c !== S.paintColour)].slice(0, 10);
  try { localStorage.setItem('glurff-editor-colours', JSON.stringify(S.recent)); } catch {}
}
function setColour(hex) {
  S.paintColour = hex;
  const i = $('.paintbar .colour i'); if (i) i.style.background = hex;
  paint();
}
/* A stroke cut short -- by another tool, layer or map, or a second finger --
 * keeps what it painted. */
function finishStroke() {
  const d = S.drawing; if (!d?.painting) return;
  S.drawing = null;
  if (!d.marquee && d.buffer?.stroke) commitPaint(d.mapId, d.buffer, d.buffer.end());
}

/* WHAT THE MAP SHOWS, at the painting's size, over [x, y, w, h] of it: the
 * map image, the painting and the pictures on it -- what the eyedropper
 * takes from, fill follows and Copy copies. */
function composite(m, b, [x, y, w, h]) {
  const c = el('canvas', { width: w, height: h }), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.setTransform(b.kx, 0, 0, b.ky, -x, -y);
  if (m.image) { const bg = picture(m.image.src); if (bg) g.drawImage(bg, 0, 0, m.size[0], m.size[1]); }
  g.setTransform(1, 0, 0, 1, -x, -y);
  b.draw(g);
  g.setTransform(b.kx, 0, 0, b.ky, -x, -y);
  for (const it of m.items) if (it.image) { const pic = picture(it.image.src); if (pic) drawPlaced(g, pic, it.image); }
  return c;
}
const brushRadius = (b) => (S.paintSize / 2) * b.kx;

/* A press on the painting layer: true when it is the painting's to handle
 * (lines, rectangles and circles are drawn as on any layer). */
function paintDown(e, p) {
  const m = map();
  if (S.tool === 'pick' || (e.altKey && !['select', 'hand'].includes(S.tool))) { pickAt(m, p); return true; }
  if (S.tool === 'select') { selectPaint(m, p); return true; }
  if (S.tool === 'fill') { fillPaint(m, p); return true; }
  if (S.tool !== 'brush' && S.tool !== 'eraser') return false;
  const b = paintTarget(m); if (!b) return true;
  b.begin(paintStyle(S.tool === 'eraser'));
  const [x, y] = b.toPaint(p.x, p.y);
  b.segment(x, y, x, y, brushRadius(b));
  S.drawing = { tool: S.tool, painting: true, buffer: b, mapId: m.id, last: [x, y] };
  paint();
  return true;
}
function paintMove(p) {
  const d = S.drawing, b = d.buffer, [x, y] = b.toPaint(p.x, p.y);
  if (d.marquee) { d.to = [x, y]; return; }
  b.segment(d.last[0], d.last[1], x, y, brushRadius(b));
  d.last = [x, y];
}
function paintUp(d) {
  S.drawing = null;
  if (d.marquee) {
    const b = d.buffer, x0 = Math.max(0, Math.floor(Math.min(d.from[0], d.to[0]))), y0 = Math.max(0, Math.floor(Math.min(d.from[1], d.to[1])));
    const x1 = Math.min(b.w, Math.ceil(Math.max(d.from[0], d.to[0]))), y1 = Math.min(b.h, Math.ceil(Math.max(d.from[1], d.to[1])));
    const big = ((x1 - x0) / b.kx) * S.view.z >= 4 && ((y1 - y0) / b.ky) * S.view.z >= 4;
    S.paintSel = big ? [x0, y0, x1 - x0, y1 - y0] : null;
    renderDrawing(); return paint();
  }
  if (d.tool !== 'eraser') rememberColour();
  commitPaint(d.mapId, d.buffer, d.buffer.end());
}
/* A line, rectangle or circle, as drawn on any layer, painted. */
function paintShape(op) {
  const m = map(), b = paintTarget(m); if (!b) return paint();
  const kx = b.kx, ky = b.ky;
  b.begin(paintStyle());
  if (op.t === 'line') {
    const q = op.p, r = op.r * kx;
    if (q.length === 2) b.segment(q[0] * kx, q[1] * ky, q[0] * kx, q[1] * ky, r);
    for (let i = 2; i < q.length; i += 2) b.segment(q[i - 2] * kx, q[i - 1] * ky, q[i] * kx, q[i + 1] * ky, r);
  } else if (op.t === 'rect') b.rect(op.x * kx, op.y * ky, op.w * kx, op.h * ky);
  else if (op.t === 'ellipse') b.ellipse(op.x * kx, op.y * ky, op.rx * kx, op.ry * ky);
  rememberColour();
  commitPaint(m.id, b, b.end());
}
/* FILL: where the map shows one colour with the place tapped, as near as the
 * tolerance allows, painted over. */
function fillPaint(m, p) {
  const b = paintTarget(m); if (!b) return;
  const [x, y] = b.toPaint(p.x, p.y);
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const seen = composite(m, b, [0, 0, b.w, b.h]).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, b.w, b.h).data;
  b.begin(paintStyle());
  b.fill(seen, x, y, Math.round(S.fillTolerance * 2.55));
  rememberColour();
  commitPaint(m.id, b, b.end());
}
/* THE EYEDROPPER: the colour the map shows there. Alt with any painting
 * tool does the same, and the eyedropper goes back to the tool before it. */
function pickAt(m, p) {
  const b = syncPaint(m) ?? new PaintBuffer(paintDims(m.size).w, paintDims(m.size).h, m.size);
  const [x, y] = b.toPaint(p.x, p.y).map(Math.floor);
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return;
  const d = composite(m, b, [x, y, 1, 1]).getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 1, 1).data;
  if (!d[3]) return say('Nothing there to take a colour from.', true);
  setColour(rgbToHex([d[0], d[1], d[2]])); rememberColour();
  if (S.tool === 'pick') setTool(S.pickBack && S.pickBack !== 'pick' ? S.pickBack : 'brush');
  else renderDrawing();
}

/* SELECT, COPY AND PASTE. Select drags a rectangle; Copy takes what the map
 * shows there, Cut and Delete take away only painting. A paste floats until
 * it is put down: dragged, flipped, and -- as a picture is (2026-11-10) --
 * resized from its corners in proportion, stretched from its sides and
 * turned with its round handle. Its place is the painting's pixels; its
 * handles are worked on the map (world/turned). */
const floatBox = (f) => [f.at[0] / f.buffer.kx, f.at[1] / f.buffer.ky, f.at[2] / f.buffer.kx, f.at[3] / f.buffer.ky];
function selectPaint(m, p) {
  const f = S.floating;
  if (f) {
    const box = { at: floatBox(f), turn: f.turn }, h = turnedHandleAt(box, p);
    if (h) { S.paintDrag = { ...h, box, from: p }; return; }
    if (insideTurned(box.at, box.turn, p.x, p.y)) { S.paintDrag = { move: true, from: f.buffer.toPaint(p.x, p.y), at: [...f.at] }; return; }
    placeFloating();
  }
  const b = paintTarget(m); if (!b) return;
  const at = b.toPaint(p.x, p.y);
  S.paintSel = null;
  S.drawing = { tool: 'select', painting: true, marquee: true, buffer: b, mapId: m.id, from: at, to: at };
  renderDrawing(); paint();
}
function dragFloating(p, e) {
  const d = S.paintDrag, f = S.floating; if (!f) return;
  if (d.move) { const [x, y] = f.buffer.toPaint(p.x, p.y); f.at = [d.at[0] + x - d.from[0], d.at[1] + y - d.from[1], d.at[2], d.at[3]]; return; }
  const { at, turn } = d.box, { kx, ky } = f.buffer;
  if (d.turning) { f.turn = turnBy(at, turn, d.from, p, !!e?.shiftKey); return; }
  /* The corner or side across stays put; never less than a pixel. */
  const nb = d.corner != null ? resizeCorner(at, turn, d.corner, p, true, 1 / kx) : resizeSide(at, turn, d.side, p, 1 / kx);
  f.at = [nb[0] * kx, nb[1] * ky, nb[2] * kx, nb[3] * ky];
}
function copyPaint(cut = false) {
  const m = map(), sel = S.paintSel; if (!sel || S.floating) return;
  const b = paintTarget(m); if (!b) return;
  S.clip = { canvas: composite(m, b, sel), w: sel[2], h: sel[3] };
  if (cut) commitPaint(m.id, b, b.clear(sel));
  renderDrawing();
  say(`${cut ? 'Cut' : 'Copied'}. Paste puts it on this map or another (⌘V).`);
}
function deletePaint() {
  const m = map(), sel = S.paintSel; if (!sel) return;
  const b = paintTarget(m); if (!b) return;
  commitPaint(m.id, b, b.clear(sel));
}
function pastePaint() {
  if (!S.clip) return;
  placeFloating();
  const m = map(), b = paintTarget(m); if (!b) return;
  if (S.tool !== 'select') setTool('select');
  const cx = (S.view.ox + stage.clientWidth / 2 / S.view.z) * b.kx, cy = (S.view.oy + stage.clientHeight / 2 / S.view.z) * b.ky;
  S.floating = { canvas: S.clip.canvas, buffer: b, mapId: m.id, flip: false, turn: 0, at: [Math.round(cx - S.clip.w / 2), Math.round(cy - S.clip.h / 2), S.clip.w, S.clip.h] };
  S.paintSel = null;
  renderDrawing(); paint();
  say('Drag it into place. Its corners resize it, the dots on its sides stretch it and the round handle turns it (Shift: in steps). Put it down with Enter, or by tapping outside it.');
}
function placeFloating() {
  const f = S.floating; if (!f) return;
  S.floating = null; S.paintDrag = null;
  commitPaint(f.mapId, f.buffer, f.buffer.stamp(f.canvas, f.at.map(Math.round), { flip: f.flip, smooth: !S.paintHard, turn: f.turn }));
  renderDrawing(); paint();
}
function cancelFloating() { S.floating = null; S.paintDrag = null; renderDrawing(); paint(); }
function drawPaintSelection(m, px) {
  const f = S.floating, d = S.drawing?.marquee ? S.drawing : null;
  const dashed = (x, y, w, h) => {
    ctx.save(); ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, h);
    ctx.strokeStyle = '#fff'; ctx.lineDashOffset = 5 * px; ctx.strokeRect(x, y, w, h); ctx.restore();
  };
  if (f) {
    const at = floatBox(f), [x, y, w, h] = at;
    ctx.save(); ctx.imageSmoothingEnabled = !S.paintHard;
    ctx.translate(x + w / 2, y + h / 2);
    if (f.turn) ctx.rotate((f.turn * Math.PI) / 180);
    if (f.flip) ctx.scale(-1, 1);
    ctx.drawImage(f.canvas, -w / 2, -h / 2, w, h);
    ctx.restore();
    drawTurnedHandles({ at, turn: f.turn }, px);
    return;
  }
  const b = d?.buffer ?? buffers.get(m.id);
  const k = b ? [b.kx, b.ky] : [paintDims(m.size).w / m.size[0], paintDims(m.size).h / m.size[1]];
  const r = d ? [Math.min(d.from[0], d.to[0]), Math.min(d.from[1], d.to[1]), Math.abs(d.to[0] - d.from[0]), Math.abs(d.to[1] - d.from[1])] : S.paintSel;
  if (r) dashed(r[0] / k[0], r[1] / k[1], r[2] / k[0], r[3] / k[1]);
}

/* THE PAINTING'S BAR, under the layers: colour, opacity, hard edges, the
 * shape or fill being drawn, hiding it, and select, copy and paste. */
function paintBar() {
  const slider = (label, title, value, min, max, set) => el('label', { class: 'slider', title }, label,
    el('input', { type: 'range', min, max, value, oninput: (e) => { set(+e.target.value); e.target.nextSibling.textContent = `${e.target.value}%`; } }),
    el('span', {}, `${value}%`));
  const check = (label, title, on, set) => el('label', { class: 'tick', title }, el('input', { type: 'checkbox', checked: on, onchange: (e) => set(e.target.checked) }), label);
  const shapes = ['rect', 'circle'].includes(S.tool) && el('span', { class: 'seg' },
    el('button', { class: S.paintFilled ? '' : 'on', onclick: () => { S.paintFilled = false; renderDrawing(); } }, 'Outline'),
    el('button', { class: S.paintFilled ? 'on' : '', onclick: () => { S.paintFilled = true; renderDrawing(); } }, 'Filled'));
  return el('div', { class: 'paintbar' },
    el('button', { class: 'colour', title: 'Colour', onclick: (e) => colourMenu(e.currentTarget) }, el('i', { style: `background:${S.paintColour}` }), 'Colour ▾'),
    slider('Opacity', 'How strongly it paints', Math.round(S.paintAlpha * 100), 5, 100, (v) => { S.paintAlpha = v / 100; }),
    check('Hard edges', 'Whole pixels, as the game\'s art is drawn', S.paintHard, (v) => { S.paintHard = v; paint(); }),
    shapes,
    S.tool === 'fill' && slider('Tolerance', 'How alike colours must be to be filled together', S.fillTolerance, 0, 100, (v) => { S.fillTolerance = v; }),
    check('Hide drawing', 'See the map without what you drew, here only', S.hidePaint, (v) => { S.hidePaint = v; paint(); }),
    S.tool === 'select' && S.paintSel && !S.floating && [
      el('button', { title: 'Copy what the map shows here (⌘C)', onclick: () => copyPaint() }, 'Copy'),
      el('button', { title: 'Copy it, and take away what is drawn here (⌘X)', onclick: () => copyPaint(true) }, 'Cut'),
      el('button', { title: 'Take away what is drawn here (Delete)', onclick: deletePaint }, 'Delete')],
    S.clip && !S.floating && el('button', { title: 'Paste (⌘V)', onclick: pastePaint }, 'Paste'),
    S.floating && [
      el('button', { onclick: () => { S.floating.flip = !S.floating.flip; paint(); } }, 'Flip ↔'),
      S.floating.turn ? el('button', { onclick: () => { S.floating.turn = 0; renderDrawing(); paint(); } }, 'Straighten') : null,
      el('button', { class: 'primary', onclick: placeFloating }, 'Put it down'),
      el('button', { onclick: cancelFloating }, 'Cancel')]);
}
function colourMenu(anchor) {
  const wheel = colourWheel({ value: S.paintColour, onChange: setColour });
  popover(anchor, [
    wheel,
    S.recent.length ? el('div', { class: 'recent' }, el('span', {}, 'Recent'),
      S.recent.map((c) => el('button', { title: c, 'aria-label': c, style: `background:${c}`, onclick: () => { setColour(c); wheel.set(c); } }))) : null,
    ['Take a colour from the map (I)', () => setTool('pick')],
  ], 'colours');
}

/* -------------------------------------------------------------- pictures */

/* THE WORLD'S ROOM (2026-11-08): what the host keeps for this world -- the
 * draft's pictures and sounds and every published version's -- of the most
 * it may (sur/glurff `store-max`), as of the last save. Checked here first,
 * so nothing is sent that cannot be kept; the host checks again. */
const room = () => (S.home?.room?.max ? S.home.room : null);
const roundMB = (bytes) => `${Math.round(bytes / 1048576)} MB`;
function roomFor(bytes) {
  const r = room();
  if (r && r.used + bytes > r.max) {
    throw new Error(`it needs ${megabytes(bytes)}, and this world has ${megabytes(Math.max(0, r.max - r.used))} of its ${roundMB(r.max)} left. Remove pictures or sounds it no longer uses, then try again`);
  }
}
function storageRow() {
  const r = room(); if (!r) return null;
  const pc = Math.min(100, Math.round((100 * r.used) / r.max));
  return el('div', { class: 'storage', title: 'Pictures and sounds this world keeps on your ship: the draft\'s, and every published version\'s.' },
    el('span', {}, `Storage: ${megabytes(r.used)} of ${roundMB(r.max)}`),
    el('span', { class: `bar${pc >= 90 ? ' full' : ''}` }, el('i', { style: `width:${pc}%` })));
}
async function keep(copy) {
  roomFor(copy.blob.size);
  S.sending++;
  try {
    const a = await host.putAsset(copy.blob, copy.mime);
    known.set(a.hash, { mime: a.mime, size: a.size, w: a.w, h: a.h });
    return { src: a.hash, w: a.w, h: a.h };
  } finally { S.sending--; }
}
const pickFile = (accept = IMAGE_TYPES.join(',')) => new Promise((resolve) => { const i = el('input', { type: 'file', accept, onchange: () => resolve(i.files[0] ?? null) }); i.click(); });

/* A NEW MAP, from any picture: all of it, or the part dragged over. */
async function addMap(given = null, choose = null) {
  const file = given ?? await pickFile(); if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) return say('A JPEG, PNG or WebP image, please.', true);
  const choice = choose ?? await cropDialog(file, 'A new map');
  if (!choice) return;
  try {
    const p = await painting(file, choice.crop);
    const m = newMap(S.doc, { name: `Map ${S.doc.maps.length + 1}`, size: [p.master.w, p.master.h], image: p.visitor, source: p.source });
    furnish(m);
    change((d) => { d.maps.push(m); d.world.entry ??= m.spawn; });
    chooseMap(m.id);
    say('Made. Set how tall people are from its tab, then draw its walls.');
  } catch (e) { say(`The image did not come in: ${e.message}`, true); }
}
/* AN EMPTY MAP, in space (2026-11-08): people stand among the stars, on
 * whatever is drawn and placed there. */
function addSpaceMap() {
  const m = newMap(S.doc, { name: `Map ${S.doc.maps.length + 1}` });
  furnish(m);
  change((d) => { d.maps.push(m); d.world.entry ??= m.spawn; });
  chooseMap(m.id);
  say('Made: an empty map in space. Add a map image, or draw walls and areas as it is.');
}
/* A map in space is as big as its owner says. Smaller leaves anything past
 * the new edge off the map, which the checks then point out. */
const MIN_SIDE = 256;
function resize(m, i, input) {
  const v = Math.round(Number(input.value));
  if (!Number.isFinite(v) || v < MIN_SIDE || v > LIMITS.side) { input.value = m.size[i]; return say(`A side is ${MIN_SIDE} to ${LIMITS.side} pixels.`, true); }
  if (v === m.size[i]) return;
  change(() => { m.size[i] = v; m.grid = Math.max(m.grid, coarsest(m.size)); });
  fit();
}
function removePicture(m) {
  change(() => { delete m.image; delete m.source; });
  say('Map image removed. Everything drawn stays: it is a map in space now.');
}
/* CLEAR THIS MAP (2026-11-08): back to empty space -- its picture and
 * everything on it go, but for where people arrive and the world's chat,
 * which a world needs. Undo brings it all back. */
function clearMap(m) {
  if (!confirm('Clear this map? Its map image and everything on it go: walls, foreground, areas, items, doors and pictures. Where people arrive stays, and so does the world\'s chat. Undo brings it back.')) return;
  change((d) => {
    const chat = m.areas.find((a) => a.mode === 'world'), arrival = m.arrivals.find((a) => a.id === m.spawn) ?? m.arrivals[0];
    m.areas = chat ? [chat] : [];
    /* The chat's own shapes, and the rubbing-out that shaped it. */
    m.zones = chat ? m.zones.filter((op) => op.a === chat.id || op.a == null) : [];
    m.walk = []; m.front = []; m.items = [];
    m.arrivals = arrival ? [arrival] : [];
    if (arrival) m.spawn = arrival.id;
    delete m.image; delete m.source; delete m.over; delete m.paint;
    if (!d.maps.some((x) => x.arrivals.some((a) => a.id === d.world.entry))) d.world.entry = d.maps[0]?.spawn ?? null;
  });
  S.sel = null; S.card = null; S.areaId = null; renderAll();
  say('Cleared. Undo brings it back.');
}
async function painting(file, crop) {
  say('Preparing the picture…', false, true); await drawn();
  const p = await preparePainting(file, crop);
  const copies = [p.original, p.master, p.visitor].filter((c, i, all) => all.indexOf(c) === i);
  const bytes = copies.reduce((n, c) => n + c.blob.size, 0);
  roomFor(bytes);
  return waiting(`Sending it to your ship (${megabytes(bytes)})…`, async () => {
    const original = await keep(p.original);
    const master = p.master === p.original ? original : await keep(p.master);
    const visitor = p.visitor === p.master ? master : await keep(p.visitor);
    return { master, visitor, source: { src: original.src, w: original.w, h: original.h, crop: crop ?? [0, 0, original.w, original.h] } };
  });
}
async function changePicture(m) {
  const file = await pickFile(); if (!file) return;
  const choice = await cropDialog(file, m.image ? 'A new image for this map' : 'This map\'s image'); if (!choice) return;
  try {
    const p = await painting(file, choice.crop), [W, H] = m.size, sx = p.master.w / W, sy = p.master.h / H;
    if (sx === 1 && sy === 1) { change(() => { m.image = p.visitor; m.source = p.source; }); return say('Map image changed; everything drawn stays where it was.'); }
    const scaled = ['walk', 'front', 'zones'].map((f) => (m[f] ?? []).map((op) => scaleOp(op, sx, sy)));
    const fits = !scaled.some((ops) => ops.includes(null));
    change(() => {
      if (fits) {
        [m.walk, m.front, m.zones] = scaled.map((ops) => ops.map(tidyOp));
        for (const a of m.arrivals) { a.x = Math.round(a.x * sx); a.y = Math.round(a.y * sy); if (a.shape) a.shape = tidyOp(scaleOp(a.shape, sx, sy) ?? a.shape); }
        for (const it of m.items) {
          if (it.shape) it.shape = tidyOp(scaleOp(it.shape, sx, sy) ?? it.shape);
          if (it.image) it.image.at = [it.image.at[0] * sx, it.image.at[1] * sy, it.image.at[2] * sx, it.image.at[3] * sy].map(Math.round);
          if (it.do?.screen) it.do.screen = carried(it.do.screen, [0, 0, 1, 1], [0, 0, sx, sy]);
        }
      }
      /* The painting stretches with the picture. */
      if (m.paint) m.paint.size = m.paint.size.map((n, i) => Math.max(1, Math.min(LIMITS.side, Math.round(n * (i ? sy : sx)))));
      m.size = [p.master.w, p.master.h]; m.image = p.visitor; m.source = p.source; m.grid = Math.max(m.grid, coarsest(m.size));
    });
    say(fits ? 'Map image in, and everything drawn stretched to fit it.' : 'Map image in. Filled parts could not stretch: check they line up.');
    fit();
  } catch (e) { say(`The image did not come in: ${e.message}`, true); }
}
async function cropDialog(file, title) {
  const img = await loadImage(file);
  return new Promise((resolve) => {
    const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 860 / W, 520 / H);
    const c = el('canvas', { width: Math.round(W * k), height: Math.round(H * k) }), g = c.getContext('2d');
    let crop = null, from = null;
    const info = el('p', { class: 'note' });
    const draw = () => {
      g.drawImage(img, 0, 0, c.width, c.height);
      if (crop) { g.fillStyle = '#000a'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, ...crop, crop[0] * k, crop[1] * k, crop[2] * k, crop[3] * k); g.strokeStyle = '#f0b84b'; g.lineWidth = 2; g.strokeRect(crop[0] * k, crop[1] * k, crop[2] * k, crop[3] * k); }
      info.textContent = crop ? `Using the part you dragged over (${crop[2]} × ${crop[3]}).` : 'Using all of it. To use only one part, like one floor of a sheet, drag over it.';
    };
    const at = (e) => { const r = c.getBoundingClientRect(); return [Math.max(0, Math.min(W, Math.round((e.clientX - r.left) / r.width * W))), Math.max(0, Math.min(H, Math.round((e.clientY - r.top) / r.height * H)))]; };
    c.addEventListener('pointerdown', (e) => { from = at(e); c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => { if (!from) return; const q = at(e); crop = [Math.min(from[0], q[0]), Math.min(from[1], q[1]), Math.abs(q[0] - from[0]), Math.abs(q[1] - from[1])]; if (crop[2] < 8 || crop[3] < 8) crop = null; draw(); });
    c.addEventListener('pointerup', () => { from = null; });
    const dlg = el('dialog', {}, el('h3', {}, title), el('div', { class: 'crop' }, c), info,
      el('div', { class: 'actions' }, el('button', { onclick: () => { crop = null; draw(); } }, 'Use all of it'),
        el('button', { onclick: () => { dlg.close(); resolve(null); } }, 'Cancel'),
        el('button', { class: 'primary', onclick: () => { dlg.close(); resolve({ crop }); } }, 'Use it')));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(null); });
    document.body.append(dlg); draw(); dlg.showModal();
  });
}
/* A PICTURE ON THE MAP: just a picture, behind people. Paint foreground over
 * it to put it in front, or walls over it to make it block the way. */
async function placeImage(given = null) {
  if (!map()) return say('Add a map first, with +.', true);
  const file = given ?? await pickFile(); if (!file) return;
  if (!IMAGE_TYPES.includes(file.type)) return say('A JPEG, PNG or WebP picture, please.', true);
  try {
    say('Preparing the picture…', false, true); await drawn();
    const p = await prepareItem(file);
    const img = await waiting(`Sending the picture to your ship (${megabytes(p.visitor.blob.size)})…`, () => keep(p.visitor)), m = map(), v = S.view;
    if (!m) return say('Its map was deleted while it was on its way.', true);
    const cx = v.ox + stage.clientWidth / 2 / v.z, cy = v.oy + stage.clientHeight / 2 / v.z;
    const k = Math.min(1, (stage.clientWidth / v.z) / 3 / p.original.w, (stage.clientHeight / v.z) / 3 / p.original.h);
    const w = Math.round(p.original.w * k), h = Math.round(p.original.h * k), id = freshId('picture', idsOf(S.doc, 'items'));
    change(() => { m.items.push({ id, name: 'Picture', image: { ...img, at: [Math.round(cx - w / 2), Math.round(cy - h / 2), w, h], layer: 'back' }, do: { kind: 'none' } }); });
    if (S.layer !== 'pictures') setLayer('pictures');
    setTool('select'); S.sel = { kind: 'image', id }; S.card = null; renderCard();
    say('Drag it where it goes. Its corners resize it in proportion, the dots on its sides stretch it and the round handle turns it.');
  } catch (e) { say(`The picture did not come in: ${e.message}`, true); }
}
function deleteMap() {
  const m = map();
  if (!confirm('Delete this map and everything drawn on it?')) return;
  buffers.delete(m.id);
  change((d) => { d.maps = d.maps.filter((x) => x.id !== m.id); if (!d.maps.some((x) => x.arrivals.some((a) => a.id === d.world.entry))) d.world.entry = d.maps[0]?.spawn ?? null; });
  chooseMap(S.doc.maps[0]?.id);
}

/* ------------------------------------------------- save, publish, test */

async function save() {
  clearTimeout(saveTimer);
  if (S.saving || !S.dirty) return !S.dirty;
  S.saving = true; renderTop();
  const version = S.version;
  try {
    S.doc = withAssets(S.doc, known);
    /* As it is now: painting may go on while its tiles are sent. */
    const doc = JSON.parse(JSON.stringify(S.doc));
    await sendPainting(doc);
    const saved = await host.saveDraft(doc, S.rev);
    S.rev = saved.rev; S.saving = false;
    savedTiles = tilesOf(doc);
    S.dirty = S.version !== version;
    if (S.dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 2500); }
    if (saved.max && S.home) S.home.room = { used: saved.used, max: saved.max };
    if (S.message?.text.startsWith('Not saved')) S.message = null;
    renderTop();
    return true;
  } catch (e) {
    S.saving = false;
    if (e.conflict) {
      if (confirm('This world was changed in another window since you opened it. Keep your version (theirs is lost)?')) { S.rev = e.body?.rev ?? S.rev; return save(); }
      say('Not saved: it was changed elsewhere. Reload to see that version.', true);
      return false;
    }
    /* A ship that did not answer, or failed, is tried again in a while,
     * changed or not: nothing else would. One that refused it is not. */
    const again = !e.status || e.status >= 500;
    say(`Not saved: ${e.message}.${again ? ' Trying again shortly.' : ''}`, true);
    if (again) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save(), 15_000); }
    return false;
  }
}

/* What needs fixing, in the editor's words, each leading to the thing. */
function problemText(p) {
  const name = (kind, id) => {
    for (const [i, m] of S.doc.maps.entries()) {
      if (kind === 'area') { const a = m.areas.find((x) => x.id === id); if (a) return `Area “${a.name}” (Map ${i + 1})`; }
      if (kind === 'arrival') { const a = m.arrivals.find((x) => x.id === id); if (a) return `Door “${a.name ?? id}” (Map ${i + 1})`; }
      if (kind === 'item') { const it = m.items.find((x) => x.id === id); if (it) return `${isWay(m, it) ? 'Door' : 'Item'} “${it.name}” (Map ${i + 1})`; }
      if (kind === 'map' && m.id === id) return `Map ${i + 1}`;
    }
    return id;
  };
  return p.replace(/^(area|arrival|item|map) ([a-z0-9-]+)/, (_, k, id) => name(k, id))
    .replace('is outside the map or inside a wall', 'is inside a wall or off the map: move it')
    .replace(/leads to no arrival point: ?\S*/, 'leads to no door yet: choose one')
    .replace('needs an arrival point to lead to', 'leads to no door yet: choose one')
    .replace(/needs its main area.*/, 'needs its main area');
}
function showProblems(anchor) {
  popover(anchor, [el('p', { class: 'note' }, 'Fix these, then publish:'), ...S.problems.slice(0, 20).map((p) => [problemText(p), () => goTo(p)])]);
}
function goTo(p) {
  const [, kind, id] = p.match(/^(area|item|arrival|map) ([a-z0-9-]+)/) ?? [];
  const m = S.doc.maps.find((x) => (kind === 'map' ? x.id === id : (kind === 'area' ? x.areas : kind === 'item' ? x.items : x.arrivals).some((y) => y.id === id)));
  if (!m) return;
  chooseMap(m.id); setTool('select');
  const it = kind === 'item' ? m.items.find((x) => x.id === id) : null;
  if (kind === 'arrival' || (it && isWay(m, it))) { setLayer('doors'); S.sel = { kind: 'door', id }; S.card = 'door'; }
  else if (kind === 'item') { setLayer('items'); S.sel = { kind: 'item', id }; S.card = 'item'; }
  else if (kind === 'area') { setLayer('areas'); S.areaId = id; renderDrawing(); }
  renderCard(); paint();
}
async function publish(e) {
  if (S.problems.length) return showProblems(e?.currentTarget ?? $('.top .primary'));
  if (!(await save())) return;
  const listing = S.home?.listing, first = !hasNote();
  if (!confirm(`Give this to visitors? They get it the next time they come in.${first ? `\n\nIts first publish: its note is made in Noltbook now, called ${S.doc.world.name}, and anybody can join it.` : ''}${listing ? `\n\nIt is also listed on ${listing}'s Glurff, so people can find it: ${listing} joins its note.` : ''}`)) return;
  S.saving = true; renderTop();
  try {
    if (first) await makeNote();
    const r = await host.publish(S.rev); S.home.live = r.release; say('Published. Visitors get it the next time they come in.'); void listWith(listing);
  }
  catch (err) { if (err.errors?.length) { S.problems = err.errors; say('Your ship found things to fix.', true); } else say(`Not published: ${err.message}`, true); }
  finally { S.saving = false; renderTop(); }
}
/* ITS NOTE, AT ITS FIRST PUBLISH (2026-11-10): made with Noltbook's own
 * create-note -- which says the new note's id on /api/results -- given to
 * our agent as this Glurff's, made public, and given the icon that waited
 * in this browser. A note made and not given (the ship slow, say) is not
 * made again: the next Publish starts over only from what failed. */
async function makeNote() {
  say('Making its note in Noltbook…', false, true);
  const id = S.madeNote ?? (S.madeNote = await createNote((S.doc.world.name || `${host.ourShip()}'s Glurff`).trim().slice(0, NAME_MAX)));
  S.home = { ...S.home, ...(await host.setNote(id)) };
  S.madeNote = null;
  await poke('noltbook', 'noltbook-api', { action: 'set-note-config', data: { noteId: id, visibility: 'public' } });
  const icon = pendingIcon();
  if (icon) {
    const { r } = await host.reach(`/apps/noltbook/upload-icon/${encodeURIComponent(id)}`, { method: 'POST', body: await (await fetch(icon)).blob() }, host.WAIT.save);
    if (r.ok) { try { localStorage.removeItem(ICON_KEY); } catch {} S.iconRev = Date.now(); }
  }
  await settled();
  await loadNote();
}
/* A new note, by Noltbook's API: asked and answered on a channel of our
 * own, closed after. Its id, or an error. */
async function createNote(name) {
  const url = `/~/channel/editor-${Date.now()}-${Math.random().toString(36).slice(2)}`, ship = host.ourShip().slice(1);
  const rid = Math.floor(Math.random() * 1e9);
  const put = (body) => fetch(url, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const r = await put([{ id: 1, action: 'subscribe', ship, app: 'noltbook', path: '/api/results' },
      { id: 2, action: 'poke', ship, app: 'noltbook', mark: 'noltbook-api', json: { action: 'create-note', requestId: rid, data: { name } } }]);
    if (!r.ok) throw new Error(`Noltbook was not asked (${r.status})`);
    return await new Promise((resolve, reject) => {
      const es = new EventSource(url, { withCredentials: true });
      const timer = setTimeout(() => { es.close(); reject(new Error('Noltbook did not answer')); }, host.WAIT.save);
      es.onmessage = (ev) => {
        let a = null;
        try { a = JSON.parse(ev.data)?.json?.['api-result']; } catch {}
        if (a?.requestId !== rid) return;
        clearTimeout(timer); es.close();
        if (a.ok && a.noteId) resolve(a.noteId); else reject(new Error(a.message || a.code || 'Noltbook did not make it'));
      };
    });
  } finally { put([{ id: 3, action: 'delete' }]).catch(() => {}); }
}
/* LISTED (2026-11-08): the ship Glurffs are listed with joins our note, if
 * it is not in it already -- Noltbook's own add-member -- and our agent has
 * told it the note is a Glurff (on Publish). */
async function listWith(ship) {
  if (!ship || ship === host.ourShip()) return;
  try {
    const r = await fetch(`/~/scry/noltbook/api/notes/${S.home.note}/members.json`, { credentials: 'include' });
    const rows = r.ok ? (await r.json())?.members ?? [] : [];
    if (rows.some((m) => m.ship === ship && !m.removed)) return;
    await poke('noltbook', 'noltbook-api', { action: 'add-member', data: { noteId: S.home.note, ship } });
  } catch (err) { console.warn('listing', err); }
}
/* UNPUBLISH (2026-11-09; it was History's "Take it down"): release 0 --
 * nobody is given this world until a version is published or chosen again,
 * and our agent takes it off the list it is on. The draft and every version
 * are kept. True if it was taken down. */
async function unpublish() {
  const listing = S.home?.listing;
  if (!confirm(`Unpublish this Glurff? Nobody can come in until you publish again. Your draft and every version you published are kept.${listing ? `\n\nIt also comes off ${listing}'s list of Glurffs.` : ''}`)) return false;
  S.saving = true; renderTop();
  try { await host.makeLive(0); S.home.live = null; say('Unpublished: nobody can visit now.'); return true; }
  catch (err) { say(`Not unpublished: ${err.message}`, true); return false; }
  finally { S.saving = false; renderTop(); }
}
async function showHistory() {
  let all; try { all = await host.releases(); } catch (e) { return say(e.message, true); }
  const dlg = el('dialog', { class: 'history' });
  /* DELETE (2026-11-09): versions visitors are not given. Pictures only they
   * used go a day later, as anything nothing uses does (app/glurff `forget`). */
  const forget = async (ns) => {
    const one = ns.length === 1;
    if (!confirm(`${one ? `Delete version ${ns[0]}?` : `Delete the ${ns.length} other versions?`} ${one ? 'It' : 'They'} can't be given to visitors again. Pictures only ${one ? 'it uses' : 'they use'} are let go within a day.`)) return;
    try { for (const n of ns) all = await host.forget(n); say(one ? `Deleted version ${ns[0]}.` : `Deleted ${ns.length} versions.`); }
    catch (err) { say(`Not deleted: ${err.message}`, true); try { all = await host.releases(); } catch {} }
    draw();
  };
  const draw = () => {
    const old = all.releases.filter((r) => r.release !== all.live).map((r) => r.release);
    dlg.replaceChildren(el('h3', {}, 'History'), el('p', { class: 'note' }, 'Every version you published. Choose one to give visitors again, or delete the ones you no longer need.'),
      all.releases.length ? el('table', {}, all.releases.map((r) => el('tr', {}, el('td', {}, `Version ${r.release}`), el('td', {}, new Date(r.at * 1000).toLocaleString()),
        el('td', {}, r.release === all.live ? el('strong', {}, 'what visitors see') : el('button', { onclick: async () => {
          try { await host.makeLive(r.release); S.home.live = r.release; say(`Visitors get version ${r.release} again.`); renderTop(); dlg.close(); void listWith(S.home?.listing); } catch (err) { say(err.message, true); }
        } }, 'Go back to this')),
        el('td', {}, r.release === all.live ? null : el('button', { class: 'danger', title: `Delete version ${r.release}`, onclick: () => forget([r.release]) }, 'Delete'))))) : el('p', {}, 'Nothing published yet.'),
      all.live != null ? el('p', { class: 'note' }, 'Visitors can come in now.') : all.releases.length ? el('p', { class: 'note' }, 'Unpublished: nobody can visit until you publish, or choose a version here.') : null,
      el('div', { class: 'actions' },
        all.live != null && old.length > 1 && el('button', { class: 'danger', onclick: () => forget(old) }, 'Delete all other versions'),
        /* TAKE IT DOWN (2026-11-08): release 0 -- nobody is given this world
         * until a version is published or chosen again. */
        all.live != null && el('button', { class: 'danger', onclick: async () => { if (await unpublish()) dlg.close(); } }, 'Unpublish'),
        el('button', { onclick: () => dlg.close() }, 'Close')));
  };
  draw();
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}
async function playtest() {
  if (!(await save())) return;
  const m = map(), at = S.sel?.kind === 'door' ? S.sel.id : m.spawn;
  const frameEl = el('iframe', { src: `/apps/glurff/playtest.html?rev=${S.rev}&at=${encodeURIComponent(at)}`, title: 'Playtest' });
  const box = el('div', { class: 'playtest' }, el('header', {}, el('strong', {}, 'Playtest'), el('span', { class: 'note' }, 'Nobody sees you; nothing is joined.'),
    el('span', { class: 'grow' }), el('button', { onclick: () => box.remove() }, 'Back to editing')), frameEl);
  document.body.append(box); frameEl.focus();
}

/* --------------------------------------------------- whole-world files */

async function packageBytes() {
  const doc = withAssets(S.doc, known), bytes = new Map(), meta = {};
  for (const hash of hashesOf(doc)) {
    const r = await fetch(host.assetUrl(hash), { credentials: 'include' });
    if (!r.ok) throw new Error(`a picture did not come (${r.status})`);
    bytes.set(hash, new Uint8Array(await r.arrayBuffer()));
    const k = known.get(hash); meta[hash] = { mime: k?.mime ?? r.headers.get('content-type')?.split(';')[0], w: k?.w, h: k?.h };
  }
  return pack(doc, bytes, { host: host.ourShip(), note: S.home.note, release: S.home.live ?? null, rev: S.rev }, meta);
}
async function exportWorld() {
  if (!(await save())) return;
  say('Packing the world…');
  try {
    const bytes = await packageBytes();
    const a = el('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), download: `${slug(S.doc.world.name, 'glurff')}-${new Date().toISOString().slice(0, 10)}.gwp` });
    document.body.append(a); a.click(); a.remove();
    say(`Saved as a file (${megabytes(bytes.length)}). Keep it yourself: it holds the pictures.`);
  } catch (e) { say(`Not saved as a file: ${e.message}`, true); }
}
async function importWorld(given = null, chosen = null) {
  const file = given ?? await pickFile('.gwp'); if (!file) return;
  let opened;
  try { opened = await unpack(file instanceof Uint8Array ? file : await file.arrayBuffer()); } catch (e) { return say(e.message, true); }
  const moved = chosen ?? await bindingDialog(opened); if (!moved) return;
  const doc = retarget(opened.doc, moved);
  try {
    let n = 0;
    for (const [hash, a] of opened.assets) {
      const kept = await waiting(`Sending pictures to your ship: ${++n} of ${opened.assets.size}…`, async () => {
        S.sending++;
        try { return await host.putAsset(new Blob([a.bytes], { type: a.mime }), a.mime); } finally { S.sending--; }
      });
      if (kept.hash !== hash) throw new Error('a picture changed on the way');
      known.set(hash, { mime: kept.mime, size: kept.size, w: kept.w, h: kept.h });
    }
  } catch (e) {
    /* What is being edited keeps its pictures until the opened world replaces it. */
    const full = e.status === 507 ? '. Start over with a blank Glurff first, give it a few minutes, then open it again' : '';
    return say(`Not opened: ${e.message}${full}`, true);
  }
  history.record(S.doc);
  S.doc = doc; S.mapId = doc.maps[0]?.id ?? null; S.sel = null; S.card = null;
  touched(); fit(); renderAll();
  say(`Opened ${doc.world.name}. Playtest it, then publish.`);
}
function bindingDialog(opened) {
  const b = bindingsOf(opened.doc); if (!notes) loadNotes();
  const distinct = (kind, key) => [...new Map(b.filter((x) => x.kind === kind).map((x) => [x[key], x])).values()];
  return new Promise((resolve) => {
    const rows = [];
    const noteRows = distinct('note', 'note').map((x) => {
      const sel = el('select', {}, el('option', { value: '' }, `keep ${x.note}`), (notes ?? []).map((n) => el('option', { value: n.id }, n.name)));
      rows.push(() => (sel.value ? ['notes', x.note, { note: sel.value, host: notes.find((n) => n.id === sel.value)?.creator ?? null }] : null));
      return el('tr', {}, el('td', {}, `A note (${x.where})`), el('td', {}, sel));
    });
    const textRows = (kind, label, bucket) => distinct(kind, 'host').map((x) => {
      const input = el('input', { value: x.host });
      rows.push(() => (input.value.trim() && input.value.trim() !== x.host ? [bucket, x.host, input.value.trim()] : null));
      return el('tr', {}, el('td', {}, `${label} ${x.host}`), el('td', {}, input));
    });
    const table = [...noteRows, ...textRows('world', 'The Glurff of', 'worlds'), ...textRows('app', 'Apps from', 'publishers')];
    const dlg = el('dialog', {}, el('h3', {}, `Open ${opened.doc.world?.name ?? 'a world'}`),
      el('p', { class: 'note' }, `${opened.doc.maps.length} map${opened.doc.maps.length === 1 ? '' : 's'}, ${opened.assets.size} pictures, every one checked. It replaces what you are editing; visitors see nothing until you publish.`),
      table.length ? el('table', {}, table) : '',
      el('div', { class: 'actions' }, el('button', { onclick: () => { dlg.close(); resolve(null); } }, 'Cancel'),
        el('button', { class: 'primary', onclick: () => { const out = { notes: {}, worlds: {}, publishers: {} }; for (const r of rows) { const v = r(); if (v) out[v[0]][v[1]] = v[2]; } dlg.close(); resolve(out); } }, 'Open it')));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(null); });
    document.body.append(dlg); dlg.showModal();
  });
}

/* For the headless checks, as the game has window.__game: a file chooser
 * cannot be driven from outside, so they hand these a File. */
window.__editor = { S, known, save, flush, glurffPanel, publish, chooseMap, setLayer, setTool, setScale, change, undo, redo, renderAll,
  addMap: (file, crop = null) => addMap(file, { crop }), placeImage: (file) => placeImage(file), validate: () => S.problems,
  packageBytes, importWorld: (bytes, moved = {}) => importWorld(bytes, moved), toScreen, problemText };

boot();

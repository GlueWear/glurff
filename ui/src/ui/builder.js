/* The character builder.
 *
 * Deliberately tiny: a row per slot, arrows to cycle, a swatch strip for the
 * slots that tint, and a preview. Turf's own editor is explicitly not carried
 * over -- it is powerful and very hard to use, and this is meant to take
 * thirty seconds.
 *
 * The preview is IN the panel. Dressing the character out in the world is not
 * a preview: the panel is fixed dead centre and the camera keeps you dead
 * centre, so the only thing you could not see while editing was yourself.
 */
import { CATALOG, SLOTS, TINTABLE, PALETTE, SKIN, DEFAULT_LOOK, completeLook, DIRS } from 'world/parts';
import { paintCharacter } from 'world/paint';

const LABEL = {
  body: 'Body', hair: 'Hair', brows: 'Brows', eyes: 'Eyes',
  mouth: 'Mouth', top: 'Top', bottom: 'Bottom',
};

export class Builder {
  constructor(root, { onChange, onDone } = {}) {
    this.root = root;
    this.onChange = onChange ?? (() => {});
    this.onDone = onDone ?? (() => {});
    this.look = completeLook(null);
    this.open = false;
    this.dir = 'down';
    this.frame = 0;
    this.timer = null;
    /* Built once and kept, so cycling a part does not tear the canvas out and
     * restart the walk from a blank frame. */
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview';
  }

  setLook(look) {
    this.look = completeLook(look);
    if (this.open) this.render();
  }

  toggle() {
    this.open = !this.open;
    this.render();
    /* The walk runs only while the panel is up. Clothes animate over three
     * frames and standing still hides half of what you just chose. */
    clearInterval(this.timer);
    this.timer = null;
    if (this.open) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % 3;
        this.paint();
      }, 180);
    }
  }

  face(dir) {
    this.dir = dir;
    this.render();
  }

  paint() {
    if (!this.open) return;
    /* Sprites arrive over the network on first open; repaint when one lands so
     * the preview fills in rather than staying half-drawn. */
    paintCharacter(this.canvas, this.look, this.dir, this.frame, 4, () => this.paint());
  }

  cycle(slot, delta) {
    const parts = CATALOG[slot].parts;
    /* indexOf finds the empty entry too, so an empty slot cycles like any
     * other rather than jumping back to the start. */
    const cur = parts.indexOf(this.look[slot]?.part ?? '');
    const next = parts[(cur + delta + parts.length) % parts.length];
    this.look = { ...this.look, [slot]: { ...this.look[slot], part: next } };
    this.onChange(this.look);
    this.render();
  }

  tint(slot, colour) {
    this.look = { ...this.look, [slot]: { ...this.look[slot], tint: colour } };
    this.onChange(this.look);
    this.render();
  }

  render() {
    if (!this.open) { this.root.innerHTML = ''; return; }
    const rows = SLOTS.map((slot) => {
      const piece = this.look[slot] ?? {};
      const colours = slot === 'body' ? SKIN : PALETTE;
      const swatches = TINTABLE.has(slot)
        ? `<div class="swatches">${colours.map((c) =>
            `<button class="sw${piece.tint === c ? ' on' : ''}" data-slot="${slot}" data-tint="${c}"
              style="background:#${c.toString(16).padStart(6, '0')}"></button>`).join('')}</div>`
        : '';
      return `<div class="row">
        <span class="label">${LABEL[slot]}</span>
        <button data-slot="${slot}" data-d="-1">&lsaquo;</button>
        <span class="part">${piece.part ? piece.part.replace(/-/g, ' ') : 'none'}</span>
        <button data-slot="${slot}" data-d="1">&rsaquo;</button>
        ${swatches}
      </div>`;
    }).join('');
    this.root.innerHTML = `<div class="builder">
      <h3>Your character</h3>
      <div class="preview-box">
        <div class="preview-slot"></div>
        <div class="dirs">${DIRS.map((d) =>
          `<button class="dir${d === this.dir ? ' on' : ''}" data-dir="${d}">${d}</button>`).join('')}</div>
      </div>
      ${rows}
      <button class="done">Done</button>
    </div>`;
    this.root.querySelector('.preview-slot').appendChild(this.canvas);
    this.paint();

    this.root.querySelectorAll('button[data-dir]').forEach((b) =>
      b.onclick = () => this.face(b.dataset.dir));
    this.root.querySelectorAll('button[data-d]').forEach((b) =>
      b.onclick = () => this.cycle(b.dataset.slot, Number(b.dataset.d)));
    this.root.querySelectorAll('button[data-tint]').forEach((b) =>
      b.onclick = () => this.tint(b.dataset.slot, Number(b.dataset.tint)));
    this.root.querySelector('.done').onclick = () => { this.onDone(this.look); this.toggle(); };
  }
}

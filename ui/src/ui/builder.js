/* The character builder.
 *
 * A row per slot: the styles the art has, then that style's colours as
 * swatches, and "none" for anything you can go without. Four hundred parts
 * behind two clicks -- a list of four hundred names would be unusable, and
 * arrows to cycle through them worse.
 *
 * The preview is IN the panel. Dressing the character out in the world is not
 * a preview: the panel is fixed dead centre and the camera keeps you dead
 * centre, so the only thing you could not see while editing was yourself.
 */
import { CATALOG, SLOTS, DIRS, completeLook, groupsOf, variantOf } from 'world/parts';
import { paintCharacter } from 'world/paint';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const title = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
    /* Which style each slot is showing colours for; the one being worn, or the
     * first, so the panel opens on something. */
    this.group = {};
    /* Built once and kept, so changing a part does not tear the canvas out and
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
    /* The walk runs only while the panel is up. Clothes animate over four
     * frames and standing still hides half of what you just chose. */
    clearInterval(this.timer);
    this.timer = null;
    if (this.open) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % 4;
        this.paint();
      }, 160);
    }
  }

  face(dir) { this.dir = dir; this.render(); }

  paint() {
    if (!this.open) return;
    /* Sheets arrive over the network on first open; repaint when one lands so
     * the preview fills in rather than staying half-drawn. */
    paintCharacter(this.canvas, this.look, this.dir, this.frame, 9, () => this.paint());
  }

  /* The style whose colours the row is showing. ALWAYS a real style, even
   * where nothing is worn: the colours stay on screen so a row never changes
   * height and the list never jumps under the pointer. */
  groupFor(slot) {
    const worn = variantOf(slot, this.look[slot]?.part);
    if (worn) return worn.group;
    return this.group[slot] ?? [...groupsOf(slot).keys()][0];
  }

  wear(slot, part) {
    this.look = { ...this.look, [slot]: { ...this.look[slot], part } };
    this.onChange(this.look);
    this.render();
  }

  showGroup(slot, group) {
    /* "None" takes the thing off but leaves the row showing the style it was,
     * so its colours stay where they were and putting it back on is one click. */
    if (group === '') { this.wear(slot, ''); return; }
    this.group[slot] = group;
    /* Picking a style PUTS IT ON, rather than waiting for a colour to be
     * clicked as well. The colour you were wearing is kept where that style has
     * it, so browsing hats does not lose your black. */
    const worn = variantOf(slot, this.look[slot]?.part);
    const options = groupsOf(slot).get(group) ?? [];
    const same = worn && options.find((v) => v.colour === worn.colour);
    this.wear(slot, (same ?? options[0])?.key ?? '');
  }

  render() {
    if (!this.open) { this.root.innerHTML = ''; return; }
    const rows = SLOTS.map((slot) => {
      const meta = CATALOG[slot];
      if (!meta) return '';
      const groups = groupsOf(slot);
      const group = this.groupFor(slot);
      const worn = this.look[slot]?.part ?? '';
      /* "None" is one of the styles, where a slot allows it -- a cross beside
       * the colours read as "clear", which is a different thing. */
      const choices = [...(meta.optional ? [['', 'None']] : []), ...[...groups.keys()].map((g) => [g, title(g)])];
      /* A slot with one style still gets the box, so every row is built the
       * same width and the colours below them line up. */
      const selected = worn === '' && meta.optional ? '' : group;
      const styles = `<select data-style="${slot}"${choices.length > 1 ? '' : ' disabled'}>${choices.map(([value, name]) =>
        `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
      /* The colours of the style the row is showing, worn or not: clicking one
       * puts that style on in that colour. */
      const swatches = (groups.get(group) ?? []).map((v) =>
        `<button class="sw${v.key === worn ? ' on' : ''}" data-slot="${slot}" data-part="${esc(v.key)}"
           title="${esc(title(v.colour))}" style="background:${esc(v.swatch)}"></button>`).join('');
      return `<div class="row">
        <span class="label">${esc(meta.label)}</span>
        ${styles}
        <div class="swatches">${swatches}</div>
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
    this.root.querySelectorAll('button[data-part]').forEach((b) =>
      b.onclick = () => this.wear(b.dataset.slot, b.dataset.part));
    this.root.querySelectorAll('select[data-style]').forEach((s) =>
      s.onchange = () => this.showGroup(s.dataset.style, s.value));
    this.root.querySelector('.done').onclick = () => { this.onDone(this.look); this.toggle(); };
  }
}

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
import { CATALOG, SLOTS, DIRS, completeLook, groupsOf, variantOf, EXTRAS, EQUIPMENT, artUrl, equipmentOf, choicesOf, ownAttack as ownAttackOf } from 'world/parts';
import { paintStage } from 'world/paint';
import { esc } from 'ui/html';

const title = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export class Builder {
  constructor(root, { onChange, onDone } = {}) {
    this.root = root;
    this.onChange = onChange ?? (() => {});
    this.onDone = onDone ?? (() => {});
    this.look = completeLook(null);
    this.open = false;
    this.picking = false;
    this.equipmentReady = false;
    this.dir = 'down';
    /* THE PREVIEW STANDS STILL. It used to walk on the spot so the clothes
     * animated; a figure marching while you are trying to look at a hat is
     * movement with nothing to say. */
    this.frame = 0;
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

  setEquipmentReady(ready) {
    this.equipmentReady = !!ready;
    if (this.open) this.render();
  }

  toggle() {
    this.open = !this.open;
    this.render();
  }

  face(dir) { this.dir = dir; this.render(); }

  paint() {
    if (!this.open) return;
    /* Sheets arrive over the network on first open; repaint when one lands so
     * the preview fills in rather than staying half-drawn. */
    /* ONE SIZE, whatever is worn (world/paint paintStage); smaller on a phone. */
    const phone = typeof innerWidth === 'number' && innerWidth <= 700;
    paintStage(this.canvas, this.look, this.dir, this.frame,
      phone ? { scale: 8, width: 320, height: 230 } : { scale: 12, width: 500, height: 300 }, () => this.paint());
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
    this.look = completeLook({ ...this.look, [slot]: { ...this.look[slot], part } });
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
    if (this.picking) { this.renderPicker(); return; }
    const premade = equipmentOf('premade',this.look.premade?.part);
    const rows = (premade ? [] : SLOTS).map((slot) => {
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
    /* A ready-made character with its own attack carries no other weapon. */
    const ownAttack = premade?.animations?.attack ? premade.attack : null;
    const extras = EXTRAS.filter((slot) => !(slot === 'weapon' && ownAttack));
    this.root.innerHTML = `<div class="builder">
      <h3>${premade ? esc(premade.name) : 'Your character'}</h3>
      ${this.equipmentReady?`<div class="builder-modes"><button class="browse-characters">Pick a ready-made character</button>
        ${premade ? '<button class="build-own-btn">Build your own</button>' : ''}</div>`:''}
      <div class="preview-box">
        <div class="preview-slot"></div>
        <div class="dirs">${DIRS.map((d) =>
          `<button class="dir${d === this.dir ? ' on' : ''}" data-dir="${d}">${d}</button>`).join('')}</div>
      </div>
      ${rows}
      ${this.equipmentReady?`<div class="equipment">${extras.map(slot=>`<div class="row"><label class="label" for="equip-${slot}">${title(slot)}</label>
        <select id="equip-${slot}" data-equipment="${slot}">
        <option value="">None</option>${choicesOf(slot).map(item=>`<option value="${esc(item.key)}"${this.look[slot]?.part===item.key?' selected':''}>${esc(item.name)}</option>`).join('')}</select></div>`).join('')}</div>`:''}
      ${this.equipmentReady&&ownAttack?'<p class="bow-hint">'+weaponHint(ownAttackOf(this.look),true)+' Hits are just for fun—you get straight back up.</p>'
        :this.equipmentReady&&this.look.weapon?.part?'<p class="bow-hint">'+weaponHint(this.look.weapon.part)+' Hits are just for fun—you get straight back up.</p>':''}
      <p class="builder-error" role="status"></p>
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
    this.root.querySelectorAll('select[data-equipment]').forEach(s =>
      s.onchange = () => this.wear(s.dataset.equipment,s.value));
    const browse=this.root.querySelector('.browse-characters');
    if(browse)browse.onclick = () => {this.picking=true;this.render();};
    /* Back to a character of our own: the ready-made one comes off. */
    const own=this.root.querySelector('.build-own-btn');
    if(own)own.onclick = () => this.wear('premade','');
    this.root.querySelector('.done').onclick = (e) => this.finish(e.currentTarget);
  }

  /* DONE: saved, and the editor closes -- from the editor or the picker. */
  async finish(button) {
    button.disabled=true;
    try {await this.onDone(this.look);this.open=false;this.picking=false;this.render();}
    catch {const err=this.root.querySelector('.builder-error');if(err)err.textContent='Could not save. Please try again.';button.disabled=false;}
  }

  renderPicker() {
    /* Thumbnails at twice the atlas: its cells are small, and so are most of
     * the characters in them. Names in two parts -- the character, then its
     * kind -- so neither is squeezed into the other. */
    const atlas=EQUIPMENT.picker, cell=atlas.cell, zoom=2;
    const COLOURS=/^(blue|brown|green|purple|red|turquoise|yellow|regular|black|white|grey|gray)$/i;
    const parts=(name)=>{const [kind,...rest]=name.replace(/^Choosen /,'Chosen ').split(' · ');
      /* "Archer · Blue" is one name; "Chosen Ones · Dark Channeler" is a name and its kind. */
      return rest.length&&!COLOURS.test(rest.join(' '))?[rest.join(' · '),kind]:[[kind,...rest].join(' · '),''];};
    this.root.innerHTML=`<div class="builder character-picker">
      <div class="picker-head"><h3>Choose your character</h3><button class="picker-back">Back to your character</button><button class="picker-done">Done</button></div>
      <label class="character-search">Find a character <input type="search" placeholder="Name or collection" aria-label="Find a character"></label>
      <div class="character-grid"><button class="character-choice build-own" data-character=""><strong>Build your own</strong><span>Choose your body, clothes and colours</span></button>
      ${choicesOf('premade').map(item=>{const [name,kind]=parts(item.name);return `<button class="character-choice${this.look.premade?.part===item.key?' selected':''}" data-character="${esc(item.key)}" data-search="${esc((item.name+' '+item.group).toLowerCase())}" title="${esc(item.name+' — '+item.group)}">
        <span class="character-thumb" style="background-image:url('${artUrl(atlas.sheet)}');background-size:${atlas.cols*cell*zoom}px ${atlas.rows*cell*zoom}px;background-position:-${(item.thumb%atlas.cols)*cell*zoom}px -${Math.floor(item.thumb/atlas.cols)*cell*zoom}px"></span>
        <span class="character-name">${esc(name)}</span>${kind?`<span class="character-kind">${esc(kind)}</span>`:''}</button>`;}).join('')}</div><p class="character-credit">Minifantasy art by Krishna Palacio</p><p class="builder-error" role="status"></p></div>`;
    this.root.querySelector('.picker-back').onclick=()=>{this.picking=false;this.render();};
    this.root.querySelector('.picker-done').onclick=(e)=>this.finish(e.currentTarget);
    this.root.querySelectorAll('[data-character]').forEach(b=>b.onclick=()=>{
      this.picking=false;this.wear('premade',b.dataset.character);
    });
    this.root.querySelector('input').oninput=e=>{
      const query=e.target.value.toLowerCase().trim();
      this.root.querySelectorAll('[data-search]').forEach(b=>b.hidden=!b.dataset.search.includes(query));
    };
  }
}

/* How to use the weapon in hand: "1" and a click, or on a phone the sword
 * button and a tap (see ui/touch-controls). */
function weaponHint(part, own = false) {
  const verb = part === 'spell' ? 'cast' : ['bow', 'slingshot'].includes(part) ? 'shoot' : 'strike';
  const lead = own ? `Fights with its own ${{ cast: 'spell', shoot: 'shot' }[verb] ?? 'attack'}. ` : 'In your hands as soon as you’re done. ';
  return lead + (document.documentElement.classList.contains('touch')
    ? `Tap where to ${verb}; the sword button puts it away and back.`
    : `Click where to ${verb} (Space ${verb}s the way you face); 1 puts it away and back.`);
}

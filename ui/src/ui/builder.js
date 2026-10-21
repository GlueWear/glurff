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
import { paintStage, paintItem } from 'world/paint';
import { esc } from 'ui/html';

const title = (s) => String(s).replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
/* What the art calls a style, said the way a person would. */
const STYLE_NAMES = { bold: 'Bald', cowboyhat: 'Cowboy hat', fedorahat: 'Fedora', longhat: 'Long hat',
  pompombeanie: 'Pom-pom beanie', rangerhat: 'Ranger hat', trapperhat: 'Trapper hat', shoulderpads: 'Shoulder pads',
  longbeard: 'Long beard', 'chin-curtain': 'Chin curtain', 'chin-strap': 'Chin strap' };
const styleName = (g) => STYLE_NAMES[g] ?? title(g);
/* A choice's picture (paintStage): the whole character, at four times or more
 * -- a box any smaller rounds it down to three, too small for a hat. */
const PICTURE = { scale: 6, width: 84, height: 84, pad: 2 };
/* How often Random leaves an optional thing off. */
const BARE = { gloves: 0.6, shoulders: 0.7, beard: 0.6, hat: 0.5 };

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
    /* ONE SIZE, whatever is worn (world/paint paintStage), in the middle of a
     * box no bigger than it needs to be; smaller on a phone. */
    const phone = typeof innerWidth === 'number' && innerWidth <= 760;
    paintStage(this.canvas, this.look, this.dir, this.frame,
      phone ? { scale: 10, width: 260, height: 160 } : { scale: 12, width: 240, height: 190 }, () => this.paint());
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
    /* A ready-made character with its own attack carries no other weapon. */
    const ownAttack = premade?.animations?.attack ? premade.attack : null;
    const extras = EXTRAS.filter((slot) => !(slot === 'weapon' && ownAttack));
    /* PICTURES, NOT LISTS (2026-10-21): a tab for each thing worn -- the
     * clothes, and with equipment unlocked, the weapon, mount and companion --
     * and under it every choice as a picture of you wearing it, then its
     * colours. A ready-made character has no clothes to change. */
    const garments = premade ? [] : SLOTS.filter((slot) => CATALOG[slot]);
    const tabs = [...garments, ...(this.equipmentReady ? extras : [])];
    if (!tabs.includes(this.tab)) this.tab = tabs[0] ?? null;
    const tab = this.tab, isGarment = garments.includes(tab);
    /* Every picture's look, painted once the markup is in. */
    this.pictures = [];
    const picture = (look, alone = null) => { this.pictures.push({ look, alone }); return `<span class="item-pic"><canvas data-pic="${this.pictures.length - 1}"></canvas></span>`; };
    let items = '', swatches = '';
    if (isGarment) {
      const meta = CATALOG[tab], groups = groupsOf(tab), group = this.groupFor(tab);
      const worn = this.look[tab]?.part ?? '', wornVariant = variantOf(tab, worn);
      const selected = worn === '' && meta.optional ? '' : group;
      /* "None" is one of the choices, where a slot allows it. Each style is
       * pictured in the colour being worn, where it comes in that colour. */
      const choices = [...(meta.optional ? [['', 'None']] : []), ...[...groups.keys()].map((g) => [g, styleName(g)])];
      items = choices.map(([g, name]) => {
        const options = groups.get(g) ?? [];
        const key = g === '' ? '' : ((wornVariant && options.find((v) => v.colour === wornVariant.colour)) ?? options[0])?.key ?? '';
        return `<button class="item${g === selected ? ' on' : ''}" data-slot="${tab}" data-group="${esc(g)}" title="${esc(name)}"
          aria-pressed="${g === selected}">${picture({ ...this.look, [tab]: { ...this.look[tab], part: key } })}<span class="item-name">${esc(name)}</span></button>`;
      }).join('');
      /* The colours of the style the tab is showing, worn or not: clicking one
       * puts that style on in that colour. */
      swatches = (groups.get(group) ?? []).map((v) =>
        `<button class="sw${v.key === worn ? ' on' : ''}" data-slot="${tab}" data-part="${esc(v.key)}"
           title="${esc(title(v.colour))}" aria-label="${esc(title(v.colour))}" style="background:${esc(v.swatch)}"></button>`).join('');
    } else if (tab) {
      const slot = tab, worn = this.look[slot]?.part ?? '';
      items = [['', 'None'], ...choicesOf(slot).map((item) => [item.key, item.name])].map(([key, name]) =>
        `<button class="item${key === worn ? ' on' : ''}" data-equipment="${slot}" data-key="${esc(key)}" title="${esc(name)}"
          aria-pressed="${key === worn}">${picture({ ...this.look, [slot]: { ...this.look[slot], part: key } },
            /* A companion or a mount pictured on its own; a weapon in hand. */
            slot === 'weapon' ? null : equipmentOf(slot, key))}<span class="item-name">${esc(name)}</span></button>`).join('');
    }
    const label = (slot) => CATALOG[slot]?.label ?? title(slot);
    const tabButton = (slot) => `<button class="slot-tab${slot === tab ? ' on' : ''}" data-tab="${slot}"${garments.includes(slot) ? ` data-style="${slot}"` : ''}
      role="tab" aria-selected="${slot === tab}">${esc(label(slot))}</button>`;
    const hint = tab === 'weapon' || (!isGarment && ownAttack)
      ? (this.equipmentReady&&ownAttack?'<p class="bow-hint">'+weaponHint(ownAttackOf(this.look),true)+' Hits are just for fun—you get straight back up.</p>'
        :this.equipmentReady&&this.look.weapon?.part?'<p class="bow-hint">'+weaponHint(this.look.weapon.part)+' Hits are just for fun—you get straight back up.</p>':'') : '';
    /* TWO COLUMNS (2026-10-20): the character on the left, what it wears on
     * the right, Done always in reach -- it fits without scrolling on a
     * desktop, and on a phone it stacks. Rebuilt on every change, so where
     * the lists were scrolled to is kept: jumping back to the top under the
     * pointer was the worst of it. */
    const kept = [this.root.querySelector('.builder')?.scrollTop ?? 0, this.root.querySelector('.builder-main')?.scrollTop ?? 0];
    this.root.innerHTML = `<div class="builder editor">
      <div class="builder-head">
      <h3>${premade ? esc(premade.name) : 'Your character'}</h3>
      ${this.equipmentReady?`<div class="builder-modes"><button class="browse-characters">Pick a ready-made character</button>
        ${premade ? '<button class="build-own-btn">Build your own</button>' : ''}</div>`:''}
      </div>
      <div class="builder-body">
      <div class="builder-side">
        <div class="preview-box"><div class="preview-slot"></div></div>
        <div class="dirs">${DIRS.map((d) =>
          `<button class="dir${d === this.dir ? ' on' : ''}" data-dir="${d}">${d}</button>`).join('')}</div>
        ${premade ? '' : '<button class="random-look" title="Different clothes, colours and hair, at random">Random</button>'}
      </div>
      <div class="builder-main">
      ${tabs.length ? `<div class="slot-tabs" role="tablist">${garments.map(tabButton).join('')}${garments.length && this.equipmentReady
        ? '<span class="slot-divider" aria-hidden="true"></span>' : ''}${(this.equipmentReady ? extras : []).map(tabButton).join('')}</div>
      <div class="slot-panel" role="tabpanel">
        <div class="items">${items}</div>
        ${swatches ? `<div class="colours"><span class="colours-label">Colour</span><div class="swatches">${swatches}</div></div>` : ''}
        ${hint}
      </div>` : ''}
      </div>
      </div>
      <div class="builder-foot"><p class="builder-error" role="status"></p><button class="done primary">Done</button></div>
    </div>`;
    this.root.querySelector('.preview-slot').appendChild(this.canvas);
    this.paint();
    this.paintPictures();
    this.root.querySelector('.builder').scrollTop = kept[0];
    this.root.querySelector('.builder-main').scrollTop = kept[1];

    this.root.querySelectorAll('button[data-dir]').forEach((b) =>
      b.onclick = () => this.face(b.dataset.dir));
    this.root.querySelectorAll('button[data-tab]').forEach((b) =>
      b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
    this.root.querySelectorAll('button[data-part]').forEach((b) =>
      b.onclick = () => this.wear(b.dataset.slot, b.dataset.part));
    this.root.querySelectorAll('button[data-group]').forEach((b) =>
      b.onclick = () => this.showGroup(b.dataset.slot, b.dataset.group));
    this.root.querySelectorAll('button[data-equipment]').forEach(b =>
      b.onclick = () => this.wear(b.dataset.equipment,b.dataset.key));
    const random=this.root.querySelector('.random-look');
    if(random)random.onclick = () => this.randomise();
    const browse=this.root.querySelector('.browse-characters');
    if(browse)browse.onclick = () => {this.picking=true;this.render();};
    /* Back to a character of our own: the ready-made one comes off. */
    const own=this.root.querySelector('.build-own-btn');
    if(own)own.onclick = () => this.wear('premade','');
    this.root.querySelector('.done').onclick = (e) => this.finish(e.currentTarget);
  }

  /* Each choice, as us wearing it, at one size: small enough for a grid,
   * big enough to tell a fedora from a ranger's hat. */
  paintPictures() {
    this.root.querySelectorAll('canvas[data-pic]').forEach((canvas) => {
      const { look, alone } = this.pictures[Number(canvas.dataset.pic)];
      const draw = () => {
        if (!canvas.isConnected) return;
        if (alone) paintItem(canvas, alone, PICTURE, draw); else paintStage(canvas, look, 'down', 0, PICTURE, draw);
      };
      draw();
    });
  }

  /* RANDOM: different clothes, colours and hair; equipment stays as it is. */
  randomise(random = Math.random) {
    const look = { ...this.look };
    for (const slot of SLOTS) {
      const meta = CATALOG[slot];
      if (!meta) continue;
      const groups = [...groupsOf(slot).values()];
      if (!groups.length) continue;
      if (meta.optional && random() < (BARE[slot] ?? 0.5)) { look[slot] = { ...look[slot], part: '' }; continue; }
      const options = groups[Math.floor(random() * groups.length)];
      look[slot] = { ...look[slot], part: options[Math.floor(random() * options.length)].key };
    }
    this.look = completeLook(look);
    this.onChange(this.look);
    this.render();
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

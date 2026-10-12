"""Pack licensed Minifantasy art, locally, beneath the withheld characters/ tree.

One lazy sheet per whole character/equipment item and a static picker atlas.
No art is embedded in JS. This script neither syncs nor commits anything.
"""
from pathlib import Path
import argparse
import json
import re
from collections import defaultdict
from pnglib import read_png, write_png, over, crop

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ART = Path('/Volumes/DEV/Sprites/characters')
OUT = ROOT / 'public/characters'
ANIM = re.compile(r'walk|idle|dmg|damage|die|fly(?:ing)?|floating|moving|surf|roll|attack', re.I)
# A character that shoots: something in its folder is a shot or a projectile.
RANGED = re.compile(r'shot|projectile|arrow|bolt', re.I)
# ATTACKS THE ART CALLS SOMETHING ELSE -- "Shot", "Possess", "Cast" -- by
# character: where the sheet sits beside its walk, what flies (an arrow, a
# stone or a spell) and the frame it leaves the hand on (None: three fifths
# of the way through). The diagonal sheets face the way the walk does.
OWN_ATTACKS = [
    (r'devoted-stalker$', lambda walk: walk.parent / 'Shot_Diagonal.png', 'arrow', 8),
    (r'feral-arbalist$', lambda walk: walk.parent / 'Shot_Diagonal.png', 'arrow', 10),
    (r'warbreed-arbalist$', lambda walk: walk.parent / 'Shot_Diagonal.png', 'arrow', None),
    (r'rts-orcs-units-hunter-', lambda walk: walk.parent.parent / 'Shot' / walk.name.replace('Walk', 'Shot'), 'arrow', 8),
    (r'true-heroes-iii-ranger$', lambda walk: walk.parent / 'Ranger_SingleShot_Diagonal.png', 'arrow', None),
    (r'orc-scout$', lambda walk: walk.parent / 'Shot_Diagonal.png', 'stone', 9),
    (r'tech-augmented-gunslinger$', lambda walk: walk.parent / 'Shot_Diagonal.png', 'stone', 4),
    (r'dark-channeler$', lambda walk: walk.parent / 'Possess.png', 'spell', 9),
    (r'reanimated-(zombie|skeleton)-mage$', lambda walk: walk.parent / 'Cast.png', 'spell', 4),
]
# What a shooter whose sheet IS called "Attack" sends, when not an arrow.
SHOTS = {r'brain-slayer$': 'spell', r'rat-people-royalty$': 'stone'}
EXCLUDE = re.compile(r'/_?shadows/|/_shadow/|_shadow|_glow|_gif|no.outline|no.effect|only.effect|projectile|impact|preview|example|/Vampirize/', re.I)
PACKS = {'premade': ['AMyriadOfNPCs', 'TrueHeroes', 'True_Heroes', 'True_Villains',
    'Dark_Brotherhood', 'Dark_Orc_Army', 'Forest_Dwellers', 'RTS_Humans', 'RTS_Orcs',
    'Monster_Creatures', 'Nightmare_Creatures', 'Undead_Creatures'],
    'companion': ['Enchanted_Companions'], 'mount': ['Mounts']}

def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def title(s):
    return re.sub(r'([a-z])([A-Z])', r'\1 \2', s).replace('_', ' ').replace('-', ' ').strip().title()

def candidates(pack, category):
    groups = defaultdict(lambda: defaultdict(list))
    for path in sorted(pack.rglob('*.png')):
        rel = str(path.relative_to(pack))
        if EXCLUDE.search(rel) or 'Generic_NPCs' in rel or 'Rider' in rel:
            continue
        if category == 'companion' and '/Companions/' not in '/' + rel:
            continue
        if category == 'mount' and not rel.startswith('Minifantasy_Mounts_Assets/New Mounts/'):
            continue
        match = ANIM.search(path.stem)
        if not match:
            continue
        # A preparation/activation sequence is not a looping idle animation.
        if re.search(r'idle.*(start|end|special|activat)|landmine|defense.tower', rel, re.I):
            continue
        parts = list(path.relative_to(pack).parts[:-1])
        parts = [p for p in parts[1:] if p not in ('General_Animations', '_Regular')]
        if parts and re.search(r'(walk|idle|dmg|die|attack)$', parts[-1], re.I):
            parts.pop()
        stem = ANIM.sub('', path.stem).strip('_ ')
        # Colour/model variants share folders but must remain separate choices.
        suffix = path.stem[match.end():].strip('_ ')
        suffix = ANIM.sub('', suffix).strip('_ ')
        suffix = re.sub(r'layer\s*\d+|disperse|&', '', suffix, flags=re.I).strip('_ ')
        key = '/'.join(parts + ([suffix] if suffix else []))
        if category == 'companion' and parts and parts[-1] == 'Hive_And_Bee':
            key += '/' + path.stem.split('_')[0]
        animation = match.group().lower()
        animation = {'damage': 'dmg', 'fly': 'walk', 'flying': 'walk',
                     'floating': 'walk', 'moving': 'walk', 'surf': 'walk', 'roll': 'walk'}.get(animation, animation)
        groups[key][animation].append(path)
    return groups

def pack_item(category, key, name, paths, extra=None):
    # Count directions from each strip, not a fixed four-row assumption.
    reference = paths.get('walk') or paths.get('idle')
    if reference is None:
        return None
    rw, rh, _ = read_png(str(reference))
    frame = rh // 4 if rh >= 128 else 32
    assert frame in (32, 40, 48, 64, 96), (reference, frame)
    strips, animations, y = [], {}, 0
    for animation in ('walk', 'idle', 'dmg', 'die', 'attack'):
        path = paths.get(animation)
        if path is None:
            continue
        w, h, px = read_png(str(path))
        # A handful of source files have one extra/short column. Keep only
        # complete frames; never let a texture rectangle exceed its sheet.
        count, rows = w // frame, h // frame
        if not count or rows not in (1, 2, 3, 4):
            continue
        # An attack drawn on a bigger canvas than the body cannot be cut into
        # the body's frames: leave it out rather than draw it in pieces.
        if animation == 'attack' and (w % frame or h % frame):
            continue
        animations[animation] = {'y': y, 'frames': count, 'rows': rows,
                                 'ms': 100 if animation in ('dmg', 'die', 'attack') else 200}
        strips.append((w, h, px, y)); y += h
    width = max(s[0] for s in strips)
    pixels = bytearray(width * y * 4)
    for w, h, px, oy in strips:
        over(pixels, width, y, px, w, h, 0, oy)
    target = OUT / category / f'{key}.png'
    target.parent.mkdir(parents=True, exist_ok=True)
    write_png(str(target), width, y, pixels)
    # Bounds of a resting character determine name height and preview framing.
    rest = animations.get('walk') or animations.get('idle')
    thumb = crop(width, y, pixels, 0, rest['y'], frame, frame)
    occupied = [(i % frame, i // frame) for i in range(frame * frame) if thumb[i*4+3]]
    bounds = [min(p[0] for p in occupied), min(p[1] for p in occupied),
              max(p[0] for p in occupied)+1, max(p[1] for p in occupied)+1] if occupied else [8, 8, 24, 20]
    # All 32px bodies preserve the established feet anchor. Large frames use
    # the bottom of their drawn resting body; collisions remain independent.
    item = {'key': key, 'name': name, 'sheet': f'{category}/{key}.png', 'frame': frame,
            'feet': 20 if frame == 32 else bounds[3], 'bounds': bounds, 'animations': animations}
    if extra: item.update(extra)
    return item, (frame, thumb)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--art', type=Path, default=DEFAULT_ART)
    args = parser.parse_args()
    catalog = {key: [] for key in (*PACKS, 'weapon')}
    thumbs = []
    for category, needles in PACKS.items():
        for pack in sorted(args.art.iterdir()):
            if not pack.is_dir() or pack.name.endswith(' 2') or not any(n in pack.name for n in needles):
                continue
            family = re.sub(r'^Minifantasy_|_v\.?[\d.]+$', '', pack.name)
            for group, choices in sorted(candidates(pack, category).items()):
                if not ('walk' in choices or 'idle' in choices): continue
                paths = {a: min(ps, key=lambda p: len(p.stem)) for a, ps in choices.items()}
                key = slug(family + '-' + group)
                # Keep wire ids small, deterministic and valid @ta slugs.
                if len(key) > 120:
                    import hashlib
                    key = key[:108] + '-' + hashlib.sha256(key.encode()).hexdigest()[:10]
                labels = [p for p in group.split('/') if p not in
                          ('Premade_NPCs', 'New Mounts', 'Units', 'Companions')]
                label = ' · '.join(title(p) for p in labels[-2:])
                if len(labels) > 1 and labels[-1] == labels[-2]: label = title(labels[-1])
                extra = {'group': title(family)}
                if category == 'mount':
                    extra['riderY'] = -4 if ('horse' in key or 'unicorn' in key) else -2
                    if 'bicycle' in key: extra['riderY'] = -3
                if category != 'premade': paths.pop('attack', None)
                own = None
                if category == 'premade' and 'attack' not in paths and paths.get('walk'):
                    own = next(((f(paths['walk']), shot, release) for pattern, f, shot, release in OWN_ATTACKS
                                if re.search(pattern, key)), None)
                    if own and own[0].exists(): paths['attack'] = own[0]
                    else: own = None
                result = pack_item(category, key, label, paths, extra)
                if not result: continue
                item, thumb = result
                # A ready-made character with its own attack fights with it:
                # ranged if its folder holds shots or projectiles, else melee.
                if category == 'premade' and 'attack' in item['animations'] and own:
                    item['attack'], item['shot'] = 'ranged', own[1]
                    if own[2] is not None: item['release'] = own[2]
                elif category == 'premade' and 'attack' in item['animations']:
                    folder = paths['attack'].parent
                    item['attack'] = 'ranged' if any(RANGED.search(f.name) for f in folder.parent.rglob('*.png')
                        if f.parent in (folder, folder.parent)) else 'melee'
                    if item['attack'] == 'ranged':
                        item['shot'] = next((s for p, s in SHOTS.items() if re.search(p, key)), 'arrow')
                item['thumb'] = len(thumbs); thumbs.append(thumb)
                catalog[category].append(item)
    weapons = args.art / 'Minifantasy_Weapons_v3.0/Minifantasy_Weapons_Assets'
    for name, folder in [('axe', 'Slash_Attacks/Axe'), ('dagger', 'Slash_Attacks/Dagger'),
                         ('sword', 'Slash_Attacks/Sword'), ('flail', 'Swing_Attacks'),
                         ('whip', 'Swing_Attacks'), ('pitchfork', 'Thrust_Attacks/Pitchfork'),
                         ('spear', 'Thrust_Attacks/Spear'), ('longsword', 'Two_Handed_Attacks/Longsword'),
                         ('waraxe', 'Two_Handed_Attacks/Waraxe'), ('bow', 'Ranged_Attacks/Bow'),
                         ('slingshot', 'Ranged_Attacks/Slingshot')]:
        layers = {}
        for f in sorted((weapons / folder).glob('*.png')):
            if name not in f.stem.lower() or any(x in f.stem.lower() for x in ['projectile','halfling','goblin','dwarf']):continue
            layer = 'back' if f.stem.endswith('_b') else 'front'
            w, h, px = read_png(str(f))
            target = OUT / 'weapon' / f'{name}-{layer}.png'
            target.parent.mkdir(parents=True, exist_ok=True)
            write_png(str(target), w, h, px)
            layers[layer] = {'sheet': f'weapon/{name}-{layer}.png', 'frames': w // 32, 'rows': h // 32}
        assert layers, name
        # Hand travel across the four walk frames, in source pixels. Every
        # weapon has its own table so alignment is tunable without renderer code.
        offsets = {'down': [[0,0],[-1,0],[0,0],[1,0]],
                   'left': [[0,0],[0,-1],[0,0],[0,1]],
                   'up': [[0,0],[1,0],[0,0],[-1,0]],
                   'right': [[0,0],[0,1],[0,0],[0,-1]]}
        catalog['weapon'].append({'key': name, 'name': title(name), 'layers': layers, 'walkOffsets': offsets})
    projectile = weapons / 'Ranged_Attacks/Bow/Shot_Bow_Projectile.png'
    w, h, px = read_png(str(projectile))
    write_png(str(OUT / 'weapon/arrow.png'), w, h, px)
    catalog['arrow'] = {'sheet': 'weapon/arrow.png', 'frames': w // 32, 'rows': h // 32, 'frame': 32}
    sling = weapons / 'Ranged_Attacks/Slingshot/Shot_slingshot_Projectile.png'
    w, h, px = read_png(str(sling))
    write_png(str(OUT / 'weapon/sling-stone.png'), w, h, px)
    catalog['slingStone'] = {'sheet': 'weapon/sling-stone.png', 'frames': w // 32, 'rows': h // 32, 'frame': 32}
    # One small static atlas for the entire picker, including large creatures.
    cell, columns = 48, 16
    rows = (len(thumbs) + columns - 1) // columns
    pixels = bytearray(cell * columns * cell * rows * 4)
    for i, (frame, px) in enumerate(thumbs):
        ox, oy = (i % columns) * cell, (i // columns) * cell
        occupied = [(p % frame, p // frame) for p in range(frame*frame) if px[p*4+3]]
        if not occupied: continue
        left, top = min(p[0] for p in occupied), min(p[1] for p in occupied)
        tw = max(p[0] for p in occupied)-left+1
        th = max(p[1] for p in occupied)-top+1
        # The real bodies are only 7–15px high in a padded 32px frame.
        # Enlarge the DRAWING, not its transparent padding, for a readable grid.
        zoom = max(1, min(4, (cell-8)//max(tw,th)))
        thumb = crop(frame,frame,px,left,top,tw,th)
        over(pixels, cell*columns, cell*rows, thumb, tw, th,
             ox + (cell-tw*zoom)//2, oy + (cell-th*zoom)//2, zoom)
    write_png(str(OUT / 'picker.png'), cell*columns, cell*rows, pixels)
    catalog['picker'] = {'sheet': 'picker.png', 'cell': cell, 'cols': columns, 'rows': rows}
    target = ROOT / 'src/world/adventure-data.js'
    target.write_text('/* Generated by tools/build_adventures.py. Minifantasy: Krishna Palacio. */\nexport default '
                      + json.dumps(catalog, separators=(',', ':')) + ';\n')
    # Only these four subdirectories are generated by this tool. Prune old
    # generated ids (never licensed source art or the existing doll atlases).
    active = {item['sheet'] for kind in PACKS for item in catalog[kind]}
    active.update(layer['sheet'] for item in catalog['weapon'] for layer in item['layers'].values())
    active.add('weapon/arrow.png')
    active.add('weapon/sling-stone.png')
    for kind in (*PACKS, 'weapon'):
        for old in (OUT/kind).glob('*.png'):
            if old.relative_to(OUT).as_posix() not in active: old.unlink()
    print(json.dumps({key: len(catalog[key]) for key in (*PACKS, 'weapon')}))

if __name__ == '__main__': main()

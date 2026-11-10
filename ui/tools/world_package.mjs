#!/usr/bin/env node
/* WORLD PACKAGES FROM THE COMMAND LINE (2026-11-05). See src/editor/package.js
 * for the format.
 *
 *   node tools/world_package.mjs official <out.gwp>   the official world as the
 *        app carries it (src/world/legacy-world.js and public/map), ready to
 *        import on its host -- nolset's own release, needing no bindings
 *   node tools/world_package.mjs verify <file.gwp>    open and check a package:
 *        every byte, the document, and what it points to outside itself
 *
 * A package holds a world's paintings. Keep it local: never commit it to a
 * public repository or post it anywhere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack, unpack } from '../src/editor/package.js';
import { validate } from '../src/world/world-doc.js';
import official, { FILES } from '../src/world/legacy-world.js';

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, file] = process.argv.slice(2);

if (cmd === 'official' && file) {
  const bytes = new Map(Object.entries(FILES).map(([h, f]) => [h, new Uint8Array(fs.readFileSync(path.join(ui, 'public', f)))]));
  const out = pack(official, bytes, { host: '~nolset', note: 'note-~2026.09.26..03.54.17..5634', release: null, built: 'legacy-world' });
  fs.writeFileSync(file, out);
  console.log(`wrote ${file}: ${out.length} bytes`);
}
if ((cmd === 'official' && file) || (cmd === 'verify' && file)) {
  const opened = await unpack(fs.readFileSync(file));
  const errors = validate(opened.doc, Object.fromEntries([...opened.assets].map(([h, a]) => [h, { mime: a.mime, size: a.bytes.length }])));
  console.log(JSON.stringify({
    world: opened.doc.world, from: opened.header.from, made: opened.header.made,
    maps: opened.doc.maps.map((m) => ({ id: m.id, num: m.num, name: m.name, size: m.size, areas: m.areas.length, items: m.items.length, arrivals: m.arrivals.length })),
    assets: [...opened.assets].map(([h, a]) => `${h.slice(0, 12)} ${a.mime} ${a.bytes.length}`),
    bindings: opened.header.bindings, problems: errors,
  }, null, 1));
  if (errors.length) process.exit(1);
} else if (!['official', 'verify'].includes(cmd) || !file) {
  console.error('usage: world_package.mjs official <out.gwp> | verify <file.gwp>');
  process.exit(2);
}

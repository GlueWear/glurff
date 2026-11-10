import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pack, unpack, retarget, bindingsOf, hashesOf, sha256 } from '../editor/package.js';
import legacy, { FILES } from './legacy-world.js';
import { validate } from './world-doc.js';

/* The official map's pictures are no longer in the app (2026-11-10): they
 * are kept, local only, beside the editor's notes -- and are not in the
 * public repository at all, where these two are skipped. */
const ART = new URL('../../../../implementation/map-editor/local/official-map-art/', import.meta.url);
const haveArt = Object.values(FILES).every((f) => fs.existsSync(new URL(f.replace(/^map\//, ''), ART)));
const bytesOf = () => new Map(Object.entries(FILES).map(([h, f]) => [h, new Uint8Array(fs.readFileSync(new URL(f.replace(/^map\//, ''), ART)))]));

test('the official world packs and unpacks byte for byte', { skip: !haveArt && 'the art is not here' }, async () => {
  const bytes = bytesOf();
  for (const [h, b] of bytes) assert.equal(await sha256(b), h, 'the built-in images are named by their hashes');
  const file = pack(legacy, bytes, { host: '~nolset' });
  const out = await unpack(file);
  assert.deepEqual(out.doc, legacy);
  assert.equal(out.assets.size, 4);
  for (const [h, a] of out.assets) assert.deepEqual(a.bytes, bytes.get(h));
  assert.deepEqual(validate(out.doc), []);
  assert.equal(out.header.from.host, '~nolset');
});

test('anything altered, missing or extra is refused', { skip: !haveArt && 'the art is not here' }, async () => {
  const file = pack(legacy, bytesOf());
  const flipped = file.slice(); flipped[flipped.length - 10] ^= 1;
  await assert.rejects(unpack(flipped), /does not match its hash/);
  await assert.rejects(unpack(file.slice(0, file.length - 1)), /cut short/);
  const longer = new Uint8Array(file.length + 3); longer.set(file);
  await assert.rejects(unpack(longer), /does not account for/);
  await assert.rejects(unpack(new TextEncoder().encode('PK\u0003\u0004 not ours')), /not a Glurff world package/);
  const short = new Map(bytesOf()); short.delete(legacy.maps[0].image.src);
  assert.throws(() => pack(legacy, short), /missing/);
});

test('a map\'s original import travels with it', () => {
  const doc = structuredClone(legacy);
  doc.maps[0].source = { src: 'a'.repeat(64), w: 10, h: 10, crop: [0, 0, 10, 10] };
  assert.ok(hashesOf(doc).includes('a'.repeat(64)));
});

test('a dev world\'s notes and hosts are retargeted for production, and nothing else moves', () => {
  const doc = structuredClone(legacy);
  Object.assign(doc.maps[0].areas[1], { mode: 'note', note: 'note-dev', noteHost: '~dolten-dilpun', lease: false }); delete doc.maps[0].areas[1].call;
  doc.maps[0].items.push({ id: 'away', name: 'Away', shape: { t: 'rect', x: 0, y: 0, w: 4, h: 4 }, do: { kind: 'travel', host: '~mignes-magtel' } });
  const b = bindingsOf(doc);
  assert.deepEqual(b.filter((x) => x.kind !== 'context').map((x) => [x.kind, x.where]), [['note', 'area bar'], ['world', 'item away']]);
  assert.ok(b.some((x) => x.kind === 'context' && x.value === 'HOST') === false, 'HOST needs no retargeting');
  const prod = retarget(doc, { notes: { 'note-dev': { note: 'note-prod', host: '~nolset' } }, worlds: { '~mignes-magtel': '~nolset' } });
  assert.equal(prod.maps[0].areas[1].note, 'note-prod'); assert.equal(prod.maps[0].areas[1].noteHost, '~nolset');
  assert.equal(prod.maps[0].items.at(-1).do.host, '~nolset');
  const pong = prod.maps[0].items.find((x) => x.id === 'pong-table');
  assert.deepEqual(pong.do, legacy.maps[0].items.find((x) => x.id === 'pong-table').do, 'the world\'s own app spot is untouched');
  assert.deepEqual(doc.maps[0].areas[1].note, 'note-dev', 'the original is not changed');
});

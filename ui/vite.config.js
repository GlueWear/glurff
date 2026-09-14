import { defineConfig } from 'vite';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

/* A version for the static files Vite does not fingerprint -- sprites and the
 * noise worklet -- taken from their CONTENT. Artwork that has not changed keeps
 * the same URL from one deploy to the next, so browsers keep their cached
 * copies. Versioning by the bundle's hash made every deploy download every
 * sprite again. */
function assetVersion() {
  const hash = crypto.createHash('sha256');
  const add = (file) => {
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) if (!name.startsWith('.')) add(path.join(file, name));
      return;
    }
    hash.update(path.relative('public', file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
  };
  for (const file of ['public/sprites', 'public/denoise-worklet.js']) if (fs.existsSync(file)) add(file);
  return hash.digest('hex').slice(0, 12);
}

export default defineConfig({
  base: '/apps/glurff/',
  define: { __ASSET_VERSION__: JSON.stringify(assetVersion()) },
  resolve: {
    alias: {
      lib: path.resolve('./src/lib'),
      world: path.resolve('./src/world'),
      ui: path.resolve('./src/ui'),
    },
  },
  build: { target: 'esnext', assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port: 3000 },
});

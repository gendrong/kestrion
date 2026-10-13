/** Writes the site's default share image (apps/web/public/og-default.png). Run: npm run og:default -w @kestrion/jobs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDefaultOg } from './og';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web/public/og-default.png');
fs.writeFileSync(out, await renderDefaultOg());
console.log(`wrote ${out}`);

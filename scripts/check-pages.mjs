import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const html=readFileSync('dist/index.html','utf8');
assert(html.includes('/yoga_studio/assets/'),'Assets must use repository base path');
assert(html.includes('href="/yoga_studio/manifest.webmanifest"'),'Manifest must use repository base path');
assert(!/(?:src|href)="\/(?:assets|icon|manifest)/.test(html),'Root-only resource URL found');
const manifest=JSON.parse(readFileSync('dist/manifest.webmanifest','utf8'));
assert.equal(manifest.name,'Yoga Studio');assert.equal(manifest.short_name,'Yoga Studio');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
for(const icon of manifest.icons){assert(!icon.src.startsWith('/'));assert(existsSync(`dist/${icon.src}`));}
assert(!readFileSync('dist/sw.js','utf8').includes('__BUILD_ID__'),'Service worker must be versioned by build');
const version=JSON.parse(readFileSync('package.json','utf8')).version;
assert(/^\d+\.\d+\.\d+$/.test(version),'Release version must be semantic');
const lock=JSON.parse(readFileSync('package-lock.json','utf8'));
assert.equal(lock.version,version,'Lockfile version must match package.json');
assert.equal(lock.packages[''].version,version,'Lockfile root package version must match');
console.log('GitHub Pages path, manifest, icons and service-worker artifact checks passed.');

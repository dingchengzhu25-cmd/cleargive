import fs from 'node:fs';
import {createHash} from 'node:crypto';
import { build } from 'esbuild';
import { compile } from './compile.mjs';
compile();
const {ensureStartupCheckpoint}=await import('./startup-checkpoint.mjs');
await ensureStartupCheckpoint();
fs.mkdirSync('dist', { recursive: true });
fs.cpSync('public', 'dist', { recursive: true, filter:source=>!source.split('/').some(part=>part.startsWith('.')) });
fs.copyFileSync('node_modules/ganache/dist/web/ganache.min.js', 'dist/ganache.min.js');
// Ship the licence notices of the third-party code copied or bundled into dist/.
fs.mkdirSync('dist/licenses', { recursive: true });
fs.copyFileSync('node_modules/ganache/LICENSE', 'dist/licenses/ganache.txt');
fs.copyFileSync('node_modules/ganache/dist/web/ganache.min.js.LICENSE.txt', 'dist/licenses/ganache-bundled-dependencies.txt');
fs.copyFileSync('node_modules/ethers/LICENSE.md', 'dist/licenses/ethers.txt');
await build({ entryPoints: ['src/app.js'], inject:['src/browser-buffer.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/app.js', legalComments: 'eof' });
await build({ entryPoints: ['src/live.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/live.js', legalComments: 'eof' });
await build({ entryPoints: ['src/worker.js'], bundle: true, minify: true, format: 'esm', target: 'es2022', outfile: 'dist/_worker.js', legalComments: 'eof' });
// Version browser assets so an existing visitor receives the current UI after deployment.
for (const html of ['index.html','demo.html','photo-credits.html']) {
  const file = `dist/${html}`; let content = fs.readFileSync(file,'utf8');
  for (const asset of ['app.js','live.js','styles.css','ganache.min.js']) {
    const version = createHash('sha256').update(fs.readFileSync(`dist/${asset}`)).digest('hex').slice(0,12);
    content = content.replaceAll(`/${asset}\"`, `/${asset}?v=${version}\"`);
  }
  fs.writeFileSync(file,content);
}
console.log('ClearGive built: Solidity compiled and browser app bundled.');

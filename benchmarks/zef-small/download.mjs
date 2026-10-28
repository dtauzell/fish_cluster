import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const root = new URL('./', import.meta.url);
const m = JSON.parse(readFileSync(new URL('manifest.json', root)));
for (const frame of m.frames) {
  const name = String(frame).padStart(6, '0') + '.jpg';
  const target = new URL('data/' + name, root);
  if (!existsSync(target)) execFileSync('curl', ['-L', '--fail', '--retry', '2', '-sS',
    `https://huggingface.co/datasets/vapaau/3D-ZeF/resolve/${m.revision}/data/${m.sequence}/imgT/${name}`, '-o', target.pathname], {stdio:'inherit'});
}
console.log('Benchmark images ready.');

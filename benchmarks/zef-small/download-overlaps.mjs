import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),root=new URL('./',import.meta.url),m=JSON.parse(readFileSync(new URL('manifest.json',root)));
mkdirSync(new URL('overlap-data/',root),{recursive:true});
const frames=[...new Set([...[1141,1441].flatMap(start=>Array.from({length:41},(_,i)=>start+i*3))])];
let next=0;
await Promise.all(Array.from({length:4},async()=>{while(next<frames.length){const n=frames[next++],name=String(n).padStart(6,'0')+'.jpg',path=new URL('overlap-data/'+name,root);if(existsSync(path))continue;await run('curl',['-L','--fail','--retry','2','--max-time','90','-sS',`https://huggingface.co/datasets/vapaau/3D-ZeF/resolve/${m.revision}/data/${m.sequence}/imgT/${name}`,'-o',path.pathname]);}}));
console.log(`${frames.length} overlap frames ready`);

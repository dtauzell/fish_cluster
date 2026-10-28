import {score} from './scoring.mjs';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {grayscale,medianBackground,detectBackgroundFish} from '../../dist/background.mjs';
const root=new URL('./',import.meta.url), m=JSON.parse(readFileSync(new URL('manifest.json',root)));
for(const [name,expected] of Object.entries(JSON.parse(readFileSync(new URL('checksums.json',root))))) {
 const actual=createHash('sha256').update(readFileSync(new URL('data/'+name,root))).digest('hex');
 if(actual!==expected)throw Error(`Fixture checksum mismatch: ${name}`);
}
const rows=readFileSync(new URL('data/gt.txt',root),'utf8').trim().split(/\r?\n/).map(r=>r.split(',').map(Number));
const out=new URL('results/',root); mkdirSync(out,{recursive:true});
const {x:cx,y:cy,width:w,height:h}=m.crop;
const frames=m.frames.map(n=>{
 const name=String(n).padStart(6,'0')+'.jpg';
 const rgba=execFileSync('ffmpeg',['-v','error','-i',new URL('data/'+name,root).pathname,'-vf',`crop=${w}:${h}:${cx}:${cy}:exact=1`,'-pix_fmt','rgba','-f','rawvideo','-'],{maxBuffer:20e6});
 return {n,name,gray:grayscale({data:rgba,width:w,height:h})};
});
const background=medianBackground(frames.map(f=>f.gray));
const results=[];let cards='';
for(const f of frames){
 // GT columns 5–11: top-view head x/y, box x/y/width/height, occlusion.
 const all=rows.filter(r=>r[0]===f.n).map(r=>({id:r[1],x:r[7]-cx,y:r[8]-cy,w:r[9],h:r[10],occluded:r[11]!==0}));
 if(all.some(b=>b.x<0||b.y<0||b.x+b.w>w||b.y+b.h>h))throw Error('Ground truth outside fixed crop');
 const boxes=all.filter(b=>!b.occluded&&b.w>0&&b.h>0);
 const detections=detectBackgroundFish(f.gray,background,w,h,{expectedFish:m.expectedFish});
 const result={frame:f.n,...score(detections,all),detections};results.push(result);
 const overlay=all.map(b=>`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="none" stroke="${b.occluded?'orange':'lime'}" stroke-width="3"/>`).join('')+detections.map(d=>`<circle cx="${d.x}" cy="${d.y}" r="7" fill="none" stroke="red" stroke-width="3"/>`).join('');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><image href="data:image/jpeg;base64,${readFileSync(new URL('data/'+f.name,root)).toString('base64')}" x="${-cx}" y="${-cy}" width="${m.width}" height="${m.height}"/>${overlay}</svg>`;
 writeFileSync(new URL(`${f.n}.svg`,out),svg);cards+=`<article><h2>Frame ${f.n}: ${result.tp} visible matched, ${result.fn} visible missed; ${result.occludedTp} occluded matched, ${result.occludedFn} occluded missed; ${result.fp} extra</h2><img width="600" src="${f.n}.svg" alt="Ground truth boxes and detector centers for frame ${f.n}"></article>`;
}
const totals=results.reduce((a,r)=>{for(const k of ['tp','fn','fp','occludedTp','occludedFn'])a[k]+=r[k];return a;},{tp:0,fn:0,fp:0,occludedTp:0,occludedFn:0});
const metrics={...totals,precision:(totals.tp+totals.occludedTp)/(totals.tp+totals.occludedTp+totals.fp)||0,visibleRecall:totals.tp/(totals.tp+totals.fn)||0,occludedRecall:totals.occludedTp/(totals.occludedTp+totals.occludedFn)||0,overallRecall:(totals.tp+totals.occludedTp)/(totals.tp+totals.occludedTp+totals.fn+totals.occludedFn)||0};
const report={sequence:m.sequence,frames:m.frames,metrics,results};
writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL('index.html',out),`<!doctype html><html lang="en"><meta charset="utf-8"><title>3D-ZeF small benchmark</title><style>body{font:16px system-ui;max-width:900px;margin:32px auto}img{max-width:100%}</style><h1>3D-ZeF detection benchmark</h1><p>Green: visible ground truth boxes; orange: occluded; red: detector centers. A match requires a center inside a box. Visible and occluded fish are scored separately, with visible matches assigned first. Occluded labels may be estimated: their scores are diagnostic. Detection only; no identity or head-position score.</p><pre>${JSON.stringify(metrics,null,2)}</pre>${cards}</html>`);
console.log(JSON.stringify(metrics,null,2));
if(process.argv.includes('--save-baseline'))writeFileSync(new URL('baseline.json',root),JSON.stringify({metrics},null,2)+'\n');
else {const baseline=JSON.parse(readFileSync(new URL('baseline.json',root))).metrics;
 if(metrics.tp<baseline.tp||metrics.occludedTp<baseline.occludedTp||metrics.fp>baseline.fp) {console.error('Detection regression against baseline');process.exitCode=1;}}

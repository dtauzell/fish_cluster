import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {score} from './scoring.mjs';
const root=new URL('./',import.meta.url),source=new URL('../../dist/background.mjs',root);
const expose=(url,extra)=>'data:text/javascript;base64,'+Buffer.from(readFileSync(url,'utf8').replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,url).href}'`)+extra).toString('base64');
const {grayscale,medianBackground,darkPixelMask,excludeBorders,detectBackgroundFish}=await import(expose(source,'\nexport {darkPixelMask,excludeBorders};'));
const {splitJoinedBlob}=await import(expose(new URL('../../dist/blob-splitting.mjs',root),'\nexport {splitJoinedBlob};'));
const {connectedRegions}=await import('../../dist/connected-regions.mjs');
for(const [name,expected] of Object.entries(JSON.parse(readFileSync(new URL('overlap-checksums.json',root))))) {
 if(createHash('sha256').update(readFileSync(new URL('overlap-data/'+name,root))).digest('hex')!==expected)throw Error('Fixture checksum mismatch: '+name);
}
const m=JSON.parse(readFileSync(new URL('manifest.json',root))),w=m.width,h=m.height;
function decode(path){return grayscale({width:w,height:h,data:execFileSync('ffmpeg',['-v','error','-i',path.pathname,'-pix_fmt','rgba','-f','rawvideo','-'],{maxBuffer:20e6})});}
const bg=medianBackground(m.frames.map(n=>decode(new URL(`data/${String(n).padStart(6,'0')}.jpg`,root))));
const labels=readFileSync(new URL('data/gt.txt',root),'utf8').trim().split(/\r?\n/).map(r=>r.split(',').map(Number));
// Independent constant-velocity Kalman filters for x and y. Units: pixels, seconds.
function axis(p){return {p,v:0,a:100,b:0,c:0,d:40000};}
function predict(s,dt){s.p+=dt*s.v;const {a,b,c,d}=s,q=40000;s.a=a+dt*(b+c)+dt*dt*d+q*dt**4/4;s.b=b+dt*d+q*dt**3/2;s.c=c+dt*d+q*dt**3/2;s.d=d+q*dt*dt;}
function update(s,z,r){const a=s.a,b=s.b,c=s.c,d=s.d,k=a/(a+r),l=c/(a+r),e=z-s.p;s.p+=k*e;s.v+=l*e;s.a=(1-k)*a;s.b=(1-k)*b;s.c=c-l*a;s.d=d-l*b;}
function point(t){return {x:t.x.p,y:t.y.p};}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
const out=new URL('results/overlap-experiment/',root);mkdirSync(out,{recursive:true});
const results=[];let cards='';
for(const start of [1141,1441]){
 let tracks=[];
 for(let n=start;n<=start+120;n+=3){
 const name=String(n).padStart(6,'0')+'.jpg',file=new URL('overlap-data/'+name,root),gray=decode(file);
 const gt=labels.filter(r=>r[0]===n).map(r=>({id:r[1],x:r[7],y:r[8],w:r[9],h:r[10],occluded:r[11]!==0}));
 const baseline=detectBackgroundFish(gray,bg,w,h,{expectedFish:2});
 const expanded=detectBackgroundFish(gray,bg,w,h,{expectedFish:2,maxArea:20000});
 const mask=darkPixelMask(gray,bg,w,h,24);excludeBorders(mask,w,h,Math.round(w*12/420),Math.round(h*10/290),Math.round(h*20/290));
 const blobs=connectedRegions(mask,w,h,{minArea:45,maxArea:20000,minLength:10});
 tracks.forEach(t=>{predict(t.x,.05);predict(t.y,.05);});
 let candidates=blobs.map(b=>({...b,source:'observed'}));
 let splits=0;
 if(tracks.length===2){
 const seeds=tracks.map(point);
 // Both predicted centers must be supported within 35 pixels of actual foreground.
 const near=(b,p)=>b.pixels.some(i=>Math.hypot(i%w-p.x,Math.floor(i/w)-p.y)<=35);
 const merged=blobs.filter(b=>b.area>=2500&&seeds.every(p=>near(b,p))).sort((a,b)=>b.area-a.area)[0];
 if(merged){const halves=splitJoinedBlob(merged,w,45,seeds);if(halves){splits++;candidates=candidates.filter(b=>b.pixels!==merged.pixels).concat(halves.map(b=>({...b,source:'split-estimate'})));}}
 }
 const selected=[];
 if(!tracks.length){
 // Initialization uses image evidence only: two largest ordinary-size components.
 const initial=blobs.filter(b=>b.area<=2500).sort((a,b)=>b.area-a.area).slice(0,2);
 if(initial.length===2)tracks=initial.map(b=>({x:axis(b.x),y:axis(b.y),gap:0}));
 selected.push(...initial.map(b=>({...b,source:'observed'})));
 }else{
 // Globally choose distinct candidates with uncertainty-aware motion gating.
 let best={cost:Infinity,assignment:[]};
 function search(i,used,cost,assignment){if(i===tracks.length){if(cost<best.cost)best={cost,assignment:[...assignment]};return;}
 const t=tracks[i],p=point(t);search(i+1,used,cost+9,[...assignment,null]);
 candidates.forEach((b,j)=>{if(used.has(j)||distance(p,b)>180)return;const c=(b.x-p.x)**2/(t.x.a+225)+(b.y-p.y)**2/(t.y.a+225);if(c>16)return;used.add(j);search(i+1,used,cost+c,[...assignment,j]);used.delete(j);});}
 search(0,new Set(),0,[]);
 tracks.forEach((t,i)=>{const j=best.assignment[i];if(j==null){t.gap++;return;}const b=candidates[j],r=b.source==='split-estimate'?900:225;update(t.x,b.x,r);update(t.y,b.y,r);t.gap=0;selected.push(b);});
 }
 const clean=a=>a.map(({pixels,...b})=>b);
 const row={frame:n,baseline:score(baseline,gt),expanded:score(expanded,gt),motion:score(selected,gt),splits,predictions:tracks.map(point),selected:clean(selected)};results.push(row);
 if([start,start+60,start+120].includes(n)){
 const shapes=gt.map(b=>`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" stroke="${b.occluded?'orange':'lime'}" fill="none" stroke-width="4"/>`).join('')+baseline.map(b=>`<circle cx="${b.x}" cy="${b.y}" r="10" fill="none" stroke="red" stroke-width="4"/>`).join('')+selected.map(b=>`<circle cx="${b.x}" cy="${b.y}" r="15" fill="none" stroke="cyan" stroke-width="4"/>`).join('');
 writeFileSync(new URL(`${n}.svg`,out),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="data:image/jpeg;base64,${readFileSync(file).toString('base64')}"/>${shapes}</svg>`);
 cards+=`<h2>Frame ${n}</h2><pre>${JSON.stringify({baseline:row.baseline,motion:row.motion},null,2)}</pre><img width="800" src="${n}.svg">`;
 }
 }
}
const totals={};for(const mode of ['baseline','expanded','motion']){totals[mode]={};for(const k of ['tp','fn','fp','occludedTp','occludedFn'])totals[mode][k]=results.reduce((s,r)=>s+r[mode][k],0);}
const report={totals,splitFrames:results.filter(r=>r.splits).map(r=>r.frame),results};
writeFileSync(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL('index.html',out),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Motion overlap experiment</title><style>body{font:16px system-ui;max-width:1000px;margin:32px auto}img{max-width:100%}</style><h1>Motion-guided overlap experiment</h1><p>82 frames, 20 fps; two independent 2-second windows. Red: original detector. Cyan: experimental selected detections (split positions are estimates). Green/orange: visible/occluded labels. Ground truth is used only for scoring. No identity accuracy claimed.</p><pre>${JSON.stringify(totals,null,2)}</pre>${cards}</html>`);
console.log(JSON.stringify({totals,splitFrames:report.splitFrames,targets:results.filter(r=>[1201,1501].includes(r.frame))},null,2));

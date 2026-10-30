// Build method-guide examples from unmodified movie regression frames.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { detectBackgroundFish, grayscale, medianBackground } from '../dist/background.mjs';
import { analyzeVideo } from '../dist/pipeline.mjs';
const output = new URL('../dist/method-examples/', import.meta.url);
mkdirSync(output, { recursive: true });
function load(name, width, height, compressed = false) {
 const raw=readFileSync(new URL('../tests/fixtures/'+name,import.meta.url));
 const bytes=compressed?gunzipSync(raw):raw,header=Buffer.from(`P5\n${width} ${height}\n255\n`);
 if(!bytes.subarray(0,header.length).equals(header))throw Error('Unexpected fixture header: '+name);
 return bytes.subarray(header.length);
}
function png(name,pixels,width,height){
 const pgm=Buffer.concat([Buffer.from(`P5\n${width} ${height}\n255\n`),pixels]);
 execFileSync('ffmpeg',['-y','-v','error','-f','image2pipe','-i','-','-frames:v','1',new URL(name,output).pathname],{input:pgm});
}
function overlay(name,image,width,height,points,crop,areas=[]){
 const shapes=areas.map(a=>`<rect x="${a.x-crop.x}" y="${a.y-crop.y}" width="${a.width}" height="${a.height}" fill="#f6d979" fill-opacity=".15" stroke="#f6d979" stroke-width="2"/>`).join('');
 const dots=points.map((p,i)=>{const x=p.x-crop.x,y=p.y-crop.y,color=p.rejectionReason?'#ff5d8f':p.splitFromBlob?'#ffb347':'#00ffb3';return `<g><circle cx="${x}" cy="${y}" r="7" fill="none" stroke="${color}" stroke-width="2"/><text x="${Math.min(width-24,x+8)}" y="${Math.max(16,y-8)}" font-family="sans-serif" font-size="13" font-weight="bold" fill="${color}" stroke="#071a22" stroke-width="2" paint-order="stroke">${p.rejectionReason?'×':p.splitFromBlob?'†':''}${p.detectionId??i+1}</text></g>`;}).join('');
 writeFileSync(new URL(name,output),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img"><title>Movie frame with detector annotations</title><image href="data:image/png;base64,${readFileSync(new URL(image,output)).toString('base64')}" width="${width}" height="${height}"/>${shapes}${dots}</svg>`);
}
const bg=load('false-overlap/background.pgm.gz',420,290,true),before=load('false-overlap/previous.pgm.gz',420,290,true),current=load('false-overlap/current.pgm.gz',420,290,true);
png('background.png',bg,420,290);png('separate.png',current,420,290);
png('foreground.png',Buffer.from(current.map((v,i)=>bg[i]-v>=24?255:0)),420,290);
const options={expectedFish:5,preferCenter:true,thresholdOverlap:true};
const previousDetections=detectBackgroundFish(before,bg,420,290,options);
const separate=detectBackgroundFish(current,bg,420,290,{...options,previousDetections,previousTimestampMs:1400});
overlay('separate.svg','separate.png',420,290,separate,{x:0,y:0});
const crop={x:50,y:200,width:420,height:330};
const background=load('tank-background.pgm',420,330),frames=[load('frame-583.pgm',420,330),load('frame-584.pgm',420,330)];
png('overlap.png',frames[1],420,330);
const config={crop,expectedFish:5,preferCenter:true,intervalMs:200,thresholdPx:45.9,pixelsPerInch:30.6,
 exclusions:[{x:390,y:200,width:80,height:330,preferenceOnly:true}]};
let reads=0,time=0;const source={seekTo:async t=>{time=t;},readGray:()=>reads++<1?background:frames[Math.round(time*5)]};
const saved=[];for await(const event of analyzeVideo({config,duration:.21,source}))if(event.frame)saved.push(event.frame);
const overlap=saved[1];
overlay('overlap.svg','overlap.png',420,330,[...overlap.detections,...overlap.rejectedDetections],crop,config.exclusions);

// Native 3D-ZeF validation footage already stored as benchmark images in this repo.
const zefRoot=new URL('../benchmarks/zef-small/',import.meta.url);
const zef=JSON.parse(readFileSync(new URL('manifest.json',zefRoot)));
function jpg(name){return grayscale({width:zef.width,height:zef.height,data:execFileSync('ffmpeg',['-v','error','-i',new URL(name,zefRoot).pathname,'-pix_fmt','rgba','-f','rawvideo','-'],{maxBuffer:20e6})});}
const zefBackground=medianBackground(zef.frames.map(n=>jpg(`data/${String(n).padStart(6,'0')}.jpg`)));
const zefCurrent=jpg('overlap-data/001501.jpg'),detail={x:1600,y:1180,width:360,height:300};
const detailPixels=Buffer.alloc(detail.width*detail.height);
for(let y=0;y<detail.height;y++)detailPixels.set(zefCurrent.subarray((y+detail.y)*zef.width+detail.x,(y+detail.y)*zef.width+detail.x+detail.width),y*detail.width);
png('threshold-detail.png',detailPixels,detail.width,detail.height);
const thresholdResults=[false,true].map(thresholdOverlap=>({thresholdOverlap,detections:detectBackgroundFish(zefCurrent,zefBackground,zef.width,zef.height,{expectedFish:2,thresholdOverlap})}));
for(const result of thresholdResults)overlay(`threshold-${result.thresholdOverlap?'on':'off'}.svg`,'threshold-detail.png',detail.width,detail.height,result.detections,detail);
const manifest={generatedBy:'node scripts/build-method-examples.mjs',sourceMovie:'fish.mov',
 examples:[{name:'Separate fish',sourceTimeMs:1600,crop:{x:50,y:240,width:420,height:290},options,detections:separate,fixture:'tests/fixtures/false-overlap/'},
 {name:'Overlap and reflection preference',sourceTimeMs:116600,sequenceClock:'Pipeline times 0 and 200 ms correspond to source times 116400 and 116600 ms.',config,frame:overlap,fixtures:['tests/fixtures/frame-583.pgm','tests/fixtures/frame-584.pgm']}]};
manifest.thresholdExample={source:'https://vap.aau.dk/3d-zef/',sequence:'ZebraFish-03',sourceFrameNumber:1501,sourceTimeMs:25000,detailCrop:detail,results:thresholdResults};
writeFileSync(new URL('examples.json',output),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({separate:separate.length,overlap:overlap.detections.length,splits:overlap.detections.filter(p=>p.splitFromBlob).length,rejected:overlap.rejectedDetections.map(p=>({x:p.x,y:p.y,reason:p.rejectionReason}))}));

// A standalone entry point also works when an older offline release caches About.
const guide=readFileSync(new URL('../dist/about.html',import.meta.url),'utf8');
const start=guide.indexOf('<section id="movie-examples"');
if(start<0)throw Error('Missing movie-examples section');
const section=guide.slice(start,guide.indexOf('</section>',start)+10)
 .replaceAll('./method-examples/','./').replaceAll('href="./test-videos.html"','href="../test-videos.html"');
const style=`:root{color-scheme:dark;font:16px/1.65 system-ui;background:#071a22;color:#eaf7f6}body{margin:0}main{max-width:1000px;margin:auto;padding:32px 24px 70px}a{color:#8ce6ce}h1,h2,h3{line-height:1.3}h3{margin-top:36px}.about-number{font-size:12px;color:#8ce6ce}figure{margin:20px 0;min-width:0}img{display:block;width:100%;height:auto;border:1px solid #365760;border-radius:8px}figcaption{font-size:13px;color:#bfd4d1;margin-top:8px}.method-example-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}code{overflow-wrap:anywhere}@media(max-width:600px){.method-example-grid{grid-template-columns:1fr}}`;
writeFileSync(new URL('index.html',output),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Real movie examples — Fish Cluster</title><style>${style}</style><main><nav><a href="../index.html">← Analyzer</a> · <a href="../about.html">About the analysis</a></nav>${section}</main></html>`);

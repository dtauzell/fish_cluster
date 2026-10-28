import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=new URL('./',import.meta.url),source=new URL('../../dist/background.mjs',root);
// Expose private stages in memory; leave production source untouched.
const code=readFileSync(source,'utf8').replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,source).href}'`)
 +'\nexport {darkPixelMask,excludeBorders};';
const {grayscale,medianBackground,darkPixelMask,excludeBorders,detectBackgroundFish}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const {connectedRegions}=await import('../../dist/connected-regions.mjs');
const m=JSON.parse(readFileSync(new URL('manifest.json',root))),w=m.width,h=m.height;
const frames=m.frames.map(n=>({n,gray:grayscale({width:w,height:h,data:execFileSync('ffmpeg',['-v','error','-i',new URL(`data/${String(n).padStart(6,'0')}.jpg`,root).pathname,'-pix_fmt','rgba','-f','rawvideo','-'],{maxBuffer:20e6})})}));
const bg=medianBackground(frames.map(f=>f.gray)),out=new URL('results/diagnostics/',root);mkdirSync(out,{recursive:true});
const summaries=[];
for(const n of [1201,1501]){
 const f=frames.find(f=>f.n===n),mask=darkPixelMask(f.gray,bg,w,h,24);
 excludeBorders(mask,w,h,Math.round(w*12/420),Math.round(h*10/290),Math.round(h*20/290));
 const pgm=Buffer.concat([Buffer.from(`P5\n${w} ${h}\n255\n`),Buffer.from(mask.map(v=>v*255))]);
 execFileSync('ffmpeg',['-y','-v','error','-f','image2pipe','-i','-','-frames:v','1',new URL(`${n}-mask.png`,out).pathname],{input:pgm});
 const regions=connectedRegions(mask.slice(),w,h).filter(b=>b.area>=45).map(({pixels,...b})=>({...b,rejectedBySize:b.area>2500}));
 const variants={};for(const maxArea of [2500,20000])variants[maxArea]=detectBackgroundFish(f.gray,bg,w,h,{expectedFish:2,maxArea});
 summaries.push({frame:n,regions,variants});
}
writeFileSync(new URL('report.json',out),JSON.stringify(summaries,null,2)+'\n');
console.log(JSON.stringify(summaries,null,2));

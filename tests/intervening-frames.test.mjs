import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeVideo} from '../dist/pipeline.mjs';
const width=200,height=70;
const config={crop:{x:0,y:0,width,height},exclusions:[],tankZones:[],expectedFish:1,intervalMs:200,pixelsPerInch:30,thresholdPx:30,trackFish:false};
function image(time){
 const gray=new Uint8Array(width*height).fill(220);
 const paint=(cx,value)=>{for(let y=28;y<38;y++)for(let x=cx-5;x<cx+5;x++)gray[y*width+x]=value;};
 paint(25+time*.4,140);
 if(time>=50)paint(160,60);
 return gray;
}
async function run(interveningFrames){
 let time=0,reads=0;
 const source={seekTo:async t=>{time=t*1000;},readGray:()=>reads++===0?new Uint8Array(width*height).fill(220):image(time),
  async *nativeFrames(){for(const timestampMs of [0,50,100,150,200,220])yield{timestampMs,gray:image(timestampMs)};}};
 const events=[];
 for await(const event of analyzeVideo({config:{...config,interveningFrames},duration:.23,source}))events.push(event);
 return events.filter(e=>e.frame).map(e=>e.frame);
}
test('intervening observations preserve single-fish continuity without adding saved samples',async()=>{
 const sparse=await run(false),dense=await run(true);
 assert.deepEqual(dense.map(f=>[f.frameIndex,f.timestampMs]),[[0,0],[1,200]]);
 assert.ok(sparse[1].detections[0].x>150);
 assert.ok(dense[1].detections[0].x>95&&dense[1].detections[0].x<110);
 assert.equal(dense[1].sourceTimestampMs,200);
});
test('dense processing retains final sample when it lies after final decoded frame',async()=>{
 const source={seekTo:async()=>{},readGray:()=>new Uint8Array(width*height).fill(220),async *nativeFrames(){yield {timestampMs:0,gray:image(0)};yield {timestampMs:180,gray:image(180)};}};
 const frames=[];for await(const event of analyzeVideo({config:{...config,interveningFrames:true},duration:.23,source}))if(event.frame)frames.push(event.frame);
 assert.deepEqual(frames.map(f=>f.timestampMs),[0,200]);assert.equal(frames[1].sourceTimestampMs,180);
});

import {createFishTracker} from '../dist/tracking.mjs';
test('rapid native observations do not establish overlap size evidence too early',()=>{
 const tracker=createFishTracker(3,{minimumObservationSpanMs:200});
 const points=[20,60,100].map(x=>({x,y:30,area:100}));
 tracker.update(points,0);tracker.update(points,30);
 assert.equal(tracker.sizeReference(40),null);
 tracker.update(points,200);
 assert.equal(tracker.sizeReference(210).area,100);
});
test('cancellation closes the native frame iterator without exporting future samples',async()=>{
 let stopped=false,closed=false;
 const source={seekTo:async()=>{},readGray:()=>new Uint8Array(width*height).fill(220),async *nativeFrames(){try{for(const t of [0,50,100,150,200])yield {timestampMs:t,gray:image(t)};}finally{closed=true;}}};
 const frames=[];for await(const e of analyzeVideo({config:{...config,interveningFrames:true},duration:.23,source,isStopped:()=>stopped}))if(e.frame){frames.push(e.frame);stopped=true;}
 assert.equal(frames.length,1);assert.equal(closed,true);
});

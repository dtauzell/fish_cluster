import test from 'node:test';
import assert from 'node:assert/strict';
import {thresholdSplit} from '../dist/threshold-splitting.mjs';
function fixture(bridgeContrast=30){
 const width=40,background=new Uint8Array(800).fill(100),frame=background.slice(),pixels=[];
 for(let y=3;y<13;y++)for(let x=2;x<32;x++){
  if(x>=12&&x<22&&y!==7)continue;
  const i=y*width+x;pixels.push(i);frame[i]=100-(x>=12&&x<22?bridgeContrast:60);
 }
 return {width,background,frame,blob:{pixels,area:pixels.length}};
}
test('threshold sweep separates two bodies connected by weaker contrast',()=>{
 const f=fixture(),r=thresholdSplit(f.blob,f.frame,f.background,f.width);
 assert.equal(r.threshold,32);assert.equal(r.parts.length,2);
 assert.deepEqual(r.parts.map(p=>p.area),[100,100]);
 assert.equal(r.parts[0].x,6.5);assert.equal(r.parts[1].x,26.5);
});
test('uniform connected bodies do not force an unsupported split',()=>{
 const f=fixture(60);assert.equal(thresholdSplit(f.blob,f.frame,f.background,f.width),null);
});
test('size plausibility can reject an otherwise possible split',()=>{
 const f=fixture();assert.equal(thresholdSplit(f.blob,f.frame,f.background,f.width,{minArea:101}),null);
});

import {detectBackgroundFish} from '../dist/background.mjs';
function largePair(){
 const width=180,height=100,background=new Uint8Array(width*height).fill(150),frame=background.slice();
 for(let y=20;y<60;y++)for(let x=20;x<110;x++){
  if(x>=60&&x<70&&(y<36||y>42))continue;
  frame[y*width+x]=(x>=60&&x<70)?120:80;
 }
 for(let y=75;y<81;y++)for(let x=30;x<60;x++)frame[y*width+x]=80;
 return {width,height,background,frame};
}
test('production detector splits oversized fish pair despite reflection filling count',()=>{
 const f=largePair(),options={expectedFish:2,thresholdOverlap:true,edgeX:0,edgeY:0};
 const old=detectBackgroundFish(f.frame,f.background,f.width,f.height,{...options,thresholdOverlap:false});
 assert.equal(old.length,1);
 assert.deepEqual(detectBackgroundFish(f.frame,f.background,f.width,f.height,{expectedFish:2,edgeX:0,edgeY:0}),old);
 const found=detectBackgroundFish(f.frame,f.background,f.width,f.height,options);
 const splits=found.filter(p=>p.splitReason==='threshold-overlap');
 assert.equal(splits.length,2);assert.equal(found.length,3);
 assert.ok(splits.every(p=>p.splitFromBlob&&p.positionUncertain));
});
test('single fish keeps existing area rejection and never runs overlap splitting',()=>{
 const f=largePair();
 const a=detectBackgroundFish(f.frame,f.background,f.width,f.height,{expectedFish:1,edgeX:0,edgeY:0});
 const b=detectBackgroundFish(f.frame,f.background,f.width,f.height,{expectedFish:1,thresholdOverlap:false,edgeX:0,edgeY:0});
 assert.deepEqual(a,b);
});

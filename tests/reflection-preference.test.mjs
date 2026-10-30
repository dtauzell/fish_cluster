import test from 'node:test';
import assert from 'node:assert/strict';
import {preferOutsideReflectionAreas} from '../dist/candidate-selection.mjs';
import {createSettings} from '../dist/settings.mjs';
import {analyzeVideo} from '../dist/pipeline.mjs';
import {applyManualCenters} from '../dist/review.mjs';
const crop={x:0,y:0,width:150,height:60};
const area={x:5,y:5,width:35,height:40,preferenceOnly:true};
const points=[{detectionId:1,x:20,y:25},{detectionId:2,x:70,y:25},{detectionId:3,x:110,y:25}];
test('only excess candidates in marked areas are rejected and IDs are preserved',()=>{
 const result=preferOutsideReflectionAreas(points,[area],2,crop);
 assert.deepEqual(result.detections.map(p=>p.detectionId),[2,3]);
 assert.equal(result.rejectedDetections[0].rejectionReason,'reflection-area-excess');
 assert.equal(result.rejectedDetections[0].inReflectionArea,true);
 assert.equal(points[0].inReflectionArea,undefined);
});
test('fish in marked regions remain when count fits; all-marked candidates are not arbitrarily removed',()=>{
 assert.equal(preferOutsideReflectionAreas(points,[area],3,crop).detections.length,3);
 assert.equal(preferOutsideReflectionAreas(points,[{...crop,preferenceOnly:true}],2,crop).detections.length,3);
 assert.equal(preferOutsideReflectionAreas(points,[],2,crop).detections.length,3);
});
test('center rule cannot favor a marked reflection over an outside fish',()=>{
 const result=preferOutsideReflectionAreas(points,[{x:60,y:0,width:30,height:60}],2,crop,true);
 assert.deepEqual(result.detections.map(p=>p.detectionId),[1,3]);
});
test('pipeline retains marked fish pixels and manual centers while rejecting only excess marked candidates',async()=>{
 for(const count of [2,3]){
  const config=createSettings({expectedFish:count,intervalMs:200,thresholdInches:1,gridPixels:15},crop,150,60,[area]);
  const image=new Uint8Array(150*60).fill(220);
  for(const {x,y} of points)for(let row=y-5;row<y+5;row++)for(let col=x-5;col<x+5;col++)image[row*150+col]=80;
  let reads=0;
  const source={seekTo:async()=>{},readGray:()=>reads++===0?new Uint8Array(image.length).fill(220):image};
  let frame;for await(const event of analyzeVideo({config,duration:.01,source}))if(event.frame)frame=event.frame;
  assert.equal(frame.rawPredictionCount,3);
  assert.equal(frame.detections.length,count);
  assert.equal(frame.rejectedDetections.length,3-count);
  assert.equal(applyManualCenters(frame,[points[0]],config).detections.length,1);
  assert.equal(applyManualCenters(frame,[points[0]],config).detections[0].inReflectionArea,true);
 }
});
test('a soft area may cover the crop without excluding the tank',()=>{
 assert.doesNotThrow(()=>createSettings({expectedFish:2,intervalMs:200,thresholdInches:1,gridPixels:15},crop,150,60,[{...crop,preferenceOnly:true}]));
});

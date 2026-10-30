import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {detectBackgroundFish} from '../dist/background.mjs';
function image(name){const bytes=gunzipSync(readFileSync(new URL(`./fixtures/false-overlap/${name}.pgm.gz`,import.meta.url)));const header=Buffer.from('P5\n420 290\n255\n');assert.deepEqual(bytes.subarray(0,header.length),header);return bytes.subarray(header.length);}
test('fish.mov at 1.6s does not split one passing fish using two previous centers',()=>{
 const background=image('background'),previous=image('previous'),current=image('current');
 for(const thresholdOverlap of [false,true]){
  const options={expectedFish:5,preferCenter:true,thresholdOverlap};
  const previousDetections=detectBackgroundFish(previous,background,420,290,options);
  const found=detectBackgroundFish(current,background,420,290,{...options,previousDetections,previousTimestampMs:1400});
  assert.equal(found.length,5);
  assert.ok(found.every(p=>!p.splitFromBlob));
  for(const point of [{x:113,y:104},{x:90,y:105},{x:159,y:98},{x:140,y:169},{x:140,y:218}])
   assert.ok(found.some(p=>Math.hypot(p.x-point.x,p.y-point.y)<5),JSON.stringify(point));
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {score} from '../benchmarks/zef-small/scoring.mjs';
const box=(occluded=false,x=0)=>({x,y:0,w:10,h:10,occluded});
test('occluded misses are reported separately',()=>{
 const r=score([{x:20,y:20}],[box(true),box(true)]);
 assert.equal(r.occludedFn,2);assert.equal(r.fp,1);assert.equal(r.fn,0);
});
test('a single detection cannot match two overlapping fish',()=>{
 const r=score([{x:5,y:5}],[box(),box(true)]);
 assert.equal(r.tp,1);assert.equal(r.occludedTp,0);assert.equal(r.occludedFn,1);
});
test('occluded matches and duplicate false positives are counted',()=>{
 const r=score([{x:5,y:5},{x:6,y:6}],[box(true)]);
 assert.equal(r.occludedTp,1);assert.equal(r.occludedFn,0);assert.equal(r.fp,1);
});
test('matching reassigns ambiguous detections to maximize matches',()=>{
 const r=score([{x:8,y:5},{x:2,y:5}],[box(),box(false,5)]);
 assert.equal(r.tp,2);assert.equal(r.fp,0);
});

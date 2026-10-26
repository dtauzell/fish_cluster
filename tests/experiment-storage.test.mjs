import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSetup, validateSetup, createExperimentStorage, snapshotResult, summarizeGroups, resultKey, recordsCsv } from '../dist/experiment-storage.mjs';
const report = { observedDurationSeconds: 10, darkTimeSeconds: 8, lightTimeSeconds: 2, unknownTimeSeconds: 0, velocityDurationSeconds: 10, zoneSwitchCount: 1, coverageFraction: 1, averageSpeedPxPerSecond: 2, averageSpeedInchesPerSecond: null };
const context = { frameWidth: 100, frameHeight: 80, crop: { x: 1, y: 2, width: 90, height: 70 }, exclusions: [], tankZones: [{ x: 1, y: 2, width: 30, height: 70, side: 'dark' }], gridPixels: 12 };
test('setups copy geometry and enforce source dimensions and finite bounds', () => {
  const setup = captureSetup(context, 'Tank A'); setup.tankZones[0].x = 5;
  assert.equal(context.tankZones[0].x, 1);
  assert.throws(() => validateSetup(setup, 200, 160), /requires/);
  assert.throws(() => captureSetup({ ...context, crop: { x: 0, y: 0, width: Infinity, height: 2 } }, 'bad'), /fit/);
  assert.throws(() => captureSetup({ ...context, tankZones: [{ ...context.tankZones[0], x: 90 }] }, 'bad'), /fit/);
});
test('setups validate polygon corners', () => {
  assert.throws(() => captureSetup({ ...context, crop: { x: 0, y: 0, width: 50, height: 50, polygon: [{x:0,y:0},{x:50,y:50},{x:0,y:50},{x:50,y:0}] } }, 'bad'), /convex/);
});
test('storage round trips and rejects corrupt data', () => {
  let raw = null; const storage = createExperimentStorage({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  storage.save({ setups: [captureSetup(context, 'Tank A')], results: [] });
  assert.equal(storage.load().setups[0].name, 'Tank A');
  raw = '{'; assert.throws(() => storage.load());
});
test('group averages weight fish equally and count valid speeds', () => {
  const a = snapshotResult({trial:'1',exposure:'low',fishId:'1'}, report);
  const b = snapshotResult({trial:'1',exposure:'low',fishId:'2'}, {...report,observedDurationSeconds:100,darkTimeSeconds:20,lightTimeSeconds:80,averageSpeedPxPerSecond:null});
  const group = summarizeGroups([a,b])[0];
  assert.equal(group.darkFractionMean, .5); assert.equal(group.averageSpeedPxPerSecondN, 1); assert.equal(group.fishCount, 2);
  assert.notEqual(resultKey(a), resultKey(b));
  assert.throws(() => snapshotResult({trial:'',exposure:'low',fishId:'1'}, {observedDurationSeconds:1}));
  assert.match(recordsCsv([{fishId:'a,"b'}]), /a,""b/);
});

test('wrapper snapshots preserve partial status and reject invalid reports', () => {
  const metadata = { trial: ' 1 ', exposure: ' low ', fishId: ' 2 ' };
  const result = snapshotResult(metadata, {testType:'light-dark',fileName:'fish.mov',complete:false,partial:true,summary:report});
  assert.equal(result.partial, true); assert.equal(result.trial, '1'); assert.equal(result.fileName, 'fish.mov');
  for (const changes of [{darkTimeSeconds:NaN}, {unknownTimeSeconds:2}, {coverageFraction:1.2}, {velocityDurationSeconds:11}, {zoneSwitchCount:1.5}]) {
    assert.throws(() => snapshotResult(metadata, {...report,...changes}));
  }
  assert.throws(() => snapshotResult(metadata, {testType:'shoaling',summary:report}), /light.dark/);
  assert.equal(captureSetup(context, 'A').testType, 'light-dark');
  assert.throws(() => captureSetup({...context,testType:'bad'}, 'A'), /type/);
});
test('failed reads preserve original bytes and disable subsequent writes', () => {
  let raw = '{broken'; const storage = createExperimentStorage({getItem:()=>raw,setItem:(_,v)=>{raw=v;}});
  assert.throws(() => storage.load());
  assert.throws(() => storage.save({setups:[],results:[]}), /disabled/);
  assert.equal(raw, '{broken');
});
test('loaded IDs are trimmed before duplicate detection', () => {
  const fish = snapshotResult({trial:'1',exposure:'low',fishId:'1'},report);
  const raw = JSON.stringify({version:1,setups:[],results:[fish,{...fish,fishId:' 1 '}]});
  const storage = createExperimentStorage({getItem:()=>raw,setItem:()=>{}});
  assert.throws(() => storage.load(), /duplicate/);
});

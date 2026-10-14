import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, move } from '../site/engine.js';
import { DEFAULT_DURATION, duration, createClock, createRound, beginRound, expireRound, recordRound, remaining, elapsed, assessment, formatTime, formatElapsed, validateRound, encodeRound, decodeRound } from '../site/assessment.js';

const game = () => newGame({seed:'assessment-test'});

test('Countdown defaults off while the editable preset is two minutes', () => {
  const s=game(), r=createRound(s);
  assert.equal(DEFAULT_DURATION,120);
  assert.equal(r.durationSeconds,0); assert.equal(r.deadline,null);
  assert.equal(remaining(r,999999),null);
  assert.equal(assessment(r,s,999999).status,'off');
  for(const value of [-1, .5, 3601, NaN, Infinity, '120']) assert.throws(()=>duration(value));
  for(const value of [0,1,120,3600]) assert.equal(duration(value),value);
});

test('Deadline includes the exact boundary and never drifts with late callbacks', () => {
  const s=game(), r=beginRound(createRound(s,120),1000);
  assert.equal(r.deadline,121000);
  assert.strictEqual(expireRound(r,120999.9),r);
  assert.equal(remaining(r,120999.9)>0,true);
  const expired=expireRound(r,121000);
  assert.equal(expired.expired,true);
  assert.equal(assessment(expired,s,999999).remainingMs,0);
  assert.equal(assessment(expired,s,999999).result.endedAt,121000);
  assert.strictEqual(expireRound(expired,999999),expired);
  assert.equal(formatTime(120000),'2:00');assert.equal(formatTime(1),'0:01');assert.equal(formatTime(0),'0:00');
});

test('A ready round waits indefinitely and starts only once', () => {
  const s=game(), r=createRound(s,120);
  assert.equal(assessment(r,s,999999).status,'ready');
  assert.equal(remaining(r,999999),120000);
  assert.equal(elapsed(r,999999),0);
  assert.strictEqual(expireRound(r,999999),r);
  const started=beginRound(r,1000000);
  assert.equal(started.startedAt,1000000);assert.equal(started.deadline,1120000);
  assert.strictEqual(beginRound(started,1100000),started);
  assert.deepEqual(decodeRound(encodeRound(s,r)).round,r);
  assert.throws(()=>validateRound({...r,expired:true},s));
  assert.throws(()=>validateRound({...r,deadline:120000},s));
});

test('Untimed elapsed time survives snapshots without acquiring a deadline', () => {
  const s=game(), r=beginRound(createRound(s),1000);
  const restored=decodeRound(encodeRound(s,r));
  assert.deepEqual(restored,{game:s,round:r});
  assert.equal(restored.round.deadline,null);
  assert.strictEqual(expireRound(r,999999),r);
  assert.equal(assessment(r,s,62500).elapsedMs,61500);
  assert.equal(assessment(r,s,62500).remainingMs,null);
  assert.equal(assessment(r,s,62500).enabled,false);
  assert.equal(formatElapsed(999),'0:00');assert.equal(formatElapsed(61500),'1:01');
  assert.equal(formatElapsed(3600000),'1:00:00');assert.equal(formatElapsed(36061000),'10:01:01');
  assert.throws(()=>validateRound({...r,deadline:121000},s));
  assert.throws(()=>validateRound({...r,expired:true},s));
});

test('An in-page clock rollback cannot add time, and wall time covers suspension', () => {
  let wall=1000, mono=0;const now=createClock(()=>wall,()=>mono);
  wall=500;mono=500;assert.equal(now(),1500);
  wall=100000;assert.equal(now(),100000);
  wall=1000;mono=1000;assert.equal(now(),100000);
});

for(const mode of ['classic','insane','2048']) test(`${mode} celebrates a crossing of 2047 once, including 2048`, () => {
  const s={...newGame({seed:'milestone',size:2,mode}),grid:mode==='2048'?[1024,1024,0,0]:[1023,1024,0,0]};
  let r=beginRound(createRound(s,120),1000);
  const next=move(s,'left').state, record=recordRound(r,next,'move');
  assert.equal(record.milestone,true);r=record.round;
  assert.equal(r.maxTile,mode==='2048'?2048:2047);
  const back=recordRound(r,s,'undo');assert.equal(back.milestone,false);
  assert.equal(back.round.maxTile,r.maxTile);
  const again=recordRound(back.round,next,'redo');assert.equal(again.milestone,false);
  assert.equal(again.round.movesMade,1);assert.equal(again.round.undos,1);assert.equal(again.round.redos,1);
  const restored=validateRound(JSON.parse(JSON.stringify(again.round)),next);
  assert.equal(recordRound(restored,next,'move').milestone,false);
});

test('Results use the peak tile and final score, and expired records reject further actions', () => {
  const s=game(), r=recordRound(beginRound(createRound(s,1),1000),{...s,grid:[2047,...s.grid.slice(1)],score:3000},'move').round;
  const ended=expireRound(r,2000), result=assessment(ended,s,2200).result;
  assert.equal(result.maxTile,2047);assert.equal(result.score,s.score);
  assert.equal(result.durationSeconds,1);assert.equal(result.movesMade,1);
  assert.equal(assessment(ended,s,999999).elapsedMs,1000);
  assert.strictEqual(recordRound(ended,{...s,score:9999},'move').round,ended);
});

test('Round snapshots preserve absolute deadlines and completed results across reload and share', () => {
  const s=game(), r=beginRound(createRound(s,120),1000);
  const restored=decodeRound(encodeRound(s,r));
  assert.deepEqual(restored,{game:s,round:r});
  assert.equal(remaining(restored.round,61000),60000);
  const ended=expireRound(restored.round,500000);
  assert.deepEqual(decodeRound(encodeRound(s,ended)).round,ended);
  assert.equal(assessment(ended,s,500000).status,'finished');
  assert.equal(validateRound(undefined,s).durationSeconds,0,'old saves remain untimed');
});

test('Invalid timer and result metadata is rejected before replacing a session', () => {
  const s=game(), r=beginRound(createRound(s,120),1000);
  for(const change of [{version:2},{durationSeconds:5000},{deadline:0},{startedAt:-1},{expired:'yes'},{maxTile:0},{celebrated:true},{movesMade:-1}]) assert.throws(()=>validateRound({...r,...change},s));
  assert.throws(()=>decodeRound('a'.repeat(16001)));
  assert.throws(()=>decodeRound('invalid'));
});

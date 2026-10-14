import test from 'node:test';
import assert from 'node:assert/strict';
import { canMerge, mergeLine, slide, newGame, move, legalMoves, validateState, encodeState, decodeState, launchFromURL, hashSeed, nextRandom, MAX_TILE } from '../site/engine.js';

test('Classic follows the iOS binary rules, including the all-ones exception', () => {
  for (const [a,b,expected] of [[1,1,true],[1,2,true],[2,5,true],[3,3,true],[7,7,true],[2,2,false],[4,4,false],[1,3,false],[3,5,false],[0,1,false]]) assert.equal(canMerge(a,b),expected,`${a}+${b}`);
  assert.equal(canMerge(2**40,1),true);
  assert.equal(canMerge(MAX_TILE,MAX_TILE),false);
});
test('A tile merges only once in a sweep', () => {
  assert.deepEqual(mergeLine([1,1,2,0]).values,[2,2,0,0]);
  assert.deepEqual(mergeLine([1,2,4,0]).values,[3,4,0,0]);
  assert.equal(mergeLine([1,1,3,3]).gain,8);
  assert.deepEqual(mergeLine([0,1,0,2]).values,[3,0,0,0]);
});
test('Insane and 2048 have separate merge and spawn rules', () => {
  assert.deepEqual(mergeLine([3,3,7,7],'insane').values,[4,8,0,0]);
  assert.deepEqual(mergeLine([2,2,2,2],'2048').values,[4,4,0,0]);
  assert.equal(canMerge(1,2,'2048'),false);
  assert.deepEqual(newGame({seed:'test',mode:'2048'}).grid.filter(Boolean),[2,2]);
});
test('All four traversal directions respect rectangular boards', () => {
  const s = {...newGame({seed:'test',rows:2,columns:3}),grid:[1,0,2,1,0,2]};
  assert.deepEqual(slide(s,'left').grid,[3,0,0,3,0,0]);
  assert.deepEqual(slide(s,'right').grid,[0,0,3,0,0,3]);
  assert.deepEqual(slide(s,'up').grid,[2,0,2,0,0,2]);
  assert.deepEqual(slide(s,'down').grid,[0,0,2,2,0,2]);
});
test('No-op moves never spawn, score, count, or advance randomness', () => {
  const s={...newGame({seed:'test',size:2}),grid:[2,0,4,0]};
  const result=move(s,'left');
  assert.equal(result.changed,false); assert.strictEqual(result.state,s);
  assert.throws(()=>move(s,'diagonal'));
});
test('Game-over detection handles full boards and unmergeable equal tiles', () => {
  const s={...newGame({seed:'test',size:2}),grid:[2,2,2,2]};
  assert.deepEqual(legalMoves(s),[]);
  assert.deepEqual(legalMoves({...s,mode:'2048'}),['up','right','down','left']);
  assert.ok(legalMoves({...s,grid:[2,2,2,0]}).length);
});
test('FNV-1a and SplitMix64 match independent published vectors', () => {
  assert.equal(hashSeed('hello'),0xa430d84680aabd0bn);
  assert.deepEqual(nextRandom('0',16),{state:'11400714819323198485',index:15});
  assert.equal(nextRandom('11400714819323198485',16).index,4);
});
for(const mode of ['classic','insane','2048']) for(const [rows,columns] of [[2,3],[3,2],[4,4],[8,8]]) {
  test(`${mode} ${rows}x${columns}: repeatable legal moves, safe tiles, and score invariants`,()=>{
    let state=newGame({seed:'invariants-2047',mode,rows,columns});
    let replay=newGame({seed:'invariants-2047',mode,rows,columns});
    for(let n=0;n<350;n++) {
      const available=legalMoves(state); if(!available.length) break;
      const direction=available[(n*7+3)%available.length];
      const before=JSON.stringify(state),sum=state.grid.reduce((a,b)=>a+b,0);
      const result=move(state,direction);
      assert.equal(JSON.stringify(state),before,'input is immutable');
      assert.equal(result.changed,true);
      assert.equal(result.state.moves,state.moves+1);
      assert.equal(result.state.score,state.score+result.gain);
      assert.deepEqual(validateState(result.state),result.state);
      const nextSum=result.state.grid.reduce((a,b)=>a+b,0);
      if(mode!=='insane') assert.equal(nextSum,sum+(mode==='2048'?2:1));
      else assert.ok(nextSum<=sum+1);
      state=result.state; replay=move(replay,direction).state;
      assert.deepEqual(state,replay);
    }
  });
}
test('Share links round-trip Unicode seeds and preserve the next spawn',()=>{
  let s=newGame({seed:'bits 🌿 中文',rows:5,columns:3,mode:'insane'});
  s=move(s,'right').state;
  const restored=decodeState(encodeState(s));
  assert.deepEqual(restored,s);
  assert.deepEqual(move(restored,'down'),move(s,'down'));
  assert.deepEqual(launchFromURL(new URL('https://example.test/2047/#state='+encodeState(s))),s);
});
test('URL challenges replay deterministically and accept a validated board',()=>{
  const s=launchFromURL(new URL('https://example.test/2047/?seed=hello&size=3&mode=classic&moves=ULDR'));
  let expected=newGame({seed:'hello',size:3});
  for(const direction of ['up','left','down','right']) expected=move(expected,direction).state;
  assert.deepEqual(s,expected);
  assert.deepEqual(launchFromURL(new URL('https://example.test/?size=2&board=1,2,0,0&score=3')).grid,[1,2,0,0]);
  assert.equal(launchFromURL(new URL('https://example.test/?controls=0')),null);
});
test('Malformed inputs fail before altering a board',()=>{
  for(const query of ['size=99','rows=2.5','mode=oops','seed=','moves=XX','size=2&board=1,2','score=3','board=','size=2&board=1,2,3,4&mode=2048','#state=bad']) {
    const link='https://example.test/'+(query.startsWith('#')?'':'?')+query;
    assert.throws(()=>launchFromURL(new URL(link)),query);
  }
  const s=newGame({seed:'valid'});
  for(const change of [{rng:'-1'},{rng:'18446744073709551616'},{moves:-1},{score:NaN},{grid:Array(16).fill(0)},{version:2},{seed:3}]) assert.throws(()=>validateState({...s,...change}));
  assert.throws(()=>decodeState('a'.repeat(6001)));
});

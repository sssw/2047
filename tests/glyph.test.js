import test from 'node:test';
import assert from 'node:assert/strict';
import { bitGlyph } from '../site/glyph.js';

test('Bit squares match iOS leading-space and significant-zero semantics', () => {
  assert.deepEqual(bitGlyph(1).cells, ['hidden','hidden','hidden','one']);
  assert.deepEqual(bitGlyph(2).cells, ['hidden','hidden','one','zero']);
  assert.deepEqual(bitGlyph(8).cells, ['one','zero','zero','zero']);
  assert.deepEqual(bitGlyph(10).cells, ['one','zero','one','zero']);
  assert.deepEqual(bitGlyph(7).cells, ['hidden','one','one','one']);
});
test('Square matrices grow with bit length and never truncate higher bits', () => {
  for (const value of [1,2,15,16,30,127,511,512,2047,65535,65536,2**40+1,2**48-1]) {
    const glyph=bitGlyph(value);
    assert.equal(glyph.cells.length,glyph.side**2);
    assert.equal(glyph.cells.filter(x=>x!=='hidden').map(x=>x==='one'?'1':'0').join(''),value.toString(2));
  }
  assert.equal(bitGlyph(15).side,2);
  assert.equal(bitGlyph(30).side,3);
  assert.equal(bitGlyph(2047).side,4);
});
test('Invalid bit-glyph values are rejected',()=>{
  for(const value of [0,-1,1.5,NaN,Infinity,'3']) assert.throws(()=>bitGlyph(value));
});

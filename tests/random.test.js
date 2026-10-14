import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sha256, hex, hashText, secureIndex, seededIndex } from '../site/random.js';
import { newGame, move, legalMoves, validateState, encodeState, decodeState, launchFromURL, legacySessionKey } from '../site/engine.js';

test('SHA-256 matches independent vectors and native SHA-256 across padding boundaries', () => {
  assert.equal(hashText(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hashText('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  for (const length of [1, 31, 32, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 2048]) {
    const bytes = Uint8Array.from({length}, (_, i) => (i * 47 + 13) % 256);
    assert.equal(hex(sha256(bytes)), createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(hashText('bits 🌿 中文'), createHash('sha256').update('bits 🌿 中文').digest('hex'));
});

test('Random games draw fresh entropy for each spawn and never serialize a future generator', t => {
  let calls = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', array => { array[0] = calls++; return array; });
  const initial = newGame();
  assert.equal(calls, 2);
  assert.equal(initial.randomness, 'random');
  assert.equal(initial.seed, null); assert.equal(initial.rng, null);
  const s = {...initial, grid:[1,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0]};
  legalMoves(s);
  assert.strictEqual(move(s, 'left').state, s);
  assert.equal(calls, 2, 'legal-move inspection and no-ops consume no entropy');
  const a = move(s, 'right').state, b = move(s, 'right').state;
  assert.equal(calls, 4);
  assert.notEqual(a.lastSpawn, b.lastSpawn, 'same board is resampled on every valid random move');
  const restored = decodeState(encodeState(a));
  assert.deepEqual(restored, a);
  assert.equal(restored.rng, null);
  move(restored, legalMoves(restored)[0]);
  assert.equal(calls, 5, 'restoring a snapshot does not restore future entropy');
});

test('Uniform selection rejects the biased tail and still draws entropy for one empty cell', t => {
  const values = [0xffffffff, 4, 8]; let calls = 0;
  t.mock.method(globalThis.crypto, 'getRandomValues', array => { array[0] = values[calls++]; return array; });
  assert.equal(secureIndex(3), 1);
  assert.equal(calls, 2);
  assert.equal(secureIndex(1), 0); assert.equal(calls, 3);
  for (const bound of [0, -1, 1.5, 65]) assert.throws(() => secureIndex(bound));
});

test('Seeded moves never request fresh entropy and remain reproducible after restoring', t => {
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('unexpected entropy'); });
  let a = newGame({seed:'repeatable 🌿'}), b = newGame({seed:'repeatable 🌿'});
  for (let n = 0; n < 80; n++) {
    const choices = legalMoves(a); if (!choices.length) break;
    const direction = choices[n % choices.length];
    a = move(a, direction).state; b = move(decodeState(encodeState(b)), direction).state;
    assert.deepEqual(a, b);
  }
  assert.equal(a.randomness, 'seeded'); assert.match(a.rng, /^[0-9a-f]{64}$/);
});

test('Every part of the position and branch changes the seeded continuation', () => {
  const s = newGame({seed:'coupling'});
  const original = seededIndex(s, 'left', 16).state;
  const board = [...s.grid]; board[0] = (board[0] || 0) + 1;
  for (const change of [{grid:board},{score:s.score+1},{moves:s.moves+1},{mode:'insane'},{seed:'other'},{rng:'0'.repeat(64)},{rows:3},{columns:3}]) {
    assert.notEqual(seededIndex({...s,...change}, 'left', 16).state, original);
  }
  assert.notEqual(seededIndex(s, 'right', 16).state, original);
  assert.deepEqual(seededIndex(s, 'left', 16), seededIndex(structuredClone(s), 'left', 16));
});

test('A random-source failure leaves the input board unchanged and does not fall back to a seed', t => {
  const s = {...newGame({seed:'fixture'}), seed:null, randomness:'random', rng:null};
  const before = structuredClone(s);
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('entropy unavailable'); });
  assert.throws(() => move(s, legalMoves(s)[0]), /entropy unavailable/);
  assert.deepEqual(s, before);
});

test('Only explicit seeds opt URL configurations into deterministic play', () => {
  for (const query of ['size=3','mode=classic','size=2&board=1,2,0,0&score=3']) {
    const s = launchFromURL(new URL('https://example.test/?'+query));
    assert.equal(s.randomness, 'random'); assert.equal(s.seed, null);
  }
  const url = new URL('https://example.test/?seed=hello&moves=ULDR&save=0');
  assert.deepEqual(launchFromURL(url), launchFromURL(url));
  assert.equal(launchFromURL(url).randomness, 'seeded');
});

test('Old snapshots and URL save keys retain their position and upgrade consistently', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/legacy-session.json', import.meta.url)));
  assert.equal(legacySessionKey(new URL(fixture.url)), fixture.key);
  for (const old of [fixture.initial, fixture.state, ...fixture.past, ...fixture.future]) {
    const upgraded = validateState(old);
    assert.equal(upgraded.version, 2); assert.equal(upgraded.randomness, 'seeded');
    for (const field of ['grid','score','moves','seed','lastSpawn','rows','columns','mode']) assert.deepEqual(upgraded[field], old[field]);
    assert.deepEqual(validateState(upgraded), upgraded);
    const encoded = Buffer.from(JSON.stringify(old)).toString('base64url');
    assert.deepEqual(decodeState(encoded), upgraded);
    const direction = legalMoves(upgraded)[0];
    assert.deepEqual(move(upgraded,direction), move(decodeState(encoded),direction));
  }
});

test('Malformed version-2 generation state is rejected before use', () => {
  const random = newGame(), seeded = newGame({seed:'valid'});
  for (const change of [{rng:'0'.repeat(64)},{seed:'x'},{randomness:'seeded'},{randomness:'unknown'}]) assert.throws(() => validateState({...random,...change}));
  for (const change of [{rng:null},{rng:'a'.repeat(63)},{rng:'g'.repeat(64)},{randomness:'random'},{seed:null}]) assert.throws(() => validateState({...seeded,...change}));
});

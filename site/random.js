// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// SHA-256 (FIPS 180-4) is used for deterministic game mixing, not secret storage.
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const encoder = new TextEncoder();
const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
export const SEED_ROUNDS = 32; // Part of saved-game version 2; changing it requires a new version.

export function sha256(bytes) {
  const data = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(data.length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(data.length - 4, (bytes.length * 8) >>> 0);
  const hash = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15], y = words[i - 2];
      const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
      const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = hash;
    for (let i = 0; i < 64; i++) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (h + sum1 + choose + K[i] + words[i]) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a,b,c,d,e,f,g,h].forEach((value, i) => { hash[i] = (hash[i] + value) >>> 0; });
  }
  const digest = new Uint8Array(32), output = new DataView(digest.buffer);
  hash.forEach((word, i) => output.setUint32(i * 4, word));
  return digest;
}

export const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const hashText = text => hex(sha256(encoder.encode(text)));

function boundLimit(upperBound) {
  if (!Number.isInteger(upperBound) || upperBound < 1 || upperBound > 64) throw new Error('Invalid spawn bound.');
  return Math.floor(0x100000000 / upperBound) * upperBound;
}

export function secureIndex(upperBound) {
  const limit = boundLimit(upperBound);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Random play requires browser random-number support. Try a seeded game.');
  const word = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(word); } while (word[0] >= limit);
  return word[0] % upperBound;
}

export function seededIndex(state, direction, upperBound) {
  const limit = boundLimit(upperBound);
  // Each branch must resolve its full position before deriving the next spawn.
  let digest = sha256(encoder.encode(JSON.stringify([
    '2047/spawn/v2', state.seed, state.rng, state.mode, state.rows, state.columns,
    state.moves, state.score, state.grid, direction
  ])));
  const roundInput = new Uint8Array(36);
  for (let round = 1; round < SEED_ROUNDS; round++) {
    roundInput.set(digest); roundInput[35] = round;
    digest = sha256(roundInput);
  }
  let word = new DataView(digest.buffer).getUint32(0);
  while (word >= limit) {
    digest = sha256(digest);
    word = new DataView(digest.buffer).getUint32(0);
  }
  return { index: word % upperBound, state: hex(digest) };
}
